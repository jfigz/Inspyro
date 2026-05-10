import React, { useMemo, useState } from 'react';
import {
  IconChevronRight,
  IconCode,
  IconDocx,
  IconFolderOpen,
  IconMcp,
  IconQuality,
  IconTemplate,
} from './Icons';
import './AgentWorkspaceHome.css';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-CL', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const LANE_ORDER = ['understand', 'run', 'deliver'];

const LANE_CONFIG = {
  understand: {
    title: 'Entender',
    kicker: 'Notebooks y contexto',
    tone: 'accent',
    icon: IconCode,
  },
  run: {
    title: 'Ejecutar',
    kicker: 'Runtimes y agentes',
    tone: 'warn',
    icon: IconMcp,
  },
  deliver: {
    title: 'Entregar',
    kicker: 'DOCX y formato',
    tone: 'good',
    icon: IconDocx,
  },
};

const CARD_CONFIG = {
  notebooks: {
    title: 'Notebooks',
    eyebrow: 'Entender',
    tone: 'accent',
    lane: 'understand',
    icon: IconCode,
  },
  mcpClients: {
    title: 'Clientes MCP',
    eyebrow: 'Ejecutar',
    tone: 'warn',
    lane: 'run',
    icon: IconMcp,
  },
  docx: {
    title: 'DOCX',
    eyebrow: 'Entregar',
    tone: 'good',
    lane: 'deliver',
    icon: IconDocx,
  },
  templates: {
    title: 'Plantillas',
    eyebrow: 'Formato',
    tone: 'neutral',
    lane: 'deliver',
    icon: IconTemplate,
  },
};

const CARD_ORDER = ['notebooks', 'mcpClients', 'docx', 'templates'];

const SERVICE_STATES = {
  running: {
    label: 'Agentes listos',
    shortLabel: 'En linea',
    tone: 'good',
    summary: 'El servicio local esta listo para ejecutar trabajo.',
  },
  starting: {
    label: 'Agentes iniciando',
    shortLabel: 'Iniciando',
    tone: 'accent',
    summary: 'El servicio esta arrancando y todavia no queda estable.',
  },
  stopped: {
    label: 'Agentes detenidos',
    shortLabel: 'Detenido',
    tone: 'muted',
    summary: 'El servicio local esta apagado.',
  },
  error: {
    label: 'Agentes con atencion',
    shortLabel: 'Atencion',
    tone: 'warn',
    summary: 'El servicio reporto un problema y conviene revisarlo.',
  },
  unknown: {
    label: 'Estado no disponible',
    shortLabel: 'Sin estado',
    tone: 'neutral',
    summary: 'Todavia no hay un estado util del servicio.',
  },
};

const TEMPLATE_STATUS_LABELS = {
  active: 'Activa',
  attached: 'Adjunta',
  configured: 'Configurada',
  loaded: 'Cargada',
  missing: 'Falta',
  ready: 'Lista',
};

const normalizeList = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getBasename = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
};

const isNotebookPath = (value) => (
  typeof value === 'string'
  && value.trim().toLowerCase().endsWith('.ipynb')
);

const isNotebook = (file = {}) => isNotebookPath(file?.path);

const dedupeFiles = (files = []) => {
  const seen = new Set();
  const next = [];

  files.forEach((file) => {
    if (!file) {
      return;
    }
    const key = file.path || file.name || JSON.stringify(file);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    next.push(file);
  });

  return next;
};

const formatWorkspaceName = (workspacePath, workspaceName) => {
  if (typeof workspaceName === 'string' && workspaceName.trim()) {
    return workspaceName.trim();
  }
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    return 'Espacio de trabajo';
  }
  return getBasename(workspacePath) || 'Espacio de trabajo';
};

const formatPath = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return 'Todavia no hay una ruta disponible';
  }
  return value;
};

const getTimestampMs = (value) => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const formatTimestamp = (value) => {
  const timestamp = getTimestampMs(value);
  if (!timestamp) {
    return 'Hace poco';
  }
  return DATE_FORMATTER.format(new Date(timestamp));
};

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = bytes;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const digits = current >= 10 || unitIndex === 0 ? 0 : 1;
  return `${current.toFixed(digits)} ${units[unitIndex]}`;
};

const formatUptime = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Sesion reciente';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const getFileLabel = (file = {}) => {
  if (typeof file?.name === 'string' && file.name.trim()) {
    return file.name.trim();
  }
  if (typeof file?.path === 'string' && file.path.trim()) {
    return getBasename(file.path);
  }
  return 'Archivo sin nombre';
};

const getTemplateName = (templateInfo = null) => {
  if (typeof templateInfo?.name === 'string' && templateInfo.name.trim()) {
    return templateInfo.name.trim();
  }
  if (typeof templateInfo?.title === 'string' && templateInfo.title.trim()) {
    return templateInfo.title.trim();
  }
  return 'Sin plantilla cargada';
};

const getTemplateStatus = (templateInfo = null) => {
  if (typeof templateInfo?.status === 'string' && templateInfo.status.trim()) {
    const status = templateInfo.status.trim();
    return TEMPLATE_STATUS_LABELS[status.toLowerCase()] || status;
  }
  return templateInfo ? 'Configurada' : 'Falta';
};

const getArtifactTimestamp = (entry = {}) => (
  entry?.docxUpdatedAt
  || entry?.docx_updated_at
  || entry?.updatedAt
  || entry?.updated_at
  || entry?.createdAt
  || entry?.created_at
  || null
);

