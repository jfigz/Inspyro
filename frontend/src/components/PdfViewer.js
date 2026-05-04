import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';

const PAGE_GAP_PX = 20;
const PAGE_SIDE_PADDING_PX = 24;
const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;
const RENDER_BUFFER_PAGES = 2;
const VIEWPORT_ACTIVE_ANCHOR_RATIO = 0.25;
const EMPTY_DOCUMENT_META = {
  numPages: 0,
  outline: [],
  hasOutline: false,
};

let pdfjsModulePromise = null;

const loadPdfJsModule = async () => {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/webpack').then((module) => module?.default || module);
  }
  try {
    return await pdfjsModulePromise;
  } catch (error) {
    pdfjsModulePromise = null;
    throw error;
  }
};

const destroyPdfResources = async (loadingTask, documentProxy) => {
  const destroyables = [];
  if (loadingTask?.destroy) {
    destroyables.push(loadingTask);
  }
  if (documentProxy?.destroy && documentProxy !== loadingTask) {
    destroyables.push(documentProxy);
  }

  for (const resource of destroyables) {
    try {
      await resource.destroy();
    } catch {
      // Ignore teardown races from stale pdf.js resources.
    }
  }
};

const parsePdfLink = (rawUrl) => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }

  try {
    const resolved = new URL(
      rawUrl,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    );
    const provenanceId = resolved.searchParams.get('provenance_id');
    const isProvenance = resolved.pathname.endsWith('/api/docx/provenance/open') && Boolean(provenanceId);
    return {
      url: resolved.toString(),
      provenanceId: isProvenance ? provenanceId : null,
      isProvenance,
    };
  } catch {
    return {
      url: rawUrl,
      provenanceId: null,
      isProvenance: false,
    };
  }
};

const normalizeOutlineTitle = (title) => (
  typeof title === 'string'
    ? title.replace(/\s+/g, ' ').trim()
    : ''
);

const toFiniteNumber = (value) => (
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
);

const clampRatio = (value) => {
  const numericValue = toFiniteNumber(value);
  if (numericValue == null) {
    return null;
  }
  return Math.min(Math.max(numericValue, 0), 1);
};

const clampToRange = (value, min, max) => {
  const numericValue = toFiniteNumber(value);
  if (numericValue == null) {
    return min;
  }
  return Math.min(Math.max(numericValue, min), max);
};

const normalizeDestinationMode = (destination) => {
  const rawMode = destination?.[1]?.name;
  return typeof rawMode === 'string' && rawMode.trim()
    ? rawMode.trim()
    : null;
};

const serializeDestinationArg = (value) => {
  if (value == null) return 'null';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'object' && typeof value.name === 'string' && value.name.trim()) {
    return `name:${value.name.trim()}`;
  }
  return '';
};

const getDestinationCacheKey = (destination) => {
  if (typeof destination === 'string' && destination.trim()) {
    return `named:${destination.trim()}`;
  }
  if (!Array.isArray(destination) || !destination[0]) {
    return null;
  }
  let pageToken = null;
  const ref = destination[0];
  if (typeof ref === 'object' && Number.isInteger(ref?.num)) {
    pageToken = `ref:${ref.num}:${Number.isInteger(ref.gen) ? ref.gen : 0}`;
  } else if (Number.isInteger(ref)) {
    pageToken = `page:${ref}`;
  }
  if (!pageToken) {
    return null;
  }
  const mode = normalizeDestinationMode(destination) || 'page';
  const args = destination.slice(2).map(serializeDestinationArg).join(':');
  return `dest:${pageToken}:${mode}:${args}`;
};

const getDestinationAnchorInputs = (explicitDestination, destinationMode) => {
  const mode = destinationMode || 'page';
  switch (mode) {
    case 'XYZ':
      return {
        left: toFiniteNumber(explicitDestination?.[2]),
        top: toFiniteNumber(explicitDestination?.[3]),
      };
    case 'FitH':
    case 'FitBH':
      return {
        left: null,
        top: toFiniteNumber(explicitDestination?.[2]),
      };
    case 'FitR':
      return {
        left: toFiniteNumber(explicitDestination?.[2]),
        top: toFiniteNumber(explicitDestination?.[5]),
      };
    default:
      return {
        left: null,
        top: null,
      };
  }
};

let pdfWorkerTeardownQueue = Promise.resolve();

const waitForPdfWorkerTeardown = async () => {
  await pdfWorkerTeardownQueue.catch(() => undefined);
};

const enqueuePdfWorkerTeardown = (teardown) => {
  const queuedTeardown = pdfWorkerTeardownQueue
    .catch(() => undefined)
    .then(teardown);
  pdfWorkerTeardownQueue = queuedTeardown.catch(() => undefined);
  return queuedTeardown;
};

