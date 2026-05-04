import { API_BASE } from '../config/endpoints';

const HISTORY_STORAGE_KEY = 'inspyro_docx_history_v1';
const HISTORY_LIMIT = 200;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
};

const normalizeTimestamp = (value, fallback = null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const normalizeComparablePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const readFirst = (payload, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      return payload[key];
    }
  }
  return undefined;
};

const hasAny = (payload, keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));

const hasNonEmptyValue = (value) => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined;
};

const withSearchParams = (pathname, params) => {
  const url = new URL(pathname, API_BASE);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return;
    }
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
};

export const buildDocxDownloadPath = ({
  artifactId = null,
  token = null,
  sourcePath = null,
  kernelId = null,
} = {}) => {
  if (artifactId) {
    return withSearchParams('/api/docx/download', { artifact_id: artifactId });
  }
  if (token) {
    return withSearchParams('/api/docx/download', { token });
  }
  if (sourcePath) {
    return withSearchParams('/api/docx/download', { source_path: sourcePath });
  }
  if (kernelId) {
    return withSearchParams('/api/docx/download', { kernel_id: kernelId });
  }
  return null;
};

export const buildDocxHistoryPath = ({
  sourcePath = null,
  kernelId = null,
  limit = 20,
} = {}) => {
  if (!sourcePath && !kernelId) {
    return null;
  }
  return withSearchParams('/api/docx/history', {
    source_path: sourcePath,
    kernel_id: kernelId,
    limit: String(limit),
  });
};

export const buildDocxProvenancePath = ({
  artifactId = null,
} = {}) => {
  if (!artifactId) {
    return null;
  }
  return withSearchParams('/api/docx/provenance', {
    artifact_id: artifactId,
  });
};

export const buildDocxQualityPath = ({
  artifactId = null,
} = {}) => {
  if (!artifactId) {
    return null;
  }
  return withSearchParams('/api/docx/quality', {
    artifact_id: artifactId,
  });
};

export const buildDocxDownloadUrlFromPayload = (payload = {}, fallback = {}) => {
  const artifactId = normalizeText(payload.docx_artifact_id || fallback.artifactId);
  if (artifactId) {
    return buildDocxDownloadPath({ artifactId });
  }
  if (payload.docx_download_url || payload.docx_ref) {
    return payload.docx_download_url || payload.docx_ref;
  }
  if (payload.docx_file_token) {
    return buildDocxDownloadPath({ token: payload.docx_file_token });
  }
  return buildDocxDownloadPath({
    artifactId: fallback.artifactId || null,
    token: fallback.token || null,
    sourcePath: fallback.sourcePath || null,
    kernelId: fallback.kernelId || null,
  });
};

export const getDocxStableIdentity = (payload = {}, options = {}) => {
  const artifactId = normalizeText(readFirst(payload, ['docxArtifactId', 'docx_artifact_id', 'artifactId', 'artifact_id']));
  if (artifactId) {
    return `artifact:${artifactId}`;
  }

  const explicitDownloadUrl = normalizeText(
    readFirst(payload, ['docxDownloadUrl', 'docx_download_url', 'docxRef', 'docx_ref', 'downloadUrl', 'download_url', 'ref']),
  );
  if (explicitDownloadUrl) {
    return `download:${explicitDownloadUrl}`;
  }

  const token = normalizeText(readFirst(payload, ['docxFileToken', 'docx_file_token', 'token']));
  if (token) {
    return `token:${token}`;
  }

  const docxBase64 = normalizeText(readFirst(payload, ['docxBase64', 'docx_file_b64']));
  const docxHash = normalizeText(readFirst(payload, ['docxHash', 'docx_hash']));
  if (docxHash && (docxBase64 || options.allowHashFallback)) {
    return `hash:${docxHash}`;
  }

  return null;
};

export const inferDocxSourceKind = (sourcePath = null) => {
  if (typeof sourcePath === 'string' && sourcePath.trim().toLowerCase().endsWith('.ipynb')) {
    return 'notebook';
  }
  return 'code';
};

export const resolveDocxDownloadUrl = ({
  docxDownloadUrl = null,
  docxRef = null,
  docxFileToken = null,
  docxArtifactId = null,
  sourcePath = null,
  kernelId = null,
} = {}) => buildDocxDownloadUrlFromPayload(
  {
    docx_download_url: docxDownloadUrl,
    docx_ref: docxRef,
    docx_file_token: docxFileToken,
    docx_artifact_id: docxArtifactId,
  },
  {
    artifactId: docxArtifactId,
    token: docxFileToken,
    sourcePath,
    kernelId,
  },
);