const getArtifactLabel = (entry = {}) => {
  if (typeof entry?.docxFileName === 'string' && entry.docxFileName.trim()) {
    return entry.docxFileName.trim();
  }
  if (typeof entry?.docx_file_name === 'string' && entry.docx_file_name.trim()) {
    return entry.docx_file_name.trim();
  }
  if (typeof entry?.pdfFileName === 'string' && entry.pdfFileName.trim()) {
    return entry.pdfFileName.trim();
  }
  if (typeof entry?.pdf_file_name === 'string' && entry.pdf_file_name.trim()) {
    return entry.pdf_file_name.trim();
  }
  return 'Artefacto sin nombre';
};

const hasDocxArtifact = (entry = {}) => Boolean(
  entry?.docxFileName
  || entry?.docx_file_name
  || entry?.docxFileToken
  || entry?.docx_file_token
  || entry?.downloadUrl
  || entry?.download_url
  || entry?.ref
  || entry?.docxUpdatedAt
  || entry?.docx_updated_at
);

const hasPdfArtifact = (entry = {}) => Boolean(
  entry?.pdfFileName
  || entry?.pdf_file_name
  || entry?.pdfRefUrl
  || entry?.pdf_ref
  || entry?.pdfBase64
  || entry?.pdf_file_b64
  || entry?.pdfHash
  || entry?.pdf_hash
);

const getArtifactKind = (entry = {}) => {
  const hasDocx = hasDocxArtifact(entry);
  const hasPdf = hasPdfArtifact(entry);

  if (hasDocx && hasPdf) {
    return 'DOCX + PDF';
  }
  if (hasPdf) {
    return 'PDF';
  }
  return 'DOCX';
};

const getArtifactSourcePath = (entry = {}) => (
  entry?.sourcePath
  || entry?.source_path
  || entry?.docxSourcePath
  || entry?.docx_source_path
  || entry?.notebook_path
  || null
);

const getDocxQualityCounts = (entry = {}) => {
  const counts = entry?.docxQualityCounts || entry?.docx_quality_counts || {};
  return {
    error: Number(counts.error || counts.errors || 0) || 0,
    warning: Number(counts.warning || counts.warnings || 0) || 0,
    info: Number(counts.info || counts.infos || 0) || 0,
  };
};

const getDocxQualityStatus = (entry = {}) => {
  const rawStatus = String(entry?.docxQualityStatus || entry?.docx_quality_status || '').trim().toLowerCase();
  if (rawStatus) {
    if (['ok', 'pass', 'passed', 'success'].includes(rawStatus)) return 'ok';
    if (['warning', 'warnings', 'warn'].includes(rawStatus)) return 'warning';
    if (['error', 'failed', 'fail', 'review', 'revisar'].includes(rawStatus)) return 'error';
    if (['missing', 'pending', 'unknown', 'sin analizar'].includes(rawStatus)) return 'missing';
  }
  const counts = getDocxQualityCounts(entry);
  if (counts.error > 0) return 'error';
  if (counts.warning > 0) return 'warning';
  return rawStatus ? 'ok' : 'missing';
};

const getDocxQualityTone = (status) => {
  if (status === 'ok') return 'good';
  if (status === 'warning') return 'warn';
  if (status === 'error') return 'danger';
  return 'muted';
};

const getDocxQualityLabel = (entry = {}) => {
  const status = getDocxQualityStatus(entry);
  const counts = getDocxQualityCounts(entry);
  if (status === 'ok') return 'Calidad OK';
  if (status === 'warning') return counts.warning > 0 ? `${counts.warning} avisos` : 'Avisos';
  if (status === 'error') return 'Revisar calidad';
  return 'Sin analizar';
};

const getDocxRenderStatus = (entry = {}) => {
  const rawStatus = String(entry?.docxRenderStatus || entry?.docx_render_status || '').trim().toLowerCase();
  if (['complete', 'completed'].includes(rawStatus)) return 'complete';
  if (['partial'].includes(rawStatus)) return 'partial';
  if (['ready'].includes(rawStatus)) return 'ready';
  if (['error', 'failed', 'fail'].includes(rawStatus)) return 'error';
  return 'missing';
};

const getDocxRenderTone = (status) => {
  if (status === 'complete') return 'good';
  if (status === 'partial' || status === 'ready') return 'warn';
  if (status === 'error') return 'danger';
  return 'muted';
};

const getDocxRenderLabel = (entry = {}) => {
  const status = getDocxRenderStatus(entry);
  const cached = Number(entry?.docxRenderCachedPages ?? entry?.docx_render_cached_pages ?? 0) || 0;
  const pageCount = Number(entry?.docxRenderPageCount ?? entry?.docx_render_page_count ?? 0) || 0;
  if (status === 'complete') return 'Visual listo';
  if (status === 'partial') return pageCount ? `${cached}/${pageCount} visual` : 'Visual parcial';
  if (status === 'ready') return 'PDF visual listo';
  if (status === 'error') return 'Visual error';
  return 'Sin render';
};

const getServiceState = (mcpStatus = null) => {
  const status = typeof mcpStatus?.status === 'string' ? mcpStatus.status.toLowerCase() : 'unknown';
  return {
    status,
    ...(SERVICE_STATES[status] || SERVICE_STATES.unknown),
  };
};

const createTarget = (kind, payload = null) => (
  kind ? { kind, payload } : null
);

const createResourceTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  const payload = {
    path,
    name: getBasename(path),
    ...extra,
  };
  return createTarget(isNotebookPath(path) ? 'notebook' : 'file', payload);
};

