import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfViewer from './PdfViewer';

jest.mock('pdfjs-dist/webpack', () => ({
  getDocument: jest.fn(),
}));

const pdfjs = require('pdfjs-dist/webpack');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const buildMockPage = ({
  pageNumber,
  width = 612,
  height = 792,
  annotations = [],
}) => {
  const renderTask = {
    promise: Promise.resolve(),
    cancel: jest.fn(),
  };

  return {
    pageNumber,
    width,
    height,
    ref: { num: pageNumber, gen: 0 },
    getViewport: jest.fn(({ scale }) => ({
      width: width * scale,
      height: height * scale,
      convertToViewportPoint: (x, y) => [
        x * scale,
        y * scale,
      ],
      convertToViewportRectangle: ([x1, y1, x2, y2]) => [
        x1 * scale,
        y1 * scale,
        x2 * scale,
        y2 * scale,
      ],
    })),
    render: jest.fn(() => renderTask),
    getAnnotations: jest.fn().mockResolvedValue(annotations),
  };
};

const buildDocumentProxy = ({
  pages = [],
  outline = [],
  namedDestinations = {},
} = {}) => {
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));

  return {
    numPages: pages.length,
    destroy: jest.fn().mockResolvedValue(undefined),
    getPage: jest.fn(async (pageNumber) => pageByNumber.get(pageNumber)),
    getOutline: jest.fn().mockResolvedValue(outline),
    getDestination: jest.fn(async (name) => namedDestinations[name] || null),
    getPageIndex: jest.fn(async (ref) => {
      const matchedPage = pages.find((page) => page.ref.num === ref.num && page.ref.gen === ref.gen);
      return matchedPage ? matchedPage.pageNumber - 1 : 0;
    }),
  };
};