const resolveDocxHistoryDownloadUrl = ({
  docxDownloadUrl = null,
  docxRef = null,
  docxFileToken = null,
  docxArtifactId = null,
} = {}) => buildDocxDownloadUrlFromPayload(
  {
    docx_download_url: docxDownloadUrl,
    docx_ref: docxRef,
    docx_file_token: docxFileToken,
    docx_artifact_id: docxArtifactId,
  },
  {},
);

export const hasMeaningfulDocxArtifactPayload = (payload = {}) => (
  Boolean(getDocxStableIdentity(payload))
  || hasNonEmptyValue(readFirst(payload, ['docxBase64', 'docx_file_b64']))
);

export const hasDocxArtifactPayload = (payload = {}) => hasMeaningfulDocxArtifactPayload(payload);

const hasDocxStatePatchPayload = (payload = {}) => hasAny(payload, [
  'docxBase64',
  'docx_file_b64',
  'docxHash',
  'docx_hash',
  'docxDownloadUrl',
  'docx_download_url',
  'docxRef',
  'docx_ref',
  'docxFileToken',
  'docx_file_token',
  'docxArtifactId',
  'docx_artifact_id',
  'docxFileName',
  'docx_file_name',
  'docxWarnings',
  'docx_warnings',
  'docxError',
  'docx_error',
  'docxSizeBytes',
  'docx_size_bytes',
  'docxStoreError',
  'docx_store_error',
  'docxProvenanceAvailable',
  'docx_provenance_available',
  'docxProvenanceRef',
  'docx_provenance_ref',
  'docxEventId',
  'docx_event_id',
  'docxUpdatedAt',
  'docx_updated_at',
  'sourcePath',
  'docxSourcePath',
  'docx_source_path',
  'source_path',
  'notebook_path',
  'sourceKind',
  'docxSourceKind',
  'docx_source_kind',
  'source_kind',
  'docxWorkspacePath',
  'workspacePath',
  'workspace_path',
  'docxWorkspaceRelpath',
  'workspaceRelpath',
  'workspace_relpath',
  'docxWorkspaceWarning',
  'workspaceWarning',
  'workspace_warning',
  'docxQualityStatus',
  'docx_quality_status',
  'docxQualityScore',
  'docx_quality_score',
  'docxQualityCounts',
  'docx_quality_counts',
  'docxRenderStatus',
  'docx_render_status',
  'docxRenderPageCount',
  'docx_render_page_count',
  'docxRenderCachedPages',
  'docx_render_cached_pages',
  'docxRenderRenderer',
  'docx_render_renderer',
]);

const hasPdfStatePatchPayload = (payload = {}) => hasAny(payload, [
  'pdfBase64',
  'pdf_file_b64',
  'pdfRefUrl',
  'pdf_ref',
  'pdfHash',
  'pdf_hash',
  'pdfConversionError',
  'pdf_conversion_error',
  'pdfAttempted',
  'pdf_attempted',
  'pdfConversionStdout',
  'pdf_conversion_stdout',
  'pdfConversionStderr',
  'pdf_conversion_stderr',
  'pdfConversionMs',
  'pdf_conversion_ms',
  'conversionStatus',
  'documentPipelineStatus',
  'converterUsed',
  'converter_used',
  'wordError',
  'word_error',
]);

export const createEmptyDocumentState = () => ({
  variables: {},
  docxBase64: null,
  docxHash: null,
  docxDownloadUrl: null,
  docxFileToken: null,
  docxArtifactId: null,
  docxFileName: null,
  docxWarnings: null,
  docxError: null,
  docxSizeBytes: null,
  docxStoreError: null,
  docxProvenanceAvailable: false,
  docxProvenanceRef: null,
  docxEventId: null,
  docxUpdatedAt: null,
  docxSourcePath: null,
  docxSourceKind: null,
    docxWorkspacePath: null,
    docxWorkspaceRelpath: null,
    docxWorkspaceWarning: null,
    docxQualityStatus: null,
    docxQualityScore: null,
    docxQualityCounts: null,
    docxRenderStatus: null,
    docxRenderPageCount: null,
    docxRenderCachedPages: null,
    docxRenderRenderer: null,
    pdfBase64: null,
  pdfRefUrl: null,
  pdfHash: null,
  pdfConversionError: null,
  pdfAttempted: null,
  pdfConversionStdout: null,
  pdfConversionStderr: null,
  pdfConversionMs: null,
  conversionStatus: null,
  documentPipelineStatus: null,
  converterUsed: null,
  wordError: null,
});

export const resetDocumentState = (previous = {}, options = {}) => {
  const {
    preserveVariables = false,
    overrides = {},
  } = options;

  return {
    ...createEmptyDocumentState(),
    variables: preserveVariables ? (previous?.variables || {}) : {},
    ...overrides,
  };
};