const createBadge = (label, tone = 'neutral') => (
  typeof label === 'string' && label.trim()
    ? { label: label.trim(), tone }
    : null
);

const createDetail = (label, value) => (
  typeof value === 'string' && value.trim()
    ? { label, value: value.trim() }
    : null
);

const createAction = (label, target, tone = 'secondary', disabled = false) => (
  label && target
    ? {
      label,
      target,
      tone,
      disabled: Boolean(disabled),
    }
    : null
);

const normalizeBadge = (badge) => {
  if (!badge) {
    return null;
  }
  if (typeof badge === 'string') {
    return createBadge(badge);
  }
  return createBadge(badge.label, badge.tone || 'neutral');
};

const normalizeBadges = (badges) => normalizeList(badges).map(normalizeBadge).filter(Boolean);

const normalizeTarget = (target) => {
  if (!target || typeof target !== 'object') {
    return null;
  }
  if (typeof target.kind !== 'string' || !target.kind.trim()) {
    return null;
  }
  return {
    kind: target.kind.trim(),
    payload: target.payload ?? null,
  };
};

const normalizeAction = (action) => {
  if (!action || typeof action !== 'object') {
    return null;
  }
  const target = normalizeTarget(action.target);
  if (!target || typeof action.label !== 'string' || !action.label.trim()) {
    return null;
  }
  return {
    label: action.label.trim(),
    target,
    tone: action.tone || 'secondary',
    disabled: Boolean(action.disabled),
  };
};

const normalizeActions = (actions) => normalizeList(actions).map(normalizeAction).filter(Boolean);

const normalizeDetail = (detail) => {
  if (!detail) {
    return null;
  }
  if (typeof detail === 'string') {
    return createDetail('Detalle', detail);
  }
  if (typeof detail === 'object') {
    return createDetail(detail.label || 'Detalle', detail.value);
  }
  return null;
};

const normalizeDetails = (details) => normalizeList(details).map(normalizeDetail).filter(Boolean);

const normalizeProgress = (progress) => {
  if (progress === null || progress === undefined) {
    return null;
  }
  if (typeof progress === 'number') {
    const value = clamp(progress, 0, 100);
    return {
      value,
      max: 100,
      percent: Math.round(value),
      label: `${Math.round(value)}%`,
      tone: 'accent',
    };
  }

  if (typeof progress !== 'object') {
    return null;
  }

  const max = Number(progress.max ?? 100);
  const rawValue = Number(progress.value ?? progress.current ?? progress.percent);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(rawValue)) {
    return null;
  }

  const value = clamp(rawValue, 0, max);
  const percent = Math.round((value / max) * 100);

  return {
    value,
    max,
    percent,
    label: typeof progress.label === 'string' && progress.label.trim() ? progress.label.trim() : `${percent}%`,
    tone: progress.tone || 'accent',
  };
};

const normalizeEmptyState = (emptyState) => {
  if (!emptyState || typeof emptyState !== 'object') {
    return null;
  }

  return {
    title: typeof emptyState.title === 'string' ? emptyState.title.trim() : '',
    description: typeof emptyState.description === 'string' ? emptyState.description.trim() : '',
    actions: normalizeActions(emptyState.actions),
  };
};