describe('PdfViewer', () => {
  let originalCanvasContext;
  let originalResizeObserver;
  let originalScrollTo;
  let originalClientWidth;
  let originalClientHeight;

  beforeAll(() => {
    originalCanvasContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({}));

    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserverMock {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {}

      disconnect() {}
    };

    originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function scrollTo(options) {
      if (typeof options === 'object') {
        this.scrollTop = options.top || 0;
        return;
      }
      this.scrollTop = arguments[1] || 0;
    };

    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 960;
      },
    });

    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 720;
      },
    });
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalCanvasContext;
    global.ResizeObserver = originalResizeObserver;
    HTMLElement.prototype.scrollTo = originalScrollTo;

    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    } else {
      delete HTMLElement.prototype.clientWidth;
    }

    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      delete HTMLElement.prototype.clientHeight;
    }
  });

  beforeEach(() => {
    pdfjs.getDocument.mockReset();
    jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not reload the same pdf when parent callback identities change', async () => {
    const documentProxy = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    const { rerender } = render(
      <PdfViewer
        pdfUrl="blob:stable"
        onCurrentPageChange={jest.fn()}
        onDocumentMetaChange={jest.fn()}
        onProvenanceSummaryChange={jest.fn()}
      />,
    );

    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(1));

    rerender(
      <PdfViewer
        pdfUrl="blob:stable"
        onCurrentPageChange={jest.fn()}
        onDocumentMetaChange={jest.fn()}
        onProvenanceSummaryChange={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous pdf visible while the next one is still loading', async () => {
    const firstDocument = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });
    const secondDocument = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });
    const secondLoad = deferred();

    pdfjs.getDocument
      .mockReturnValueOnce({
        promise: Promise.resolve(firstDocument),
        destroy: jest.fn().mockResolvedValue(undefined),
      })
      .mockReturnValueOnce({
        promise: secondLoad.promise,
        destroy: jest.fn().mockResolvedValue(undefined),
      });

    const { container, rerender } = render(<PdfViewer pdfUrl="blob:first" />);

    await waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());

    rerender(<PdfViewer pdfUrl="blob:second" />);

    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(2));
    expect(container.querySelector('canvas')).toBeTruthy();
    expect(screen.queryByText(/Sin documento/i)).toBeNull();
    expect(screen.getByText(/Cargando PDF/i)).toBeTruthy();

    await act(async () => {
      secondLoad.resolve(secondDocument);
      await secondLoad.promise;
    });

    await waitFor(() => expect(secondDocument.getPage).toHaveBeenCalled());
  });

  it('drains in-flight metadata work before destroying the previous document', async () => {
    const pendingPage = deferred();
    const firstDocument = buildDocumentProxy({
      pages: [],
    });
    firstDocument.numPages = 1;
    firstDocument.getPage = jest.fn(() => pendingPage.promise);
    const firstDestroy = jest.fn().mockResolvedValue(undefined);
    firstDocument.destroy = firstDestroy;

    const secondDocument = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });

    pdfjs.getDocument
      .mockReturnValueOnce({
        promise: Promise.resolve(firstDocument),
        destroy: jest.fn().mockResolvedValue(undefined),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(secondDocument),
        destroy: jest.fn().mockResolvedValue(undefined),
      });

    const { rerender } = render(<PdfViewer pdfUrl="blob:first" />);

    await waitFor(() => expect(firstDocument.getPage).toHaveBeenCalledWith(1));

    rerender(<PdfViewer pdfUrl="blob:second" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(firstDestroy).not.toHaveBeenCalled();

    await act(async () => {
      pendingPage.resolve(buildMockPage({ pageNumber: 1 }));
      await pendingPage.promise;
    });

    await waitFor(() => expect(firstDestroy).toHaveBeenCalledTimes(1));
  });

  it('does not load pdf.js until a pdfUrl is provided', async () => {
    const { rerender } = render(<PdfViewer pdfUrl={null} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfjs.getDocument).not.toHaveBeenCalled();

    const documentProxy = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    rerender(<PdfViewer pdfUrl="blob:lazy-load" />);

    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(1));
  });

  it('waits for a prior viewer teardown before starting a new pdf.js load', async () => {
    const firstDocument = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });
    const firstDestroyGate = deferred();
    const firstLoadingTaskDestroy = jest.fn(() => firstDestroyGate.promise);

    const secondDocument = buildDocumentProxy({
      pages: [buildMockPage({ pageNumber: 1 })],
    });

    pdfjs.getDocument
      .mockReturnValueOnce({
        promise: Promise.resolve(firstDocument),
        destroy: firstLoadingTaskDestroy,
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(secondDocument),
        destroy: jest.fn().mockResolvedValue(undefined),
      });

    const firstRender = render(<PdfViewer pdfUrl="blob:first" />);

    await waitFor(() => expect(firstDocument.getPage).toHaveBeenCalled());

    firstRender.unmount();

    render(<PdfViewer pdfUrl="blob:second" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
    expect(firstLoadingTaskDestroy).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstDestroyGate.resolve(undefined);
      await firstDestroyGate.promise;
    });

    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(secondDocument.getPage).toHaveBeenCalled());
  });

  it('publishes document metadata and provenance summary from pdf.js outline data', async () => {
    const pages = [
      buildMockPage({
        pageNumber: 1,
        annotations: [
          {
            rect: [0, 0, 60, 20],
            url: '/api/docx/provenance/open?provenance_id=prov-1',
          },
        ],
      }),
      buildMockPage({ pageNumber: 2 }),
      buildMockPage({ pageNumber: 3 }),
    ];
    const documentProxy = buildDocumentProxy({
      pages,
      outline: [
        {
          title: 'Resumen',
          dest: 'dest-resumen',
          items: [
            {
              title: 'Detalle',
              dest: [pages[2].ref, { name: 'XYZ' }, 0, 420, 0],
              items: [],
            },
          ],
        },
      ],
      namedDestinations: {
        'dest-resumen': [pages[1].ref, { name: 'XYZ' }, 0, 96, 0],
      },
    });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    const onDocumentMetaChange = jest.fn();
    const onProvenanceSummaryChange = jest.fn();
    const onCurrentPageChange = jest.fn();

    render(
      <PdfViewer
        pdfUrl="blob:meta"
        onDocumentMetaChange={onDocumentMetaChange}
        onProvenanceSummaryChange={onProvenanceSummaryChange}
        onCurrentPageChange={onCurrentPageChange}
      />,
    );

    await waitFor(() => {
      expect(onDocumentMetaChange).toHaveBeenCalled();
      const lastMeta = onDocumentMetaChange.mock.calls.at(-1)?.[0];
      expect(lastMeta).toEqual({
        numPages: 3,
        outline: [
          {
            id: 'outline-0',
            title: 'Resumen',
            pageNumber: 2,
            depth: 0,
            destinationKey: 'dest:ref:2:0:XYZ:0:96:0',
            destinationMode: 'XYZ',
            anchorTopPx: 96,
            anchorTopRatio: expect.any(Number),
          },
          {
            id: 'outline-0-0',
            title: 'Detalle',
            pageNumber: 3,
            depth: 1,
            destinationKey: expect.stringContaining('dest:ref:3:0:XYZ'),
            destinationMode: 'XYZ',
            anchorTopPx: 420,
            anchorTopRatio: expect.any(Number),
          },
        ],
        hasOutline: true,
      });
      expect(lastMeta.outline[0].anchorTopRatio).toBeCloseTo(96 / 792, 5);
      expect(lastMeta.outline[1].anchorTopRatio).toBeCloseTo(420 / 792, 5);
    });

    expect(onProvenanceSummaryChange).toHaveBeenCalledWith({
      totalLinkCount: 1,
      provenanceCount: 1,
    });
    expect(onCurrentPageChange).toHaveBeenCalledWith(expect.objectContaining({
      pageNumber: 1,
      anchorTopRatio: expect.any(Number),
    }));
    expect(documentProxy.getDestination).toHaveBeenCalledWith('dest-resumen');
    expect(documentProxy.getPageIndex).toHaveBeenCalledWith(pages[1].ref);
    expect(documentProxy.getPageIndex).toHaveBeenCalledWith(pages[2].ref);
  });

  it('supports internal pdf destinations and keeps overlay links keyboard-accessible', async () => {
    const pages = [
      buildMockPage({
        pageNumber: 1,
        annotations: [
          {
            rect: [0, 0, 60, 20],
            dest: 'jump-two',
          },
          {
            rect: [70, 0, 120, 20],
            url: '/api/docx/provenance/open?provenance_id=prov-1',
          },
        ],
      }),
      buildMockPage({ pageNumber: 2 }),
    ];
    const documentProxy = buildDocumentProxy({
      pages,
      namedDestinations: {
        'jump-two': [pages[1].ref, { name: 'XYZ' }, 0, 240, 0],
      },
    });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    const onCurrentPageChange = jest.fn();
    const onLinkActivate = jest.fn();

    render(
      <PdfViewer
        pdfUrl="blob:interactive"
        onCurrentPageChange={onCurrentPageChange}
        onLinkActivate={onLinkActivate}
        sourceMode
      />,
    );

    const internalLinkButton = await screen.findByRole('button', {
      name: /ir a la pagina 2 del pdf/i,
    });
    fireEvent.click(internalLinkButton);

    await waitFor(() => {
      const lastLocation = onCurrentPageChange.mock.calls.at(-1)?.[0];
      expect(lastLocation).toEqual(expect.objectContaining({
        pageNumber: 2,
      }));
      expect(lastLocation.anchorTopRatio).toBeCloseTo(240 / 792, 5);
    });

    const provenanceLinkButton = await screen.findByRole('button', {
      name: /ir al codigo origen/i,
    });
    expect(provenanceLinkButton.closest('[aria-hidden="true"]')).toBeNull();

    fireEvent.click(provenanceLinkButton);

    expect(onLinkActivate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'provenance',
      provenanceId: 'prov-1',
      isProvenance: true,
      url: expect.stringContaining('provenance_id=prov-1'),
    }));
  });

  it('honors requested page, manual zoom, and windowed rendering for long documents', async () => {
    const pages = Array.from({ length: 8 }, (_, index) => buildMockPage({ pageNumber: index + 1 }));
    const documentProxy = buildDocumentProxy({ pages });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    const onCurrentPageChange = jest.fn();

    const { container } = render(
      <PdfViewer
        pdfUrl="blob:windowed"
        requestedPage={5}
        zoomPercent={125}
        fitMode="manual"
        onCurrentPageChange={onCurrentPageChange}
      />,
    );

    await waitFor(() => {
      expect(onCurrentPageChange).toHaveBeenLastCalledWith(expect.objectContaining({
        pageNumber: 5,
      }));
    });

    const renderedPageCount = container.querySelectorAll('[data-page-rendered="true"]').length;
    expect(renderedPageCount).toBeLessThan(pages.length);

    const firstRenderedCanvas = container.querySelector('canvas');
    expect(firstRenderedCanvas).toBeTruthy();
    expect(firstRenderedCanvas.style.width).toBe('765px');
  });

  it('honors exact requested locations within the same page instead of falling back to page top', async () => {
    const pages = [buildMockPage({ pageNumber: 1 })];
    const documentProxy = buildDocumentProxy({ pages });
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(documentProxy),
      destroy: jest.fn().mockResolvedValue(undefined),
    });

    const onCurrentPageChange = jest.fn();
    const { container } = render(
      <PdfViewer
        pdfUrl="blob:exact-location"
        requestedPage={1}
        requestedLocation={{
          pageNumber: 1,
          destinationKey: 'dest:outline-middle',
          anchorTopRatio: 0.6,
          requestKey: 'outline-middle',
        }}
        onCurrentPageChange={onCurrentPageChange}
      />,
    );

    await waitFor(() => {
      expect(onCurrentPageChange).toHaveBeenLastCalledWith(expect.objectContaining({
        pageNumber: 1,
        destinationKey: 'dest:outline-middle',
      }));
      expect(onCurrentPageChange.mock.calls.at(-1)?.[0]?.anchorTopRatio).toBeCloseTo(0.6, 5);
    });

    expect(container.firstChild.scrollTop).toBeGreaterThan(200);
  });
});