export const applyDocxArtifactPayload = (previous = {}, payload = {}, options = {}) => {
  const next = { ...previous };
  const hasArtifactIdKey = hasAny(payload, ['docxArtifactId', 'docx_artifact_id']);
  const hasIdentityKey = hasAny(payload, [
    'docxDownloadUrl',
    'docx_download_url',
    'docxRef',
    'docx_ref',
    'docxFileToken',
    'docx_file_token',
    'docxArtifactId',
    'docx_artifact_id',
  ]);
  const artifactIdValue = readFirst(payload, ['docxArtifactId', 'docx_artifact_id']) || null;
  const sourcePath = options.sourcePath
    || readFirst(payload, ['sourcePath', 'docxSourcePath', 'docx_source_path', 'source_path', 'notebook_path'])
    || previous.docxSourcePath
    || null;
  const sourceKind = options.sourceKind
    || readFirst(payload, ['sourceKind', 'docxSourceKind', 'docx_source_kind', 'source_kind'])
    || previous.docxSourceKind
    || inferDocxSourceKind(sourcePath);
  const downloadUrl = resolveDocxDownloadUrl({
    docxDownloadUrl: readFirst(payload, ['docxDownloadUrl', 'docx_download_url']) || null,
    docxRef: readFirst(payload, ['docxRef', 'docx_ref']) || null,
    docxFileToken: readFirst(payload, ['docxFileToken', 'docx_file_token']) || null,
    docxArtifactId: readFirst(payload, ['docxArtifactId', 'docx_artifact_id']) || null,
    sourcePath,
    kernelId: readFirst(payload, ['kernelId', 'kernel_id']) || null,
  });

  if (hasAny(payload, ['docxBase64', 'docx_file_b64'])) {
    next.docxBase64 = readFirst(payload, ['docxBase64', 'docx_file_b64']) || null;
  }
  if (hasAny(payload, ['docxHash', 'docx_hash'])) {
    next.docxHash = readFirst(payload, ['docxHash', 'docx_hash']) || null;
  }
  if (hasIdentityKey) {
    next.docxDownloadUrl = downloadUrl;
    if (hasAny(payload, ['docxFileToken', 'docx_file_token'])) {
      next.docxFileToken = readFirst(payload, ['docxFileToken', 'docx_file_token']) || null;
    }
  }
  if (hasArtifactIdKey) {
    next.docxArtifactId = artifactIdValue;
  }
  if (hasAny(payload, ['docxFileName', 'docx_file_name'])) {
    next.docxFileName = readFirst(payload, ['docxFileName', 'docx_file_name']) || null;
  }
  if (hasAny(payload, ['docxWarnings', 'docx_warnings'])) {
    next.docxWarnings = readFirst(payload, ['docxWarnings', 'docx_warnings']) || null;
  }
  if (hasAny(payload, ['docxError', 'docx_error'])) {
    next.docxError = readFirst(payload, ['docxError', 'docx_error']) || null;
  }
  if (hasAny(payload, ['docxSizeBytes', 'docx_size_bytes'])) {
    const sizeBytes = readFirst(payload, ['docxSizeBytes', 'docx_size_bytes']);
    next.docxSizeBytes = sizeBytes ?? null;
  }
  if (hasAny(payload, ['docxStoreError', 'docx_store_error'])) {
    const storeError = readFirst(payload, ['docxStoreError', 'docx_store_error']);
    next.docxStoreError = storeError ?? null;
  }
  if (hasAny(payload, ['docxProvenanceAvailable', 'docx_provenance_available'])) {
    next.docxProvenanceAvailable = normalizeBoolean(
      readFirst(payload, ['docxProvenanceAvailable', 'docx_provenance_available']),
    );
  }
  if (hasAny(payload, ['docxProvenanceRef', 'docx_provenance_ref']) || hasArtifactIdKey) {
    next.docxProvenanceRef = readFirst(payload, ['docxProvenanceRef', 'docx_provenance_ref'])
      || buildDocxProvenancePath({ artifactId: artifactIdValue || previous.docxArtifactId || null })
      || null;
  }
  if (hasAny(payload, ['docxWorkspacePath', 'workspacePath', 'workspace_path'])) {
    next.docxWorkspacePath = readFirst(payload, ['docxWorkspacePath', 'workspacePath', 'workspace_path']) || null;
  }
  if (hasAny(payload, ['docxWorkspaceRelpath', 'workspaceRelpath', 'workspace_relpath'])) {
    next.docxWorkspaceRelpath = readFirst(payload, ['docxWorkspaceRelpath', 'workspaceRelpath', 'workspace_relpath']) || null;
  }
  if (hasAny(payload, ['docxWorkspaceWarning', 'workspaceWarning', 'workspace_warning'])) {
    next.docxWorkspaceWarning = readFirst(payload, ['docxWorkspaceWarning', 'workspaceWarning', 'workspace_warning']) || null;
  }
  if (hasAny(payload, ['docxQualityStatus', 'docx_quality_status'])) {
    next.docxQualityStatus = readFirst(payload, ['docxQualityStatus', 'docx_quality_status']) || null;
  }
  if (hasAny(payload, ['docxQualityScore', 'docx_quality_score'])) {
    next.docxQualityScore = readFirst(payload, ['docxQualityScore', 'docx_quality_score']) ?? null;
  }
  if (hasAny(payload, ['docxQualityCounts', 'docx_quality_counts'])) {
    next.docxQualityCounts = readFirst(payload, ['docxQualityCounts', 'docx_quality_counts']) || null;
  }
  if (hasAny(payload, ['docxRenderStatus', 'docx_render_status'])) {
    next.docxRenderStatus = readFirst(payload, ['docxRenderStatus', 'docx_render_status']) || null;
  }
  if (hasAny(payload, ['docxRenderPageCount', 'docx_render_page_count'])) {
    next.docxRenderPageCount = readFirst(payload, ['docxRenderPageCount', 'docx_render_page_count']) ?? null;
  }
  if (hasAny(payload, ['docxRenderCachedPages', 'docx_render_cached_pages'])) {
    next.docxRenderCachedPages = readFirst(payload, ['docxRenderCachedPages', 'docx_render_cached_pages']) ?? null;
  }
  if (hasAny(payload, ['docxRenderRenderer', 'docx_render_renderer'])) {
    next.docxRenderRenderer = readFirst(payload, ['docxRenderRenderer', 'docx_render_renderer']) || null;
  }

  next.docxSourcePath = sourcePath;
  next.docxSourceKind = sourceKind;
  next.docxEventId = options.docxEventId
    || readFirst(payload, ['docxEventId', 'docx_event_id', 'event_id'])
    || previous.docxEventId
    || null;
  next.docxUpdatedAt = normalizeTimestamp(
    options.docxUpdatedAt
      ?? readFirst(payload, ['docxUpdatedAt', 'docx_updated_at', 'updatedAt', 'updated_at', 'createdAt', 'created_at']),
    Date.now(),
  );
  return next;
};