const normalizeItem = (item, fallbackId) => {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Elemento ${fallbackId}`;
  return {
    id: item.id || fallbackId,
    title,
    subtitle: typeof item.subtitle === 'string' ? item.subtitle.trim() : '',
    summary: typeof item.summary === 'string' && item.summary.trim()
      ? item.summary.trim()
      : (typeof item.subtitle === 'string' ? item.subtitle.trim() : ''),
    meta: typeof item.meta === 'string' ? item.meta.trim() : '',
    tone: item.tone || item.badges?.[0]?.tone || 'neutral',
    badges: normalizeBadges(item.badges),
    progress: normalizeProgress(item.progress),
    details: normalizeDetails(item.details),
    actions: normalizeActions(item.actions),
    target: normalizeTarget(item.target || item.primaryTarget),
    source: item.source || item.kind || null,
  };
};

const normalizeCard = (cardId, rawCard) => {
  const config = CARD_CONFIG[cardId];
  const card = rawCard && typeof rawCard === 'object' ? rawCard : {};

  return {
    id: cardId,
    title: typeof card.title === 'string' && card.title.trim() ? card.title.trim() : config.title,
    eyebrow: typeof card.eyebrow === 'string' && card.eyebrow.trim() ? card.eyebrow.trim() : config.eyebrow,
    tone: card.tone || config.tone,
    lane: config.lane,
    icon: config.icon,
    summary: typeof card.summary === 'string' ? card.summary.trim() : '',
    badge: normalizeBadge(card.badge),
    meta: normalizeList(card.meta).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()),
    rows: normalizeList(card.rows).map((row, index) => normalizeItem(row, `${cardId}-row-${index}`)).filter(Boolean),
    actions: normalizeActions(card.actions),
    primaryTarget: normalizeTarget(card.primaryTarget),
    emptyState: normalizeEmptyState(card.emptyState),
  };
};

const createLaneFromCards = (laneId, cards) => {
  const config = LANE_CONFIG[laneId];
  const laneCards = cards.filter((card) => card.lane === laneId);
  const rows = laneCards.flatMap((card) => (
    card.rows.map((row) => ({
      ...row,
      source: card.id,
      badges: [
        createBadge(card.title, card.tone),
        ...row.badges,
      ].filter(Boolean),
    }))
  ));
  const primaryCard = laneCards.find((card) => card.primaryTarget) || laneCards[0] || null;
  const primaryAction = primaryCard
    ? normalizeAction(primaryCard.actions[0]) || createAction(
      primaryCard.primaryTarget?.kind === 'agents' ? 'Abrir agentes' : `Abrir ${primaryCard.title}`,
      primaryCard.primaryTarget,
      'primary',
    )
    : null;

  return {
    id: laneId,
    title: config.title,
    kicker: config.kicker,
    tone: config.tone,
    icon: config.icon,
    badge: laneCards.map((card) => card.badge).find(Boolean) || null,
    summary: laneCards.map((card) => card.summary).filter(Boolean).join(' · '),
    primaryAction,
    items: rows,
    emptyState: laneCards.map((card) => card.emptyState).find(Boolean) || null,
  };
};

const itemNeedsAttention = (item) => {
  if (!item) {
    return false;
  }
  if (item.progress) {
    return true;
  }
  return item.badges.some((badge) => ['warn', 'danger'].includes(badge.tone));
};

const deriveOperationalFromCards = ({ cards, headerActions }) => {
  const lanes = Object.fromEntries(LANE_ORDER.map((laneId) => [laneId, createLaneFromCards(laneId, cards)]));
  const allItems = LANE_ORDER.flatMap((laneId) => lanes[laneId].items);
  const attentionItems = allItems.filter(itemNeedsAttention).slice(0, 6);
  const fallbackTarget = lanes.deliver.items[0]?.target || lanes.understand.items[0]?.target || normalizeActions(headerActions)[0]?.target || null;
  const fallbackAction = normalizeActions(headerActions)[0]
    || createAction('Ir a archivos', fallbackTarget, 'primary');
  const stableItem = {
    id: 'attention-stable',
    title: 'Sin atenciones criticas',
    summary: 'No hay ejecuciones activas ni avisos relevantes en este momento.',
    meta: 'Workspace estable',
    tone: 'good',
    badges: [createBadge('Estable', 'good')],
    target: fallbackTarget,
    details: [
      createDetail('Estado', 'Sin ejecuciones activas'),
    ].filter(Boolean),
    actions: [
      fallbackAction,
    ].filter(Boolean),
  };

  return {
    quickActions: normalizeActions(headerActions),
    attention: {
      title: 'Atencion',
      summary: attentionItems.length
        ? 'Lo que requiere seguimiento aparece primero.'
        : 'No hay bloqueos visibles; puedes retomar trabajo, agentes o entregables.',
      primaryAction: attentionItems[0]?.actions?.[0] || fallbackAction,
      items: attentionItems.length ? attentionItems : [stableItem],
    },
    lanes,
  };
};

const normalizeLane = (laneId, lane) => {
  const config = LANE_CONFIG[laneId] || LANE_CONFIG.understand;
  const raw = lane && typeof lane === 'object' ? lane : {};
  return {
    id: raw.id || laneId,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : config.title,
    kicker: typeof raw.kicker === 'string' && raw.kicker.trim() ? raw.kicker.trim() : config.kicker,
    tone: raw.tone || config.tone,
    icon: config.icon,
    badge: normalizeBadge(raw.badge),
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    primaryAction: normalizeAction(raw.primaryAction),
    items: normalizeList(raw.items).map((item, index) => normalizeItem(item, `${laneId}-item-${index}`)).filter(Boolean),
    emptyState: normalizeEmptyState(raw.emptyState),
  };
};

const normalizeOperational = (operational, fallback) => {
  if (!operational || typeof operational !== 'object') {
    return deriveOperationalFromCards(fallback);
  }

  const rawLanes = operational.lanes || {};
  const lanes = {};
  LANE_ORDER.forEach((laneId) => {
    const lane = Array.isArray(rawLanes)
      ? rawLanes.find((item) => item?.id === laneId)
      : rawLanes[laneId];
    lanes[laneId] = normalizeLane(laneId, lane);
  });

  const attentionRaw = operational.attention || {};
  const attentionItems = normalizeList(attentionRaw.items || operational.attentionItems)
    .map((item, index) => normalizeItem(item, `attention-${index}`))
    .filter(Boolean);
  const fallbackAttention = deriveOperationalFromCards(fallback).attention;

  return {
    quickActions: normalizeActions(operational.quickActions || fallback.headerActions),
    attention: {
      title: typeof attentionRaw.title === 'string' && attentionRaw.title.trim() ? attentionRaw.title.trim() : 'Atencion',
      summary: typeof attentionRaw.summary === 'string' ? attentionRaw.summary.trim() : '',
      primaryAction: normalizeAction(attentionRaw.primaryAction || operational.primaryAction) || fallbackAttention.primaryAction,
      items: attentionItems.length ? attentionItems : fallbackAttention.items,
    },
    lanes,
  };
};

const normalizeWorkspaceData = (workspaceData = {}) => {
  const cards = CARD_ORDER.map((cardId) => normalizeCard(cardId, workspaceData?.cards?.[cardId]));
  const headerActions = normalizeActions(workspaceData.headerActions);
  const fallback = { cards, headerActions };
  const operational = normalizeOperational(workspaceData.operational, fallback);

  return {
    workspaceName: formatWorkspaceName(workspaceData.workspacePath, workspaceData.workspaceName),
    workspacePath: typeof workspaceData.workspacePath === 'string' ? workspaceData.workspacePath : '',
    subtitle: typeof workspaceData.subtitle === 'string' && workspaceData.subtitle.trim()
      ? workspaceData.subtitle.trim()
      : 'Centro operativo del workspace: atencion, ejecucion y entrega en una sola vista.',
    meta: normalizeList(workspaceData.meta).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()),
    headerActions,
    operational,
  };
};

const buildLegacyWorkspaceData = (props) => {
  const workspaceName = formatWorkspaceName(props.workspacePath, props.workspaceName);
  const workspacePath = props.workspacePath || '';
  const normalizedOpenFiles = dedupeFiles([props.activeFile, ...normalizeList(props.openFiles)].filter(Boolean));
  const notebookFiles = normalizedOpenFiles.filter(isNotebook);
  const activeNotebook = isNotebook(props.activeFile) ? props.activeFile : notebookFiles[0] || null;
  const serviceState = getServiceState(props.mcpStatus);
  const sortedArtifacts = normalizeList(props.docxHistoryEntries)
    .slice()
    .sort((left, right) => getTimestampMs(getArtifactTimestamp(right)) - getTimestampMs(getArtifactTimestamp(left)));
  const latestArtifact = sortedArtifacts[0] || null;
  const latestArtifactSourcePath = latestArtifact ? getArtifactSourcePath(latestArtifact) : null;
  const latestQualityStatus = latestArtifact ? getDocxQualityStatus(latestArtifact) : 'missing';
  const latestQualityLabel = latestArtifact ? getDocxQualityLabel(latestArtifact) : 'Sin analizar';
  const latestQualityTone = getDocxQualityTone(latestQualityStatus);
  const latestRenderLabel = latestArtifact ? getDocxRenderLabel(latestArtifact) : 'Sin render';
  const primaryNotebookTarget = activeNotebook ? createResourceTarget(activeNotebook.path || activeNotebook.name, activeNotebook) : null;
  const latestArtifactTarget = latestArtifact ? createTarget('document', latestArtifact) : null;
  const latestQualityTarget = latestArtifact
    ? createTarget('document', { ...latestArtifact, focus: 'quality', focusQuality: true })
    : null;
  const mcpServiceActions = [
    createAction('Iniciar agentes', createTarget('startAgents'), 'primary', serviceState.status === 'running' || serviceState.status === 'starting'),
    createAction('Detener agentes', createTarget('stopAgents'), 'secondary', serviceState.status !== 'running'),
    createAction('Reiniciar agentes', createTarget('restartAgents'), 'ghost', serviceState.status === 'starting'),
    createAction(props.mirrorEnabled ? 'Desactivar espejo' : 'Activar espejo', createTarget('toggleMirror'), 'ghost', props.mirrorToggleDisabled),
  ].filter(Boolean);

  return normalizeWorkspaceData({
    workspaceName,
    workspacePath,
    subtitle: 'Centro operativo del workspace: atencion, ejecucion y entrega en una sola vista.',
    meta: [
      notebookFiles.length ? `${notebookFiles.length} notebook${notebookFiles.length === 1 ? '' : 's'}` : 'Sin notebooks',
      sortedArtifacts.length ? `${sortedArtifacts.length} DOCX recientes` : 'Sin DOCX',
      props.mirrorEnabled ? 'Espejo activo' : 'Espejo inactivo',
    ],
    headerActions: [
      createAction('Ir a archivos', createTarget('fileSurface'), 'primary'),
      createAction('Abrir agentes', createTarget('agents'), 'ghost'),
    ],
    cards: {
      notebooks: {
        summary: notebookFiles.length
          ? `${notebookFiles.length} notebook${notebookFiles.length === 1 ? '' : 's'} listos para retomar.`
          : 'Todavia no hay notebooks abiertos en esta superficie.',
        badge: createBadge(notebookFiles.length ? `${notebookFiles.length} notebooks` : 'Sin notebooks', notebookFiles.length ? 'accent' : 'muted'),
        primaryTarget: primaryNotebookTarget || createTarget('fileSurface'),
        rows: notebookFiles.map((file, index) => ({
          id: file.path || `notebook-${index}`,
          title: getFileLabel(file),
          subtitle: file.path || '',
          meta: activeNotebook?.path === file.path ? 'Activo' : 'Disponible',
          badges: [
            createBadge(activeNotebook?.path === file.path ? 'Activo' : 'Listo', activeNotebook?.path === file.path ? 'accent' : 'neutral'),
          ].filter(Boolean),
          target: createResourceTarget(file.path || file.name, file),
          details: [
            createDetail('Ruta', file.path),
            latestArtifactSourcePath === file.path ? createDetail('Ultimo DOCX', getArtifactLabel(latestArtifact)) : null,
          ].filter(Boolean),
          actions: [
            createAction('Abrir notebook', createResourceTarget(file.path || file.name, file), 'primary'),
            latestArtifactSourcePath === file.path ? createAction('Abrir DOCX', latestArtifactTarget, 'secondary') : null,
          ].filter(Boolean),
        })),
        emptyState: {
          title: 'No hay notebooks visibles',
          description: 'Abre un notebook o vuelve a la superficie de archivos para empezar.',
          actions: [
            createAction('Ir a archivos', createTarget('fileSurface'), 'primary'),
          ],
        },
      },
      docx: {
        summary: latestArtifact
          ? `Ultimo entregable: ${getArtifactLabel(latestArtifact)}. ${latestQualityLabel}. ${latestRenderLabel}.`
          : 'Todavia no hay entregables listos en el historial.',
        badge: createBadge(latestArtifact ? latestQualityLabel : 'Sin DOCX', latestArtifact ? latestQualityTone : 'muted'),
        primaryTarget: latestArtifactTarget || primaryNotebookTarget || createTarget('fileSurface'),
        rows: sortedArtifacts.slice(0, 8).map((entry, index) => ({
          id: entry.id || entry.artifact_id || `docx-${index}`,
          title: getArtifactLabel(entry),
          subtitle: getArtifactSourcePath(entry) ? getBasename(getArtifactSourcePath(entry)) : 'Documento sin origen',
          meta: formatTimestamp(getArtifactTimestamp(entry)),
          badges: [
            createBadge(getArtifactKind(entry), 'good'),
            createBadge(getDocxQualityLabel(entry), getDocxQualityTone(getDocxQualityStatus(entry))),
            createBadge(getDocxRenderLabel(entry), getDocxRenderTone(getDocxRenderStatus(entry))),
          ].filter(Boolean),
          target: createTarget('document', entry),
          details: [
            createDetail('Origen', getArtifactSourcePath(entry)),
            createDetail('Tamano', formatBytes(entry.docxSizeBytes || entry.docx_size_bytes || entry.size_bytes)),
            createDetail('Calidad', getDocxQualityLabel(entry)),
            createDetail('Visual', getDocxRenderLabel(entry)),
          ].filter(Boolean),
          actions: [
            createAction('Abrir DOCX', createTarget('document', entry), 'primary'),
            createAction('Preparar entrega', createTarget('document', { ...entry, focus: 'quality', focusQuality: true }), 'secondary'),
          ],
        })),
        actions: [
          latestArtifact ? createAction('Abrir ultimo DOCX', latestArtifactTarget, 'primary') : null,
          latestArtifact ? createAction('Preparar entrega', latestQualityTarget, 'secondary') : null,
        ].filter(Boolean),
        emptyState: {
          title: 'No hay documentos generados',
          description: 'Cuando un notebook publique un DOCX o PDF, apareceran aqui.',
          actions: [
            primaryNotebookTarget ? createAction('Abrir notebook', primaryNotebookTarget, 'secondary') : null,
            createAction('Abrir agentes', createTarget('agents'), 'ghost'),
          ].filter(Boolean),
        },
      },
      mcpClients: {
        summary: props.agentExecutionState?.summary || serviceState.summary,
        badge: createBadge(serviceState.shortLabel, serviceState.tone),
        primaryTarget: createTarget('agents'),
        rows: [{
          id: 'mcp-service',
          title: serviceState.label,
          subtitle: props.mcpStatus?.port ? `Puerto ${props.mcpStatus.port}` : 'Servicio local de agentes',
          meta: props.mirrorEnabled ? 'Espejo activo' : 'Espejo inactivo',
          badges: [
            createBadge(serviceState.shortLabel, serviceState.tone),
            createBadge(props.mirrorEnabled ? 'Espejo activo' : 'Espejo inactivo', props.mirrorEnabled ? 'accent' : 'muted'),
          ].filter(Boolean),
          target: createTarget('agents'),
          details: [
            createDetail('Estado', serviceState.label),
            createDetail('PID', props.mcpStatus?.pid),
            createDetail('Uptime', formatUptime(props.mcpStatus?.uptime_seconds)),
            createDetail('Mirror', props.mirrorEnabled ? 'Activo' : 'Inactivo'),
            createDetail('Aviso', props.mirrorDisabledReason),
          ].filter(Boolean),
          actions: mcpServiceActions,
        }],
      },
      templates: {
        summary: props.templateInfo
          ? `${getTemplateName(props.templateInfo)} esta lista para la siguiente salida.`
          : 'Todavia no hay una plantilla activa para este workspace.',
        badge: createBadge(getTemplateStatus(props.templateInfo), props.templateInfo ? 'good' : 'muted'),
        primaryTarget: props.templateInfo ? createTarget('template', props.templateInfo) : createTarget('template'),
        rows: props.templateInfo ? [{
          id: 'template-current',
          title: getTemplateName(props.templateInfo),
          subtitle: 'Plantilla activa del workspace',
          meta: getTemplateStatus(props.templateInfo),
          badges: [
            createBadge(getTemplateStatus(props.templateInfo), 'good'),
          ],
          target: createTarget('template', props.templateInfo),
          details: [
            createDetail('Plantilla', getTemplateName(props.templateInfo)),
            props.templateInfo?.path ? createDetail('Ruta', formatPath(props.templateInfo.path)) : null,
            latestArtifact ? createDetail('Ultimo entregable', getArtifactLabel(latestArtifact)) : null,
          ].filter(Boolean),
          actions: [
            createAction('Abrir plantilla', createTarget('template', props.templateInfo), 'primary'),
            latestArtifact ? createAction('Abrir ultimo DOCX', latestArtifactTarget, 'secondary') : null,
          ].filter(Boolean),
        }] : [],
        emptyState: {
          title: 'No hay plantilla activa',
          description: 'Carga o abre una plantilla para preparar la salida DOCX.',
          actions: [
            createAction('Abrir plantilla', createTarget('template', props.templateInfo), 'primary'),
          ],
        },
      },
    },
  });
};

const getHandlerForTarget = (target, handlers) => {
  if (!target) {
    return null;
  }

  const handlerMap = {
    file: handlers.onOpenFile,
    notebook: handlers.onOpenNotebook,
    document: handlers.onOpenDocument,
    template: handlers.onOpenTemplate,
    agents: handlers.onOpenAgentsPanel,
    fileSurface: handlers.onGoToFileSurface,
    startAgents: handlers.onStartAgents,
    stopAgents: handlers.onStopAgents,
    restartAgents: handlers.onRestartAgents,
    toggleMirror: handlers.onToggleMirror,
  };

  const handler = handlerMap[target.kind];
  return typeof handler === 'function' ? handler : null;
};

const canInvokeTarget = (target, handlers) => Boolean(getHandlerForTarget(target, handlers));

const invokeTarget = (target, handlers) => {
  const handler = getHandlerForTarget(target, handlers);
  if (!handler) {
    return;
  }

  if (target.payload === null || target.payload === undefined) {
    handler();
    return;
  }

  handler(target.payload);
};

const getItemKey = (item) => `${item?.source || 'item'}:${item?.id || item?.title || 'unknown'}`;

const renderPill = (pill, key) => {
  const normalized = normalizeBadge(pill);
  if (!normalized) {
    return null;
  }

  return (
    <span key={key || normalized.label} className={`agent-home-pill agent-home-pill--${normalized.tone}`}>
      {normalized.label}
    </span>
  );
};

function ProgressBar({ progress }) {
  if (!progress) {
    return null;
  }
  return (
    <div className={`agent-home-progress agent-home-progress--${progress.tone}`} aria-label={`Progreso ${progress.label}`}>
      <span className="agent-home-progress__track">
        <span className="agent-home-progress__value" style={{ width: `${progress.percent}%` }} />
      </span>
      <span className="agent-home-progress__label">{progress.label}</span>
    </div>
  );
}

function ActionButtons({ actions, handlers, compact = false }) {
  const normalizedActions = normalizeActions(actions);
  if (!normalizedActions.length) {
    return null;
  }

  return (
    <div className={`agent-home-action-row ${compact ? 'agent-home-action-row--compact' : ''}`}>
      {normalizedActions.map((action) => (
        <button
          key={`${action.label}-${action.target.kind}`}
          type="button"
          className={`agent-home-button agent-home-button--${action.tone}`}
          disabled={action.disabled || !canInvokeTarget(action.target, handlers)}
          onClick={(event) => {
            event.stopPropagation();
            invokeTarget(action.target, handlers);
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ emptyState, handlers }) {
  if (!emptyState) {
    return null;
  }

  return (
    <div className="agent-home-empty-state">
      <strong>{emptyState.title}</strong>
      {emptyState.description ? <p>{emptyState.description}</p> : null}
      <ActionButtons actions={emptyState.actions} handlers={handlers} compact />
    </div>
  );
}

function ItemRow({
  item,
  icon: Icon,
  selected,
  onSelect,
  handlers,
  compact = false,
}) {
  const canOpen = canInvokeTarget(item.target, handlers);

  return (
    <article className={`agent-home-item agent-home-item--${item.tone} ${selected ? 'is-selected' : ''} ${compact ? 'agent-home-item--compact' : ''}`}>
      <button
        type="button"
        className="agent-home-item__main"
        onClick={() => {
          if (canOpen) {
            invokeTarget(item.target, handlers);
            return;
          }
          onSelect(item);
        }}
      >
        <span className="agent-home-item__icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="agent-home-item__copy">
          <span className="agent-home-item__title-row">
            <strong>{item.title}</strong>
            {item.badges.length ? (
              <span className="agent-home-item__badges">
                {item.badges.slice(0, compact ? 2 : 4).map((badge, index) => renderPill(badge, `${item.id}-${badge.label}-${index}`))}
              </span>
            ) : null}
          </span>
          {item.summary ? <span className="agent-home-item__summary">{item.summary}</span> : null}
          {item.meta ? <span className="agent-home-item__meta">{item.meta}</span> : null}
          <ProgressBar progress={item.progress} />
        </span>
      </button>
      <div className="agent-home-item__tools">
        <ActionButtons actions={item.actions.slice(0, compact ? 1 : 2)} handlers={handlers} compact />
        <button
          type="button"
          className="agent-home-icon-button"
          aria-label={`Ver detalle de ${item.title}`}
          title={`Ver detalle de ${item.title}`}
          onClick={() => onSelect(item)}
        >
          <IconChevronRight />
        </button>
      </div>
    </article>
  );
}

function AttentionSection({
  attention,
  selectedKey,
  onSelect,
  handlers,
}) {
  const items = normalizeList(attention.items);
  return (
    <section className="agent-home-attention" data-testid="agent-home-attention" aria-label="Atencion del workspace">
      <div className="agent-home-attention__header">
        <span className="agent-home-section-kicker">Atencion</span>
        <div>
          <h2>{attention.title || 'Atencion'}</h2>
          {attention.summary ? <p>{attention.summary}</p> : null}
        </div>
        <ActionButtons actions={[attention.primaryAction]} handlers={handlers} compact />
      </div>
      <div className="agent-home-attention__items">
        {items.map((item) => (
          <ItemRow
            key={getItemKey(item)}
            item={item}
            icon={IconQuality}
            selected={selectedKey === getItemKey(item)}
            onSelect={onSelect}
            handlers={handlers}
            compact
          />
        ))}
      </div>
    </section>
  );
}

function LaneColumn({
  lane,
  selectedKey,
  onSelect,
  handlers,
}) {
  const Icon = lane.icon || LANE_CONFIG[lane.id]?.icon || IconCode;
  return (
    <section className={`agent-home-lane agent-home-lane--${lane.tone}`} data-testid={`agent-home-lane-${lane.id}`}>
      <header className="agent-home-lane__header">
        <span className="agent-home-lane__icon" aria-hidden="true">
          <Icon />
        </span>
        <div className="agent-home-lane__copy">
          <span className="agent-home-section-kicker">{lane.kicker}</span>
          <h2>{lane.title}</h2>
          {lane.summary ? <p>{lane.summary}</p> : null}
          {lane.badge ? <div className="agent-home-lane__badges">{renderPill(lane.badge, `${lane.id}-badge`)}</div> : null}
        </div>
        <ActionButtons actions={[lane.primaryAction]} handlers={handlers} compact />
      </header>
      <div className="agent-home-lane__items">
        {lane.items.length ? (
          lane.items.map((item) => (
            <ItemRow
              key={getItemKey(item)}
              item={item}
              icon={Icon}
              selected={selectedKey === getItemKey(item)}
              onSelect={onSelect}
              handlers={handlers}
            />
          ))
        ) : (
          <EmptyState emptyState={lane.emptyState} handlers={handlers} />
        )}
      </div>
    </section>
  );
}

function DetailPanel({ item, handlers }) {
  if (!item) {
    return (
      <aside className="agent-home-detail-panel" aria-label="Detalle operativo">
        <span className="agent-home-section-kicker">Detalle</span>
        <h2>Selecciona un elemento</h2>
        <p>El detalle del item seleccionado aparecera aqui.</p>
      </aside>
    );
  }

  return (
    <aside className={`agent-home-detail-panel agent-home-detail-panel--${item.tone}`} aria-label="Detalle operativo">
      <span className="agent-home-section-kicker">Detalle</span>
      <h2>{item.title}</h2>
      {item.summary ? <p>{item.summary}</p> : null}
      {item.badges.length ? (
        <div className="agent-home-detail-panel__badges">
          {item.badges.map((badge, index) => renderPill(badge, `detail-${item.id}-${badge.label}-${index}`))}
        </div>
      ) : null}
      {item.details.length ? (
        <dl className="agent-home-detail-grid">
          {item.details.map((detail) => (
            <div key={`${item.id}-${detail.label}`} className="agent-home-detail-grid__item">
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="agent-home-detail-panel__empty">No hay metadata adicional para este elemento.</p>
      )}
      <ActionButtons actions={item.actions} handlers={handlers} />
    </aside>
  );
}

export default function AgentWorkspaceHome(props) {
  const data = useMemo(() => (
    props.workspaceData
      ? normalizeWorkspaceData(props.workspaceData)
      : buildLegacyWorkspaceData(props)
  ), [props]);

  const allItems = useMemo(() => ([
    ...normalizeList(data.operational.attention.items),
    ...LANE_ORDER.flatMap((laneId) => normalizeList(data.operational.lanes[laneId]?.items)),
  ]), [data]);
  const [selectedItemKey, setSelectedItemKey] = useState(null);

  const handlers = {
    onOpenFile: props.onOpenFile,
    onOpenNotebook: props.onOpenNotebook,
    onOpenDocument: props.onOpenDocument,
    onOpenTemplate: props.onOpenTemplate,
    onStartAgents: props.onStartAgents,
    onStopAgents: props.onStopAgents,
    onRestartAgents: props.onRestartAgents,
    onToggleMirror: props.onToggleMirror,
    onOpenAgentsPanel: props.onOpenAgentsPanel,
    onGoToFileSurface: props.onGoToFileSurface,
  };

  const selectedItem = allItems.find((item) => getItemKey(item) === selectedItemKey)
    || data.operational.attention.items[0]
    || allItems[0]
    || null;
  const selectedKey = selectedItem ? getItemKey(selectedItem) : null;

  const handleSelect = (item) => {
    setSelectedItemKey(getItemKey(item));
  };

  return (
    <section className="agent-workspace-home" aria-label="Inicio del espacio de trabajo de agentes">
      <header className="agent-workspace-home__header">
        <div className="agent-workspace-home__header-copy">
          <span className="agent-workspace-home__kicker">Centro operativo</span>
          <h1>{data.workspaceName}</h1>
          <p>{data.subtitle}</p>
        </div>

        <div className="agent-workspace-home__header-side">
          <div className="agent-workspace-home__meta">
            {data.workspacePath ? (
              <span className="agent-workspace-home__path" title={formatPath(data.workspacePath)}>
                <IconFolderOpen aria-hidden="true" />
                {formatPath(data.workspacePath)}
              </span>
            ) : null}
            {data.meta.map((item) => renderPill(item, `meta-${item}`))}
          </div>
          <ActionButtons actions={data.operational.quickActions.length ? data.operational.quickActions : data.headerActions} handlers={handlers} />
        </div>
      </header>

      <AttentionSection
        attention={data.operational.attention}
        selectedKey={selectedKey}
        onSelect={handleSelect}
        handlers={handlers}
      />

      <div className="agent-home-workbench">
        <div className="agent-home-lanes" data-testid="agent-home-lanes">
          {LANE_ORDER.map((laneId) => (
            <LaneColumn
              key={laneId}
              lane={data.operational.lanes[laneId]}
              selectedKey={selectedKey}
              onSelect={handleSelect}
              handlers={handlers}
            />
          ))}
        </div>
        <DetailPanel item={selectedItem} handlers={handlers} />
      </div>
    </section>
  );
}