const annotationHasLink = (annotation) => Boolean(
  annotation?.dest
    || annotation?.url
    || annotation?.unsafeUrl,
);

const annotationIsProvenance = (annotation) => {
  const rawUrl = annotation?.url || annotation?.unsafeUrl || null;
  if (!rawUrl) {
    return false;
  }
  return Boolean(parsePdfLink(rawUrl)?.isProvenance);
};

const getEstimatedPageMetric = (pageMetrics, pageNumber) => (
  pageMetrics[pageNumber]
  || pageMetrics[1]
  || { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT }
);

const getRenderedPageHeight = (pageMetrics, pageNumber, targetWidth) => {
  const metric = getEstimatedPageMetric(pageMetrics, pageNumber);
  const baseWidth = metric.width || DEFAULT_PAGE_WIDTH;
  const baseHeight = metric.height || DEFAULT_PAGE_HEIGHT;
  const safeWidth = targetWidth || baseWidth;
  return Math.max((baseHeight / baseWidth) * safeWidth, 320);
};

const PdfPageCanvas = ({
  pdfDocument,
  pageNumber,
  targetWidth,
  sourceMode,
  documentGeneration,
  registerGenerationTask,
  isGenerationInvalid,
  onPageMetric,
  onLinksDiscovered,
  onLinkActivate,
  resolveDestinationDetails,
}) => {
  const canvasRef = useRef(null);
  const [links, setLinks] = useState([]);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;

    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current || !targetWidth) {
        setLinks([]);
        onLinksDiscovered?.(pageNumber, []);
        return;
      }

      try {
        const pagePromise = pdfDocument.getPage(pageNumber);
        registerGenerationTask?.(documentGeneration, pagePromise);
        const page = await pagePromise;
        if (cancelled || isGenerationInvalid?.(documentGeneration)) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const outputScale = typeof window !== 'undefined' && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        onPageMetric?.(pageNumber, {
          width: baseViewport.width,
          height: baseViewport.height,
        });

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        });
        registerGenerationTask?.(documentGeneration, renderTask.promise);
        await renderTask.promise;
        if (cancelled || isGenerationInvalid?.(documentGeneration)) {
          return;
        }

        const annotationsPromise = page.getAnnotations({ intent: 'display' });
        registerGenerationTask?.(documentGeneration, annotationsPromise);
        const annotations = await annotationsPromise;
        if (cancelled || isGenerationInvalid?.(documentGeneration)) {
          return;
        }

        const nextLinks = (
          await Promise.all(annotations.map(async (annotation, index) => {
            if (!Array.isArray(annotation?.rect)) {
              return null;
            }

            let linkInfo = null;
            if (annotation?.dest) {
              const destinationDetails = await resolveDestinationDetails?.(annotation.dest);
              if (!destinationDetails?.pageNumber) {
                return null;
              }
              linkInfo = {
                url: null,
                provenanceId: null,
                isProvenance: false,
                destination: annotation.dest,
                destinationDetails,
                destinationPageNumber: destinationDetails.pageNumber,
                isInternal: true,
                kind: 'internal',
              };
            } else {
              const rawUrl = annotation?.url || annotation?.unsafeUrl || null;
              if (!rawUrl) {
                return null;
              }
              const parsedLink = parsePdfLink(rawUrl);
              if (!parsedLink?.url) {
                return null;
              }
              linkInfo = {
                ...parsedLink,
                destination: null,
                destinationPageNumber: null,
                isInternal: false,
                kind: parsedLink.isProvenance ? 'provenance' : 'external',
              };
            }

            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
            return {
              id: `page-${pageNumber}-link-${index}`,
              pageNumber,
              url: linkInfo.url,
              provenanceId: linkInfo.provenanceId,
              isProvenance: linkInfo.isProvenance,
              destination: linkInfo.destination,
              destinationDetails: linkInfo.destinationDetails || null,
              destinationPageNumber: linkInfo.destinationPageNumber,
              isInternal: linkInfo.isInternal,
              kind: linkInfo.kind,
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            };
          }))
        )
          .filter((item) => item && item.width > 0 && item.height > 0);

        setLinks(nextLinks);
        onLinksDiscovered?.(pageNumber, nextLinks);
      } catch {
        if (!cancelled) {
          setLinks([]);
          onLinksDiscovered?.(pageNumber, []);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask?.cancel) {
        renderTask.cancel();
      }
    };
  }, [
    documentGeneration,
    isGenerationInvalid,
    onLinksDiscovered,
    onPageMetric,
    pageNumber,
    pdfDocument,
    registerGenerationTask,
    resolveDestinationDetails,
    targetWidth,
  ]);

  return (
    <>
      <canvas data-testid={`pdf-page-canvas-${pageNumber}`} ref={canvasRef} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        {links.map((link) => {
          const shouldHighlight = sourceMode && link.isProvenance;
          const title = link.isInternal
            ? `Ir a la pagina ${link.destinationPageNumber} del PDF`
            : (link.isProvenance ? 'Ir al codigo origen' : 'Abrir enlace del PDF');
          return (
            <button
              key={link.id}
              type="button"
              aria-label={title}
              onClick={() => onLinkActivate?.(link)}
              title={title}
              style={{
                position: 'absolute',
                left: link.left,
                top: link.top,
                width: link.width,
                height: link.height,
                background: shouldHighlight ? 'rgba(52, 152, 219, 0.10)' : 'transparent',
                border: shouldHighlight ? '1px solid rgba(52, 152, 219, 0.35)' : 'none',
                cursor: 'pointer',
                pointerEvents: 'auto',
                padding: 0,
              }}
            />
          );
        })}
      </div>
    </>
  );
};