export const applyPdfArtifactPayload = (previous = {}, payload = {}, options = {}) => {
  const next = { ...previous };
  const sourcePath = options.sourcePath
    || readFirst(payload, ['sourcePath', 'docxSourcePath', 'docx_source_path', 'source_path', 'notebook_path'])
    || previous.docxSourcePath
    || null;
  const sourceKind = options.sourceKind
    || readFirst(payload, ['sourceKind', 'docxSourceKind', 'docx_source_kind', 'source_kind'])
    || previous.docxSourceKind
    || inferDocxSourceKind(sourcePath);

  if (sourcePath) {
    next.docxSourcePath = sourcePath;
    next.docxSourceKind = sourceKind;
  }
  if (hasAny(payload, ['pdfBase64', 'pdf_file_b64'])) {
    next.pdfBase64 = readFirst(payload, ['pdfBase64', 'pdf_file_b64']) || null;
  }
  if (hasAny(payload, ['pdfRefUrl', 'pdf_ref'])) {
    next.pdfRefUrl = readFirst(payload, ['pdfRefUrl', 'pdf_ref']) || null;
  }
  if (hasAny(payload, ['pdfHash', 'pdf_hash'])) {
    next.pdfHash = readFirst(payload, ['pdfHash', 'pdf_hash']) || null;
  }
  if (hasAny(payload, ['pdfConversionError', 'pdf_conversion_error'])) {
    next.pdfConversionError = readFirst(payload, ['pdfConversionError', 'pdf_conversion_error']) || null;
  }
  if (hasAny(payload, ['pdfAttempted', 'pdf_attempted'])) {
    next.pdfAttempted = readFirst(payload, ['pdfAttempted', 'pdf_attempted']) ?? null;
  }
  if (hasAny(payload, ['pdfConversionStdout', 'pdf_conversion_stdout'])) {
    next.pdfConversionStdout = readFirst(payload, ['pdfConversionStdout', 'pdf_conversion_stdout']) ?? null;
  }
  if (hasAny(payload, ['pdfConversionStderr', 'pdf_conversion_stderr'])) {
    next.pdfConversionStderr = readFirst(payload, ['pdfConversionStderr', 'pdf_conversion_stderr']) ?? null;
  }
  if (hasAny(payload, ['pdfConversionMs', 'pdf_conversion_ms'])) {
    next.pdfConversionMs = readFirst(payload, ['pdfConversionMs', 'pdf_conversion_ms']) ?? null;
  }
  if (hasAny(payload, ['conversionStatus'])) {
    next.conversionStatus = readFirst(payload, ['conversionStatus']) ?? null;
  }
  if (hasAny(payload, ['documentPipelineStatus'])) {
    next.documentPipelineStatus = readFirst(payload, ['documentPipelineStatus']) ?? null;
  }
  if (hasAny(payload, ['converterUsed', 'converter_used'])) {
    next.converterUsed = readFirst(payload, ['converterUsed', 'converter_used']) ?? null;
  }
  if (hasAny(payload, ['wordError', 'word_error'])) {
    next.wordError = readFirst(payload, ['wordError', 'word_error']) ?? null;
  }
  return next;
};

