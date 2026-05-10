import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import LoadingSpinner from './LoadingSpinner';
import PdfViewer from './PdfViewer';
import TemplateEditor from './TemplateEditor';
import DropdownMenu from './DropdownMenu';
import {
  IconDocx,
  IconPdf,
  IconHistory,
  IconTemplate,
  IconZoomIn,
  IconZoomOut,
  IconFitWidth,
  IconOutline,
  IconSource,
  IconQuality,
  IconKebab,
  IconRefresh,
  IconTrash,
  IconText,
} from './Icons';
import { API_BASE } from '../config/endpoints';
import { createFrontendLogger } from '../utils/frontendLogger';
import { buildDocxDownloadPath, buildDocxHistoryPath, buildDocxProvenancePath, buildDocxQualityPath, isDocxHistoryEntryEmpty, normalizeDocxHistoryEntry } from '../utils/docxArtifacts';
import './DocxViewer.css';

const DOCX_FETCH_OPTIONS = { cache: 'no-store' };
const logger = createFrontendLogger('DocxViewer');

let mammothModulePromise = null;

const loadMammothModule = async () => {
  if (!mammothModulePromise) {
    mammothModulePromise = import('mammoth').then((module) => {
      if (module?.convertToHtml) {
        return module;
      }
      if (module?.default?.convertToHtml) {
        return module.default;
      }
      if (module?.default?.default?.convertToHtml) {
        return module.default.default;
      }
      return module?.default || module;
    });
  }
  try {
    return await mammothModulePromise;
  } catch (error) {
    mammothModulePromise = null;
    throw error;
  }
};

const createHttpStatusError = (status, message = `HTTP ${status}`) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const readHttpStatus = (error) => {
  if (Number.isFinite(error?.status)) {
    return Number(error.status);
  }
  const match = String(error?.message || error || '').match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
};

const isHttpStatusError = (error, status) => readHttpStatus(error) === status;

const describePdfLoadError = (error) => {
  const raw = String(error || 'pdf_load_failed');
  if (/HTTP 404/i.test(raw) || /Missing PDF/i.test(raw)) {
    return 'El PDF temporal ya no esta disponible. Reintenta la conversion.';
  }
  return `No se pudo cargar el PDF temporal: ${raw}`;
};

const normalizeDocumentSharedResource = (value = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const kind = typeof value.kind === 'string' ? value.kind.trim().toLowerCase() : '';
  const scope = typeof value.scope === 'string' ? value.scope.trim().toLowerCase() : 'global';
  const status = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
  if (!kind || !status) {
    return null;
  }
  return {
    kind,
    scope: scope || 'global',
    status,
  };
};

const describePdfSharedResource = (sharedResource) => {
  const normalized = normalizeDocumentSharedResource(sharedResource);
  if (!normalized || normalized.kind !== 'pdf_converter') {
    return null;
  }
  if (normalized.status === 'waiting') {
    return 'Esperando convertidor PDF compartido';
  }
  if (normalized.status === 'running') {
    return 'Usando convertidor PDF compartido';
  }
  return 'Convertidor PDF compartido';
};

const isDocumentPipelineStatusActive = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return !normalized || ['queued', 'waiting', 'running'].includes(normalized);
};

const resolveBackendUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^(blob:|data:|about:)/i.test(trimmed)) return trimmed;
  try {
    const fallbackOrigin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost:3000';
    const backendBase = new URL(API_BASE, fallbackOrigin);
    return trimmed.startsWith('/') ? new URL(trimmed, backendBase.origin).toString() : new URL(trimmed, backendBase.toString()).toString();
  } catch {
    return trimmed;
  }
};

const inspectProvenanceOpenUrl = (rawUrl, { format = null } = {}) => {
  const emptyResult = {
    rawUrl: rawUrl || null,
    resolvedUrl: null,
    rewrittenUrl: null,
    provenanceId: null,
    isProvenance: false,
    staleOrigin: false,
    backendOrigin: null,
    originalOrigin: null,
  };
  if (!rawUrl || typeof rawUrl !== 'string') return emptyResult;
  try {
    const fallbackOrigin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost:3000';
    const backendBase = new URL(API_BASE, fallbackOrigin);
    const parsed = new URL(rawUrl, backendBase.toString());
    const provenanceId = parsed.searchParams.get('provenance_id');
    if (!parsed.pathname.endsWith('/api/docx/provenance/open')) {
      return {
        ...emptyResult,
        resolvedUrl: resolveBackendUrl(rawUrl),
        rewrittenUrl: resolveBackendUrl(rawUrl),
        backendOrigin: backendBase.origin,
        originalOrigin: parsed.origin || null,
      };
    }

    const rewritten = new URL(parsed.pathname, backendBase.origin);
    parsed.searchParams.forEach((value, key) => {
      rewritten.searchParams.set(key, value);
    });
    if (typeof format === 'string' && format.trim()) {
      rewritten.searchParams.set('format', format.trim());
    } else {
      rewritten.searchParams.delete('format');
    }
    return {
      ...emptyResult,
      resolvedUrl: parsed.toString(),
      rewrittenUrl: rewritten.toString(),
      provenanceId: typeof provenanceId === 'string' && provenanceId.trim() ? provenanceId.trim() : null,
      isProvenance: true,
      staleOrigin: Boolean(parsed.origin && parsed.origin !== backendBase.origin),
      backendOrigin: backendBase.origin,
      originalOrigin: parsed.origin || null,
    };
  } catch {
    return {
      ...emptyResult,
      resolvedUrl: resolveBackendUrl(rawUrl),
      rewrittenUrl: resolveBackendUrl(rawUrl),
    };
  }
};

const rewriteProvenanceOpenUrl = (rawUrl, { format = null } = {}) => (
  inspectProvenanceOpenUrl(rawUrl, { format })?.rewrittenUrl
);

const buildProvenanceResolveUrl = (rawUrl) => rewriteProvenanceOpenUrl(rawUrl, { format: 'json' });

const createProvenanceError = (code, message, meta = {}) => {
  const error = new Error(message);
  error.code = code;
  error.meta = meta;
  return error;
};

const reportProvenanceFailure = (code, meta = {}, error = null) => {
  logger.error('DocxViewer provenance failure', {
    code,
    ...meta,
    errorMessage: error?.message || null,
  });
};

const normalizeTs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const freshness = (entry) => normalizeTs(entry?.docxUpdatedAt) ?? normalizeTs(entry?.createdAt) ?? -1;

const mergeDocxEntryLatestWins = (byId, rawEntry) => {
  const entry = rawEntry?.id ? rawEntry : normalizeDocxHistoryEntry(rawEntry);
  if (!entry?.id) return;
  const normalized = { ...entry, ref: entry.ref || entry.downloadUrl || null, docxUpdatedAt: normalizeTs(entry.docxUpdatedAt) ?? normalizeTs(entry.createdAt) ?? null };
  const existing = byId.get(normalized.id);
  if (!existing || freshness(normalized) >= freshness(existing)) {
    byId.set(normalized.id, { ...existing, ...normalized, ref: normalized.ref || existing?.ref || null });
  } else {
    byId.set(normalized.id, { ...normalized, ...existing, ref: existing.ref || normalized.ref || null });
  }
};

const normalizeQualityCounts = (counts) => {
  if (!counts || typeof counts !== 'object') {
    return { error: 0, warning: 0, info: 0 };
  }
  return {
    error: Number(counts.error || counts.errors || 0) || 0,
    warning: Number(counts.warning || counts.warnings || 0) || 0,
    info: Number(counts.info || counts.infos || 0) || 0,
  };
};

const getQualityStatus = (summaryOrEntry = null) => {
  const rawStatus = String(
    summaryOrEntry?.status
    || summaryOrEntry?.docxQualityStatus
    || summaryOrEntry?.docx_quality_status
    || '',
  ).trim().toLowerCase();
  if (rawStatus) {
    if (['ok', 'pass', 'passed', 'success'].includes(rawStatus)) return 'ok';
    if (['warning', 'warnings', 'warn'].includes(rawStatus)) return 'warning';
    if (['error', 'failed', 'fail', 'review', 'revisar'].includes(rawStatus)) return 'error';
    if (['missing', 'pending', 'unknown', 'sin analizar'].includes(rawStatus)) return 'missing';
  }
  const counts = normalizeQualityCounts(
    summaryOrEntry?.counts
    || summaryOrEntry?.docxQualityCounts
    || summaryOrEntry?.docx_quality_counts,
  );
  if (counts.error > 0) return 'error';
  if (counts.warning > 0) return 'warning';
  return rawStatus ? 'ok' : 'missing';
};

const getQualityTone = (status) => {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
};

const getQualityBadgeLabel = (summaryOrEntry = null) => {
  const status = getQualityStatus(summaryOrEntry);
  const counts = normalizeQualityCounts(
    summaryOrEntry?.counts
    || summaryOrEntry?.docxQualityCounts
    || summaryOrEntry?.docx_quality_counts,
  );
  if (status === 'ok') return 'OK';
  if (status === 'warning') return counts.warning > 0 ? `${counts.warning} avisos` : 'Avisos';
  if (status === 'error') return 'Revisar';
  return 'Sin analizar';
};

const describeQualitySummary = (summaryOrEntry = null) => {
  const status = getQualityStatus(summaryOrEntry);
  const label = getQualityBadgeLabel(summaryOrEntry);
  return {
    status,
    tone: getQualityTone(status),
    label,
    counts: normalizeQualityCounts(
      summaryOrEntry?.counts
      || summaryOrEntry?.docxQualityCounts
      || summaryOrEntry?.docx_quality_counts,
    ),
    score: summaryOrEntry?.score ?? summaryOrEntry?.docxQualityScore ?? summaryOrEntry?.docx_quality_score ?? null,
  };
};

const getRenderStatus = (summaryOrEntry = null) => {
  const rawStatus = String(
    summaryOrEntry?.docxRenderStatus
    || summaryOrEntry?.docx_render_status
    || summaryOrEntry?.status
    || '',
  ).trim().toLowerCase();
  if (['complete', 'completed', 'visual listo', 'ready_all'].includes(rawStatus)) return 'complete';
  if (['partial', 'parcial'].includes(rawStatus)) return 'partial';
  if (['ready', 'pdf_ready', 'pdf listo'].includes(rawStatus)) return 'ready';
  if (['error', 'failed', 'fail'].includes(rawStatus)) return 'error';
  return 'missing';
};

const getRenderTone = (status) => {
  if (status === 'complete') return 'success';
  if (status === 'partial' || status === 'ready') return 'warning';
  if (status === 'error') return 'error';
  return 'muted';
};

const describeRenderSummary = (summaryOrEntry = null) => {
  const status = getRenderStatus(summaryOrEntry);
  const pageCount = Number(
    summaryOrEntry?.page_count
    ?? summaryOrEntry?.docxRenderPageCount
    ?? summaryOrEntry?.docx_render_page_count
    ?? 0,
  ) || 0;
  const cachedPages = Number(
    summaryOrEntry?.cached_pages
    ?? summaryOrEntry?.docxRenderCachedPages
    ?? summaryOrEntry?.docx_render_cached_pages
    ?? 0,
  ) || 0;
  const renderer = summaryOrEntry?.converter_used
    || summaryOrEntry?.docxRenderRenderer
    || summaryOrEntry?.docx_render_renderer
    || null;
  let label = 'Sin render';
  if (status === 'complete') label = 'Visual listo';
  else if (status === 'partial') label = `${cachedPages}/${pageCount || '?'} paginas`;
  else if (status === 'ready') label = 'PDF listo';
  else if (status === 'error') label = 'Visual error';
  return {
    status,
    tone: getRenderTone(status),
    label,
    pageCount,
    cachedPages,
    renderer,
  };
};

const SECTION_LABELS = {
  package: 'Paquete',
  layout: 'Layout',
  accessibility: 'Accesibilidad',
  fields: 'Campos',
  styles: 'Estilos',
  review: 'Revision',
  publication: 'Publicacion',
  content_controls: 'Controles de contenido',
};

const createCurrentLiveDocxEntry = (props) => {
  const liveTs = normalizeTs(props.docxUpdatedAt) ?? 0;
  const normalized = normalizeDocxHistoryEntry({
    createdAt: liveTs,
    docxUpdatedAt: liveTs || null,
    sourcePath: props.sourcePath,
    sourceKind: props.sourceKind,
    docx_file_b64: props.docxBase64 || null,
    docx_hash: props.docxHash || null,
    docx_download_url: props.docxDownloadUrl || null,
    docx_file_token: props.docxFileToken || null,
    docx_artifact_id: props.docxArtifactId || null,
    docx_file_name: props.docxFileName || null,
    docx_size_bytes: props.docxSizeBytes ?? null,
    docx_provenance_available: Boolean(props.docxProvenanceAvailable),
    docx_provenance_ref: props.docxProvenanceRef || null,
    workspace_path: props.docxWorkspacePath || null,
    workspace_relpath: props.docxWorkspaceRelpath || null,
    workspace_warning: props.docxWorkspaceWarning || null,
    docx_quality_status: props.docxQualityStatus || null,
    docx_quality_score: props.docxQualityScore ?? null,
    docx_quality_counts: props.docxQualityCounts || null,
    docx_render_status: props.docxRenderStatus || null,
    docx_render_page_count: props.docxRenderPageCount ?? null,
    docx_render_cached_pages: props.docxRenderCachedPages ?? null,
    docx_render_renderer: props.docxRenderRenderer || null,
    ref: props.docxDownloadUrl || null,
  });
  if (normalized) return normalized;
  const fallback = buildDocxDownloadPath({ sourcePath: props.sourcePath, kernelId: props.kernelId });
  if (!fallback && !props.docxBase64) return null;
  return {
    id: `live:${props.sourcePath || props.kernelId || props.docxHash || props.docxDownloadUrl || 'current'}`,
    createdAt: liveTs,
    sourcePath: props.sourcePath,
    sourceKind: props.sourceKind,
    docxEventId: null,
    downloadUrl: fallback,
    ref: fallback,
    docxArtifactId: props.docxArtifactId || null,
    docxFileToken: props.docxFileToken || null,
    docxFileName: props.docxFileName || 'inspyro_document.docx',
    docxSizeBytes: props.docxSizeBytes ?? null,
    docxProvenanceAvailable: Boolean(props.docxProvenanceAvailable),
    docxProvenanceRef: props.docxProvenanceRef || buildDocxProvenancePath({ artifactId: props.docxArtifactId || null }) || null,
    docxWorkspacePath: props.docxWorkspacePath || null,
    docxWorkspaceRelpath: props.docxWorkspaceRelpath || null,
    docxWorkspaceWarning: props.docxWorkspaceWarning || null,
    docxQualityStatus: props.docxQualityStatus || null,
    docxQualityScore: props.docxQualityScore ?? null,
    docxQualityCounts: props.docxQualityCounts || null,
    docxRenderStatus: props.docxRenderStatus || null,
    docxRenderPageCount: props.docxRenderPageCount ?? null,
    docxRenderCachedPages: props.docxRenderCachedPages ?? null,
    docxRenderRenderer: props.docxRenderRenderer || null,
    docxHash: props.docxHash || null,
    docxUpdatedAt: liveTs || null,
    origin: 'live',
  };
};

const describeWorkspaceDocxWarning = (warningCode) => {
  switch (warningCode) {
    case 'active_workspace_missing':
      return 'No hay un proyecto activo para abrir este DOCX desde la carpeta del proyecto.';
    case 'active_workspace_unavailable':
      return 'La carpeta del proyecto ya no esta disponible para abrir este DOCX.';
    case 'workspace_docx_dir_outside_workspace':
    case 'workspace_docx_target_outside_workspace':
      return 'La copia persistida del DOCX no pudo validarse dentro del proyecto activo.';
    default:
      return 'No se pudo abrir el DOCX desde la carpeta del proyecto.';
  }
};

const hasArtifactBackedDownload = (entry) => {
  const rawUrl = entry?.downloadUrl || entry?.ref || null;
  if (entry?.docxArtifactId) {
    return true;
  }
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(resolveBackendUrl(rawUrl) || rawUrl);
    return parsed.pathname.endsWith('/api/docx/download') && parsed.searchParams.has('artifact_id');
  } catch {
    return String(rawUrl).includes('/api/docx/download?artifact_id=');
  }
};

const mergeProvenanceManifestItem = (currentManifest, item) => {
  if (!item || typeof item !== 'object' || !item.provenance_id) {
    return currentManifest;
  }
  const baseManifest = currentManifest && typeof currentManifest === 'object'
    ? currentManifest
    : { items: [] };
  const existingItems = Array.isArray(baseManifest.items) ? baseManifest.items : [];
  return {
    ...baseManifest,
    items: [
      ...existingItems.filter((entry) => entry?.provenance_id !== item.provenance_id),
      item,
    ],
  };
};