const PdfViewer = ({
  pdfUrl = null,
  sourceMode = false,
  emptyMessage = 'Sin documento',
  onLinkActivate = null,
  onProvenanceSummaryChange = null,
  onDocumentMetaChange = null,
  onCurrentPageChange = null,
  requestedPage = null,
  requestedLocation = null,
  zoomPercent = 100,
  fitMode = 'fit-width',
}) => {
  const containerRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const destinationCacheRef = useRef(new Map());
  const currentPageRef = useRef(1);
  const requestedPageRef = useRef(null);
  const requestedLocationRef = useRef(null);
  const generationTasksRef = useRef(new Map());
  const invalidatedGenerationsRef = useRef(new Set());
  const activeDocumentRef = useRef(null);
  const pendingLoadRef = useRef(null);
  const isUnmountedRef = useRef(false);
  const documentMetaCallbackRef = useRef(onDocumentMetaChange);
  const currentPageCallbackRef = useRef(onCurrentPageChange);
  const provenanceSummaryCallbackRef = useRef(onProvenanceSummaryChange);

  const [activeDocument, setActiveDocument] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageLinks, setPageLinks] = useState({});
  const [pageMetrics, setPageMetrics] = useState({});
  const [visiblePage, setVisiblePage] = useState(1);

  useEffect(() => {
    documentMetaCallbackRef.current = onDocumentMetaChange;
  }, [onDocumentMetaChange]);

  useEffect(() => {
    currentPageCallbackRef.current = onCurrentPageChange;
  }, [onCurrentPageChange]);

  useEffect(() => {
    provenanceSummaryCallbackRef.current = onProvenanceSummaryChange;
  }, [onProvenanceSummaryChange]);

  const registerGenerationTask = useCallback((generation, promiseLike) => {
    const promise = Promise.resolve(promiseLike);
    let tasks = generationTasksRef.current.get(generation);
    if (!tasks) {
      tasks = new Set();
      generationTasksRef.current.set(generation, tasks);
    }

    let trackedPromise = null;
    trackedPromise = promise
      .catch(() => undefined)
      .finally(() => {
        const currentTasks = generationTasksRef.current.get(generation);
        currentTasks?.delete(trackedPromise);
      });
    tasks.add(trackedPromise);

    return promise;
  }, []);

  const drainGenerationTasks = useCallback(async (generation) => {
    const tasks = generationTasksRef.current.get(generation);
    if (!tasks || tasks.size === 0) {
      return;
    }
    await Promise.allSettled(Array.from(tasks));
  }, []);

  const isGenerationInvalid = useCallback((generation) => (
    invalidatedGenerationsRef.current.has(generation) || isUnmountedRef.current
  ), []);

  const destroyDocumentContext = useCallback(async (context) => {
    if (!context || invalidatedGenerationsRef.current.has(context.generation)) {
      return;
    }

    invalidatedGenerationsRef.current.add(context.generation);
    await enqueuePdfWorkerTeardown(async () => {
      await drainGenerationTasks(context.generation);
      await destroyPdfResources(context.loadingTask, context.proxy);
      generationTasksRef.current.delete(context.generation);
    });
  }, [drainGenerationTasks]);

  const publishEmptyState = useCallback(() => {
    documentMetaCallbackRef.current?.(EMPTY_DOCUMENT_META);
    currentPageCallbackRef.current?.({
      pageNumber: 1,
      anchorTopPx: 0,
      anchorTopRatio: 0,
      destinationKey: null,
    });
    provenanceSummaryCallbackRef.current?.({ totalLinkCount: 0, provenanceCount: 0 });
  }, []);

  const resolveDestinationDetails = useCallback(async (destination) => {
    if (!activeDocument?.proxy || !destination) {
      return null;
    }

    const originalCacheKey = getDestinationCacheKey(destination);
    if (originalCacheKey && destinationCacheRef.current.has(originalCacheKey)) {
      return destinationCacheRef.current.get(originalCacheKey);
    }

    let explicitDestination = destination;
    if (typeof explicitDestination === 'string') {
      const destinationPromise = activeDocument.proxy.getDestination(explicitDestination);
      registerGenerationTask(activeDocument.generation, destinationPromise);
      explicitDestination = await destinationPromise;
    }

    if (!Array.isArray(explicitDestination) || !explicitDestination[0]) {
      if (originalCacheKey) {
        destinationCacheRef.current.set(originalCacheKey, null);
      }
      return null;
    }

    const resolvedCacheKey = getDestinationCacheKey(explicitDestination) || originalCacheKey;
    if (resolvedCacheKey && destinationCacheRef.current.has(resolvedCacheKey)) {
      return destinationCacheRef.current.get(resolvedCacheKey);
    }

    const pageRef = explicitDestination[0];
    let pageIndex = null;
    if (typeof pageRef === 'object') {
      const pageIndexPromise = activeDocument.proxy.getPageIndex(pageRef);
      registerGenerationTask(activeDocument.generation, pageIndexPromise);
      pageIndex = await pageIndexPromise;
    } else if (Number.isInteger(pageRef)) {
      pageIndex = pageRef;
    }

    if (!Number.isFinite(pageIndex)) {
      if (originalCacheKey) {
        destinationCacheRef.current.set(originalCacheKey, null);
      }
      if (resolvedCacheKey) {
        destinationCacheRef.current.set(resolvedCacheKey, null);
      }
      return null;
    }

    const pageNumber = pageIndex + 1;
    const pagePromise = activeDocument.proxy.getPage(pageNumber);
    registerGenerationTask(activeDocument.generation, pagePromise);
    const page = await pagePromise;
    const baseViewport = page.getViewport({ scale: 1 });
    const destinationMode = normalizeDestinationMode(explicitDestination) || 'page';
    const { left, top } = getDestinationAnchorInputs(explicitDestination, destinationMode);

    let anchorTopPx = 0;
    let anchorLeftPx = 0;
    if (typeof baseViewport.convertToViewportPoint === 'function' && (top != null || left != null)) {
      const [viewportLeft, viewportTop] = baseViewport.convertToViewportPoint(left ?? 0, top ?? baseViewport.height);
      anchorTopPx = clampToRange(viewportTop, 0, baseViewport.height);
      anchorLeftPx = clampToRange(viewportLeft, 0, baseViewport.width);
    } else if (top != null || left != null) {
      anchorTopPx = clampToRange(baseViewport.height - (top ?? baseViewport.height), 0, baseViewport.height);
      anchorLeftPx = clampToRange(left ?? 0, 0, baseViewport.width);
    }

    const details = {
      pageNumber,
      destinationKey: resolvedCacheKey || originalCacheKey || `page:${pageNumber}`,
      destinationMode,
      anchorTopPx,
      anchorLeftPx,
      anchorTopRatio: clampRatio(baseViewport.height ? anchorTopPx / baseViewport.height : 0) ?? 0,
      anchorLeftRatio: clampRatio(baseViewport.width ? anchorLeftPx / baseViewport.width : 0) ?? 0,
    };

    if (originalCacheKey) {
      destinationCacheRef.current.set(originalCacheKey, details);
    }
    if (resolvedCacheKey) {
      destinationCacheRef.current.set(resolvedCacheKey, details);
    }
    return details;
  }, [activeDocument, registerGenerationTask]);

  const pageNumbers = useMemo(() => {
    if (!activeDocument?.proxy?.numPages) {
      return [];
    }
    return Array.from({ length: activeDocument.proxy.numPages }, (_, index) => index + 1);
  }, [activeDocument]);

  const updateContainerWidth = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const nextWidth = Math.max(node.clientWidth - (PAGE_SIDE_PADDING_PX * 2), 320);
    setContainerWidth(nextWidth);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return undefined;
    }

    updateContainerWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateContainerWidth());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateContainerWidth);
    return () => window.removeEventListener('resize', updateContainerWidth);
  }, [updateContainerWidth]);

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      const pendingContext = pendingLoadRef.current;
      const activeContext = activeDocumentRef.current;
      pendingLoadRef.current = null;
      activeDocumentRef.current = null;
      if (pendingContext) {
        void destroyDocumentContext(pendingContext);
      }
      if (activeContext && activeContext.generation !== pendingContext?.generation) {
        void destroyDocumentContext(activeContext);
      }
    };
  }, [destroyDocumentContext]);

  useEffect(() => {
    let cancelled = false;
    let pendingContext = null;

    if (!pdfUrl) {
      const pendingContext = pendingLoadRef.current;
      const activeContext = activeDocumentRef.current;
      pendingLoadRef.current = null;
      activeDocumentRef.current = null;
      destinationCacheRef.current = new Map();
      currentPageRef.current = 1;
      requestedPageRef.current = null;
      requestedLocationRef.current = null;
      setActiveDocument(null);
      setPageLinks({});
      setPageMetrics({});
      setVisiblePage(1);
      setLoadError(null);
      setIsLoading(false);
      publishEmptyState();
      if (pendingContext) {
        void destroyDocumentContext(pendingContext);
      }
      if (activeContext && activeContext.generation !== pendingContext?.generation) {
        void destroyDocumentContext(activeContext);
      }
      return undefined;
    }

    setLoadError(null);
    setIsLoading(true);

    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const startLoad = async () => {
      try {
        await waitForPdfWorkerTeardown();
        if (cancelled || isUnmountedRef.current || isGenerationInvalid(generation)) {
          return;
        }

        const pdfjs = await loadPdfJsModule();
        if (cancelled || isUnmountedRef.current || isGenerationInvalid(generation)) {
          return;
        }

        const loadingTask = pdfjs.getDocument(pdfUrl);
        pendingContext = {
          generation,
          loadingTask,
          proxy: null,
          sourceUrl: pdfUrl,
        };
        pendingLoadRef.current = pendingContext;

        const loadPromise = loadingTask.promise.then((proxy) => {
          pendingContext.proxy = proxy;
          return proxy;
        });
        registerGenerationTask(generation, loadPromise);

        await loadPromise;
        if (cancelled || isUnmountedRef.current) {
          void destroyDocumentContext(pendingContext);
          return;
        }
        if (pendingLoadRef.current?.generation !== generation || isGenerationInvalid(generation)) {
          void destroyDocumentContext(pendingContext);
          return;
        }

        const previousContext = activeDocumentRef.current;
        pendingLoadRef.current = null;
        activeDocumentRef.current = pendingContext;
        destinationCacheRef.current = new Map();
        currentPageRef.current = 1;
        requestedPageRef.current = null;
        requestedLocationRef.current = null;
        setPageLinks({});
        setPageMetrics({});
        setVisiblePage(1);
        setActiveDocument({
          generation,
          proxy: pendingContext.proxy,
          sourceUrl: pdfUrl,
        });
        currentPageCallbackRef.current?.({
          pageNumber: 1,
          anchorTopPx: 0,
          anchorTopRatio: 0,
          destinationKey: null,
        });
        provenanceSummaryCallbackRef.current?.({ totalLinkCount: 0, provenanceCount: 0 });
        setLoadError(null);
        setIsLoading(false);

        if (previousContext && previousContext.generation !== generation) {
          void destroyDocumentContext(previousContext);
        }
      } catch (error) {
        if (cancelled || isUnmountedRef.current) {
          return;
        }
        if (pendingLoadRef.current?.generation === generation) {
          pendingLoadRef.current = null;
        }
        setLoadError(String(error));
        setIsLoading(false);
        if (pendingContext) {
          void destroyDocumentContext(pendingContext);
        }
      }
    };

    void startLoad();

    return () => {
      cancelled = true;
      if (pendingContext && pendingLoadRef.current?.generation === generation) {
        pendingLoadRef.current = null;
        void destroyDocumentContext(pendingContext);
      }
    };
  }, [destroyDocumentContext, isGenerationInvalid, pdfUrl, publishEmptyState, registerGenerationTask]);

  useEffect(() => {
    if (!activeDocument?.proxy) {
      return undefined;
    }

    const { generation, proxy } = activeDocument;
    let cancelled = false;

    documentMetaCallbackRef.current?.({
      numPages: proxy.numPages,
      outline: [],
      hasOutline: false,
    });

    const loadDocumentMeta = async () => {
      let totalLinkCount = 0;
      let provenanceCount = 0;
      const nextMetrics = {};

      const outlinePromise = (async () => {
        try {
          const rawOutlinePromise = proxy.getOutline();
          registerGenerationTask(generation, rawOutlinePromise);
          const rawOutline = await rawOutlinePromise;
          const nextOutline = [];

          const visitItems = async (items, depth = 0, lineage = []) => {
            if (!Array.isArray(items) || cancelled || isGenerationInvalid(generation)) {
              return;
            }

            for (let index = 0; index < items.length; index += 1) {
              const item = items[index];
              if (cancelled || isGenerationInvalid(generation)) {
                return;
              }

              const destinationDetails = item?.dest
                ? await resolveDestinationDetails(item.dest)
                : null;
              const pageNumber = destinationDetails?.pageNumber || null;
              const title = normalizeOutlineTitle(item?.title);
              if (title && pageNumber) {
                nextOutline.push({
                  id: `outline-${[...lineage, index].join('-')}`,
                  title,
                  pageNumber,
                  depth,
                  destinationKey: destinationDetails?.destinationKey || null,
                  destinationMode: destinationDetails?.destinationMode || null,
                  anchorTopPx: destinationDetails?.anchorTopPx ?? null,
                  anchorTopRatio: destinationDetails?.anchorTopRatio ?? null,
                });
              }
              if (Array.isArray(item?.items) && item.items.length > 0) {
                await visitItems(item.items, depth + 1, [...lineage, index]);
              }
            }
          };

          await visitItems(rawOutline || [], 0, []);
          if (!cancelled && !isGenerationInvalid(generation)) {
            documentMetaCallbackRef.current?.({
              numPages: proxy.numPages,
              outline: nextOutline,
              hasOutline: nextOutline.length > 0,
            });
          }
        } catch {
          if (!cancelled && !isGenerationInvalid(generation)) {
            documentMetaCallbackRef.current?.({
              numPages: proxy.numPages,
              outline: [],
              hasOutline: false,
            });
          }
        }
      })();

      registerGenerationTask(generation, outlinePromise);

      for (let pageNumber = 1; pageNumber <= proxy.numPages; pageNumber += 1) {
        if (cancelled || isGenerationInvalid(generation)) {
          return;
        }

        try {
          const pagePromise = proxy.getPage(pageNumber);
          registerGenerationTask(generation, pagePromise);
          const page = await pagePromise;
          const baseViewport = page.getViewport({ scale: 1 });
          nextMetrics[pageNumber] = {
            width: baseViewport.width,
            height: baseViewport.height,
          };
          const annotationsPromise = page.getAnnotations({ intent: 'display' });
          registerGenerationTask(generation, annotationsPromise);
          const annotations = await annotationsPromise;
          totalLinkCount += annotations.filter(annotationHasLink).length;
          provenanceCount += annotations.filter(annotationIsProvenance).length;
        } catch {
          // Best effort metadata scan; individual pages still render on demand.
        }

        if (!cancelled && !isGenerationInvalid(generation) && (pageNumber === 1 || pageNumber === proxy.numPages || pageNumber % 5 === 0)) {
          setPageMetrics((current) => ({ ...current, ...nextMetrics }));
          provenanceSummaryCallbackRef.current?.({ totalLinkCount, provenanceCount });
        }
      }

      if (!cancelled && !isGenerationInvalid(generation)) {
        setPageMetrics((current) => ({ ...current, ...nextMetrics }));
        provenanceSummaryCallbackRef.current?.({ totalLinkCount, provenanceCount });
      }
    };

    void loadDocumentMeta();

    return () => {
      cancelled = true;
    };
  }, [activeDocument, isGenerationInvalid, registerGenerationTask, resolveDestinationDetails]);

  const handleLinksDiscovered = useCallback((pageNumber, links) => {
    setPageLinks((current) => ({
      ...current,
      [pageNumber]: Array.isArray(links) ? links : [],
    }));
  }, []);

  const handlePageMetric = useCallback((pageNumber, metric) => {
    if (!metric?.width || !metric?.height) {
      return;
    }
    setPageMetrics((current) => {
      const existing = current[pageNumber];
      if (existing?.width === metric.width && existing?.height === metric.height) {
        return current;
      }
      return {
        ...current,
        [pageNumber]: metric,
      };
    });
  }, []);

  const effectiveZoom = useMemo(() => {
    const numericZoom = Number(zoomPercent);
    if (!Number.isFinite(numericZoom)) {
      return 100;
    }
    return Math.min(Math.max(numericZoom, 25), 400);
  }, [zoomPercent]);

  const getTargetPageWidth = useCallback((pageNumber) => {
    const metric = getEstimatedPageMetric(pageMetrics, pageNumber);
    if (fitMode === 'fit-width' || fitMode === 'width') {
      return containerWidth || metric.width;
    }
    return Math.max((metric.width || DEFAULT_PAGE_WIDTH) * (effectiveZoom / 100), 160);
  }, [containerWidth, effectiveZoom, fitMode, pageMetrics]);

  const pageOffsets = useMemo(() => {
    let currentOffset = 0;
    const nextOffsets = {};

    pageNumbers.forEach((pageNumber) => {
      nextOffsets[pageNumber] = currentOffset;
      currentOffset += getRenderedPageHeight(pageMetrics, pageNumber, getTargetPageWidth(pageNumber))
        + PAGE_GAP_PX;
    });

    return nextOffsets;
  }, [getTargetPageWidth, pageMetrics, pageNumbers]);

  const buildViewportLocation = useCallback((pageNumber, viewportAnchor, overrides = {}) => {
    const numericPageNumber = Number(pageNumber);
    if (!Number.isFinite(numericPageNumber)) {
      return null;
    }
    const metric = getEstimatedPageMetric(pageMetrics, numericPageNumber);
    const targetWidth = overrides.targetWidth || getTargetPageWidth(numericPageNumber);
    const renderedHeight = getRenderedPageHeight(pageMetrics, numericPageNumber, targetWidth);
    const pageOffset = pageOffsets[numericPageNumber] ?? 0;
    const anchorWithinPagePx = clampToRange(viewportAnchor - pageOffset, 0, renderedHeight);
    const anchorTopPx = metric.height
      ? clampToRange((anchorWithinPagePx / renderedHeight) * metric.height, 0, metric.height)
      : 0;

    return {
      pageNumber: numericPageNumber,
      anchorTopPx,
      anchorTopRatio: clampRatio(metric.height ? anchorTopPx / metric.height : 0) ?? 0,
      destinationKey: overrides.destinationKey || null,
    };
  }, [getTargetPageWidth, pageMetrics, pageOffsets]);

  const scrollToLocation = useCallback((location, behavior = 'smooth') => {
    const containerNode = containerRef.current;
    const pageNumber = Number(location?.pageNumber);
    if (!containerNode || !Number.isFinite(pageNumber)) {
      return false;
    }

    const pageOffset = pageOffsets[pageNumber] ?? 0;
    const targetWidth = getTargetPageWidth(pageNumber);
    const renderedHeight = getRenderedPageHeight(pageMetrics, pageNumber, targetWidth);
    const normalizedAnchorRatio = clampRatio(location?.anchorTopRatio);
    const viewportAnchor = normalizedAnchorRatio != null
      ? pageOffset + (renderedHeight * normalizedAnchorRatio)
      : pageOffset;
    const top = Math.max(viewportAnchor - (containerNode.clientHeight * VIEWPORT_ACTIVE_ANCHOR_RATIO), 0);
    containerNode.scrollTo({ top, behavior });
    currentPageRef.current = pageNumber;
    setVisiblePage(pageNumber);
    currentPageCallbackRef.current?.(
      buildViewportLocation(pageNumber, viewportAnchor, {
        destinationKey: location?.destinationKey || null,
        targetWidth,
      }) || {
        pageNumber,
        anchorTopPx: 0,
        anchorTopRatio: 0,
        destinationKey: location?.destinationKey || null,
      },
    );
    return true;
  }, [buildViewportLocation, getTargetPageWidth, pageMetrics, pageOffsets]);

  const scrollToPage = useCallback((pageNumber, behavior = 'smooth') => (
    scrollToLocation({ pageNumber }, behavior)
  ), [scrollToLocation]);

  useEffect(() => {
    if (!pageNumbers.length) {
      return undefined;
    }

    const containerNode = containerRef.current;
    if (!containerNode) {
      return undefined;
    }

    let animationFrame = null;

    const updateVisiblePage = () => {
      animationFrame = null;
      const viewportAnchor = containerNode.scrollTop + (containerNode.clientHeight * VIEWPORT_ACTIVE_ANCHOR_RATIO);
      let nextPage = 1;
      for (const pageNumber of pageNumbers) {
        const pageOffset = pageOffsets[pageNumber] ?? 0;
        if (pageOffset <= viewportAnchor) {
          nextPage = pageNumber;
        } else {
          break;
        }
      }

      const nextLocation = buildViewportLocation(nextPage, viewportAnchor);
      if (currentPageRef.current !== nextPage) {
        currentPageRef.current = nextPage;
        setVisiblePage(nextPage);
        currentPageCallbackRef.current?.(nextLocation || {
          pageNumber: nextPage,
          anchorTopPx: 0,
          anchorTopRatio: 0,
          destinationKey: null,
        });
      } else if (visiblePage !== nextPage) {
        setVisiblePage(nextPage);
      } else {
        currentPageCallbackRef.current?.(nextLocation || {
          pageNumber: nextPage,
          anchorTopPx: 0,
          anchorTopRatio: 0,
          destinationKey: null,
        });
      }
    };

    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(updateVisiblePage);
    };

    updateVisiblePage();
    containerNode.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      containerNode.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [buildViewportLocation, pageNumbers, pageOffsets, visiblePage]);

  useEffect(() => {
    if (!requestedLocation?.requestKey || !activeDocument?.proxy?.numPages) {
      return;
    }
    if (requestedLocationRef.current === requestedLocation.requestKey) {
      return;
    }
    if (requestedLocation.pageNumber < 1 || requestedLocation.pageNumber > activeDocument.proxy.numPages) {
      return;
    }

    requestedLocationRef.current = requestedLocation.requestKey;
    scrollToLocation(requestedLocation);
  }, [activeDocument, requestedLocation, scrollToLocation]);

  useEffect(() => {
    if (requestedLocation?.requestKey) {
      return;
    }
    if (!requestedPage || !activeDocument?.proxy?.numPages) {
      return;
    }
    if (requestedPageRef.current === requestedPage) {
      return;
    }
    if (requestedPage < 1 || requestedPage > activeDocument.proxy.numPages) {
      return;
    }

    requestedPageRef.current = requestedPage;
    scrollToPage(requestedPage);
  }, [activeDocument, requestedLocation, requestedPage, scrollToPage]);

  const handleOverlayLinkActivate = useCallback(async (link) => {
    if (link?.destination) {
      const destinationDetails = link.destinationDetails || await resolveDestinationDetails(link.destination);
      if (destinationDetails?.pageNumber) {
        scrollToLocation(destinationDetails);
      }
      return;
    }

    onLinkActivate?.(link);
  }, [onLinkActivate, resolveDestinationDetails, scrollToLocation]);

  const renderedPages = useMemo(() => {
    if (!pageNumbers.length) {
      return new Set();
    }

    const focusPage = requestedLocation?.pageNumber || requestedPage || visiblePage || 1;
    const nextRenderedPages = new Set();
    for (const pageNumber of pageNumbers) {
      if (Math.abs(pageNumber - visiblePage) <= RENDER_BUFFER_PAGES || Math.abs(pageNumber - focusPage) <= RENDER_BUFFER_PAGES) {
        nextRenderedPages.add(pageNumber);
      }
    }
    return nextRenderedPages;
  }, [pageNumbers, requestedLocation, requestedPage, visiblePage]);

  const linkSummary = useMemo(() => {
    const allLinks = Object.values(pageLinks).flat();
    return {
      totalLinkCount: allLinks.length,
      provenanceCount: allLinks.filter((item) => item?.isProvenance && item?.provenanceId).length,
    };
  }, [pageLinks]);

  useEffect(() => {
    if (linkSummary.totalLinkCount > 0) {
      provenanceSummaryCallbackRef.current?.(linkSummary);
    }
  }, [linkSummary]);

  if (!pdfUrl) {
    return <div style={{ color: '#ccc', fontSize: 12, padding: 12 }}>{emptyMessage}</div>;
  }

  if (!activeDocument && loadError) {
    return (
      <div style={{ color: '#f6b3b3', fontSize: 12, padding: 12 }}>
        No se pudo abrir el PDF: {loadError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="scroll-surface"
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'auto',
        background: '#d2d8df',
        padding: PAGE_SIDE_PADDING_PX,
      }}
    >
      {activeDocument ? (
        pageNumbers.map((pageNumber) => {
          const targetWidth = getTargetPageWidth(pageNumber);
          const estimatedHeight = getRenderedPageHeight(pageMetrics, pageNumber, targetWidth);
          const shouldRender = renderedPages.has(pageNumber);

          return (
            <div
              key={`pdf-page-${activeDocument.generation}-${pageNumber}`}
              data-testid={`pdf-page-${pageNumber}`}
              data-page-rendered={shouldRender ? 'true' : 'false'}
              style={{
                position: 'relative',
                width: targetWidth || '100%',
                minHeight: estimatedHeight,
                margin: `0 auto ${PAGE_GAP_PX}px`,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.22)',
                background: '#fff',
              }}
            >
              {shouldRender ? (
                <PdfPageCanvas
                  pdfDocument={activeDocument.proxy}
                  pageNumber={pageNumber}
                  targetWidth={targetWidth}
                  sourceMode={sourceMode}
                  documentGeneration={activeDocument.generation}
                  registerGenerationTask={registerGenerationTask}
                  isGenerationInvalid={isGenerationInvalid}
                  onPageMetric={handlePageMetric}
                  onLinksDiscovered={handleLinksDiscovered}
                  onLinkActivate={handleOverlayLinkActivate}
                  resolveDestinationDetails={resolveDestinationDetails}
                />
              ) : null}
            </div>
          );
        })
      ) : null}

      {isLoading ? (
        <div
          style={{
            position: activeDocument ? 'absolute' : 'relative',
            inset: activeDocument ? 0 : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: activeDocument ? 'rgba(210, 216, 223, 0.72)' : 'transparent',
            pointerEvents: 'none',
          }}
        >
          <LoadingSpinner message="Cargando PDF..." size="medium" />
        </div>
      ) : null}

      {!activeDocument && !isLoading ? (
        <div style={{ color: '#ccc', fontSize: 12, padding: 12 }}>{emptyMessage}</div>
      ) : null}

      {activeDocument && loadError ? (
        <div
          style={{
            position: 'absolute',
            left: PAGE_SIDE_PADDING_PX,
            right: PAGE_SIDE_PADDING_PX,
            bottom: PAGE_SIDE_PADDING_PX,
            background: '#2a0000',
            color: '#fbb',
            fontSize: 11,
            padding: '6px 8px',
            borderTop: '1px solid #400',
          }}
        >
          No se pudo cargar la nueva version del PDF: {loadError}
        </div>
      ) : null}
    </div>
  );
};

export default PdfViewer;