export const applyDocumentStatePayload = (previous = {}, payload = {}, options = {}) => {
  const sourcePath = options.sourcePath
    || readFirst(payload, ['sourcePath', 'docxSourcePath', 'docx_source_path', 'source_path', 'notebook_path'])
    || previous.docxSourcePath
    || null;
  const sourceKind = options.sourceKind
    || readFirst(payload, ['sourceKind', 'docxSourceKind', 'docx_source_kind', 'source_kind'])
    || previous.docxSourceKind
    || inferDocxSourceKind(sourcePath);

  let next = { ...previous };
  if (hasDocxStatePatchPayload(payload) || hasDocxArtifactPayload(payload)) {
    next = applyDocxArtifactPayload(next, payload, {
      ...options,
      sourcePath,
      sourceKind,
    });
  } else if (sourcePath) {
    next.docxSourcePath = sourcePath;
    next.docxSourceKind = sourceKind;
  }

  if (hasPdfStatePatchPayload(payload)) {
    next = applyPdfArtifactPayload(next, payload, {
      ...options,
      sourcePath,
      sourceKind,
    });
  }

  return next;
};

export const applyMcpArtifactToDocumentState = (previous = {}, artifact = null) => {
  const prev = previous || {};
  if (!artifact?.kind) {
    return prev;
  }

  const next = { ...prev };
  if (artifact.kind === 'pdf') {
    const artifactSourcePath = artifact.source_path || artifact.notebook_path || prev.docxSourcePath || null;
    const artifactSourceKind = artifact.source_kind || prev.docxSourceKind || inferDocxSourceKind(artifactSourcePath);
    const docxArtifactId = artifact.docx_artifact_id || prev.docxArtifactId || null;
    const recoveredDocxDownloadUrl = resolveDocxDownloadUrl({
      docxDownloadUrl: artifact.docx_download_url || null,
      docxRef: artifact.docx_ref || null,
      docxFileToken: artifact.docx_file_token || null,
      docxArtifactId,
      sourcePath: artifactSourcePath,
      kernelId: artifact.kernel_id || null,
    });
    next.pdfBase64 = artifact.pdf_file_b64 || null;
    next.pdfRefUrl = artifact.ref || artifact.pdf_ref || prev.pdfRefUrl || null;
    next.pdfHash = artifact.pdf_hash || prev.pdfHash || null;
    if (artifactSourcePath) {
      next.docxSourcePath = artifactSourcePath;
      next.docxSourceKind = artifactSourceKind;
    }
    if (docxArtifactId) {
      next.docxArtifactId = docxArtifactId;
    }
    if (artifact.docx_hash) {
      next.docxHash = artifact.docx_hash;
    }
    if (recoveredDocxDownloadUrl) {
      next.docxDownloadUrl = recoveredDocxDownloadUrl;
    }
    next.docxProvenanceAvailable = Object.prototype.hasOwnProperty.call(artifact, 'docx_provenance_available')
      ? Boolean(artifact.docx_provenance_available)
      : Boolean(artifact.docx_provenance_ref || prev.docxProvenanceAvailable);
    next.docxProvenanceRef = artifact.docx_provenance_ref
      || prev.docxProvenanceRef
      || buildDocxProvenancePath({ artifactId: docxArtifactId });
    if (Object.prototype.hasOwnProperty.call(artifact, 'workspace_path')) {
      next.docxWorkspacePath = artifact.workspace_path || null;
    }
    if (Object.prototype.hasOwnProperty.call(artifact, 'workspace_relpath')) {
      next.docxWorkspaceRelpath = artifact.workspace_relpath || null;
    }
    if (Object.prototype.hasOwnProperty.call(artifact, 'workspace_warning')) {
      next.docxWorkspaceWarning = artifact.workspace_warning || null;
    }
    if (
      artifact.docx_artifact_id
      || artifact.docx_provenance_ref
      || artifact.source_path
      || artifact.notebook_path
      || artifact.source_kind
    ) {
      next.docxUpdatedAt = artifact.docx_updated_at || artifact.updated_at || artifact.created_at || prev.docxUpdatedAt || Date.now();
      next.docxEventId = artifact.docx_event_id || artifact.execution_id || prev.docxEventId || null;
    }
    next.pdfConversionError = null;
    next.pdfAttempted = true;
    next.pdfConversionStdout = null;
    next.pdfConversionStderr = null;
    next.pdfConversionMs = null;
    next.conversionStatus = null;
    next.documentPipelineStatus = null;
    next.converterUsed = null;
    next.wordError = null;
  }
  if (artifact.kind === 'docx') {
    if (!hasDocxArtifactPayload({
      ...artifact,
      docx_file_token: artifact.docx_file_token || artifact.token || null,
    })) {
      return prev;
    }
    const sourcePath = artifact.source_path || artifact.notebook_path || prev.docxSourcePath || null;
    const sourceKind = artifact.source_kind || inferDocxSourceKind(sourcePath);
    const docxDownloadUrl = resolveDocxDownloadUrl({
      docxDownloadUrl: artifact.docx_download_url || artifact.ref || null,
      docxRef: artifact.docx_ref || null,
      docxFileToken: artifact.docx_file_token || artifact.token || null,
      docxArtifactId: artifact.docx_artifact_id || artifact.artifact_id || null,
      sourcePath,
      kernelId: artifact.kernel_id || null,
    });

    next.docxBase64 = Object.prototype.hasOwnProperty.call(artifact, 'docx_file_b64')
      ? (artifact.docx_file_b64 || null)
      : null;
    next.docxDownloadUrl = docxDownloadUrl;
    next.docxFileToken = artifact.docx_file_token || artifact.token || null;
    next.docxArtifactId = artifact.docx_artifact_id || artifact.artifact_id || null;
    next.docxHash = artifact.docx_hash || null;
    next.docxFileName = artifact.docx_file_name || prev.docxFileName || 'inspyro_document.docx';
    next.docxSizeBytes = artifact.docx_size_bytes ?? null;
    next.docxProvenanceAvailable = Boolean(artifact.docx_provenance_available);
    next.docxProvenanceRef = artifact.docx_provenance_ref
      || buildDocxProvenancePath({ artifactId: artifact.docx_artifact_id || artifact.artifact_id || null });
    next.docxWorkspacePath = artifact.workspace_path || null;
    next.docxWorkspaceRelpath = artifact.workspace_relpath || null;
    next.docxWorkspaceWarning = artifact.workspace_warning || null;
    next.docxQualityStatus = artifact.docx_quality_status || null;
    next.docxQualityScore = artifact.docx_quality_score ?? null;
    next.docxQualityCounts = artifact.docx_quality_counts || null;
    next.docxRenderStatus = artifact.docx_render_status || null;
    next.docxRenderPageCount = artifact.docx_render_page_count ?? null;
    next.docxRenderCachedPages = artifact.docx_render_cached_pages ?? null;
    next.docxRenderRenderer = artifact.docx_render_renderer || null;
    next.docxWarnings = null;
    next.docxError = null;
    next.docxStoreError = null;
    next.docxEventId = artifact.docx_event_id || artifact.event_id || `docx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    next.docxUpdatedAt = artifact.docx_updated_at || artifact.updated_at || artifact.created_at || Date.now();
    next.docxSourcePath = sourcePath;
    next.docxSourceKind = sourceKind;
  }
  return next;
};

export const createDocxHistoryEntry = (payload = {}, base = {}) => {
  const sourcePath = base.sourcePath
    || readFirst(payload, ['sourcePath', 'docxSourcePath', 'docx_source_path', 'source_path'])
    || null;
  const sourceKind = base.sourceKind
    || readFirst(payload, ['sourceKind', 'docxSourceKind', 'docx_source_kind', 'source_kind'])
    || inferDocxSourceKind(sourcePath);
  const downloadUrl = resolveDocxHistoryDownloadUrl({
    docxDownloadUrl: readFirst(payload, ['docxDownloadUrl', 'docx_download_url']) || null,
    docxRef: readFirst(payload, ['docxRef', 'docx_ref']) || null,
    docxFileToken: readFirst(payload, ['docxFileToken', 'docx_file_token']) || null,
    docxArtifactId: readFirst(payload, ['docxArtifactId', 'docx_artifact_id']) || null,
  });
  const hasInlineBase64 = hasNonEmptyValue(readFirst(payload, ['docxBase64', 'docx_file_b64']));
  const stableIdentity = getDocxStableIdentity(
    {
      ...payload,
      downloadUrl,
      docxDownloadUrl: downloadUrl,
    },
    { allowHashFallback: hasInlineBase64 || base.allowHashFallback === true },
  );

  if (!stableIdentity && !hasInlineBase64) {
    return null;
  }

  const createdAt = normalizeTimestamp(
    base.createdAt
      ?? readFirst(payload, ['createdAt', 'created_at', 'docxUpdatedAt', 'docx_updated_at', 'updatedAt', 'updated_at']),
    Date.now(),
  );
  const docxUpdatedAt = normalizeTimestamp(
    base.docxUpdatedAt
      ?? readFirst(payload, ['docxUpdatedAt', 'docx_updated_at', 'updatedAt', 'updated_at', 'createdAt', 'created_at']),
    createdAt,
  );

  return {
    id: stableIdentity || base.id || `docx_hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    sourcePath,
    sourceKind,
    docxEventId: base.docxEventId || readFirst(payload, ['docxEventId', 'docx_event_id']) || null,
    downloadUrl,
    docxArtifactId: readFirst(payload, ['docxArtifactId', 'docx_artifact_id', 'artifactId', 'artifact_id']) || null,
    docxFileToken: readFirst(payload, ['docxFileToken', 'docx_file_token']) || null,
    docxFileName: readFirst(payload, ['docxFileName', 'docx_file_name']) || 'inspyro_document.docx',
    docxSizeBytes: readFirst(payload, ['docxSizeBytes', 'docx_size_bytes']) ?? null,
    docxHash: readFirst(payload, ['docxHash', 'docx_hash']) || null,
    docxIsEmpty: normalizeBoolean(readFirst(payload, ['docxIsEmpty', 'docx_is_empty'])),
    docxWarning: readFirst(payload, ['docxWarning', 'docx_warning']) || null,
    docxProvenanceAvailable: normalizeBoolean(
      readFirst(payload, ['docxProvenanceAvailable', 'docx_provenance_available']),
    ),
    docxProvenanceRef: readFirst(payload, ['docxProvenanceRef', 'docx_provenance_ref']) || null,
    docxWorkspacePath: readFirst(payload, ['docxWorkspacePath', 'workspacePath', 'workspace_path']) || null,
    docxWorkspaceRelpath: readFirst(payload, ['docxWorkspaceRelpath', 'workspaceRelpath', 'workspace_relpath']) || null,
    docxWorkspaceWarning: readFirst(payload, ['docxWorkspaceWarning', 'workspaceWarning', 'workspace_warning']) || null,
    docxQualityStatus: readFirst(payload, ['docxQualityStatus', 'docx_quality_status']) || null,
    docxQualityScore: readFirst(payload, ['docxQualityScore', 'docx_quality_score']) ?? null,
    docxQualityCounts: readFirst(payload, ['docxQualityCounts', 'docx_quality_counts']) || null,
    docxRenderStatus: readFirst(payload, ['docxRenderStatus', 'docx_render_status']) || null,
    docxRenderPageCount: readFirst(payload, ['docxRenderPageCount', 'docx_render_page_count']) ?? null,
    docxRenderCachedPages: readFirst(payload, ['docxRenderCachedPages', 'docx_render_cached_pages']) ?? null,
    docxRenderRenderer: readFirst(payload, ['docxRenderRenderer', 'docx_render_renderer']) || null,
    docxUpdatedAt,
    origin: base.origin || readFirst(payload, ['origin']) || 'ui',
  };
};