const formatNavigationTargetLabel = (target) => {
  if (!target || typeof target !== 'object') return 'Sin destino navegable.';
  if (target.filePath) return `${target.filePath}:${target.line || '?'}`;
  if (target.cellId) return `Celda ${target.cellId} - linea ${target.line || '?'}`;
  return 'Sin destino navegable.';
};

const resolveNotebookSourcePath = (rawPath) => {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().endsWith('.ipynb') ? trimmed : null;
};

const buildDocumentSourceIdentity = (sourcePath, sourceKind, kernelId) => {
  if (typeof sourcePath === 'string' && sourcePath.trim()) {
    return `${sourceKind || 'unknown'}:${sourcePath.trim().toLowerCase()}`;
  }
  if (typeof kernelId === 'string' && kernelId.trim()) {
    return `kernel:${kernelId.trim()}`;
  }
  return null;
};

const buildTemplateModalIntent = (request = null) => {
  const entry = request?.entry || {};
  return {
    persisted: Boolean(
      entry?.template_token
      || entry?.templateToken
      || entry?.template_json_path
      || entry?.templateJsonPath
      || entry?.template_mirror_path
      || entry?.templateMirrorPath
    ),
  };
};

const isNavigationTargetUsable = (target) => Boolean(
  target
  && typeof target === 'object'
  && (
    (typeof target.filePath === 'string' && target.filePath.trim())
    || (typeof target.cellId === 'string' && target.cellId.trim())
  )
);

const DEFAULT_ZOOM_PERCENT = 100;
const PDF_ZOOM_STEP = 10;
const PDF_MIN_ZOOM_PERCENT = 50;
const PDF_MAX_ZOOM_PERCENT = 300;
const MAX_HISTORY_MENU_ITEMS = 8;
const OUTLINE_RAIL_DOCKED_WIDTH = 290;
const PROVENANCE_RAIL_DOCKED_WIDTH = 320;
const QUALITY_RAIL_DOCKED_WIDTH = 340;
const PDF_VIEWPORT_MIN_DOCKED_WIDTH = 820;
const OUTLINE_ACTIVE_EPSILON = 0.01;

const clampPageNumber = (value, totalPages = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 1) return null;
  if (Number.isFinite(totalPages) && totalPages > 0) {
    return Math.min(normalized, Math.trunc(totalPages));
  }
  return normalized;
};

const clampZoomPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ZOOM_PERCENT;
  return Math.min(PDF_MAX_ZOOM_PERCENT, Math.max(PDF_MIN_ZOOM_PERCENT, Math.trunc(parsed)));
};

const clampRatio = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 0), 1);
};

const getOutlineAnchorRatio = (item) => clampRatio(item?.anchorTopRatio);

const buildPdfLocation = (pageNumber, options = {}) => {
  const normalizedPageNumber = clampPageNumber(pageNumber, null);
  if (!normalizedPageNumber) {
    return null;
  }
  return {
    pageNumber: normalizedPageNumber,
    anchorTopPx: Number.isFinite(options.anchorTopPx) ? options.anchorTopPx : null,
    anchorTopRatio: clampRatio(options.anchorTopRatio) ?? 0,
    destinationKey: options.destinationKey || null,
    requestKey: options.requestKey || null,
  };
};

const resolveActiveOutlineId = (outlineItems, currentLocation) => {
  const currentPageNumber = clampPageNumber(currentLocation?.pageNumber, null);
  if (!currentPageNumber || !Array.isArray(outlineItems) || outlineItems.length === 0) {
    return null;
  }
  const currentAnchorRatio = clampRatio(currentLocation?.anchorTopRatio);
  let candidateId = null;
  for (const item of outlineItems) {
    const itemPageNumber = clampPageNumber(item?.pageNumber, null);
    if (!itemPageNumber) continue;
    if (itemPageNumber < currentPageNumber) {
      candidateId = item.id;
      continue;
    }
    if (itemPageNumber > currentPageNumber) {
      break;
    }
    const itemAnchorRatio = getOutlineAnchorRatio(item);
    if (currentAnchorRatio == null || itemAnchorRatio == null) {
      candidateId = item.id;
      continue;
    }
    if (itemAnchorRatio <= currentAnchorRatio + OUTLINE_ACTIVE_EPSILON) {
      candidateId = item.id;
      continue;
    }
    break;
  }
  return candidateId;
};

const normalizeOutlineItems = (items, totalPages = null, depth = 0, lineage = 'outline') => {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item, index) => {
    const itemDepth = Number.isInteger(item?.depth) && item.depth >= 0 ? item.depth : depth;
    const pageNumber = clampPageNumber(
      item?.pageNumber ?? item?.page ?? item?.destPageNumber ?? item?.page_index ?? null,
      totalPages,
    );
    const title = typeof item?.title === 'string' && item.title.trim()
      ? item.title.trim()
      : null;
    const id = item?.id || `${lineage}-${index}-${pageNumber || 'unknown'}`;
    const anchorTopRatio = clampRatio(item?.anchorTopRatio ?? item?.top_ratio ?? item?.destinationTopRatio ?? null);
    const current = title && pageNumber
      ? [{
        id,
        title,
        pageNumber,
        depth: itemDepth,
        destinationKey: item?.destinationKey || item?.destination_key || null,
        destinationMode: item?.destinationMode || item?.destination_mode || null,
        anchorTopPx: Number.isFinite(item?.anchorTopPx) ? item.anchorTopPx : (Number.isFinite(item?.anchor_top_px) ? item.anchor_top_px : null),
        anchorTopRatio,
      }]
      : [];
    const children = normalizeOutlineItems(
      Array.isArray(item?.items) ? item.items : item?.children,
      totalPages,
      itemDepth + 1,
      id,
    );

    return current.concat(children);
  });
};