export const upsertDocxHistoryEntry = (entries = [], entry = null) => {
  if (!entry?.id) {
    return Array.isArray(entries) ? entries : [];
  }
  const next = (Array.isArray(entries) ? entries : []).filter((item) => item?.id !== entry.id);
  next.unshift(entry);
  next.sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0));
  return next.slice(0, HISTORY_LIMIT);
};

export const normalizeDocxHistoryEntry = (entry = null) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const normalized = createDocxHistoryEntry(entry, {
    createdAt: normalizeTimestamp(entry.createdAt ?? entry.created_at, Date.now()),
    sourcePath: entry.sourcePath || entry.source_path || null,
    sourceKind: entry.sourceKind || entry.source_kind || inferDocxSourceKind(entry.sourcePath || entry.source_path || null),
    docxEventId: entry.docxEventId || entry.docx_event_id || null,
    docxUpdatedAt: normalizeTimestamp(entry.docxUpdatedAt ?? entry.docx_updated_at ?? entry.updatedAt ?? entry.updated_at, null),
    origin: entry.origin || 'ui',
  });
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    docxArtifactId: entry.docxArtifactId || entry.docx_artifact_id || entry.artifactId || entry.artifact_id || normalized.docxArtifactId,
    docxFileName: entry.docxFileName || entry.filename || normalized.docxFileName,
    docxSizeBytes: entry.docxSizeBytes ?? entry.size_bytes ?? normalized.docxSizeBytes,
    docxHash: entry.docxHash || entry.docx_hash || normalized.docxHash,
    docxIsEmpty: normalizeBoolean(entry.docxIsEmpty ?? entry.docx_is_empty ?? normalized.docxIsEmpty),
    docxWarning: entry.docxWarning || entry.docx_warning || normalized.docxWarning || null,
    docxProvenanceAvailable: normalizeBoolean(
      entry.docxProvenanceAvailable ?? entry.docx_provenance_available ?? normalized.docxProvenanceAvailable,
    ),
    docxProvenanceRef: entry.docxProvenanceRef || entry.docx_provenance_ref || normalized.docxProvenanceRef || null,
    docxWorkspacePath: entry.docxWorkspacePath || entry.workspacePath || entry.workspace_path || normalized.docxWorkspacePath || null,
    docxWorkspaceRelpath: entry.docxWorkspaceRelpath || entry.workspaceRelpath || entry.workspace_relpath || normalized.docxWorkspaceRelpath || null,
    docxWorkspaceWarning: entry.docxWorkspaceWarning || entry.workspaceWarning || entry.workspace_warning || normalized.docxWorkspaceWarning || null,
    docxQualityStatus: entry.docxQualityStatus || entry.docx_quality_status || normalized.docxQualityStatus || null,
    docxQualityScore: entry.docxQualityScore ?? entry.docx_quality_score ?? normalized.docxQualityScore ?? null,
    docxQualityCounts: entry.docxQualityCounts || entry.docx_quality_counts || normalized.docxQualityCounts || null,
    docxRenderStatus: entry.docxRenderStatus || entry.docx_render_status || normalized.docxRenderStatus || null,
    docxRenderPageCount: entry.docxRenderPageCount ?? entry.docx_render_page_count ?? normalized.docxRenderPageCount ?? null,
    docxRenderCachedPages: entry.docxRenderCachedPages ?? entry.docx_render_cached_pages ?? normalized.docxRenderCachedPages ?? null,
    docxRenderRenderer: entry.docxRenderRenderer || entry.docx_render_renderer || normalized.docxRenderRenderer || null,
    downloadUrl: normalized.downloadUrl || entry.downloadUrl || entry.download_url || entry.ref || null,
    docxUpdatedAt: normalizeTimestamp(
      entry.docxUpdatedAt ?? entry.docx_updated_at ?? entry.updatedAt ?? entry.updated_at,
      normalized.docxUpdatedAt,
    ),
  };
};

export const getDocxHistoryRecordKey = (entry = null) => {
  const normalized = normalizeDocxHistoryEntry(entry);
  if (!normalized?.id) {
    return null;
  }
  return [
    normalized.id,
    normalized.docxUpdatedAt ?? normalized.createdAt ?? '',
    normalized.docxFileName || '',
    normalized.docxSizeBytes ?? '',
    normalized.docxProvenanceRef || '',
    normalized.docxProvenanceAvailable ? '1' : '0',
    normalized.docxQualityStatus || '',
    normalized.docxQualityScore ?? '',
    normalized.docxRenderStatus || '',
    normalized.docxRenderCachedPages ?? '',
    normalized.docxRenderPageCount ?? '',
    normalized.downloadUrl || '',
  ].join('|');
};

export const isDocxHistoryEntryEmpty = (entry = null) => normalizeBoolean(entry?.docxIsEmpty ?? entry?.docx_is_empty);

export const filterDocxHistoryEntries = (entries = [], sourcePath = null) => {
  const normalizedSourcePath = normalizeComparablePath(sourcePath);
  const list = Array.isArray(entries) ? entries : [];
  if (!normalizedSourcePath) {
    return [];
  }
  return list
    .map((entry) => normalizeDocxHistoryEntry(entry))
    .filter((entry) => entry && normalizeComparablePath(entry.sourcePath) === normalizedSourcePath);
};

export const loadDocxHistoryEntries = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeDocxHistoryEntry(entry))
      .filter(Boolean)
      .reduce((current, entry) => upsertDocxHistoryEntry(current, entry), [])
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
};

export const saveDocxHistoryEntries = (entries = []) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeDocxHistoryEntry(entry))
      .filter(Boolean)
      .reduce((current, entry) => upsertDocxHistoryEntry(current, entry), [])
      .slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(normalizedEntries),
    );
  } catch {
    // ignore local history write failures
  }
};