const DocxViewer = ({
  docxBase64, docxHash, docxDownloadUrl, docxFileToken = null, docxArtifactId = null, docxFileName, docxWarnings, docxError,
  docxSizeBytes, docxStoreError, docxProvenanceAvailable = false, docxProvenanceRef = null, docxUpdatedAt = null, docxHistory = [],
  docxWorkspacePath = null, docxWorkspaceRelpath = null, docxWorkspaceWarning = null,
  docxQualityStatus = null, docxQualityScore = null, docxQualityCounts = null,
  docxRenderStatus = null, docxRenderPageCount = null, docxRenderCachedPages = null, docxRenderRenderer = null,
  sourcePath = null, sourceKind = null, pdfBase64, pdfRefUrl, pdfHash, pdfConversionError, pdfAttempted, pdfConversionStdout,
  pdfConversionStderr, pdfConversionMs, conversionStatus, documentPipelineStatus = null, pdfServiceStatus = null, converterUsed, wordError, onClearDocx,
  onRetryPdf, onStatusMessage, kernelId = null, sendMessage = null, lastMessage = null,
  templateSendMessage = null, templateLastMessage = null, templateInfo = null,
  templateBinding = null,
  templateDocxBase64 = '',
  onTemplateChange = null, onTemplateUpload = null, onTemplateBind = null, onRequestKernelStart = null, onTemplateOpenHandled = null, onNavigateToCode = null, isVisible = true,
  templateOpenRequest = null, qualityOpenRequest = null,
}) => {
  const desktopApi = typeof window !== 'undefined' ? window.inspyroDesktop : null;
  const [html, setHtml] = useState('');
  const [htmlError, setHtmlError] = useState(null);
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [mammothStatus, setMammothStatus] = useState('unknown');
  const [flash, setFlash] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoadError, setPdfLoadError] = useState(null);
  const [pdfLoadNotice, setPdfLoadNotice] = useState(null);
  const [isLoadingPdfRef, setIsLoadingPdfRef] = useState(false);
  const [viewMode, setViewMode] = useState('pdf');
  const [pdfWaitingTooLong, setPdfWaitingTooLong] = useState(false);
  const [historyEntries, setHistoryEntries] = useState(Array.isArray(docxHistory) ? docxHistory : []);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateModalIntent, setTemplateModalIntent] = useState(null);
  const [isWaitingForKernel, setIsWaitingForKernel] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [provenanceManifest, setProvenanceManifest] = useState(null);
  const [provenanceLoading, setProvenanceLoading] = useState(false);
  const [provenanceError, setProvenanceError] = useState(null);
  const [provenanceNotice, setProvenanceNotice] = useState(null);
  const [provenanceSelectionId, setProvenanceSelectionId] = useState(null);
  const [provenanceSummary, setProvenanceSummary] = useState({ totalLinkCount: 0, provenanceCount: 0 });
  const [qualityRailOpen, setQualityRailOpen] = useState(false);
  const [qualitySummary, setQualitySummary] = useState(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState(null);
  const [qualityRenderUrl, setQualityRenderUrl] = useState(null);
  const [qualityRenderLoading, setQualityRenderLoading] = useState(false);
  const [qualityCleanLoading, setQualityCleanLoading] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState('quality');
  const [workbenchResult, setWorkbenchResult] = useState(null);
  const [workbenchLoading, setWorkbenchLoading] = useState(null);
  const [workbenchError, setWorkbenchError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [outline, setOutline] = useState([]);
  const [isOutlineRailOpen, setIsOutlineRailOpen] = useState(false);
  const [isOutlineOverlayForced, setIsOutlineOverlayForced] = useState(false);
  const [viewerBodyWidth, setViewerBodyWidth] = useState(() => (
    (typeof window !== 'undefined' && Number.isFinite(window.innerWidth))
      ? window.innerWidth
      : (PDF_VIEWPORT_MIN_DOCKED_WIDTH + OUTLINE_RAIL_DOCKED_WIDTH)
  ));
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_ZOOM_PERCENT);
  const [fitMode, setFitMode] = useState('width');
  const [requestedPage, setRequestedPage] = useState(null);
  const [requestedPdfLocation, setRequestedPdfLocation] = useState(null);
  const [currentPdfLocation, setCurrentPdfLocation] = useState(() => buildPdfLocation(1, {}));
  const [pageInputValue, setPageInputValue] = useState('');
  const prevPdfUrlRef = useRef(null);
  const qualityRenderUrlRef = useRef(null);
  const viewerBodyRef = useRef(null);
  const pageInputFocusedRef = useRef(false);
  const pdfViewerVisibleRef = useRef(false);
  const numPagesRef = useRef(0);
  const currentPageRef = useRef(1);
  const currentPdfLocationRef = useRef(buildPdfLocation(1, {}));
  const pdfNavigationRequestSeqRef = useRef(0);
  const lastTemplateOpenTokenRef = useRef(null);
  const lastQualityOpenTokenRef = useRef(null);
  const sourceIdentityRef = useRef(buildDocumentSourceIdentity(sourcePath, sourceKind, kernelId));
  const sourceModeRef = useRef(sourceMode);
  const provenanceItemsByIdRef = useRef(new Map());
  const onNavigateToCodeRef = useRef(onNavigateToCode);
  const onStatusMessageRef = useRef(onStatusMessage);
  const lastPdfMetaSignatureRef = useRef('');
  const nextPdfNavigationRequestKey = useCallback((prefix = 'pdf') => {
    pdfNavigationRequestSeqRef.current += 1;
    return `${prefix}-${pdfNavigationRequestSeqRef.current}`;
  }, []);

  const normalizedDocxDownloadUrl = useMemo(() => resolveBackendUrl(docxDownloadUrl || (docxFileToken ? buildDocxDownloadPath({ token: docxFileToken }) : null)), [docxDownloadUrl, docxFileToken]);
  const documentSourceIdentity = useMemo(
    () => buildDocumentSourceIdentity(sourcePath, sourceKind, kernelId),
    [kernelId, sourceKind, sourcePath],
  );
  const normalizedPdfRefUrl = useMemo(() => {
    const resolved = resolveBackendUrl(pdfRefUrl);
    if (!resolved) return null;
    try {
      const url = new URL(resolved); if (url.pathname.endsWith('/api/pdf/download') && !url.searchParams.has('inline')) url.searchParams.set('inline', '1'); return url.toString();
    } catch { return resolved; }
  }, [pdfRefUrl]);
  const normalizedPdfDownloadUrl = useMemo(() => {
    if (!normalizedPdfRefUrl) return null;
    try { const url = new URL(normalizedPdfRefUrl); url.searchParams.set('inline', '0'); return url.toString(); } catch { return normalizedPdfRefUrl; }
  }, [normalizedPdfRefUrl]);
  const localHistoryEntries = useMemo(() => (Array.isArray(docxHistory) ? docxHistory : []), [docxHistory]);
  const mergeHistoryEntries = useCallback((remoteEntries = []) => {
    const byId = new Map();
    [...remoteEntries, ...localHistoryEntries].forEach((entry) => {
      const normalized = normalizeDocxHistoryEntry({
        ...entry,
        source_path: entry?.source_path || sourcePath || null,
        source_kind: entry?.source_kind || sourceKind || null,
      });
      if (normalized?.id) byId.set(normalized.id, { ...normalized, ref: normalized.ref || normalized.downloadUrl || null });
    });
    return Array.from(byId.values()).sort((l, r) => r.createdAt - l.createdAt);
  }, [localHistoryEntries, sourceKind, sourcePath]);
  const currentLiveEntry = useMemo(() => createCurrentLiveDocxEntry({ docxBase64, docxHash, docxDownloadUrl, docxFileToken, docxArtifactId, docxFileName, docxSizeBytes, docxProvenanceAvailable, docxProvenanceRef, docxUpdatedAt, docxWorkspacePath, docxWorkspaceRelpath, docxWorkspaceWarning, docxQualityStatus, docxQualityScore, docxQualityCounts, docxRenderStatus, docxRenderPageCount, docxRenderCachedPages, docxRenderRenderer, sourcePath, sourceKind, kernelId }), [docxArtifactId, docxBase64, docxDownloadUrl, docxFileName, docxFileToken, docxHash, docxProvenanceAvailable, docxProvenanceRef, docxQualityCounts, docxQualityScore, docxQualityStatus, docxRenderCachedPages, docxRenderPageCount, docxRenderRenderer, docxRenderStatus, docxSizeBytes, docxUpdatedAt, docxWorkspacePath, docxWorkspaceRelpath, docxWorkspaceWarning, kernelId, sourceKind, sourcePath]);
  const latestHistoryEntry = useMemo(() => (historyEntries[0] || null), [historyEntries]);
  const latestStableArtifactEntry = useMemo(
    () => (historyEntries || []).find((entry) => !isDocxHistoryEntryEmpty(entry) && hasArtifactBackedDownload(entry)) || null,
    [historyEntries],
  );
  const latestDownloadEntry = useMemo(() => {
    const byId = new Map(); (historyEntries || []).forEach((entry) => mergeDocxEntryLatestWins(byId, entry)); if (currentLiveEntry) mergeDocxEntryLatestWins(byId, currentLiveEntry);
    return Array.from(byId.values()).sort((l, r) => freshness(r) - freshness(l)).find((entry) => !isDocxHistoryEntryEmpty(entry)) || null;
  }, [currentLiveEntry, historyEntries]);
  const normalizedLatestDownloadUrl = useMemo(() => resolveBackendUrl(latestDownloadEntry?.downloadUrl || latestDownloadEntry?.ref || null), [latestDownloadEntry]);
  const latestFallbackDownloadUrl = useMemo(() => resolveBackendUrl(buildDocxDownloadPath({ sourcePath, kernelId })), [kernelId, sourcePath]);
  const latestWorkspacePath = useMemo(
    () => latestDownloadEntry?.docxWorkspacePath || currentLiveEntry?.docxWorkspacePath || docxWorkspacePath || null,
    [currentLiveEntry?.docxWorkspacePath, docxWorkspacePath, latestDownloadEntry?.docxWorkspacePath],
  );
  const latestWorkspaceWarning = useMemo(
    () => latestDownloadEntry?.docxWorkspaceWarning || currentLiveEntry?.docxWorkspaceWarning || docxWorkspaceWarning || null,
    [currentLiveEntry?.docxWorkspaceWarning, docxWorkspaceWarning, latestDownloadEntry?.docxWorkspaceWarning],
  );
  const shouldRefreshBeforeUsingHistoryArtifact = useMemo(() => (
    Boolean(
      currentLiveEntry
      && !hasArtifactBackedDownload(currentLiveEntry)
      && latestStableArtifactEntry
      && freshness(currentLiveEntry) > freshness(latestStableArtifactEntry)
    )
  ), [currentLiveEntry, latestStableArtifactEntry]);
  const normalizedProvenanceRef = useMemo(() => resolveBackendUrl(docxProvenanceRef || latestDownloadEntry?.docxProvenanceRef || buildDocxProvenancePath({ artifactId: docxArtifactId || latestDownloadEntry?.docxArtifactId || null })), [docxArtifactId, docxProvenanceRef, latestDownloadEntry]);
  const effectiveDocxProvenanceAvailable = Boolean(docxProvenanceAvailable || latestDownloadEntry?.docxProvenanceAvailable || normalizedProvenanceRef);
  const qualityArtifactId = useMemo(
    () => latestStableArtifactEntry?.docxArtifactId || latestDownloadEntry?.docxArtifactId || docxArtifactId || currentLiveEntry?.docxArtifactId || null,
    [currentLiveEntry?.docxArtifactId, docxArtifactId, latestDownloadEntry?.docxArtifactId, latestStableArtifactEntry?.docxArtifactId],
  );
  const qualitySourceSummary = useMemo(
    () => qualitySummary || latestDownloadEntry || currentLiveEntry || {
      docxQualityStatus,
      docxQualityScore,
      docxQualityCounts,
    },
    [currentLiveEntry, docxQualityCounts, docxQualityScore, docxQualityStatus, latestDownloadEntry, qualitySummary],
  );
  const qualityDescriptor = useMemo(() => describeQualitySummary(qualitySourceSummary), [qualitySourceSummary]);
  const renderSourceSummary = useMemo(
    () => (workbenchResult?.visual && typeof workbenchResult.visual === 'object')
      ? workbenchResult.visual
      : latestDownloadEntry || currentLiveEntry || {
        docxRenderStatus,
        docxRenderPageCount,
        docxRenderCachedPages,
        docxRenderRenderer,
      },
    [currentLiveEntry, docxRenderCachedPages, docxRenderPageCount, docxRenderRenderer, docxRenderStatus, latestDownloadEntry, workbenchResult],
  );
  const renderDescriptor = useMemo(() => describeRenderSummary(renderSourceSummary), [renderSourceSummary]);
  const qualitySections = useMemo(
    () => (Array.isArray(qualitySummary?.sections) ? qualitySummary.sections : []),
    [qualitySummary],
  );
  const qualityContentControls = useMemo(
    () => (qualitySummary?.content_controls && typeof qualitySummary.content_controls === 'object' ? qualitySummary.content_controls : null),
    [qualitySummary],
  );
  const diffCompareEntry = useMemo(
    () => historyEntries.find((entry) => entry?.docxArtifactId && entry.docxArtifactId !== qualityArtifactId) || null,
    [historyEntries, qualityArtifactId],
  );
  const workbenchResources = useMemo(
    () => {
      const byUri = new Map();
      const addResource = (resource) => {
        if (!resource || typeof resource !== 'object') return;
        const key = resource.resource_uri || resource.name;
        if (key) byUri.set(key, resource);
      };
      (Array.isArray(workbenchResult?.resources) ? workbenchResult.resources : []).forEach(addResource);
      (Array.isArray(workbenchResult?.visual?.page_resources) ? workbenchResult.visual.page_resources : []).forEach(addResource);
      (Array.isArray(workbenchResult?.visual?.resources) ? workbenchResult.visual.resources : []).forEach(addResource);
      return Array.from(byUri.values());
    },
    [workbenchResult],
  );
  const provenanceItemsById = useMemo(() => new Map((Array.isArray(provenanceManifest?.items) ? provenanceManifest.items : []).filter((item) => item?.provenance_id).map((item) => [item.provenance_id, item])), [provenanceManifest]);
  const selectedProvenanceItem = useMemo(() => (provenanceSelectionId ? provenanceItemsById.get(provenanceSelectionId) || null : null), [provenanceItemsById, provenanceSelectionId]);
  const hasHistoryDownloadEntry = useMemo(() => (
    (historyEntries || []).some((entry) => !isDocxHistoryEntryEmpty(entry) && (
      entry?.downloadUrl
      || entry?.ref
      || entry?.docxArtifactId
      || entry?.docxFileToken
      || entry?.docxHash
    ))
  ), [historyEntries]);
  const hasKnownDocxDownload = Boolean(docxBase64 || normalizedDocxDownloadUrl || docxArtifactId || docxFileToken || hasHistoryDownloadEntry);
  const hasDocxSourceLookupOnly = Boolean(!hasKnownDocxDownload && normalizedLatestDownloadUrl);
  const hasDocx = Boolean(hasKnownDocxDownload || hasDocxSourceLookupOnly);
  const hasDocxDownloadOnly = Boolean(!docxBase64 && hasKnownDocxDownload);
  const hasKernel = Boolean(sendMessage && kernelId);
  const canRetryPdf = Boolean(onRetryPdf && sendMessage && kernelId);
  const canRequestKernel = Boolean(onRequestKernelStart && sendMessage);
  const activeDocumentPipelineStatus = isDocumentPipelineStatusActive(documentPipelineStatus?.status)
    ? documentPipelineStatus
    : null;
  const documentSharedResource = useMemo(
    () => normalizeDocumentSharedResource(activeDocumentPipelineStatus?.sharedResource || activeDocumentPipelineStatus?.shared_resource || null),
    [activeDocumentPipelineStatus],
  );
  const effectiveConversionStatus = useMemo(() => (
    activeDocumentPipelineStatus
      ? {
        message: describePdfSharedResource(documentSharedResource)
          || activeDocumentPipelineStatus.message
          || 'Generando documento...',
      }
      : conversionStatus
  ), [activeDocumentPipelineStatus, conversionStatus, documentSharedResource]);
  const effectivePdfError = pdfConversionError || pdfLoadError || null;
  const effectivePdfNotice = effectivePdfError ? null : pdfLoadNotice;
  const showConversionSpinner = !pdfBlobUrl && !effectivePdfError && (Boolean(effectiveConversionStatus) || isLoadingPdfRef);
  const hasPdfPreviewSource = Boolean(pdfBase64 || normalizedPdfRefUrl || pdfBlobUrl);
  const hasActiveDocumentPreview = Boolean(docxBase64 || pdfBase64 || normalizedPdfRefUrl || pdfBlobUrl);
  const canEnableSourceMode = Boolean(pdfBlobUrl && effectiveDocxProvenanceAvailable && provenanceManifest && provenanceSummary.provenanceCount > 0);
  const sourceModeDisabledReason = !pdfBlobUrl
    ? 'Modo origen requiere un PDF visible.'
    : provenanceLoading
      ? 'Cargando procedencia del documento...'
      : provenanceError
        ? 'No se pudo cargar la procedencia de esta version DOCX.'
        : provenanceNotice
          ? provenanceNotice
          : !effectiveDocxProvenanceAvailable
            ? 'Esta version DOCX no publico procedencia.'
            : provenanceManifest && provenanceSummary.provenanceCount === 0
              ? 'Este PDF no contiene links de procedencia clicables.'
              : null;
  const showRetryPdf = canRetryPdf
    && !pdfBase64
    && !pdfBlobUrl
    && !isLoadingPdfRef
    && (Boolean(effectivePdfError) || Boolean(effectivePdfNotice) || Boolean(pdfAttempted))
    && (!effectiveConversionStatus || Boolean(effectivePdfError) || Boolean(effectivePdfNotice));

  const clearPdfPreview = useCallback(() => {
    if (prevPdfUrlRef.current) {
      URL.revokeObjectURL(prevPdfUrlRef.current);
      prevPdfUrlRef.current = null;
    }
    setPdfBlobUrl(null);
    setIsLoadingPdfRef(false);
    setPdfLoadError(null);
    setPdfLoadNotice(null);
  }, []);

  const resetPdfReaderState = useCallback(() => {
    currentPageRef.current = 1;
    currentPdfLocationRef.current = buildPdfLocation(1, {});
    numPagesRef.current = 0;
    lastPdfMetaSignatureRef.current = '';
    setCurrentPage(1);
    setCurrentPdfLocation(buildPdfLocation(1, {}));
    setNumPages(0);
    setOutline([]);
    setIsOutlineOverlayForced(false);
    setZoomPercent(DEFAULT_ZOOM_PERCENT);
    setFitMode('width');
    setRequestedPage(null);
    setRequestedPdfLocation(null);
    setPageInputValue('');
    setProvenanceSelectionId(null);
  }, []);

  useEffect(() => {
    if (sourceIdentityRef.current === documentSourceIdentity) {
      return;
    }

    sourceIdentityRef.current = documentSourceIdentity;
    setHistoryEntries(localHistoryEntries);
    setHistoryError(null);
    setHistoryLoading(false);
    setHtml('');
    setHtmlError(null);
    setLoadingHtml(false);
    setPdfLoadNotice(null);
    setProvenanceManifest(null);
    setProvenanceError(null);
    setProvenanceNotice(null);
    setProvenanceLoading(false);
    setProvenanceSummary({ totalLinkCount: 0, provenanceCount: 0 });
    setSourceMode(false);
    clearPdfPreview();
    resetPdfReaderState();
  }, [clearPdfPreview, documentSourceIdentity, localHistoryEntries, resetPdfReaderState]);

  useEffect(() => {
    const historyPath = buildDocxHistoryPath({ sourcePath, kernelId, limit: 20 });
    if (!historyPath) { setHistoryEntries(localHistoryEntries); setHistoryError(null); setHistoryLoading(false); return undefined; }
    let cancelled = false;
    setHistoryLoading(true);
    fetch(resolveBackendUrl(historyPath), DOCX_FETCH_OPTIONS).then(async (response) => {
      if (!response.ok) throw createHttpStatusError(response.status);
      return response.json();
    }).then((payload) => {
      if (!cancelled) { setHistoryEntries(mergeHistoryEntries(Array.isArray(payload?.items) ? payload.items : [])); setHistoryError(null); }
    }).catch((error) => {
      if (cancelled) return;
      if (isHttpStatusError(error, 404)) {
        logger.info('DOCX history not available yet for active source, using local fallback.', {
          historyPath,
          sourcePath,
          kernelId,
        });
        setHistoryEntries(mergeHistoryEntries());
        setHistoryError(null);
        return;
      }
      logger.error('Error cargando historial DOCX:', error);
      setHistoryEntries(mergeHistoryEntries());
      setHistoryError(String(error));
    }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [docxArtifactId, docxUpdatedAt, kernelId, localHistoryEntries, mergeHistoryEntries, pdfHash, pdfRefUrl, sourcePath]);

  const refreshRemoteHistoryEntries = useCallback(async () => {
    const historyPath = buildDocxHistoryPath({ sourcePath, kernelId, limit: 20 });
    if (!historyPath) {
      const merged = mergeHistoryEntries();
      setHistoryEntries(merged);
      setHistoryError(null);
      return merged;
    }

    setHistoryLoading(true);
    try {
      const response = await fetch(resolveBackendUrl(historyPath), DOCX_FETCH_OPTIONS);
      if (!response.ok) throw createHttpStatusError(response.status);
      const payload = await response.json();
      const merged = mergeHistoryEntries(Array.isArray(payload?.items) ? payload.items : []);
      setHistoryEntries(merged);
      setHistoryError(null);
      return merged;
    } catch (error) {
      if (isHttpStatusError(error, 404)) {
        logger.info('DOCX history refresh returned 404, keeping local history.', {
          historyPath,
          sourcePath,
          kernelId,
        });
        const merged = mergeHistoryEntries();
        setHistoryEntries(merged);
        setHistoryError(null);
        return merged;
      }
      logger.error('Error refrescando historial DOCX:', error);
      const merged = mergeHistoryEntries();
      setHistoryEntries(merged);
      setHistoryError(String(error));
      return merged;
    } finally {
      setHistoryLoading(false);
    }
  }, [kernelId, mergeHistoryEntries, sourcePath]);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedProvenanceRef || !effectiveDocxProvenanceAvailable || !hasPdfPreviewSource) {
      setProvenanceManifest(null); setProvenanceError(null); setProvenanceLoading(false); setProvenanceSelectionId(null); return undefined;
    }
    setProvenanceLoading(true);
    fetch(normalizedProvenanceRef, DOCX_FETCH_OPTIONS).then(async (response) => {
      if (!response.ok) throw createHttpStatusError(response.status);
      if (typeof response.json !== 'function') return { items: [] };
      return response.json();
    }).then((payload) => {
      if (!cancelled) {
        const nextManifest = payload || { items: [] };
        logger.info('DocxViewer provenance manifest loaded', {
          provenanceRef: normalizedProvenanceRef,
          itemCount: Array.isArray(nextManifest?.items) ? nextManifest.items.length : 0,
          sourcePath,
          sourceKind,
        });
        setProvenanceManifest(nextManifest);
        setProvenanceError(null);
        setProvenanceNotice(null);
      }
    }).catch((error) => {
      if (cancelled) return;
      if (isHttpStatusError(error, 404)) {
        logger.info('DOCX provenance manifest not available yet for active source.', {
          provenanceRef: normalizedProvenanceRef,
          sourcePath,
          sourceKind,
        });
        setProvenanceManifest({ items: [] });
        setProvenanceError(null);
        setProvenanceNotice('La procedencia todavia no esta disponible para esta version DOCX.');
        return;
      }
      logger.error('Error cargando procedencia DOCX:', error);
      setProvenanceManifest(null);
      setProvenanceError(String(error));
      setProvenanceNotice(null);
    }).finally(() => { if (!cancelled) setProvenanceLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveDocxProvenanceAvailable, hasPdfPreviewSource, normalizedProvenanceRef, sourceKind, sourcePath]);

  useEffect(() => { if (sourceMode && !canEnableSourceMode) setSourceMode(false); }, [canEnableSourceMode, sourceMode]);
  useEffect(() => { if (viewMode !== 'pdf' && sourceMode) setSourceMode(false); }, [sourceMode, viewMode]);
  useEffect(() => { if (viewMode !== 'pdf' && isOutlineRailOpen) setIsOutlineRailOpen(false); }, [isOutlineRailOpen, viewMode]);
  useEffect(() => { if (outline.length === 0 && isOutlineRailOpen) setIsOutlineRailOpen(false); }, [isOutlineRailOpen, outline]);
  useEffect(() => {
    if (!isOutlineRailOpen && isOutlineOverlayForced) {
      setIsOutlineOverlayForced(false);
    }
  }, [isOutlineOverlayForced, isOutlineRailOpen]);
  useEffect(() => { if (provenanceSelectionId && !selectedProvenanceItem) setProvenanceSelectionId(null); }, [provenanceSelectionId, selectedProvenanceItem]);
  useEffect(() => { sourceModeRef.current = sourceMode; }, [sourceMode]);
  useEffect(() => { provenanceItemsByIdRef.current = provenanceItemsById; }, [provenanceItemsById]);
  useEffect(() => {
    if (!pdfBlobUrl) return;
    logger.info('DocxViewer provenance summary updated', {
      totalLinkCount: provenanceSummary.totalLinkCount,
      provenanceCount: provenanceSummary.provenanceCount,
      sourceMode,
      sourcePath,
    });
  }, [pdfBlobUrl, provenanceSummary.provenanceCount, provenanceSummary.totalLinkCount, sourceMode, sourcePath]);
  useEffect(() => { onNavigateToCodeRef.current = onNavigateToCode; }, [onNavigateToCode]);
  useEffect(() => { onStatusMessageRef.current = onStatusMessage; }, [onStatusMessage]);
  useEffect(() => { numPagesRef.current = numPages; }, [numPages]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { currentPdfLocationRef.current = currentPdfLocation; }, [currentPdfLocation]);
  useEffect(() => {
    if (!pdfBlobUrl) {
      lastPdfMetaSignatureRef.current = '';
    }
  }, [pdfBlobUrl]);
  useEffect(() => { if (!docxHash) return undefined; setFlash(true); const t = setTimeout(() => setFlash(false), 800); return () => clearTimeout(t); }, [docxHash]);
  useEffect(() => {
    if (pageInputFocusedRef.current) return;
    setPageInputValue(numPages > 0 ? String(currentPage) : '');
  }, [currentPage, numPages]);
  useEffect(() => {
    const shouldMountViewer = Boolean(isVisible && viewMode === 'pdf' && pdfBlobUrl);
    const shouldRestorePriorLocation = (
      (currentPage || 1) > 1
      || Boolean(currentPdfLocation?.destinationKey)
      || (clampRatio(currentPdfLocation?.anchorTopRatio) ?? 0) > 0
    );
    if (shouldMountViewer && !pdfViewerVisibleRef.current && shouldRestorePriorLocation) {
      setRequestedPage((pending) => pending ?? clampPageNumber(currentPage, numPages || null) ?? 1);
      setRequestedPdfLocation((pending) => pending ?? buildPdfLocation(currentPage, {
        destinationKey: currentPdfLocation?.destinationKey || null,
        anchorTopPx: currentPdfLocation?.anchorTopPx ?? null,
        anchorTopRatio: currentPdfLocation?.anchorTopRatio ?? 0,
        requestKey: nextPdfNavigationRequestKey('resume'),
      }));
    }
    pdfViewerVisibleRef.current = shouldMountViewer;
  }, [currentPage, currentPdfLocation, isVisible, nextPdfNavigationRequestKey, numPages, pdfBlobUrl, viewMode]);

  useEffect(() => {
    const node = viewerBodyRef.current;
    if (!node) {
      return undefined;
    }

    const measureWidth = () => {
      const nextWidth = node.clientWidth > 0
        ? node.clientWidth
        : ((typeof window !== 'undefined' && Number.isFinite(window.innerWidth)) ? window.innerWidth : (PDF_VIEWPORT_MIN_DOCKED_WIDTH + OUTLINE_RAIL_DOCKED_WIDTH));
      setViewerBodyWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    measureWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => measureWidth());
      observer.observe(node);
      return () => observer.disconnect();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measureWidth);
      return () => window.removeEventListener('resize', measureWidth);
    }

    return undefined;
  }, [hasDocx, hasPdfPreviewSource, viewMode]);

  useEffect(() => {
    setPdfWaitingTooLong(false);
    setPdfLoadError(null);
    setPdfLoadNotice(null);
    let currentUrl = null;
    let cancelled = false;
    const controller = new AbortController();
    const clearOwnedUrl = () => { if (prevPdfUrlRef.current) { URL.revokeObjectURL(prevPdfUrlRef.current); prevPdfUrlRef.current = null; } };
    if (normalizedPdfRefUrl) {
      setIsLoadingPdfRef(true);
      (async () => {
        try {
          const response = await fetch(normalizedPdfRefUrl, { signal: controller.signal });
          if (!response.ok) throw createHttpStatusError(response.status);
          const blob = await response.blob();
          if (cancelled) return;
          const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
          clearOwnedUrl(); currentUrl = URL.createObjectURL(pdfBlob); prevPdfUrlRef.current = currentUrl;
          resetPdfReaderState();
          setPdfBlobUrl(currentUrl);
          setPdfLoadError(null);
          setPdfLoadNotice(null);
        } catch (error) {
          if (!cancelled && !controller.signal.aborted) {
            if (isHttpStatusError(error, 404)) {
              logger.info('PDF artifact not available yet for active source.', {
                pdfRefUrl: normalizedPdfRefUrl,
                sourcePath,
                kernelId,
              });
              setPdfLoadError(null);
              setPdfLoadNotice('El PDF todavia no esta disponible para esta version DOCX.');
            } else {
              logger.error('Error cargando PDF por referencia:', error);
              setPdfLoadError(describePdfLoadError(error));
              setPdfLoadNotice(null);
            }
          }
        } finally { if (!cancelled) setIsLoadingPdfRef(false); }
      })();
      return () => { cancelled = true; controller.abort(); if (currentUrl) URL.revokeObjectURL(currentUrl); };
    }
    setIsLoadingPdfRef(false);
    if (!pdfBase64) { return undefined; }
    try {
      const binary = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([binary], { type: 'application/pdf' }));
      clearOwnedUrl(); prevPdfUrlRef.current = url; currentUrl = url;
      resetPdfReaderState();
      setPdfBlobUrl(url);
      setPdfLoadError(null);
      setPdfLoadNotice(null);
    } catch (error) {
      logger.error('Error creando blob PDF:', error);
      setPdfLoadError('No se pudo preparar la vista del PDF.');
      setPdfLoadNotice(null);
    }
    return () => { if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [kernelId, normalizedPdfRefUrl, pdfBase64, resetPdfReaderState, sourcePath]);

  useEffect(() => {
    if (viewMode === 'pdf' && effectiveConversionStatus && hasDocx && !pdfBase64 && !normalizedPdfRefUrl && !effectivePdfError) {
      const t = setTimeout(() => setPdfWaitingTooLong(true), 5000); return () => clearTimeout(t);
    }
    return undefined;
  }, [effectiveConversionStatus, effectivePdfError, hasDocx, normalizedPdfRefUrl, pdfBase64, viewMode]);

  useEffect(() => { if (pdfBlobUrl) setViewMode('pdf'); }, [pdfBlobUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!docxBase64) {
      setHtml('');
      setHtmlError(null);
      setLoadingHtml(false);
      return undefined;
    }
    if (viewMode !== 'html') {
      setLoadingHtml(false);
      return undefined;
    }
    setLoadingHtml(true);
    setHtmlError(null);
    (async () => {
      let mammothLib = null;
      try {
        setMammothStatus((current) => (current === 'ready' ? current : 'loading'));
        mammothLib = await loadMammothModule();
        if (cancelled) return;
        setMammothStatus('ready');
      } catch (error) {
        if (!cancelled) {
          logger.error('Error loading mammoth for HTML preview:', error);
          setMammothStatus('unavailable');
          setHtmlError('La vista HTML no esta disponible en este entorno.');
          setLoadingHtml(false);
        }
        return;
      }

      try {
        const arr = Uint8Array.from(atob(docxBase64), (c) => c.charCodeAt(0));
        const { value } = await mammothLib.convertToHtml({ arrayBuffer: arr.buffer });
        if (!cancelled) {
          setHtml(value?.trim() ? DOMPurify.sanitize(value) : '<p style="opacity:0.7">(Sin contenido extraido)</p>');
        }
      } catch (error) {
        if (!cancelled) {
          logger.error('Error converting DOCX to HTML:', error);
          setHtmlError(String(error));
        }
      } finally {
        if (!cancelled) setLoadingHtml(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docxBase64, viewMode]);

  const triggerBlobDownload = useCallback(async (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url; a.download = fileName || docxFileName || latestHistoryEntry?.docxFileName || 'inspyro_document.docx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } finally { URL.revokeObjectURL(url); }
  }, [docxFileName, latestHistoryEntry]);

  const downloadDocxFromUrl = useCallback(async (url, fileName) => {
    const response = await fetch(url, DOCX_FETCH_OPTIONS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await triggerBlobDownload(blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? blob : new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), fileName);
  }, [triggerBlobDownload]);

  const isSourcePathDownloadUrl = useCallback((url) => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.pathname.endsWith('/api/docx/download') && parsed.searchParams.has('source_path') && !parsed.searchParams.has('artifact_id');
    } catch {
      return String(url).includes('/api/docx/download?source_path=');
    }
  }, []);

  const resolveFreshRemoteHistoryEntry = useCallback(async () => {
    if (!(sourcePath || kernelId)) {
      return null;
    }
    if (currentLiveEntry?.docxArtifactId && !shouldRefreshBeforeUsingHistoryArtifact) {
      return null;
    }
    const baselineFreshness = latestStableArtifactEntry ? freshness(latestStableArtifactEntry) : -1;
    const refreshedEntries = await refreshRemoteHistoryEntries();
    const refreshedStableEntry = (refreshedEntries || []).find((entry) => !isDocxHistoryEntryEmpty(entry)) || null;
    if (
      refreshedStableEntry
      && (
        !latestStableArtifactEntry
        || freshness(refreshedStableEntry) > baselineFreshness
      )
    ) {
      return refreshedStableEntry;
    }
    return null;
  }, [currentLiveEntry?.docxArtifactId, kernelId, latestStableArtifactEntry, refreshRemoteHistoryEntries, shouldRefreshBeforeUsingHistoryArtifact, sourcePath]);

  const resolveStableHistoryEntryForDownload = useCallback(async () => {
    if (!shouldRefreshBeforeUsingHistoryArtifact && latestHistoryEntry && !isDocxHistoryEntryEmpty(latestHistoryEntry)) {
      return latestHistoryEntry;
    }
    return resolveFreshRemoteHistoryEntry();
  }, [latestHistoryEntry, resolveFreshRemoteHistoryEntry, shouldRefreshBeforeUsingHistoryArtifact]);

  const tryOpenDocxProjectFile = useCallback(async (workspacePath) => {
    if (!(desktopApi?.isDesktop && typeof desktopApi.openPath === 'function')) {
      return false;
    }
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return false;
    }
    try {
      await desktopApi.openPath(workspacePath);
      return true;
    } catch (error) {
      logger.error('Error abriendo DOCX persistido desde desktop:', error);
      return false;
    }
  }, [desktopApi]);

  const handleDownload = async () => {
    setIsDownloadingDocx(true);
    try {
      let primaryUrl = normalizedLatestDownloadUrl || normalizedDocxDownloadUrl;
      let primaryFileName = latestDownloadEntry?.docxFileName || docxFileName || latestHistoryEntry?.docxFileName || 'inspyro_document.docx';
      const isDesktopOpenPreferred = Boolean(desktopApi?.isDesktop && typeof desktopApi.openPath === 'function');
      if (isDesktopOpenPreferred) {
        if (await tryOpenDocxProjectFile(latestWorkspacePath)) {
          onStatusMessage?.('DOCX abierto desde la carpeta del proyecto', 'success');
          return;
        }
        if ((sourcePath || kernelId) && !latestWorkspacePath) {
          const refreshedStableEntry = await resolveFreshRemoteHistoryEntry();
          if (await tryOpenDocxProjectFile(refreshedStableEntry?.docxWorkspacePath || null)) {
            onStatusMessage?.('DOCX abierto desde la carpeta del proyecto', 'success');
            return;
          }
        }
        if (!latestWorkspacePath) {
          onStatusMessage?.(describeWorkspaceDocxWarning(latestWorkspaceWarning), 'warning');
        }
      }
      if (shouldRefreshBeforeUsingHistoryArtifact) {
        const refreshedStableEntry = await resolveFreshRemoteHistoryEntry();
        const refreshedUrl = resolveBackendUrl(refreshedStableEntry?.downloadUrl || refreshedStableEntry?.ref || null);
        if (refreshedUrl) {
          primaryUrl = refreshedUrl;
          primaryFileName = refreshedStableEntry?.docxFileName || primaryFileName;
        } else if (latestFallbackDownloadUrl) {
          primaryUrl = latestFallbackDownloadUrl;
        }
      }
      if (primaryUrl && isSourcePathDownloadUrl(primaryUrl)) {
        const stableEntry = await resolveStableHistoryEntryForDownload();
        const stableUrl = resolveBackendUrl(stableEntry?.downloadUrl || stableEntry?.ref || null);
        if (stableUrl) {
          primaryUrl = stableUrl;
          primaryFileName = stableEntry?.docxFileName || primaryFileName;
        }
      }
      if (primaryUrl) { try { await downloadDocxFromUrl(primaryUrl, primaryFileName); onStatusMessage?.('DOCX descargado', 'success'); return; } catch (error) { logger.error('Error descargando DOCX por URL primaria:', error); } }
      if (sourcePath || kernelId) {
        const refreshedEntries = await refreshRemoteHistoryEntries();
        const refreshedStableEntry = (refreshedEntries || []).find((entry) => !isDocxHistoryEntryEmpty(entry)) || null;
        const refreshedUrl = resolveBackendUrl(refreshedStableEntry?.downloadUrl || refreshedStableEntry?.ref || null);
        if (refreshedUrl && refreshedUrl !== primaryUrl) {
          try {
            await downloadDocxFromUrl(refreshedUrl, refreshedStableEntry?.docxFileName || primaryFileName);
            onStatusMessage?.('DOCX descargado', 'success');
            return;
          } catch (error) {
            logger.error('Error descargando DOCX tras refrescar historial remoto:', error);
          }
        }
      }
      if (latestFallbackDownloadUrl && latestFallbackDownloadUrl !== primaryUrl) { try { await downloadDocxFromUrl(latestFallbackDownloadUrl, primaryFileName); onStatusMessage?.('DOCX descargado', 'success'); return; } catch (error) { logger.error('Error descargando DOCX por fallback estable:', error); } }
      if (docxBase64) { await triggerBlobDownload(new Blob([Uint8Array.from(atob(docxBase64), (c) => c.charCodeAt(0))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), primaryFileName); onStatusMessage?.('DOCX descargado', 'success'); return; }
      onStatusMessage?.('No se pudo descargar el DOCX disponible', 'error');
    } catch (error) { logger.error('Error descargando DOCX:', error); onStatusMessage?.(`No se pudo descargar DOCX: ${String(error)}`, 'error'); } finally { setIsDownloadingDocx(false); }
  };

  const handleDownloadHistoryEntry = useCallback(async (entry) => {
    const resolvedUrl = resolveBackendUrl(entry?.downloadUrl || entry?.ref || null);
    if (!resolvedUrl) { onStatusMessage?.('No hay descarga disponible para esa version DOCX', 'warning'); return; }
    try { await downloadDocxFromUrl(resolvedUrl, entry?.docxFileName || entry?.filename || 'inspyro_document.docx'); onStatusMessage?.(isDocxHistoryEntryEmpty(entry) ? (entry?.docxWarning || 'Se descargo una version DOCX vacia del historial.') : 'DOCX descargado', isDocxHistoryEntryEmpty(entry) ? 'warning' : 'success'); } catch (error) { logger.error('Error descargando historial DOCX:', error); onStatusMessage?.(`No se pudo descargar esa version DOCX: ${String(error)}`, 'error'); }
  }, [downloadDocxFromUrl, onStatusMessage]);

  const handleDownloadPdf = () => {
    const a = document.createElement('a');
    a.href = (normalizedPdfDownloadUrl && normalizedPdfRefUrl) ? normalizedPdfDownloadUrl : pdfBlobUrl; a.download = 'inspyro_document.pdf'; a.click(); onStatusMessage?.('PDF descargado', 'success');
  };

  const loadQualitySummary = useCallback(async ({ silent = false } = {}) => {
    if (!qualityArtifactId) {
      setQualitySummary(null);
      setQualityError(null);
      if (!silent) onStatusMessage?.('No hay un artefacto DOCX persistido para analizar.', 'warning');
      return null;
    }
    const qualityPath = buildDocxQualityPath({ artifactId: qualityArtifactId });
    if (!qualityPath) return null;
    if (!silent) setQualityLoading(true);
    try {
      const response = await fetch(resolveBackendUrl(qualityPath), DOCX_FETCH_OPTIONS);
      if (response.status === 404) {
        setQualitySummary(null);
        setQualityError(null);
        return null;
      }
      if (!response.ok) throw createHttpStatusError(response.status);
      const payload = await response.json();
      setQualitySummary(payload);
      setQualityError(null);
      return payload;
    } catch (error) {
      logger.error('Error cargando calidad DOCX:', error);
      setQualityError(String(error));
      if (!silent) onStatusMessage?.(`No se pudo cargar calidad DOCX: ${String(error)}`, 'error');
      return null;
    } finally {
      if (!silent) setQualityLoading(false);
    }
  }, [onStatusMessage, qualityArtifactId]);

  const handleRunWorkbenchOperation = useCallback(async (operation, options = {}) => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para Workbench.', 'warning');
      return null;
    }
    const normalizedOperation = String(operation || 'audit');
    setWorkbenchLoading(normalizedOperation);
    setWorkbenchError(null);
    try {
      const response = await fetch(resolveBackendUrl('/api/docx/workbench/run'), {
        ...DOCX_FETCH_OPTIONS,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_id: qualityArtifactId,
          operation: normalizedOperation,
          ...options,
        }),
      });
      if (!response.ok) throw createHttpStatusError(response.status);
      const payload = await response.json();
      setWorkbenchResult(payload);
      if (payload?.summary && typeof payload.summary === 'object') {
        setQualitySummary(payload.summary);
        refreshRemoteHistoryEntries().catch((error) => logger.error('Error refrescando historial tras Workbench DOCX:', error));
      }
      if (payload?.visual && typeof payload.visual === 'object') {
        refreshRemoteHistoryEntries().catch((error) => logger.error('Error refrescando historial visual DOCX:', error));
      }
      onStatusMessage?.(`Workbench DOCX: ${normalizedOperation}`, 'success');
      return payload;
    } catch (error) {
      logger.error('Error ejecutando Workbench DOCX:', error);
      setWorkbenchError(String(error));
      onStatusMessage?.(`No se pudo ejecutar Workbench DOCX: ${String(error)}`, 'error');
      return null;
    } finally {
      setWorkbenchLoading(null);
    }
  }, [onStatusMessage, qualityArtifactId, refreshRemoteHistoryEntries]);

  const handleRunQuality = useCallback(async () => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para analizar.', 'warning');
      return;
    }
    setQualityRailOpen(true);
    setQualityLoading(true);
    setQualityError(null);
    try {
      const response = await fetch(resolveBackendUrl('/api/docx/quality/run'), {
        ...DOCX_FETCH_OPTIONS,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_id: qualityArtifactId, profile: 'agent' }),
      });
      if (!response.ok) throw createHttpStatusError(response.status);
      const payload = await response.json();
      setQualitySummary(payload);
      setQualityError(null);
      refreshRemoteHistoryEntries().catch((error) => logger.error('Error refrescando historial tras calidad DOCX:', error));
      onStatusMessage?.(`Calidad DOCX: ${getQualityBadgeLabel(payload)}`, getQualityStatus(payload) === 'error' ? 'warning' : 'success');
    } catch (error) {
      logger.error('Error ejecutando calidad DOCX:', error);
      setQualityError(String(error));
      onStatusMessage?.(`No se pudo analizar calidad DOCX: ${String(error)}`, 'error');
    } finally {
      setQualityLoading(false);
    }
  }, [onStatusMessage, qualityArtifactId, refreshRemoteHistoryEntries]);

  const previewWorkbenchImageResource = useCallback(async (resource) => {
    if (!resource?.resource_uri) {
      return false;
    }
    const response = await fetch(resolveBackendUrl(resource.resource_uri), DOCX_FETCH_OPTIONS);
    if (!response.ok) throw createHttpStatusError(response.status);
    const blob = await response.blob();
    const nextUrl = URL.createObjectURL(blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }));
    if (qualityRenderUrlRef.current) {
      URL.revokeObjectURL(qualityRenderUrlRef.current);
    }
    qualityRenderUrlRef.current = nextUrl;
    setQualityRenderUrl(nextUrl);
    return true;
  }, []);

  const handleRefreshRenderManifest = useCallback(async () => {
    setWorkbenchTab('visual');
    await handleRunWorkbenchOperation('render_manifest');
  }, [handleRunWorkbenchOperation]);

  const handleRenderQualityPage = useCallback(async () => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para renderizar.', 'warning');
      return;
    }
    const page = clampPageNumber(currentPage, numPages || null) || 1;
    setQualityRenderLoading(true);
    try {
      const payload = await handleRunWorkbenchOperation('render_page', { page });
      if (!payload) {
        return;
      }
      const imageResource = (payload?.resources || []).find((resource) => String(resource?.mime_type || '').startsWith('image/'))
        || payload?.render?.resource
        || null;
      if (imageResource) {
        await previewWorkbenchImageResource(imageResource);
      }
      onStatusMessage?.(`Pagina ${page} renderizada para QA DOCX`, 'success');
    } catch (error) {
      logger.error('Error renderizando pagina de calidad DOCX:', error);
      onStatusMessage?.(`No se pudo renderizar la pagina DOCX: ${String(error)}`, 'error');
    } finally {
      setQualityRenderLoading(false);
    }
  }, [currentPage, handleRunWorkbenchOperation, numPages, onStatusMessage, previewWorkbenchImageResource, qualityArtifactId]);

  const handleRenderAllPages = useCallback(async () => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para renderizar.', 'warning');
      return;
    }
    setWorkbenchTab('visual');
    const payload = await handleRunWorkbenchOperation('render_all_pages');
    const firstImage = (payload?.resources || []).find((resource) => String(resource?.mime_type || '').startsWith('image/'))
      || (payload?.visual?.page_resources || [])[0]
      || null;
    if (firstImage) {
      try {
        await previewWorkbenchImageResource(firstImage);
      } catch (error) {
        logger.error('Error cargando miniatura render all DOCX:', error);
      }
    }
  }, [handleRunWorkbenchOperation, onStatusMessage, previewWorkbenchImageResource, qualityArtifactId]);

  const handleClearRenderCache = useCallback(async () => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para limpiar visuales.', 'warning');
      return;
    }
    setWorkbenchTab('visual');
    const payload = await handleRunWorkbenchOperation('clear_render_cache');
    setQualityRenderUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      qualityRenderUrlRef.current = null;
      return null;
    });
    if (payload?.status === 'ok') {
      onStatusMessage?.('Derivados visuales DOCX limpiados', 'success');
    }
  }, [handleRunWorkbenchOperation, onStatusMessage, qualityArtifactId]);

  const handleDownloadCleanDocx = useCallback(async () => {
    if (!qualityArtifactId) {
      onStatusMessage?.('No hay un artefacto DOCX persistido para limpiar.', 'warning');
      return;
    }
    setQualityCleanLoading(true);
    try {
      const response = await fetch(resolveBackendUrl('/api/docx/quality/clean'), {
        ...DOCX_FETCH_OPTIONS,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_id: qualityArtifactId,
          scrub_metadata: true,
          strip_comments: true,
          tracked_changes: 'accept',
        }),
      });
      if (!response.ok) throw createHttpStatusError(response.status);
      const blob = await response.blob();
      const baseName = latestDownloadEntry?.docxFileName || docxFileName || 'inspyro_document.docx';
      const cleanName = baseName.replace(/\.docx$/i, '') + '_clean.docx';
      await triggerBlobDownload(
        blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? blob
          : new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        cleanName,
      );
      onStatusMessage?.('Copia limpia DOCX descargada', 'success');
    } catch (error) {
      logger.error('Error descargando copia limpia DOCX:', error);
      onStatusMessage?.(`No se pudo generar copia limpia: ${String(error)}`, 'error');
    } finally {
      setQualityCleanLoading(false);
    }
  }, [docxFileName, latestDownloadEntry?.docxFileName, onStatusMessage, qualityArtifactId, triggerBlobDownload]);

  const handleDownloadWorkbenchResource = useCallback(async (resource) => {
    if (!resource?.resource_uri) {
      onStatusMessage?.('No hay recurso Workbench descargable.', 'warning');
      return;
    }
    try {
      const response = await fetch(resolveBackendUrl(resource.resource_uri), DOCX_FETCH_OPTIONS);
      if (!response.ok) throw createHttpStatusError(response.status);
      const blob = await response.blob();
      await triggerBlobDownload(blob, resource.name || 'docx-workbench-resource');
      onStatusMessage?.('Recurso Workbench descargado', 'success');
    } catch (error) {
      logger.error('Error descargando recurso Workbench DOCX:', error);
      onStatusMessage?.(`No se pudo descargar recurso Workbench: ${String(error)}`, 'error');
    }
  }, [onStatusMessage, triggerBlobDownload]);

  const handlePrepareDelivery = useCallback(async () => {
    setQualityCleanLoading(true);
    try {
      const payload = await handleRunWorkbenchOperation('prepare_delivery', {
        profile: 'delivery',
        scrub_metadata: true,
        strip_comments: true,
        tracked_changes: 'accept',
      });
      const variantResource = payload?.resources?.find((resource) => resource?.name === payload?.variant?.filename)
        || payload?.resources?.find((resource) => String(resource?.name || '').toLowerCase().endsWith('.docx'));
      if (variantResource) {
        await handleDownloadWorkbenchResource(variantResource);
      }
    } finally {
      setQualityCleanLoading(false);
    }
  }, [handleDownloadWorkbenchResource, handleRunWorkbenchOperation]);

  const handleRunDiff = useCallback(async () => {
    if (!diffCompareEntry?.docxArtifactId) {
      onStatusMessage?.('Se necesitan dos versiones DOCX en historial para comparar.', 'warning');
      return;
    }
    setWorkbenchTab('diff');
    await handleRunWorkbenchOperation('diff', { compare_artifact_id: diffCompareEntry.docxArtifactId });
  }, [diffCompareEntry, handleRunWorkbenchOperation, onStatusMessage]);

  const handleQualityRailToggle = useCallback(() => {
    setQualityRailOpen((current) => {
      const next = !current;
      if (next) {
        setProvenanceSelectionId(null);
        setIsOutlineRailOpen(false);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isWaitingForKernel && kernelId && sendMessage) {
      setIsWaitingForKernel(false);
      setShowTemplateModal(true);
    }
  }, [isWaitingForKernel, kernelId, sendMessage]);
  useEffect(() => {
    if (templateInfo) {
      setTemplateModalIntent(null);
    }
  }, [templateInfo]);
  const handleTemplateButtonClick = () => {
    setTemplateModalIntent({ persisted: false });
    if (kernelId && sendMessage) {
      setShowTemplateModal(true);
    } else if (onRequestKernelStart) {
      setIsWaitingForKernel(true);
      onRequestKernelStart();
    }
  };
  useEffect(() => {
    const requestToken = templateOpenRequest?.token;
    if (!requestToken || lastTemplateOpenTokenRef.current === requestToken) {
      return;
    }
    lastTemplateOpenTokenRef.current = requestToken;
    setTemplateModalIntent(buildTemplateModalIntent(templateOpenRequest));
    onTemplateOpenHandled?.(requestToken);
    if (kernelId && sendMessage) {
      setShowTemplateModal(true);
      setIsWaitingForKernel(false);
      return;
    }
    if (onRequestKernelStart) {
      setIsWaitingForKernel(true);
      onRequestKernelStart();
    }
  }, [kernelId, onRequestKernelStart, onTemplateOpenHandled, sendMessage, templateOpenRequest]);
  const isOpeningPersistedTemplate = Boolean(showTemplateModal && !templateInfo && templateModalIntent?.persisted);

  useEffect(() => {
    const requestToken = qualityOpenRequest?.token;
    if (!requestToken || lastQualityOpenTokenRef.current === requestToken) {
      return;
    }
    lastQualityOpenTokenRef.current = requestToken;
    setQualityRailOpen(true);
    setProvenanceSelectionId(null);
    setIsOutlineRailOpen(false);
  }, [qualityOpenRequest]);

  useEffect(() => {
    setQualitySummary(null);
    setQualityError(null);
    setWorkbenchResult(null);
    setWorkbenchError(null);
    setWorkbenchLoading(null);
    setQualityRenderUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      qualityRenderUrlRef.current = null;
      return null;
    });
  }, [qualityArtifactId]);

  useEffect(() => {
    if (!qualityRailOpen || !qualityArtifactId) {
      return undefined;
    }
    loadQualitySummary({ silent: true });
    return undefined;
  }, [loadQualitySummary, qualityArtifactId, qualityRailOpen]);

  useEffect(() => () => {
    if (qualityRenderUrlRef.current) {
      URL.revokeObjectURL(qualityRenderUrlRef.current);
      qualityRenderUrlRef.current = null;
    }
  }, []);

  const buildNavigationTarget = useCallback((item, mode = 'callsite') => {
    if (!item || typeof item !== 'object') return null;
    const notebookSourcePath = resolveNotebookSourcePath(sourcePath);
    if (mode === 'exact') {
      return {
        filePath: item.exact_file_path || item.file_path || notebookSourcePath,
        cellId: item.exact_notebook_cell_id || item.notebook_cell_id || null,
        line: Number.isInteger(item.exact_line) ? item.exact_line : (typeof item.exact_line === 'number' && Number.isFinite(item.exact_line) ? Math.trunc(item.exact_line) : (Number.isInteger(item.line) ? item.line : (typeof item.line === 'number' && Number.isFinite(item.line) ? Math.trunc(item.line) : null))),
      };
    }
    return {
      filePath: item.file_path || notebookSourcePath,
      cellId: item.notebook_cell_id || null,
      line: Number.isInteger(item.line) ? item.line : (typeof item.line === 'number' && Number.isFinite(item.line) ? Math.trunc(item.line) : null),
    };
  }, [sourcePath]);

  const sameNavigationTarget = useCallback((left, right) => (
    (left?.filePath || null) === (right?.filePath || null)
    && (left?.cellId || null) === (right?.cellId || null)
    && (left?.line || null) === (right?.line || null)
  ), []);

  const mergeResolvedProvenanceItem = useCallback((item) => {
    setProvenanceManifest((current) => mergeProvenanceManifestItem(current, item));
  }, []);

  const resolveProvenanceItem = useCallback(async (link) => {
    const inspectedLink = inspectProvenanceOpenUrl(link?.url);
    const provenanceId = typeof link?.provenanceId === 'string' && link.provenanceId.trim()
      ? link.provenanceId.trim()
      : (inspectedLink?.provenanceId || '');
    if (!provenanceId) return null;
    const cachedItem = provenanceItemsByIdRef.current.get(provenanceId);
    if (cachedItem) return cachedItem;

    const resolveUrl = inspectedLink?.isProvenance
      ? rewriteProvenanceOpenUrl(link?.url, { format: 'json' })
      : buildProvenanceResolveUrl(link?.url);
    if (!resolveUrl) {
      throw createProvenanceError('missing_manifest_item', 'Provenance resolver URL is missing', {
        provenanceId,
        rawUrl: link?.url || null,
      });
    }

    const response = await fetch(resolveUrl, DOCX_FETCH_OPTIONS);
    if (!response.ok) {
      throw createProvenanceError(response.status === 404 ? 'resolver_404' : 'resolver_http', `HTTP ${response.status}`, {
        provenanceId,
        rawUrl: link?.url || null,
        resolveUrl,
        staleOrigin: Boolean(inspectedLink?.staleOrigin),
      });
    }
    if (typeof response.json !== 'function') {
      throw createProvenanceError('missing_manifest_item', 'Resolver response is not JSON-capable', {
        provenanceId,
        resolveUrl,
      });
    }

    const payload = await response.json();
    const resolvedItem = payload?.item && typeof payload.item === 'object'
      ? payload.item
      : (payload && typeof payload === 'object' ? payload : null);
    if (!resolvedItem?.provenance_id) {
      throw createProvenanceError('missing_manifest_item', 'Resolver payload does not include a provenance item', {
        provenanceId,
        resolveUrl,
      });
    }

    mergeResolvedProvenanceItem(resolvedItem);
    logger.info('DocxViewer provenance item resolved', {
      provenanceId,
      resolveUrl,
      location: resolvedItem?.file_path || resolvedItem?.notebook_cell_id || null,
      exactLocation: resolvedItem?.exact_file_path || resolvedItem?.exact_notebook_cell_id || null,
    });
    return resolvedItem;
  }, [mergeResolvedProvenanceItem]);

  const handlePdfLinkActivate = useCallback(async (link) => {
    if (!link?.url) return;
    const inspectedLink = inspectProvenanceOpenUrl(link.url);
    const provenanceId = typeof link?.provenanceId === 'string' && link.provenanceId.trim()
      ? link.provenanceId.trim()
      : (inspectedLink?.provenanceId || null);
    logger.info('DocxViewer provenance link activated', {
      provenanceId,
      rawUrl: link.url,
      sourceMode: sourceModeRef.current,
      staleOrigin: Boolean(inspectedLink?.staleOrigin),
    });

    if (!sourceModeRef.current || !provenanceId) {
      if (typeof window !== 'undefined') {
        const targetUrl = rewriteProvenanceOpenUrl(link.url);
        window.open(targetUrl || link.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    let item = provenanceItemsByIdRef.current.get(provenanceId);
    if (!item) {
      try {
        item = await resolveProvenanceItem({ ...link, provenanceId, url: inspectedLink?.rewrittenUrl || link.url });
      } catch (error) {
        const code = error?.code || (inspectedLink?.staleOrigin ? 'stale_origin' : 'resolver_404');
        reportProvenanceFailure(code, {
          provenanceId,
          rawUrl: link.url,
          rewrittenUrl: inspectedLink?.rewrittenUrl || null,
          staleOrigin: Boolean(inspectedLink?.staleOrigin),
        }, error);
        onStatusMessageRef.current?.('No se pudo resolver la procedencia del fragmento seleccionado.', 'warning');
        return;
      }
    }
    if (!item) {
      reportProvenanceFailure('missing_manifest_item', {
        provenanceId,
        rawUrl: link.url,
        rewrittenUrl: inspectedLink?.rewrittenUrl || null,
      });
      onStatusMessageRef.current?.('No se pudo resolver la procedencia del fragmento seleccionado.', 'warning');
      return;
    }
    setProvenanceSelectionId(item.provenance_id || provenanceId);

    const exactTarget = buildNavigationTarget(item, 'exact');
    const callsiteTarget = buildNavigationTarget(item, 'callsite');
    const primaryTarget = isNavigationTargetUsable(exactTarget)
      ? exactTarget
      : (isNavigationTargetUsable(callsiteTarget) ? callsiteTarget : null);
    const fallbackTarget = primaryTarget && isNavigationTargetUsable(callsiteTarget) && !sameNavigationTarget(primaryTarget, callsiteTarget)
      ? callsiteTarget
      : null;
    logger.info('DocxViewer provenance navigation target built', {
      provenanceId,
      primaryTarget,
      fallbackTarget,
    });

    if (!primaryTarget) {
      reportProvenanceFailure('missing_navigation_target', {
        provenanceId,
        rawUrl: link.url,
        item,
      });
      onStatusMessageRef.current?.('La procedencia del fragmento seleccionado no tiene un destino navegable.', 'warning');
      return;
    }

    try {
      let navigated = false;
      if (typeof onNavigateToCodeRef.current === 'function') {
        navigated = Boolean(await onNavigateToCodeRef.current(primaryTarget));
        if (!navigated && fallbackTarget) {
          navigated = Boolean(await onNavigateToCodeRef.current(fallbackTarget));
        }
      }
      logger.info('DocxViewer provenance navigation result', {
        provenanceId,
        navigated,
        fallbackAttempted: Boolean(fallbackTarget),
      });
      if (!navigated && typeof onNavigateToCodeRef.current === 'function') {
        onStatusMessageRef.current?.('No se pudo navegar al codigo del fragmento seleccionado.', 'warning');
      }
    } catch (error) {
      logger.error('Error navegando a la procedencia DOCX:', error);
      onStatusMessageRef.current?.('No se pudo navegar al codigo del fragmento seleccionado.', 'warning');
    }
  }, [buildNavigationTarget, resolveProvenanceItem, sameNavigationTarget]);

  const selectedCallsiteTarget = useMemo(
    () => buildNavigationTarget(selectedProvenanceItem, 'callsite'),
    [buildNavigationTarget, selectedProvenanceItem],
  );
  const selectedExactTarget = useMemo(
    () => buildNavigationTarget(selectedProvenanceItem, 'exact'),
    [buildNavigationTarget, selectedProvenanceItem],
  );
  const selectedHasDistinctExact = useMemo(
    () => !sameNavigationTarget(selectedCallsiteTarget, selectedExactTarget),
    [sameNavigationTarget, selectedCallsiteTarget, selectedExactTarget],
  );
  const selectedUserStack = useMemo(
    () => (Array.isArray(selectedProvenanceItem?.user_stack) ? selectedProvenanceItem.user_stack.filter((item) => item && typeof item === 'object') : []),
    [selectedProvenanceItem],
  );
  const hasOutline = outline.length > 0;
  const shouldShowOutlineRail = viewMode === 'pdf' && hasOutline && isOutlineRailOpen;
  const shouldShowProvenanceRail = viewMode === 'pdf' && Boolean(selectedProvenanceItem);
  const shouldShowQualityRail = Boolean(qualityRailOpen);
  const projectedPdfWidthWithDockedOutline = viewerBodyWidth
    - OUTLINE_RAIL_DOCKED_WIDTH
    - (shouldShowProvenanceRail ? PROVENANCE_RAIL_DOCKED_WIDTH : 0)
    - (shouldShowQualityRail ? QUALITY_RAIL_DOCKED_WIDTH : 0);
  const isOutlineOverlay = isOutlineOverlayForced || projectedPdfWidthWithDockedOutline < PDF_VIEWPORT_MIN_DOCKED_WIDTH;
  const projectedPdfWidthWithDockedProvenance = viewerBodyWidth
    - (shouldShowOutlineRail && !isOutlineOverlay ? OUTLINE_RAIL_DOCKED_WIDTH : 0)
    - (shouldShowQualityRail ? QUALITY_RAIL_DOCKED_WIDTH : 0)
    - PROVENANCE_RAIL_DOCKED_WIDTH;
  const isProvenanceOverlay = projectedPdfWidthWithDockedProvenance < PDF_VIEWPORT_MIN_DOCKED_WIDTH;
  const projectedPdfWidthWithDockedQuality = viewerBodyWidth
    - (shouldShowOutlineRail && !isOutlineOverlay ? OUTLINE_RAIL_DOCKED_WIDTH : 0)
    - (shouldShowProvenanceRail && !isProvenanceOverlay ? PROVENANCE_RAIL_DOCKED_WIDTH : 0)
    - QUALITY_RAIL_DOCKED_WIDTH;
  const isQualityOverlay = projectedPdfWidthWithDockedQuality < PDF_VIEWPORT_MIN_DOCKED_WIDTH;
  const activeOutlineId = useMemo(
    () => resolveActiveOutlineId(outline, currentPdfLocation),
    [currentPdfLocation, outline],
  );
  const hasPdfDocument = viewMode === 'pdf' && Boolean(pdfBlobUrl);
  const shouldMountPdfViewer = Boolean(isVisible && viewMode === 'pdf' && pdfBlobUrl);
  const canUsePageControls = Boolean(pdfBlobUrl && numPages > 0);
  const canViewHtml = Boolean(docxBase64 && mammothStatus !== 'unavailable');
  const zoomDisplayLabel = fitMode === 'width' ? 'Ajuste ancho' : `${zoomPercent}%`;

  useEffect(() => {
    if (shouldShowOutlineRail && isOutlineOverlay && provenanceSelectionId) {
      setProvenanceSelectionId(null);
    }
  }, [isOutlineOverlay, provenanceSelectionId, shouldShowOutlineRail]);

  useEffect(() => {
    if (shouldShowProvenanceRail && isProvenanceOverlay && isOutlineRailOpen) {
      setIsOutlineRailOpen(false);
    }
  }, [isOutlineRailOpen, isProvenanceOverlay, shouldShowProvenanceRail]);

  useEffect(() => {
    if (shouldShowQualityRail && isQualityOverlay) {
      setProvenanceSelectionId(null);
      setIsOutlineRailOpen(false);
    }
  }, [isQualityOverlay, shouldShowQualityRail]);

  const handlePdfDocumentMetaChange = useCallback((meta) => {
    const totalPages = clampPageNumber(meta?.numPages, null) || 0;
    const nextOutline = normalizeOutlineItems(meta?.outline, totalPages || null);
    const nextHasOutline = typeof meta?.hasOutline === 'boolean' ? meta.hasOutline : nextOutline.length > 0;
    const signature = `${totalPages}|${nextHasOutline ? nextOutline.map((item) => `${item.depth}:${item.pageNumber}:${item.destinationKey || 'page'}:${item.anchorTopRatio != null ? item.anchorTopRatio.toFixed(4) : 'na'}:${item.title}`).join('||') : 'no-outline'}`;

    if (signature === lastPdfMetaSignatureRef.current) {
      return;
    }

    lastPdfMetaSignatureRef.current = signature;

    setNumPages(totalPages);
    setOutline(nextHasOutline ? nextOutline : []);
    setIsOutlineRailOpen((current) => (nextHasOutline ? current : false));
    setCurrentPage((current) => clampPageNumber(current, totalPages || null) || 1);
    setCurrentPdfLocation((current) => buildPdfLocation(current?.pageNumber || 1, {
      destinationKey: current?.destinationKey || null,
      anchorTopPx: current?.anchorTopPx ?? null,
      anchorTopRatio: current?.anchorTopRatio ?? 0,
    }));
    setRequestedPage((pending) => clampPageNumber(pending, totalPages || null));
    setRequestedPdfLocation((pending) => (
      pending
        ? buildPdfLocation(pending.pageNumber, {
          destinationKey: pending.destinationKey,
          anchorTopPx: pending.anchorTopPx,
          anchorTopRatio: pending.anchorTopRatio,
          requestKey: pending.requestKey,
        })
        : null
    ));
  }, []);

  const handlePdfCurrentPageChange = useCallback((locationOrPageNumber) => {
    const nextLocation = typeof locationOrPageNumber === 'object' && locationOrPageNumber !== null
      ? buildPdfLocation(locationOrPageNumber.pageNumber, {
        destinationKey: locationOrPageNumber.destinationKey || null,
        anchorTopPx: locationOrPageNumber.anchorTopPx ?? null,
        anchorTopRatio: locationOrPageNumber.anchorTopRatio ?? 0,
      })
      : buildPdfLocation(locationOrPageNumber, {});
    const nextPage = clampPageNumber(nextLocation?.pageNumber, numPagesRef.current || null);
    if (!nextPage) return;
    currentPageRef.current = nextPage;
    currentPdfLocationRef.current = nextLocation || buildPdfLocation(nextPage, {});
    setCurrentPage(nextPage);
    setCurrentPdfLocation(nextLocation || buildPdfLocation(nextPage, {}));
    setRequestedPage((pending) => (pending === nextPage ? null : pending));
  }, []);

  const requestPageNavigation = useCallback((value) => {
    if (!canUsePageControls) return;
    const nextPage = clampPageNumber(value, numPages);
    if (!nextPage) {
      onStatusMessage?.('Numero de pagina invalido.', 'warning');
      setPageInputValue(numPages > 0 ? String(currentPage) : '');
      return;
    }
    setCurrentPage(nextPage);
    setRequestedPage((pending) => {
      if (pending === nextPage) {
        return null;
      }
      return nextPage;
    });
    setRequestedPdfLocation(buildPdfLocation(nextPage, {
      destinationKey: `page:${nextPage}`,
      anchorTopRatio: 0,
      requestKey: nextPdfNavigationRequestKey('page'),
    }));
    setPageInputValue(String(nextPage));
    setProvenanceSelectionId(null);
  }, [canUsePageControls, currentPage, nextPdfNavigationRequestKey, numPages, onStatusMessage]);

  const handleOutlineRailToggle = useCallback(() => {
    if (!hasOutline) {
      return;
    }
    if (!isOutlineRailOpen && isOutlineOverlay) {
      setProvenanceSelectionId(null);
    }
    setIsOutlineRailOpen((current) => !current);
  }, [hasOutline, isOutlineOverlay, isOutlineRailOpen]);

  const handleOutlineRailClose = useCallback(() => {
    setIsOutlineRailOpen(false);
  }, []);

  const handleOutlineItemSelect = useCallback((item) => {
    const nextPage = clampPageNumber(item?.pageNumber, numPages || null);
    if (!nextPage) {
      return;
    }
    setCurrentPage(nextPage);
    setRequestedPage(nextPage);
    setRequestedPdfLocation(buildPdfLocation(nextPage, {
      destinationKey: item?.destinationKey || null,
      anchorTopPx: item?.anchorTopPx ?? null,
      anchorTopRatio: item?.anchorTopRatio ?? 0,
      requestKey: nextPdfNavigationRequestKey('outline'),
    }));
    setPageInputValue(String(nextPage));
    setProvenanceSelectionId(null);
  }, [nextPdfNavigationRequestKey, numPages]);

  useEffect(() => {
    if (!requestedPage || !canUsePageControls) return undefined;
    if (requestedPage !== currentPage) return undefined;

    const timer = setTimeout(() => {
      setRequestedPage((pending) => (pending === currentPage ? null : pending));
    }, 0);

    return () => clearTimeout(timer);
  }, [canUsePageControls, currentPage, requestedPage]);

  useEffect(() => {
    if (!requestedPdfLocation || !canUsePageControls) return undefined;
    if (requestedPdfLocation.pageNumber !== currentPage) return undefined;
    const requestedAnchorRatio = clampRatio(requestedPdfLocation.anchorTopRatio);
    const currentAnchorRatio = clampRatio(currentPdfLocation?.anchorTopRatio);
    const requestedDestinationKey = requestedPdfLocation.destinationKey || null;
    const currentDestinationKey = currentPdfLocation?.destinationKey || null;
    const anchorMatches = requestedAnchorRatio == null
      || currentAnchorRatio == null
      || Math.abs(requestedAnchorRatio - currentAnchorRatio) <= 0.035;
    const destinationMatches = !requestedDestinationKey
      || !currentDestinationKey
      || requestedDestinationKey === currentDestinationKey;
    if (!anchorMatches || !destinationMatches) return undefined;

    const requestKey = requestedPdfLocation.requestKey;
    const timer = setTimeout(() => {
      setRequestedPdfLocation((pending) => (pending?.requestKey === requestKey ? null : pending));
    }, 0);

    return () => clearTimeout(timer);
  }, [canUsePageControls, currentPage, currentPdfLocation, requestedPdfLocation]);

  const handlePageSubmit = useCallback((event) => {
    event.preventDefault();
    if (!pageInputValue) {
      setPageInputValue(numPages > 0 ? String(currentPage) : '');
      return;
    }
    requestPageNavigation(pageInputValue);
  }, [currentPage, numPages, pageInputValue, requestPageNavigation]);

  const handlePageInputBlur = useCallback(() => {
    pageInputFocusedRef.current = false;
    if (!pageInputValue) {
      setPageInputValue(numPages > 0 ? String(currentPage) : '');
      return;
    }
    requestPageNavigation(pageInputValue);
  }, [currentPage, numPages, pageInputValue, requestPageNavigation]);

  const handleZoomStep = useCallback((delta) => {
    setFitMode('custom');
    setZoomPercent((current) => clampZoomPercent(current + delta));
  }, []);

  const handleZoomReset = useCallback(() => {
    setFitMode('custom');
    setZoomPercent(DEFAULT_ZOOM_PERCENT);
  }, []);

  const handleFitWidth = useCallback(() => {
    setFitMode('width');
  }, []);

  const historyMenuOptions = useMemo(() => {
    if (historyLoading) {
      return [{ id: 'history-loading', label: 'Cargando historial...', icon: <IconHistory />, disabled: true }];
    }
    if (historyEntries.length === 0) {
      return [{ id: 'history-empty', label: historyError ? 'No se pudo cargar el historial remoto.' : 'Sin historial DOCX.', icon: <IconHistory />, disabled: true }];
    }
    return historyEntries.slice(0, MAX_HISTORY_MENU_ITEMS).map((entry) => ({
      id: entry.id,
      icon: <IconHistory />,
      onClick: () => handleDownloadHistoryEntry(entry),
      label: (
        <span className="docx-history-label">
          <span className={`docx-history-title ${isDocxHistoryEntryEmpty(entry) ? 'is-empty' : ''}`}>
            {entry.docxFileName || 'inspyro_document.docx'}
            {isDocxHistoryEntryEmpty(entry) ? ' (vacio)' : ''}
          </span>
          <span className="docx-history-meta">
            {`${new Date(entry.createdAt).toLocaleString()} · ${entry.docxSizeBytes ?? '?'} bytes`}
          </span>
          {(() => {
            const quality = describeQualitySummary(entry);
            const visual = describeRenderSummary(entry);
            return (
              <>
                <span className={`docx-history-quality docx-history-quality--${quality.tone}`}>
                  {quality.status === 'missing' ? 'Sin analizar' : `Calidad ${quality.label}`}
                </span>
                <span className={`docx-history-quality docx-history-quality--${visual.tone}`}>
                  {visual.label}
                </span>
              </>
            );
          })()}
          {entry.docxWarning ? <span className="docx-history-warning">{entry.docxWarning}</span> : null}
        </span>
      ),
    }));
  }, [handleDownloadHistoryEntry, historyEntries, historyError, historyLoading]);

  const moreMenuOptions = useMemo(() => ([
    {
      id: 'view-pdf',
      icon: <IconPdf />,
      label: 'Ver PDF',
      onClick: () => setViewMode('pdf'),
      disabled: !pdfBlobUrl,
    },
    {
      id: 'view-html',
      icon: <IconText />,
      label: 'Ver HTML',
      onClick: () => setViewMode('html'),
      disabled: !docxBase64 || mammothStatus === 'unavailable',
    },
    { id: 'more-separator', type: 'separator' },
    {
      id: 'clear-doc',
      icon: <IconTrash />,
      label: 'Limpiar documento',
      onClick: onClearDocx,
    },
  ]), [docxBase64, mammothStatus, onClearDocx, pdfBlobUrl]);

  const toolbarStatusItems = useMemo(() => {
    const items = [];
    if (flash) {
      items.push({ id: 'updated', tone: 'info', icon: <IconRefresh />, text: 'Actualizado' });
    }
    if (!pdfBlobUrl && pdfBase64) {
      items.push({ id: 'preparing', tone: 'info', icon: <IconPdf />, text: 'Preparando PDF...' });
    }
    if (effectiveConversionStatus?.message) {
      items.push({ id: 'conversion', tone: 'warning', icon: <IconPdf />, text: effectiveConversionStatus.message });
    }
    if (pdfWaitingTooLong && !effectivePdfError && !conversionStatus) {
      items.push({ id: 'waiting', tone: 'warning', icon: <IconPdf />, text: 'PDF tardando... LibreOffice?' });
    }
    if (effectivePdfNotice) {
      items.push({ id: 'notice', tone: 'info', icon: <IconPdf />, text: effectivePdfNotice });
    }
    if (effectivePdfError) {
      items.push({ id: 'error', tone: 'error', icon: <IconPdf />, text: 'Error PDF' });
    }
    if (hasDocxDownloadOnly && (normalizedDocxDownloadUrl || normalizedLatestDownloadUrl)) {
      items.push({
        id: 'stable-docx',
        tone: 'info',
        icon: <IconDocx />,
        text: (desktopApi?.isDesktop && latestWorkspacePath)
          ? 'DOCX listo para abrirse desde la carpeta del proyecto'
          : (hasDocxDownloadOnly ? 'DOCX asociado descargable' : 'DOCX disponible'),
      });
    }
    if (qualityArtifactId) {
      items.push({
        id: 'quality',
        tone: qualityDescriptor.tone === 'success' ? 'success' : qualityDescriptor.tone,
        icon: <IconQuality />,
        text: qualityDescriptor.status === 'missing' ? 'Calidad sin analizar' : `Calidad ${qualityDescriptor.label}`,
      });
    }
    if (viewMode === 'pdf' && sourceModeDisabledReason) {
      items.push({ id: 'source-disabled', tone: 'info', icon: <IconSource />, text: sourceModeDisabledReason });
    } else if (viewMode === 'pdf' && sourceMode) {
      items.push({ id: 'source-on', tone: 'info', icon: <IconSource />, text: 'Haz clic sobre contenido trazable para abrir su origen.' });
    }
    return items;
  }, [conversionStatus, desktopApi?.isDesktop, effectiveConversionStatus, effectivePdfError, effectivePdfNotice, flash, hasDocxDownloadOnly, latestWorkspacePath, normalizedDocxDownloadUrl, normalizedLatestDownloadUrl, pdfBase64, pdfBlobUrl, pdfWaitingTooLong, qualityArtifactId, qualityDescriptor.label, qualityDescriptor.status, qualityDescriptor.tone, sourceMode, sourceModeDisabledReason, viewMode]);
  const shouldShowHistoryMenu = historyLoading || historyEntries.length > 0 || Boolean(historyError);

  const emptyView = !hasActiveDocumentPreview;
  if (emptyView && !qualityRailOpen) {
    return (
      <div className="docx-viewer">
        <div className="docx-toolbar-empty">
          <button
            type="button"
            onClick={handleDownload}
            className="toolbar-button docx-action-button"
            disabled={!hasDocx || isDownloadingDocx}
          >
            <IconDocx />
            <span>{isDownloadingDocx ? 'Descargando...' : 'DOCX'}</span>
          </button>
          {shouldShowHistoryMenu ? (
            <DropdownMenu
              options={historyMenuOptions}
              icon={<IconHistory />}
              title={historyEntries.length > 0 ? `Historial DOCX (${historyEntries.length})` : 'Historial DOCX'}
              ariaLabel="Historial DOCX"
              dataTestId="docx-history-menu"
              className="docx-toolbar-menu"
              triggerClassName="app-toolbar-icon-btn docx-icon-button"
              panelClassName="docx-history-panel"
            />
          ) : null}
          <button
            type="button"
            onClick={handleQualityRailToggle}
            className={`app-toolbar-icon-btn docx-icon-button docx-quality-toggle docx-quality-toggle--${qualityDescriptor.tone} ${qualityRailOpen ? 'is-active' : ''}`}
            disabled={!qualityArtifactId}
            title={qualityArtifactId ? `Calidad DOCX: ${qualityDescriptor.label}` : 'Calidad DOCX requiere un artefacto persistido'}
            aria-label="Calidad DOCX"
            aria-pressed={qualityRailOpen}
            data-testid="docx-quality-toggle-empty"
          >
            <IconQuality />
            <span className="docx-quality-toggle-badge">{qualityDescriptor.status === 'missing' ? 'QA' : qualityDescriptor.label}</span>
          </button>
          <button
            type="button"
            onClick={handleTemplateButtonClick}
            className="toolbar-button docx-action-button"
            title={isWaitingForKernel ? 'Iniciando kernel...' : (templateInfo ? 'Ver o editar plantilla' : 'Cargar plantilla')}
            disabled={isWaitingForKernel || (!hasKernel && !canRequestKernel)}
            data-testid="docx-template-button-empty"
          >
            <IconTemplate />
            <span>{isWaitingForKernel ? 'Iniciando...' : 'Plantilla'}</span>
          </button>
          {!hasKernel && !isWaitingForKernel ? (
            <span className="docx-empty-hint">{canRequestKernel ? '(Se iniciara el kernel)' : ''}</span>
          ) : null}
        </div>
        {(toolbarStatusItems.length > 0 || showRetryPdf) ? (
          <div className="docx-toolbar-status docx-toolbar-status--empty">
            {toolbarStatusItems.map((item) => (
              <span key={item.id} className={`docx-status-chip docx-status-chip--${item.tone}`}>
                {item.icon}
                <span>{item.text}</span>
              </span>
            ))}
            {showRetryPdf ? (
              <button type="button" onClick={onRetryPdf} className="toolbar-button docx-status-action">
                Reintentar PDF
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="docx-empty-state" data-testid="docx-empty-state">
          {hasDocx
            ? (
              <>
                <strong>Sin vista previa activa</strong>
                <span>
                  {desktopApi?.isDesktop && latestWorkspacePath
                    ? 'El DOCX esta en la carpeta del proyecto, pero no hay PDF o HTML visible.'
                    : historyEntries.length > 0
                    ? 'Hay versiones DOCX descargables en el historial, pero no hay PDF o HTML visible para este recurso.'
                    : hasDocxSourceLookupOnly
                    ? 'Puedes descargar la ultima version DOCX estable para este recurso, pero no hay PDF o HTML visible.'
                    : 'Hay un DOCX descargable, pero todavia no hay una vista previa visible para este recurso.'}
                </span>
              </>
            )
            : (
              <>
                <strong>Sin documento</strong>
                <span>No hay documento generado aun. Usa mdoc("expr") o txtdoc("texto").</span>
              </>
            )}
        </div>
        {showTemplateModal && <TemplateEditor templateInfo={templateInfo} templateBinding={templateBinding} kernelId={kernelId} sendMessage={templateSendMessage || sendMessage} lastMessage={templateLastMessage || lastMessage} onClose={() => setShowTemplateModal(false)} onTemplateChange={onTemplateChange} onStatusMessage={onStatusMessage} onTemplateUpload={onTemplateUpload} onTemplateBind={onTemplateBind} isOpeningPersistedTemplate={isOpeningPersistedTemplate} templateDocxBase64={templateDocxBase64} enableTemplateSourceFetch />}
      </div>
    );
  }

  return (
    <div className="docx-viewer">
      <div className="docx-toolbar">
        <div className="docx-toolbar-main">
          <div className="docx-toolbar-group">
            <button
              type="button"
              onClick={handleDownload}
              className="toolbar-button docx-action-button"
              disabled={!hasDocx || isDownloadingDocx}
            >
              <IconDocx />
              <span>{isDownloadingDocx ? 'Descargando...' : 'DOCX'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="toolbar-button docx-action-button"
              disabled={!pdfBlobUrl}
            >
              <IconPdf />
              <span>PDF</span>
            </button>
            {(hasKernel || canRequestKernel) ? (
              <button
                type="button"
                onClick={handleTemplateButtonClick}
                className="toolbar-button docx-action-button"
                title={isWaitingForKernel ? 'Iniciando kernel...' : (templateInfo ? 'Ver o editar plantilla' : 'Cargar plantilla')}
                disabled={isWaitingForKernel || (!hasKernel && !canRequestKernel)}
                data-testid="docx-template-button"
              >
                <IconTemplate />
                <span>{isWaitingForKernel ? 'Iniciando...' : 'Plantilla'}</span>
              </button>
            ) : null}
          </div>

          {viewMode === 'pdf' ? (
            <div className="docx-toolbar-group" data-testid="docx-pdf-toolbar">
              <span className="docx-page-indicator" data-testid="docx-page-indicator">
                {numPages > 0 ? `${currentPage} / ${numPages}` : '- / -'}
              </span>
              <form onSubmit={handlePageSubmit} className="docx-page-form">
                <label htmlFor="docx-page-input" className="sr-only">Ir a pagina</label>
                <input
                  id="docx-page-input"
                  data-testid="docx-page-input"
                  className="docx-page-input"
                  type="number"
                  min={1}
                  max={numPages || undefined}
                  value={pageInputValue}
                  onFocus={() => { pageInputFocusedRef.current = true; }}
                  onBlur={handlePageInputBlur}
                  onChange={(event) => setPageInputValue(event.target.value)}
                  disabled={!canUsePageControls}
                  aria-label="Ir a pagina"
                />
              </form>
              <button
                type="button"
                className="app-toolbar-icon-btn docx-icon-button"
                onClick={() => handleZoomStep(-PDF_ZOOM_STEP)}
                disabled={!hasPdfDocument}
                title="Reducir zoom"
                aria-label="Reducir zoom"
              >
                <IconZoomOut />
              </button>
              <button
                type="button"
                className="app-toolbar-icon-btn docx-icon-button"
                onClick={() => handleZoomStep(PDF_ZOOM_STEP)}
                disabled={!hasPdfDocument}
                title="Aumentar zoom"
                aria-label="Aumentar zoom"
              >
                <IconZoomIn />
              </button>
              <button
                type="button"
                className={`app-toolbar-icon-btn docx-icon-button ${fitMode === 'custom' && zoomPercent === DEFAULT_ZOOM_PERCENT ? 'is-active' : ''}`}
                onClick={handleZoomReset}
                disabled={!hasPdfDocument}
                title="Restablecer zoom a 100%"
                aria-label="Restablecer zoom a 100%"
              >
                <span>100</span>
              </button>
              <button
                type="button"
                className={`app-toolbar-icon-btn docx-icon-button ${fitMode === 'width' ? 'is-active' : ''}`}
                onClick={handleFitWidth}
                disabled={!hasPdfDocument}
                title="Ajustar al ancho"
                aria-label="Ajustar al ancho"
              >
                <IconFitWidth />
              </button>
              <span className="docx-zoom-label" data-testid="docx-zoom-label">{zoomDisplayLabel}</span>
              <button
                type="button"
                onClick={handleOutlineRailToggle}
                className={`app-toolbar-icon-btn docx-icon-button ${isOutlineRailOpen ? 'is-active' : ''}`}
                disabled={!hasOutline}
                title={hasOutline ? 'Mostrar indice del PDF' : 'Indice sin navegacion disponible'}
                aria-label={hasOutline ? 'Mostrar indice del PDF' : 'Indice sin navegacion disponible'}
                aria-pressed={isOutlineRailOpen}
                data-testid="docx-outline-toggle"
              >
                <IconOutline />
              </button>
              <button
                type="button"
                onClick={() => setSourceMode((current) => !current)}
                className={`app-toolbar-icon-btn docx-icon-button ${sourceMode ? 'is-active' : ''}`}
                disabled={viewMode !== 'pdf' || !canEnableSourceMode}
                title={viewMode !== 'pdf' ? 'Modo origen solo esta disponible en vista PDF.' : (sourceModeDisabledReason || 'Abrir procedencia desde el PDF')}
                aria-label="Alternar modo origen"
                aria-pressed={sourceMode}
                data-testid="docx-source-mode-toggle"
              >
                <IconSource />
              </button>
            </div>
          ) : (
            <div className="docx-toolbar-group">
              <span className="docx-toolbar-note">Vista HTML</span>
            </div>
          )}

          <div className="docx-toolbar-spacer" />

          <div className="docx-toolbar-group">
            <button
              type="button"
              onClick={handleQualityRailToggle}
              className={`app-toolbar-icon-btn docx-icon-button docx-quality-toggle docx-quality-toggle--${qualityDescriptor.tone} ${qualityRailOpen ? 'is-active' : ''}`}
              disabled={!qualityArtifactId}
              title={qualityArtifactId ? `Calidad DOCX: ${qualityDescriptor.label}` : 'Calidad DOCX requiere un artefacto persistido'}
              aria-label="Calidad DOCX"
              aria-pressed={qualityRailOpen}
              data-testid="docx-quality-toggle"
            >
              <IconQuality />
              <span className="docx-quality-toggle-badge">{qualityDescriptor.status === 'missing' ? 'QA' : qualityDescriptor.label}</span>
            </button>
            {shouldShowHistoryMenu ? (
              <DropdownMenu
                options={historyMenuOptions}
                icon={<IconHistory />}
                title={historyEntries.length > 0 ? `Historial DOCX (${historyEntries.length})` : 'Historial DOCX'}
                ariaLabel="Historial DOCX"
                dataTestId="docx-history-menu"
                className="docx-toolbar-menu"
                triggerClassName="app-toolbar-icon-btn docx-icon-button"
                panelClassName="docx-history-panel"
              />
            ) : null}
            <DropdownMenu
              options={moreMenuOptions}
              icon={<IconKebab />}
              title="Mas opciones"
              ariaLabel="Mas opciones del documento"
              dataTestId="docx-more-menu"
              className="docx-toolbar-menu"
              triggerClassName="app-toolbar-icon-btn docx-icon-button"
            />
          </div>
        </div>

        <div className="docx-toolbar-status">
          {toolbarStatusItems.map((item) => (
            <span key={item.id} className={`docx-status-chip docx-status-chip--${item.tone}`}>
              {item.icon}
              <span>{item.text}</span>
            </span>
          ))}
          {showRetryPdf ? (
            <button type="button" onClick={onRetryPdf} className="toolbar-button docx-status-action">
              Reintentar PDF
            </button>
          ) : null}
        </div>
      </div>

      {pdfServiceStatus ? (
        <div className={`docx-status-band ${pdfServiceStatus.available ? '' : 'warning'}`.trim()}>
          {pdfServiceStatus.available
            ? `PDF disponible en este equipo mediante ${pdfServiceStatus.sourceLabel}.`
            : 'La conversion PDF no esta disponible en este equipo.'}
        </div>
      ) : null}
      {(converterUsed || wordError) ? (
        <div className={`docx-converter-band ${converterUsed === 'libreoffice' && wordError ? 'warning' : 'success'}`}>
          {converterUsed ? (
            <span style={{ color: converterUsed === 'word' ? '#5c8' : (converterUsed === 'libreoffice' ? '#fa0' : '#8cf') }}>
              {converterUsed === 'word' ? 'Microsoft Word' : (converterUsed === 'libreoffice' ? 'LibreOffice' : 'PDF en cache')}
              {pdfConversionMs && converterUsed !== 'cached' ? <span style={{ color: '#888', marginLeft: 6 }}>({pdfConversionMs}ms)</span> : null}
            </span>
          ) : null}
          {wordError ? (
            <span style={{ color: '#f88' }} title={wordError}>
              Word fallo: {wordError.length > 40 ? `${wordError.substring(0, 40)}...` : wordError}
            </span>
          ) : null}
        </div>
      ) : null}
      {(docxError || docxStoreError || (docxWarnings && docxWarnings.length)) ? (
        <div style={{ padding: '4px 10px', borderBottom: '1px solid #333', background: '#2a1a1a', display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
          {docxError ? <span style={{ color: '#f88' }}>DOCX error: {String(docxError)}</span> : null}
          {docxStoreError ? <span style={{ color: '#f88' }}>DOCX store: {String(docxStoreError)}</span> : null}
          {docxSizeBytes != null ? <span style={{ color: '#aaa' }}>DOCX size: {docxSizeBytes} bytes</span> : null}
          {docxWarnings && docxWarnings.length > 0 ? (
            <details style={{ color: '#f2b880' }}>
              <summary style={{ cursor: 'pointer' }}>Warnings ({docxWarnings.length})</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{docxWarnings.map((warning, index) => <li key={`docx-warning-${index}`}>{warning}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="docx-viewer-body" ref={viewerBodyRef}>
        {shouldShowOutlineRail && isOutlineOverlay ? (
          <button
            type="button"
            className="docx-outline-backdrop"
            aria-label="Cerrar indice"
            onClick={handleOutlineRailClose}
            data-testid="docx-outline-backdrop"
          />
        ) : null}
        {shouldShowProvenanceRail && isProvenanceOverlay ? (
          <button
            type="button"
            className="docx-provenance-backdrop"
            aria-label="Cerrar procedencia"
            onClick={() => setProvenanceSelectionId(null)}
            data-testid="docx-provenance-backdrop"
          />
        ) : null}
        {shouldShowQualityRail && isQualityOverlay ? (
          <button
            type="button"
            className="docx-quality-backdrop"
            aria-label="Cerrar calidad DOCX"
            onClick={() => setQualityRailOpen(false)}
            data-testid="docx-quality-backdrop"
          />
        ) : null}
        {shouldShowOutlineRail ? (
          <aside
            className={`docx-outline-rail ${isOutlineOverlay ? 'is-overlay' : 'is-docked'}`}
            data-testid="docx-outline-rail"
          >
            <div className="docx-outline-rail-header">
              <div>
                <div className="docx-rail-eyebrow">Indice</div>
                <div className="docx-rail-title">Secciones PDF</div>
              </div>
              <button
                type="button"
                className="toolbar-button docx-rail-close-button"
                onClick={handleOutlineRailClose}
              >
                Cerrar
              </button>
            </div>
            <div className="docx-outline-rail-content">
              {outline.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`docx-outline-item ${item.id === activeOutlineId ? 'is-active' : ''}`}
                  style={{ '--docx-outline-depth': Math.max(0, item.depth || 0) }}
                  onClick={() => handleOutlineItemSelect(item)}
                  aria-current={item.id === activeOutlineId ? 'location' : undefined}
                  data-active={item.id === activeOutlineId ? 'true' : 'false'}
                  data-testid={`docx-outline-item-${index}`}
                >
                  <span className="docx-outline-item-title">{item.title}</span>
                  <span className="docx-outline-item-page">p. {item.pageNumber}</span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
        <div className={`docx-viewer-canvas ${viewMode === 'html' ? 'is-html' : ''}`.trim()}>
          {showConversionSpinner && viewMode === 'pdf' ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(30,30,30,0.9)', zIndex: 10 }}>
              <LoadingSpinner message={effectiveConversionStatus?.message || 'Generando PDF...'} size="medium" />
            </div>
          ) : null}
          {viewMode === 'pdf'
            ? (
              pdfBlobUrl
                ? (
                  shouldMountPdfViewer
                    ? (
                      <PdfViewer
                        pdfUrl={pdfBlobUrl}
                        sourceMode={sourceMode}
                        onLinkActivate={handlePdfLinkActivate}
                        onProvenanceSummaryChange={setProvenanceSummary}
                        onDocumentMetaChange={handlePdfDocumentMetaChange}
                        onCurrentPageChange={handlePdfCurrentPageChange}
                        requestedPage={requestedPage}
                        requestedLocation={requestedPdfLocation}
                        zoomPercent={zoomPercent}
                        fitMode={fitMode}
                        emptyMessage={effectivePdfError ? 'No se pudo cargar el PDF' : (effectivePdfNotice || 'Sin documento')}
                      />
                    )
                    : <div className="docx-reader-suspended">Vista PDF pausada hasta que la pestaña Documento vuelva a estar visible.</div>
                )
                : (!showConversionSpinner ? <div style={{ color: '#ccc', fontSize: 12, padding: 12 }}>{effectivePdfError ? 'No se pudo cargar el PDF' : (effectivePdfNotice || 'Sin documento')}</div> : null)
            )
            : (
              canViewHtml
                ? (!docxBase64
                  ? <div style={{ color: '#ddd' }}>Vista HTML no disponible sin DOCX inline.</div>
                  : (loadingHtml
                    ? <div style={{ color: '#ddd' }}>(Convirtiendo...)</div>
                    : (
                      <>
                        <div style={{ color: '#ddd' }} dangerouslySetInnerHTML={{ __html: html || '<p style="opacity:0.7">(Sin contenido extraido)</p>' }} />
                        {htmlError ? <div style={{ marginTop: 8, fontSize: 11, color: '#f88' }}>Error al convertir a HTML (mammoth): {String(htmlError)}</div> : null}
                      </>
                    )))
                : <div style={{ fontSize: 12, lineHeight: 1.4 }}>La vista HTML no esta disponible en este entorno. El PDF sigue disponible si la conversion esta habilitada.</div>
            )}
          {effectivePdfError ? (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#2a0000', color: '#fbb', fontSize: 11, padding: '6px 8px', borderTop: '1px solid #400' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Diagnostico PDF</div>
              <div>Error: {String(effectivePdfError)}</div>
              {pdfConversionMs != null ? <div>Duracion: {pdfConversionMs} ms</div> : null}
              {pdfConversionStdout ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>stdout</summary>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{pdfConversionStdout}</pre>
                </details>
              ) : null}
              {pdfConversionStderr ? (
                <details style={{ marginTop: 4 }} open>
                  <summary style={{ cursor: 'pointer' }}>stderr</summary>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{pdfConversionStderr}</pre>
                </details>
              ) : null}
              {canRetryPdf ? (
                <button onClick={onRetryPdf} className="toolbar-button" style={{ marginTop: 6, fontSize: 11 }}>
                  Reintentar conversion
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {shouldShowProvenanceRail && (
          <aside
            className={`docx-provenance-rail ${isProvenanceOverlay ? 'is-overlay' : 'is-docked'}`}
            data-testid="docx-provenance-rail"
          >
            <div className="docx-provenance-rail-header">
              <div>
                <div className="docx-rail-eyebrow">Procedencia</div>
                <div className="docx-rail-title">Codigo origen</div>
              </div>
              <button type="button" className="toolbar-button docx-rail-close-button" onClick={() => setProvenanceSelectionId(null)}>Cerrar</button>
            </div>
            <div className="docx-provenance-rail-content">
              <div className="docx-rail-label">Callsite</div>
              <div className="docx-rail-value">{formatNavigationTargetLabel(selectedCallsiteTarget)}</div>
              {selectedCallsiteTarget && (
                <button
                  type="button"
                  className="toolbar-button"
                  style={{ marginBottom: 12, fontSize: 11 }}
                  onClick={() => onNavigateToCode?.(selectedCallsiteTarget)}
                  data-testid="docx-provenance-go-callsite"
                >
                  Ir al callsite
                </button>
              )}
              {selectedExactTarget && selectedHasDistinctExact && (
                <>
                  <div className="docx-rail-label">Exacta</div>
                  <div className="docx-rail-value">{formatNavigationTargetLabel(selectedExactTarget)}</div>
                  <button
                    type="button"
                    className="toolbar-button"
                    style={{ marginBottom: 12, fontSize: 11 }}
                    onClick={() => onNavigateToCode?.(selectedExactTarget)}
                    data-testid="docx-provenance-go-exact"
                  >
                    Ir a linea exacta
                  </button>
                </>
              )}
              <div className="docx-rail-label">API DOCX</div>
              <div className="docx-rail-value"><code>{selectedProvenanceItem.api_name || 'unknown'}</code></div>
              <div className="docx-rail-label">Precision</div>
              <div className="docx-rail-value">{selectedProvenanceItem.precision || 'unknown'}</div>
              <div className="docx-rail-label">Tipo</div>
              <div className="docx-rail-value">{selectedProvenanceItem.element_kind || 'unknown'}</div>
              <div className="docx-rail-label">Vista previa</div>
              <div className="docx-rail-preview" style={{ marginBottom: selectedUserStack.length ? 12 : 0 }}>{selectedProvenanceItem.text_preview || 'Sin vista previa disponible.'}</div>
              {selectedUserStack.length > 0 && (
                <>
                  <div className="docx-rail-label">Stack</div>
                  <div className="docx-rail-stack">
                    {selectedUserStack.map((frame, index) => {
                      const frameLabel = frame.file_path
                        ? `${frame.file_path}:${frame.line || '?'}`
                        : `Celda ${frame.notebook_cell_id || '?'} - linea ${frame.line || '?'}`;
                      return (
                        <div
                          key={`docx-stack-${selectedProvenanceItem.provenance_id || 'item'}-${index}`}
                          className="docx-rail-stack-item"
                        >
                          <div className="docx-rail-stack-text">{frameLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
        {shouldShowQualityRail && (
          <aside
            className={`docx-quality-rail ${isQualityOverlay ? 'is-overlay' : 'is-docked'}`}
            data-testid="docx-quality-rail"
          >
            <div className="docx-quality-rail-header">
              <div>
                <div className="docx-rail-eyebrow">Workbench</div>
                <div className="docx-rail-title">Workbench DOCX</div>
              </div>
              <button type="button" className="toolbar-button docx-rail-close-button" onClick={() => setQualityRailOpen(false)}>Cerrar</button>
            </div>
            <div className="docx-quality-rail-content">
              <div className="docx-quality-summary">
                <div>
                  <div className="docx-rail-label">Estado</div>
                  <div className={`docx-quality-pill docx-quality-pill--${qualityDescriptor.tone}`}>
                    {qualityDescriptor.status === 'missing' ? 'Sin analizar' : qualityDescriptor.label}
                  </div>
                </div>
                <div>
                  <div className="docx-rail-label">Score</div>
                  <div className="docx-quality-score">{qualityDescriptor.score == null ? '-' : qualityDescriptor.score}</div>
                </div>
              </div>
              <div className="docx-quality-counts">
                <span className="docx-quality-count docx-quality-count--error">{qualityDescriptor.counts.error} errores</span>
                <span className="docx-quality-count docx-quality-count--warning">{qualityDescriptor.counts.warning} warnings</span>
                <span className="docx-quality-count docx-quality-count--info">{qualityDescriptor.counts.info} info</span>
              </div>
              <div className="docx-render-summary" data-testid="docx-render-summary">
                <span className={`docx-history-quality docx-history-quality--${renderDescriptor.tone}`}>
                  {renderDescriptor.label}
                </span>
                <span>{renderDescriptor.pageCount ? `${renderDescriptor.cachedPages}/${renderDescriptor.pageCount} paginas` : 'Paginas sin preparar'}</span>
                <span>{renderDescriptor.renderer ? `Motor ${renderDescriptor.renderer}` : 'Motor pendiente'}</span>
              </div>
              <div className="docx-workbench-tabs" role="tablist" aria-label="Workbench DOCX">
                {[
                  ['quality', 'Calidad'],
                  ['visual', 'Visual'],
                  ['review', 'Revision'],
                  ['publishing', 'Publicacion'],
                  ['fields', 'Campos'],
                  ['diff', 'Diff'],
                ].map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    role="tab"
                    aria-selected={workbenchTab === tabId}
                    className={`docx-workbench-tab ${workbenchTab === tabId ? 'is-active' : ''}`}
                    onClick={() => setWorkbenchTab(tabId)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(qualityError || workbenchError) ? <div className="docx-quality-error">Error: {qualityError || workbenchError}</div> : null}
              {workbenchTab === 'quality' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={handleRunQuality} disabled={!qualityArtifactId || qualityLoading} data-testid="docx-quality-run">
                      {qualityLoading ? 'Analizando...' : 'Analizar'}
                    </button>
                    {qualityError ? (
                      <button type="button" className="toolbar-button" onClick={handleRunQuality} disabled={!qualityArtifactId || qualityLoading}>
                        Reintentar
                      </button>
                    ) : null}
                  </div>
                  <div className="docx-quality-sections">
                    {(qualitySections.length ? qualitySections : [
                      { id: 'layout', status: 'missing', findings: [] },
                      { id: 'accessibility', status: 'missing', findings: [] },
                      { id: 'fields', status: 'missing', findings: [] },
                      { id: 'styles', status: 'missing', findings: [] },
                      { id: 'review', status: 'missing', findings: [] },
                      { id: 'publication', status: 'missing', findings: [] },
                      { id: 'content_controls', status: 'missing', findings: [] },
                    ]).map((section) => {
                      const sectionTone = getQualityTone(getQualityStatus(section));
                      const findings = Array.isArray(section.findings) ? section.findings : [];
                      return (
                        <section className="docx-quality-section" key={section.id}>
                          <div className="docx-quality-section-header">
                            <span>{SECTION_LABELS[section.id] || section.id}</span>
                            <span className={`docx-quality-section-status docx-quality-section-status--${sectionTone}`}>
                              {section.status === 'missing' ? 'Sin datos' : section.status}
                            </span>
                          </div>
                          {findings.length > 0 ? (
                            <div className="docx-quality-findings">
                              {findings.slice(0, 5).map((finding, index) => (
                                <div className={`docx-quality-finding docx-quality-finding--${finding.severity || 'info'}`} key={`${section.id}-${index}`}>
                                  <span>{finding.message || finding.title || 'Hallazgo DOCX'}</span>
                                  {finding.count != null ? <strong>{finding.count}</strong> : null}
                                </div>
                              ))}
                              {findings.length > 5 ? <div className="docx-quality-more">+{findings.length - 5} mas</div> : null}
                            </div>
                          ) : (
                            <div className="docx-quality-empty">{qualitySummary ? 'Sin hallazgos.' : 'Pendiente de analisis.'}</div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </>
              ) : null}
              {workbenchTab === 'visual' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={handleRefreshRenderManifest} disabled={!qualityArtifactId || workbenchLoading === 'render_manifest'} data-testid="docx-render-manifest">
                      {workbenchLoading === 'render_manifest' ? 'Refrescando...' : 'Refrescar manifest'}
                    </button>
                    <button type="button" className="toolbar-button" onClick={handleRenderQualityPage} disabled={!qualityArtifactId || qualityRenderLoading || workbenchLoading === 'render_page'} data-testid="docx-quality-render">
                      {qualityRenderLoading ? 'Renderizando...' : 'Render pagina'}
                    </button>
                    <button type="button" className="toolbar-button" onClick={handleRenderAllPages} disabled={!qualityArtifactId || workbenchLoading === 'render_all_pages'} data-testid="docx-render-all">
                      {workbenchLoading === 'render_all_pages' ? 'Preparando...' : 'Render todas'}
                    </button>
                    <button type="button" className="toolbar-button" onClick={handleClearRenderCache} disabled={!qualityArtifactId || workbenchLoading === 'clear_render_cache'} data-testid="docx-render-clear">
                      Limpiar visuales
                    </button>
                  </div>
                  <div className="docx-render-metrics">
                    <div>
                      <div className="docx-rail-label">Estado visual</div>
                      <div className={`docx-quality-pill docx-quality-pill--${renderDescriptor.tone}`}>{renderDescriptor.label}</div>
                    </div>
                    <div>
                      <div className="docx-rail-label">Paginas</div>
                      <div className="docx-rail-value">{renderDescriptor.pageCount ? `${renderDescriptor.cachedPages}/${renderDescriptor.pageCount}` : '-'}</div>
                    </div>
                    <div>
                      <div className="docx-rail-label">Motor</div>
                      <div className="docx-rail-value">{renderDescriptor.renderer || '-'}</div>
                    </div>
                  </div>
                  {qualityRenderUrl ? (
                    <div className="docx-quality-preview" data-testid="docx-quality-preview">
                      <div className="docx-rail-label">Pagina renderizada</div>
                      <img src={qualityRenderUrl} alt="Pagina DOCX renderizada para QA" />
                    </div>
                  ) : <div className="docx-quality-empty">Sin pagina renderizada.</div>}
                </>
              ) : null}
              {workbenchTab === 'review' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('comments_extract')} disabled={!qualityArtifactId || workbenchLoading === 'comments_extract'}>Comentarios</button>
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('redlines_report')} disabled={!qualityArtifactId || workbenchLoading === 'redlines_report'}>Redlines</button>
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('comments_strip', { strip_comments: true, scrub_metadata: false, tracked_changes: 'preserve' })} disabled={!qualityArtifactId || workbenchLoading === 'comments_strip'}>Quitar comentarios</button>
                  </div>
                  <pre className="docx-workbench-json">{JSON.stringify(workbenchResult?.review || workbenchResult?.stats || {}, null, 2)}</pre>
                </>
              ) : null}
              {workbenchTab === 'publishing' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={handlePrepareDelivery} disabled={!qualityArtifactId || qualityCleanLoading} data-testid="docx-quality-clean">
                      {qualityCleanLoading ? 'Preparando...' : 'Preparar entrega'}
                    </button>
                    <button type="button" className="toolbar-button" onClick={handleDownloadCleanDocx} disabled={!qualityArtifactId || qualityCleanLoading}>
                      Descargar copia limpia
                    </button>
                  </div>
                  <pre className="docx-workbench-json">{JSON.stringify(workbenchResult?.variant || workbenchResult?.stats || {}, null, 2)}</pre>
                </>
              ) : null}
              {workbenchTab === 'fields' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('fields_report')} disabled={!qualityArtifactId || workbenchLoading === 'fields_report'}>Fields</button>
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('content_controls_list')} disabled={!qualityArtifactId || workbenchLoading === 'content_controls_list'}>SDTs</button>
                    <button type="button" className="toolbar-button" onClick={() => handleRunWorkbenchOperation('content_controls_wrap')} disabled={!qualityArtifactId || workbenchLoading === 'content_controls_wrap'}>Envolver placeholders</button>
                  </div>
                  {qualityContentControls ? (
                    <div className="docx-quality-content-controls">
                      <div className="docx-rail-label">Controles de contenido</div>
                      <div className="docx-rail-value">
                        {qualityContentControls.control_count || 0} SDT, {qualityContentControls.placeholder_count || 0} placeholders, {qualityContentControls.unwrapped_placeholder_count || 0} sin envolver.
                      </div>
                    </div>
                  ) : null}
                  <pre className="docx-workbench-json">{JSON.stringify(workbenchResult?.fields || workbenchResult?.content_controls || {}, null, 2)}</pre>
                </>
              ) : null}
              {workbenchTab === 'diff' ? (
                <>
                  <div className="docx-quality-actions">
                    <button type="button" className="toolbar-button" onClick={handleRunDiff} disabled={!qualityArtifactId || !diffCompareEntry || workbenchLoading === 'diff'}>
                      {workbenchLoading === 'diff' ? 'Comparando...' : 'Comparar versiones'}
                    </button>
                  </div>
                  <div className="docx-rail-value">
                    {diffCompareEntry ? `Comparando con ${diffCompareEntry.docxFileName || diffCompareEntry.id}` : 'Se requieren dos versiones en el historial.'}
                  </div>
                  <pre className="docx-workbench-json">{JSON.stringify(workbenchResult?.diff || {}, null, 2)}</pre>
                </>
              ) : null}
              {workbenchResources.length > 0 ? (
                <div className="docx-workbench-resources">
                  <div className="docx-rail-label">Recursos</div>
                  {workbenchResources.map((resource) => (
                    <button key={resource.name || resource.resource_uri} type="button" className="toolbar-button" onClick={() => handleDownloadWorkbenchResource(resource)}>
                      {resource.name || 'Recurso'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        )}
      </div>

      {showTemplateModal && <TemplateEditor templateInfo={templateInfo} templateBinding={templateBinding} kernelId={kernelId} sendMessage={templateSendMessage || sendMessage} lastMessage={templateLastMessage || lastMessage} onClose={() => setShowTemplateModal(false)} onTemplateChange={onTemplateChange} onStatusMessage={onStatusMessage} onTemplateUpload={onTemplateUpload} onTemplateBind={onTemplateBind} isOpeningPersistedTemplate={isOpeningPersistedTemplate} templateDocxBase64={templateDocxBase64} enableTemplateSourceFetch />}
    </div>
  );
};

export default DocxViewer;
