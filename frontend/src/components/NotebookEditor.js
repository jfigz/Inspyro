import React, { useState, useEffect, useCallback, useRef } from 'react';
import './NotebookEditor.css';
import NotebookCell from './notebook/NotebookCell';
import { deriveEngineeringVarsFromOutputs } from './notebook/deriveEngineeringVars';
import { useCellOperations } from './notebook/useCellOperations';
import { createFrontendLogger } from '../utils/frontendLogger';
import { buildDocxDownloadUrlFromPayload, buildDocxProvenancePath } from '../utils/docxArtifacts';
import {
  isDocxCell,
  isPythonNotebookCell,
  isRunnableNotebookCell,
  normalizeNotebookCellType,
} from '../utils/notebookCellTypes';


// Logger condicional para evitar console.logs en producción
const logger = createFrontendLogger('NotebookEditor');

// Presupuesto canónico por celda: 10 minutos, con una pequeña gracia para transporte/relay.
const NOTEBOOK_CELL_TIMEOUT_MS = 600000;
const EXECUTION_TIMEOUT_GRACE_MS = 5000;

// Mantiene un único presupuesto por celda para evitar cancelaciones prematuras en notebooks grandes.
const calculateExecutionTimeout = (notebookCellCount) => {
  if (!notebookCellCount || notebookCellCount <= 0) return NOTEBOOK_CELL_TIMEOUT_MS;
  return NOTEBOOK_CELL_TIMEOUT_MS;
};

const buildExecutionTimeoutMessage = (cellId, executionId = null) => {
  const suffix = executionId ? ` (${executionId})` : '';
  return `timeout esperando mensaje terminal para la celda ${cellId}${suffix}`;
};

const runtimeMetadataKeys = ['execution_duration', 'execution_duration_ms'];
const CELL_RUN_RAIL_HOLD_MS = 900;
const DOCUMENT_RAIL_SUCCESS_HOLD_MS = 1400;
const DOCUMENT_RAIL_FAILURE_HOLD_MS = 3200;
const DOCUMENT_STAGE_PERCENTS = {
  queued: 8,
  docx_export: 30,
  docx_ready: 55,
  pdf_convert: 80,
};
const DOCUMENT_STAGE_LABELS = {
  queued: 'En cola',
  docx_export: 'DOCX',
  docx_ready: 'DOCX listo',
  pdf_convert: 'PDF',
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

const createIdleCellRunProgress = () => ({
  visible: false,
  active: false,
  status: 'idle',
  mode: 'determinate',
  label: '',
  message: '',
  percent: 0,
  total: 0,
  completed: 0,
  runId: null,
  executionId: null,
});

const createIdleDocumentPipelineProgress = () => ({
  visible: false,
  active: false,
  status: 'idle',
  label: 'Generando documento',
  message: '',
  percent: 0,
  stage: null,
  executionId: null,
  indeterminate: false,
  sharedResource: null,
});

const isShellBatchRunActive = (batchRunState) => (
  ['waiting_kernel', 'queued', 'running'].includes(batchRunState?.status || '')
);

const getShellBatchCurrentCellId = (batchRunState) => (
  batchRunState?.currentCellId
  || batchRunState?.pendingCells?.[0]?.cellId
  || null
);

const buildShellBatchExecutionRail = (batchRunState) => {
  if (!isShellBatchRunActive(batchRunState)) {
    return null;
  }

  const total = Math.max(0, Number(batchRunState?.total || 0));
  const completed = total > 0
    ? Math.max(0, Math.min(total, Number(batchRunState?.executed || 0)))
    : 0;
  const waitingKernel = batchRunState?.status === 'waiting_kernel';
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const label = waitingKernel
    ? (batchRunState?.kernelRecoveryAttempts > 0 ? 'Recuperando Run All' : 'Iniciando kernel')
    : 'Ejecutando notebook';
  const message = batchRunState?.message
    || (total > 0 ? `${completed} de ${total} celdas completadas` : 'Ejecutando notebook...');

  return {
    tone: 'execution',
    label,
    message,
    percent: waitingKernel && percent <= 0 ? 4 : percent,
    indeterminate: waitingKernel,
    status: 'running',
    meta: waitingKernel
      ? (batchRunState?.kernelRecoveryAttempts > 0 ? 'Reanudando' : 'Preparando')
      : `${Math.max(0, percent)}%`,
  };
};

const deriveDocumentPercent = (stage, fallbackPercent = null) => {
  if (typeof fallbackPercent === 'number' && Number.isFinite(fallbackPercent)) {
    return Math.max(0, Math.min(100, fallbackPercent));
  }
  return DOCUMENT_STAGE_PERCENTS[stage] ?? 0;
};

const buildDocumentPipelineStatus = ({
  executionId = null,
  stage = null,
  status = 'running',
  message = '',
  percent = null,
  indeterminate = false,
  sharedResource = null,
} = {}) => {
  const normalizedSharedResource = normalizeDocumentSharedResource(sharedResource);
  return {
    scope: 'document',
    executionId,
    stage,
    status,
    message: describePdfSharedResource(normalizedSharedResource) || message,
    percent: deriveDocumentPercent(stage, percent),
    indeterminate: Boolean(indeterminate),
    sharedResource: normalizedSharedResource,
  };
};

const normalizeDocumentPipelineStatusValue = (status) => (
  String(status || '').trim().toLowerCase()
);

const isDocumentPipelineCompletedStatus = (status) => (
  ['completed', 'success', 'succeeded', 'ready', 'pdf_ready'].includes(normalizeDocumentPipelineStatusValue(status))
);

const isDocumentPipelineFailedStatus = (status) => (
  ['failed', 'error'].includes(normalizeDocumentPipelineStatusValue(status))
);

const isDocumentPipelineCancelledStatus = (status) => (
  ['cancelled', 'canceled', 'interrupted'].includes(normalizeDocumentPipelineStatusValue(status))
);

const hasCellRuntimeState = (cell = {}) => {
  if (!isPythonNotebookCell(cell)) return false;
  const outputs = Array.isArray(cell?.outputs) ? cell.outputs : [];
  if (outputs.length > 0) return true;
  if (cell?.execution_count !== null && cell?.execution_count !== undefined) return true;
  return runtimeMetadataKeys.some((key) => Object.prototype.hasOwnProperty.call(cell?.metadata || {}, key));
};

const resolveNotebookDisplayId = (content = {}) => (
  content?.transient?.display_id
  || content?.display_id
  || content?.metadata?.display_id
  || null
);

const buildRichNotebookOutput = (messageType, content = {}) => {
  const output = {
    output_type: messageType === 'notebook_display_data' ? 'display_data' : 'execute_result',
    data: content?.data || {},
    metadata: content?.metadata || {},
    execution_count: content?.execution_count,
  };
  const displayId = resolveNotebookDisplayId(content);
  if (displayId) {
    output.transient = { display_id: displayId };
  }
  return output;
};

const buildInlineNotebookErrorOutput = (message = {}) => {
  const details = message?.details || {};
  const content = message?.content || {};
  const traceback = details.traceback || content.traceback || message.traceback || [];
  return {
    output_type: 'error',
    ename: details.ename || content.ename || message.error_code || 'NotebookError',
    evalue: details.evalue || content.evalue || message.error || message.message || 'Error ejecutando celda',
    traceback: Array.isArray(traceback) ? traceback : [String(traceback || message.error || message.message || '')],
  };
};

const stripCodeCellRuntimeState = (cell = {}) => {
  if (!isPythonNotebookCell(cell)) {
    return { ...cell };
  }

  const nextMetadata = { ...(cell.metadata || {}) };
  runtimeMetadataKeys.forEach((key) => {
    delete nextMetadata[key];
  });

  return {
    ...cell,
    outputs: [],
    execution_count: null,
    metadata: nextMetadata,
  };
};

const stripNotebookRuntimeState = (rawNotebook) => {
  if (!rawNotebook || !Array.isArray(rawNotebook.cells)) {
    return rawNotebook;
  }

  return {
    ...rawNotebook,
    cells: rawNotebook.cells.map(stripCodeCellRuntimeState),
  };
};

const serializeNotebookForKernelLoad = (rawNotebook) => (
  JSON.stringify(stripNotebookRuntimeState(rawNotebook))
);

const normalizeCellMetadata = (metadata) => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {}
);

const hashStableString = (value) => {
  const source = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildStableFallbackCellId = (cellType, source, occurrence) => {
  const signature = `${cellType}|${Array.isArray(source) ? source.join('\n') : ''}|${occurrence}`;
  return `cell_${hashStableString(signature)}`;
};

const createNotebookFileTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  return {
    kind: 'file',
    path,
    ...extra,
  };
};

const createNotebookCodeTarget = ({
  filePath = null,
  cellId = null,
  cellIndex = null,
  line = null,
  column = null,
  ...extra
} = {}) => {
  if (
    !(typeof filePath === 'string' && filePath.trim())
    && !(typeof cellId === 'string' && cellId.trim())
    && !Number.isInteger(cellIndex)
  ) {
    return null;
  }
  return {
    kind: 'code',
    ...(typeof filePath === 'string' && filePath.trim() ? { filePath } : {}),
    ...(typeof cellId === 'string' && cellId.trim() ? { cellId } : {}),
    ...(Number.isInteger(cellIndex) ? { cellIndex } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isInteger(column) && column >= 0 ? { column } : {}),
    ...extra,
  };
};

const createNotebookDocumentTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  return {
    kind: 'document',
    sourcePath: path,
    sourceKind: 'notebook',
    ...extra,
  };
};

const normalizeNotebookComparablePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const normalizeKernelId = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim()
    : null
);

const NOTEBOOK_LIFECYCLE_MESSAGE_TYPES = new Set([
  'notebook_created',
  'notebook_loaded',
  'notebook_attached',
  'notebook_kernel_reset',
  'notebook_kernel_interrupted',
  'notebook_kernel_shutdown',
  'notebook_error',
]);

const NOTEBOOK_EXECUTION_SCOPED_MESSAGE_TYPES = new Set([
  'notebook_stream',
  'notebook_execute_input',
  'notebook_clear_output',
  'notebook_update_display_data',
  'notebook_display_data',
  'notebook_execute_result',
  'notebook_comm_open',
  'notebook_comm_msg',
  'notebook_comm_close',
  'notebook_cell_error',
  'notebook_cell_executed',
  'notebook_progress_update',
  'notebook_execution_cancelled',
]);

const NotebookEditor = ({
  connectionStatus,
  sendMessage,
  lastMessage,
  preferShellMessageRelay = false,
  onVisualizationData,
  initialNotebook = null,
  initialNotebookOrigin = 'runtime',
  initialNotebookToken = 0,
  initialKernelId = null,
  shellBatchRunState = null,
  filePath = null,
  onNotebookChange = null,
  autoSaveEnabled = false,
  onToggleAutoSave = null,
  // Nuevas props para control externo del toolbar
  onKernelStateChange = null,  // Callback para sincronizar estado del kernel con padre
  externalAutoDocEnabled = null, // Control externo de autoDoc (si null, usa estado interno)
  externalTrustHtml = null,
  externalEnableTracing = null,
  externalDocxValidationEnabled = null,
  // Refs expuestas para acciones externas
  actionsRef = null,
  // Callback para mensajes de estado centralizados
  onStatusMessage = null,
  onClearRuntimeData = null,
  onBatchExecutionEvent = null,
  onPendingExecutionRequestChange = null,
  // Callback para sincronizar estado de dependencias con el padre (App.js)
  onDependencyTargetChange = null,
  onSelectedCellChange = null,
  agentExecutionState = null
}) => {
  const shellKernelId = normalizeKernelId(initialKernelId);
  const hasActiveShellBatchRun = isShellBatchRunActive(shellBatchRunState);
  const shellExecutingCellId = getShellBatchCurrentCellId(shellBatchRunState);
  const hasShellOwnedHydration = Boolean(
    shellKernelId
    || (initialNotebook && initialNotebookOrigin !== 'persistable')
  );
  const [notebook, setNotebook] = useState(null);
  const [kernelId, setKernelId] = useState(shellKernelId);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingCellId, setExecutingCellId] = useState(null);
  const [kernelInterrupted, setKernelInterrupted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [cellRunProgress, setCellRunProgress] = useState(() => createIdleCellRunProgress());
  const [documentPipelineProgress, setDocumentPipelineProgress] = useState(() => createIdleDocumentPipelineProgress());
  const effectiveExecutionLock = isExecuting || hasActiveShellBatchRun;
  const effectiveExecutingCellId = hasActiveShellBatchRun ? shellExecutingCellId : executingCellId;

  // Estados internos con soporte para control externo
  const [internalTrustHtml] = useState(false);
  const [internalEnableTracing] = useState(false);
  const [internalAutoDocEnabled] = useState(true);
  const [internalDocxValidationEnabled] = useState(true);

  // Valores efectivos (externos si existen, internos como fallback)
  const trustHtml = externalTrustHtml !== null ? externalTrustHtml : internalTrustHtml;
  const enableTracing = externalEnableTracing !== null ? externalEnableTracing : internalEnableTracing;
  const autoDocEnabled = externalAutoDocEnabled !== null ? externalAutoDocEnabled : internalAutoDocEnabled;
  const docxValidationEnabled = externalDocxValidationEnabled !== null ? externalDocxValidationEnabled : internalDocxValidationEnabled;

  // Cell operations hook (replaces inline patchCellById, updateCell, addCell, deleteCell, moveCell)
  const notebookChangeReasonRef = useRef('persistable');
  const {
    rebuildCellIndexMap,
    patchCellById,
    updateCell,
    addCell,
    deleteCell,
    moveCell,
    updateCellOutput,
  } = useCellOperations(setNotebook, notebookChangeReasonRef);

  const pendingExecutionsRef = useRef(new Map());
  const kernelInterruptedRef = useRef(false);
  const executeAllInProgressRef = useRef(false);
  const executeAllRunIdRef = useRef(0); // ID único para cada sesión de executeAll
  const createTimeoutRef = useRef(null);
  const kernelStartTimeoutRef = useRef(null);
  const kernelInitPromiseRef = useRef(null);
  const kernelInitResolverRef = useRef({ resolve: null, reject: null });
  const hardResetInFlightRef = useRef(false);
  const cellRunHideTimeoutRef = useRef(null);
  const documentPipelineHideTimeoutRef = useRef(null);

  // Estado para el panel de dependencias
  const [dependencyTarget, setDependencyTarget] = useState(null);
  const dependencyRequestSeqRef = useRef(0);
  // Estado para resaltar línea de código cuando se navega desde el grafo
  const [highlightedLine, setHighlightedLine] = useState(null); // { cellIndex, line, column }
  const highlightClearTimeoutRef = useRef(null);
  // Estado para celda seleccionada (para ejecución con Ctrl+Enter)
  const [selectedCellId, setSelectedCellId] = useState(null);
  // Refs para scroll a celdas específicas
  const cellRefs = useRef({});
  // Rebuild cell index map whenever notebook changes
  useEffect(() => { rebuildCellIndexMap(notebook); }, [notebook, rebuildCellIndexMap]);
  // Ref para contenedor principal (scroll lanes)
  const notebookContentRef = useRef(null);


  // Ref para rastrear el filePath del notebook actual para detectar cambios
  const currentFilePathRef = useRef(null);
  const normalizedFilePath = filePath || null;
  const filePathChangedThisRender = normalizedFilePath !== (currentFilePathRef.current || null);
  const lastHydratedNotebookRef = useRef({ filePath: null, token: null });
  const lastMessageListenerPrimedRef = useRef(false);
  // Ref para rastrear si ya se envió el mensaje para iniciar kernel
  const kernelRequestSentRef = useRef(false);
  // Ref para tener acceso al notebook más reciente dentro de closures async (ej. executeAll)
  const notebookRef = useRef(notebook);
  useEffect(() => { notebookRef.current = notebook; }, [notebook]);
  const kernelIdRef = useRef(kernelId);
  useEffect(() => { kernelIdRef.current = kernelId; }, [kernelId]);
  useEffect(() => {
    if (shellKernelId !== kernelIdRef.current) {
      setKernelId(shellKernelId);
    }
  }, [shellKernelId]);
  const executionSeqRef = useRef(0);
  const latestExecutionByCellRef = useRef(new Map());
  const latestPdfExecutionIdRef = useRef(null);
  const pendingExecutionRequestRef = useRef(null);
  const onPendingExecutionRequestChangeRef = useRef(onPendingExecutionRequestChange);

  // Bug #13: Ref para trackear si el componente está montado y prevenir updates inseguros
  const isMountedRef = useRef(true);



  // Propagar cambios de dependencyTarget al padre (App.js) para mostrar en VisualizationPanel
  useEffect(() => {
    if (onDependencyTargetChange) {
      onDependencyTargetChange(dependencyTarget);
    }
  }, [dependencyTarget, onDependencyTargetChange]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onPendingExecutionRequestChangeRef.current = onPendingExecutionRequestChange;
  }, [onPendingExecutionRequestChange]);

  const notifyPendingExecutionRequestChange = useCallback((request) => {
    onPendingExecutionRequestChangeRef.current?.(request);
  }, []);



  const normalizeNotebook = useCallback((rawNotebook) => {
    if (!rawNotebook || typeof rawNotebook !== 'object') return null;
    const cells = Array.isArray(rawNotebook.cells) ? rawNotebook.cells : [];
    const fallbackCellOccurrences = new Map();


    const normalizedCells = cells.map((cell = {}) => {
      const rawSource = cell?.source;
      let source;
      if (Array.isArray(rawSource)) {
        // El source ya viene como array del backend - usarlo directamente
        // El backend normaliza con join("").split("\n") para manejar líneas con \n embebido
        source = rawSource;
      } else if (typeof rawSource === 'string') {
        // Si es string, splitear por saltos de línea
        source = rawSource.split(/\r?\n/);
      } else {
        source = [''];
      }

      const resolvedCellType = normalizeNotebookCellType(cell?.cell_type);
      const metadata = normalizeCellMetadata(cell?.metadata);
      const existingCellId = typeof cell?.id === 'string' && cell.id.trim()
        ? cell.id.trim()
        : null;
      const metadataCellId = typeof metadata?.inspyro_id === 'string' && metadata.inspyro_id.trim()
        ? metadata.inspyro_id.trim()
        : null;
      const fallbackSignature = `${resolvedCellType}|${source.join('\n')}`;
      const occurrence = fallbackCellOccurrences.get(fallbackSignature) || 0;
      fallbackCellOccurrences.set(fallbackSignature, occurrence + 1);
      const resolvedCellId = existingCellId
        || metadataCellId
        || buildStableFallbackCellId(resolvedCellType, source, occurrence);


      return {
        id: resolvedCellId,
        cell_type: resolvedCellType,
        source,
        outputs: Array.isArray(cell?.outputs) ? cell.outputs : [],
        execution_count: typeof cell?.execution_count === 'number' ? cell.execution_count : (cell?.execution_count ?? null),
        metadata: metadataCellId === resolvedCellId
          ? metadata
          : { ...metadata, inspyro_id: metadataCellId || resolvedCellId },
      };
    });

    return {
      ...rawNotebook,
      cells: normalizedCells,
      metadata: rawNotebook.metadata || {},
      nbformat: rawNotebook.nbformat || 4,
      nbformat_minor: rawNotebook.nbformat_minor || 4,
    };
  }, []);

  // Definido antes del useEffect que lo usa (evita "used before defined")
  const flushPendingExecutions = useCallback((reason, options = {}) => {
    const { reject = true } = options || {};
    const error = reason instanceof Error ? reason : new Error(reason || 'execution_cancelled');
    pendingExecutionsRef.current.forEach(entry => {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (reject && entry.reject) {
        try {
          entry.reject(error);
        } catch (e) {
          logger.error('Error rejecting pending execution:', e);
        }
      }
    });
    pendingExecutionsRef.current.clear();
  }, []);

  const schedulePendingExecutionTimeout = useCallback((cellId, executionId, timeoutMs, onTimeout) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingExecutionsRef.current.get(cellId);
      if (!pending || pending.executionId !== executionId) {
        return;
      }
      pendingExecutionsRef.current.delete(cellId);
      onTimeout();
    }, timeoutMs);

    return {
      executionId,
      timeoutId,
      timeoutMs,
      onTimeout,
    };
  }, []);

  const refreshPendingExecutionLiveness = useCallback((executionId) => {
    if (!executionId) {
      return false;
    }

    for (const [cellId, pending] of pendingExecutionsRef.current.entries()) {
      if (pending?.executionId !== executionId || !pending?.onTimeout || !pending?.timeoutMs) {
        continue;
      }
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      const refreshed = schedulePendingExecutionTimeout(
        cellId,
        executionId,
        pending.timeoutMs,
        pending.onTimeout,
      );
      pendingExecutionsRef.current.set(cellId, {
        ...pending,
        timeoutId: refreshed.timeoutId,
      });
      return true;
    }
    return false;
  }, [schedulePendingExecutionTimeout]);

  const clearCellRunHideTimeout = useCallback(() => {
    if (cellRunHideTimeoutRef.current) {
      clearTimeout(cellRunHideTimeoutRef.current);
      cellRunHideTimeoutRef.current = null;
    }
  }, []);

  const clearDocumentPipelineHideTimeout = useCallback(() => {
    if (documentPipelineHideTimeoutRef.current) {
      clearTimeout(documentPipelineHideTimeoutRef.current);
      documentPipelineHideTimeoutRef.current = null;
    }
  }, []);

  const clearDocumentPipelineVisualizationStatus = useCallback(() => {
    onVisualizationData?.({
      conversionStatus: null,
      documentPipelineStatus: null,
    });
  }, [onVisualizationData]);

  const resetCellRunProgress = useCallback(() => {
    clearCellRunHideTimeout();
    setCellRunProgress(createIdleCellRunProgress());
  }, [clearCellRunHideTimeout]);

  const resetDocumentPipelineProgress = useCallback(() => {
    clearDocumentPipelineHideTimeout();
    setDocumentPipelineProgress(createIdleDocumentPipelineProgress());
    clearDocumentPipelineVisualizationStatus();
  }, [clearDocumentPipelineHideTimeout, clearDocumentPipelineVisualizationStatus]);

  const beginBatchCellRunProgress = useCallback((total, runId) => {
    clearCellRunHideTimeout();
    setCellRunProgress({
      visible: total > 0,
      active: total > 0,
      status: 'running',
      mode: 'determinate',
      label: 'Ejecutando notebook',
      message: total > 0 ? `0 de ${total} celdas completadas` : '',
      percent: 0,
      total,
      completed: 0,
      runId,
      executionId: null,
    });
  }, [clearCellRunHideTimeout]);

  const beginSingleCellRunProgress = useCallback((executionId) => {
    clearCellRunHideTimeout();
    setCellRunProgress({
      visible: true,
      active: true,
      status: 'running',
      mode: 'indeterminate',
      label: 'Ejecutando celda',
      message: 'Procesando código...',
      percent: 0,
      total: 1,
      completed: 0,
      runId: null,
      executionId,
    });
  }, [clearCellRunHideTimeout]);

  const advanceBatchCellRunProgress = useCallback((completed) => {
    setCellRunProgress((prev) => {
      if (!prev.visible || prev.mode !== 'determinate' || prev.total <= 0) {
        return prev;
      }
      const safeCompleted = Math.max(0, Math.min(prev.total, completed));
      const percent = prev.total > 0 ? (safeCompleted / prev.total) * 100 : 0;
      return {
        ...prev,
        active: safeCompleted < prev.total,
        completed: safeCompleted,
        percent,
        status: safeCompleted >= prev.total ? 'completed' : 'running',
        message: `${safeCompleted} de ${prev.total} celdas completadas`,
      };
    });
  }, []);

  const completeCellRunProgress = useCallback((message) => {
    clearCellRunHideTimeout();
    setCellRunProgress((prev) => {
      if (!prev.visible) {
        return prev;
      }
      return {
        ...prev,
        active: false,
        status: 'completed',
        percent: 100,
        completed: prev.total || prev.completed || 1,
        message: message || prev.message || 'Ejecución completada',
      };
    });
    cellRunHideTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setCellRunProgress(createIdleCellRunProgress());
      }
    }, CELL_RUN_RAIL_HOLD_MS);
  }, [clearCellRunHideTimeout]);

  const failCellRunProgress = useCallback((message) => {
    clearCellRunHideTimeout();
    setCellRunProgress((prev) => ({
      ...prev,
      visible: prev.visible || true,
      active: false,
      status: 'failed',
      label: prev.label || 'Ejecución interrumpida',
      message: message || prev.message || 'La ejecución no pudo completarse',
      percent: prev.mode === 'determinate' ? prev.percent : 100,
    }));
    cellRunHideTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setCellRunProgress(createIdleCellRunProgress());
      }
    }, DOCUMENT_RAIL_FAILURE_HOLD_MS);
  }, [clearCellRunHideTimeout]);

  const updateDocumentPipelineProgress = useCallback((status) => {
    if (!status?.executionId) {
      return;
    }
    clearDocumentPipelineHideTimeout();
    const normalizedStatus = {
      ...buildDocumentPipelineStatus(status),
      executionId: status.executionId,
    };
    setDocumentPipelineProgress((prev) => ({
      ...prev,
      visible: true,
      active: normalizedStatus.status === 'running',
      status: normalizedStatus.status,
      label: 'Generando documento',
      message: normalizedStatus.message || prev.message || 'Procesando documento...',
      percent: normalizedStatus.percent,
      stage: normalizedStatus.stage,
      executionId: normalizedStatus.executionId,
      indeterminate: normalizedStatus.indeterminate,
      sharedResource: normalizedStatus.sharedResource,
    }));
    onVisualizationData?.({
      conversionStatus: normalizedStatus.message ? { message: normalizedStatus.message } : null,
      documentPipelineStatus: normalizedStatus,
    });
  }, [clearDocumentPipelineHideTimeout, onVisualizationData]);

  const completeDocumentPipelineProgress = useCallback((status) => {
    const normalizedStatus = buildDocumentPipelineStatus({
      ...status,
      status: 'completed',
      percent: 100,
      indeterminate: false,
    });
    clearDocumentPipelineHideTimeout();
    setDocumentPipelineProgress((prev) => ({
      ...prev,
      visible: true,
      active: false,
      status: 'completed',
      label: 'Generando documento',
      message: normalizedStatus.message || 'PDF listo',
      percent: 100,
      stage: normalizedStatus.stage || prev.stage || 'pdf_convert',
      executionId: normalizedStatus.executionId || prev.executionId || null,
      indeterminate: false,
      sharedResource: null,
    }));
    onVisualizationData?.({
      conversionStatus: null,
      documentPipelineStatus: normalizedStatus,
    });
    documentPipelineHideTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setDocumentPipelineProgress(createIdleDocumentPipelineProgress());
        clearDocumentPipelineVisualizationStatus();
      }
    }, DOCUMENT_RAIL_SUCCESS_HOLD_MS);
  }, [clearDocumentPipelineHideTimeout, clearDocumentPipelineVisualizationStatus, onVisualizationData]);

  const failDocumentPipelineProgress = useCallback((status) => {
    const normalizedStatus = buildDocumentPipelineStatus({
      ...status,
      status: 'failed',
      indeterminate: false,
    });
    clearDocumentPipelineHideTimeout();
    setDocumentPipelineProgress((prev) => ({
      ...prev,
      visible: true,
      active: false,
      status: 'failed',
      label: 'Generando documento',
      message: normalizedStatus.message || 'La generación del documento falló',
      percent: Math.max(prev.percent || 0, normalizedStatus.percent || 0),
      stage: normalizedStatus.stage || prev.stage || 'pdf_convert',
      executionId: normalizedStatus.executionId || prev.executionId || null,
      indeterminate: false,
      sharedResource: null,
    }));
    onVisualizationData?.({
      conversionStatus: normalizedStatus.message ? { message: normalizedStatus.message } : null,
      documentPipelineStatus: normalizedStatus,
    });
    documentPipelineHideTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setDocumentPipelineProgress(createIdleDocumentPipelineProgress());
        clearDocumentPipelineVisualizationStatus();
      }
    }, DOCUMENT_RAIL_FAILURE_HOLD_MS);
  }, [clearDocumentPipelineHideTimeout, clearDocumentPipelineVisualizationStatus, onVisualizationData]);

  // Efecto principal: sincroniza notebook local y resetea kernel al cambiar de archivo
  useEffect(() => {
    const isNewFile = filePath && filePath !== currentFilePathRef.current;
    const shouldHydrateRuntimeNotebook = Boolean(
      initialNotebook
      && (
        isNewFile
        || !notebook
        || (
          initialNotebookOrigin !== 'persistable'
          && (
            lastHydratedNotebookRef.current.filePath !== filePath
            || lastHydratedNotebookRef.current.token !== initialNotebookToken
          )
        )
      )
    );

    if (isNewFile) {
      if (pendingExecutionRequestRef.current) {
        const detachedRequest = {
          ...pendingExecutionRequestRef.current,
          detached: true,
        };
        pendingExecutionRequestRef.current = detachedRequest;
        notifyPendingExecutionRequestChange(detachedRequest);
      }
      currentFilePathRef.current = filePath;
      kernelRequestSentRef.current = false;
      executeAllInProgressRef.current = false;
      setKernelId(shellKernelId);
      setIsCreating(false);
      hardResetInFlightRef.current = false;
      setIsExecuting(false);
      setExecutingCellId(null);
      setHighlightedLine(null);
      kernelInterruptedRef.current = false;
      setKernelInterrupted(false);
      // Usar flush en vez de clear() para también cancelar timeouts activos
      flushPendingExecutions(new Error('file_changed'), { reject: false });
      // Invalidar cualquier executeAll en progreso incrementando el runId
      executeAllRunIdRef.current += 1;
      if (kernelStartTimeoutRef.current) {
        clearTimeout(kernelStartTimeoutRef.current);
        kernelStartTimeoutRef.current = null;
      }
      kernelInitPromiseRef.current = null;
      kernelInitResolverRef.current = { resolve: null, reject: null };
      latestExecutionByCellRef.current.clear();
      latestPdfExecutionIdRef.current = null;
      if (highlightClearTimeoutRef.current) {
        clearTimeout(highlightClearTimeoutRef.current);
        highlightClearTimeoutRef.current = null;
      }
      clearCellRunHideTimeout();
      clearDocumentPipelineHideTimeout();
      setCellRunProgress(createIdleCellRunProgress());
      setDocumentPipelineProgress(createIdleDocumentPipelineProgress());
    }

    if (shouldHydrateRuntimeNotebook) {
      const normalizedNotebook = normalizeNotebook(initialNotebook);
      notebookChangeReasonRef.current = 'runtime';
      notebookRef.current = normalizedNotebook;
      setNotebook(normalizedNotebook);
      currentFilePathRef.current = filePath;
      lastHydratedNotebookRef.current = {
        filePath,
        token: initialNotebookToken,
      };
    } else if (!initialNotebook && (isNewFile || !filePath)) {
      notebookChangeReasonRef.current = 'runtime';
      notebookRef.current = null;
      setNotebook(null);
      setKernelId(shellKernelId);
      setIsExecuting(false);
      setExecutingCellId(null);
      currentFilePathRef.current = filePath || null;
      lastHydratedNotebookRef.current = {
        filePath: filePath || null,
        token: initialNotebookToken,
      };
    }
  }, [
    initialNotebook,
    initialNotebookOrigin,
    initialNotebookToken,
    filePath,
    normalizeNotebook,
    notebook,
    flushPendingExecutions,
    shellKernelId,
    notifyPendingExecutionRequestChange,
    clearCellRunHideTimeout,
    clearDocumentPipelineHideTimeout,
  ]);

  // Notificar cambios persistibles al componente padre (evita autosave por runtime outputs)
  useEffect(() => {
    if (notebook && onNotebookChange && filePath) {
      const persistable = notebookChangeReasonRef.current !== 'runtime';
      if (!persistable) {
        return;
      }
      onNotebookChange(notebook, filePath, { persistable: true });
    }
  }, [notebook, onNotebookChange, filePath]);
  const updateKernelInterrupted = useCallback((value) => {
    kernelInterruptedRef.current = value;
    setKernelInterrupted(value);
  }, []);

  const getActiveKernelId = useCallback(() => (
    kernelIdRef.current || shellKernelId || null
  ), [shellKernelId]);

  const resolveKernelInit = useCallback((kid, nb = null) => {
    // Ya resuelto o rechazado: no-op
    if (!kernelInitResolverRef.current?.resolve && !kernelStartTimeoutRef.current) {
      return;
    }
    if (kernelStartTimeoutRef.current) {
      clearTimeout(kernelStartTimeoutRef.current);
      kernelStartTimeoutRef.current = null;
    }
    if (kernelInitResolverRef.current?.resolve) {
      try { kernelInitResolverRef.current.resolve({ kernelId: kid, notebook: nb }); } catch (e) { logger.error('Error resolviendo init kernel:', e); }
    }
    kernelInitPromiseRef.current = null;
    kernelInitResolverRef.current = { resolve: null, reject: null };
  }, []);

  const rejectKernelInit = useCallback((err) => {
    // Ya resuelto o rechazado: no-op
    if (!kernelInitResolverRef.current?.reject && !kernelStartTimeoutRef.current) {
      return;
    }
    if (kernelStartTimeoutRef.current) {
      clearTimeout(kernelStartTimeoutRef.current);
      kernelStartTimeoutRef.current = null;
    }
    if (kernelInitResolverRef.current?.reject) {
      try { kernelInitResolverRef.current.reject(err instanceof Error ? err : new Error(err || 'kernel_error')); } catch (e) { logger.error('Error rechazando init kernel:', e); }
    }
    kernelInitPromiseRef.current = null;
    kernelInitResolverRef.current = { resolve: null, reject: null };
    kernelRequestSentRef.current = false;
  }, []);

  const ensureKernel = useCallback(async () => {
    const activeKernelId = getActiveKernelId();
    if (activeKernelId) {
      return {
        kernelId: activeKernelId,
        notebook: notebookRef.current || notebook,
      };
    }
    if (kernelInitPromiseRef.current) return kernelInitPromiseRef.current;
    if (connectionStatus !== 'connected') {
      throw new Error('WebSocket desconectado');
    }
    const currentNotebook = notebookRef.current || notebook;
    if (!currentNotebook) {
      throw new Error('Notebook no cargado');
    }

    setIsCreating(true);
    onStatusMessage?.('Iniciando kernel...', 'info', {
      target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
    });
    kernelRequestSentRef.current = true;
    const payload = serializeNotebookForKernelLoad(currentNotebook);
    sendMessage({
      type: 'notebook_load',
      content: payload,
      path: filePath
    });
    kernelInitPromiseRef.current = new Promise((resolve, reject) => {
      kernelInitResolverRef.current = { resolve, reject };
      kernelStartTimeoutRef.current = setTimeout(() => {
        kernelInitPromiseRef.current = null;
        kernelInitResolverRef.current = { resolve: null, reject: null };
        setIsCreating(false);
        kernelRequestSentRef.current = false;
        reject(new Error('Timeout iniciando kernel'));
      }, 20000);
    });
    return kernelInitPromiseRef.current;
  }, [connectionStatus, filePath, getActiveKernelId, notebook, onStatusMessage, sendMessage]);

  // deriveEngineeringVarsFromOutputs is now imported from ./notebook/deriveEngineeringVars

  const nextExecutionId = useCallback((cellId) => {
    executionSeqRef.current += 1;
    const token = `exec_${Date.now()}_${executionSeqRef.current}_${cellId || 'cell'}`;
    latestExecutionByCellRef.current.set(cellId, token);
    return token;
  }, []);

  // patchCellById and updateCellOutput are now provided by useCellOperations hook

  const applyNotebookDocumentPayload = useCallback((message) => {
    if (!onVisualizationData) return;
    const hasRelevantPayload = [
      'docx_file_b64',
      'docx_hash',
      'docx_download_url',
      'docx_ref',
      'docx_file_token',
      'docx_artifact_id',
      'docx_updated_at',
      'docx_file_name',
      'docx_warnings',
      'docx_error',
      'docx_size_bytes',
      'docx_store_error',
      'docx_provenance_available',
      'docx_provenance_ref',
      'workspace_path',
      'workspace_relpath',
      'workspace_warning',
      'pdf_file_b64',
      'pdf_ref',
      'pdf_hash',
      'pdf_conversion_error',
      'pdf_attempted',
      'pdf_conversion_stdout',
      'pdf_conversion_stderr',
      'pdf_conversion_ms',
      'converter_used',
      'word_error',
    ].some((key) => Object.prototype.hasOwnProperty.call(message || {}, key));

    if (!hasRelevantPayload) return;

    onVisualizationData({
      docxBase64: message.docx_file_b64 || null,
      docxHash: message.docx_hash || null,
      docxDownloadUrl: buildDocxDownloadUrlFromPayload(message) || null,
      docxArtifactId: message.docx_artifact_id || null,
      docxFileName: message.docx_file_name || null,
      docxWarnings: message.docx_warnings || null,
      docxError: message.docx_error || null,
      docxSizeBytes: message.docx_size_bytes ?? null,
      docxStoreError: message.docx_store_error ?? null,
      docxProvenanceAvailable: Boolean(message.docx_provenance_available),
      docxProvenanceRef: message.docx_provenance_ref || buildDocxProvenancePath({ artifactId: message.docx_artifact_id || null }) || null,
      docxWorkspacePath: message.workspace_path || null,
      docxWorkspaceRelpath: message.workspace_relpath || null,
      docxWorkspaceWarning: message.workspace_warning || null,
      docxUpdatedAt: message.docx_updated_at || message.updated_at || message.created_at || Date.now(),
      sourcePath: message.source_path || null,
      sourceKind: message.source_kind || null,
      pdfBase64: message.pdf_file_b64 || null,
      pdfRefUrl: message.pdf_ref || null,
      pdfHash: message.pdf_hash || null,
      pdfConversionError: message.pdf_conversion_error || null,
      pdfAttempted: message.pdf_attempted ?? null,
      pdfConversionStdout: message.pdf_conversion_stdout ?? null,
      pdfConversionStderr: message.pdf_conversion_stderr ?? null,
      pdfConversionMs: message.pdf_conversion_ms ?? null,
      converterUsed: message.converter_used ?? null,
      wordError: message.word_error ?? null,
      ...(Object.prototype.hasOwnProperty.call(message || {}, 'conversionStatus')
        ? { conversionStatus: message.conversionStatus ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(message || {}, 'documentPipelineStatus')
        ? { documentPipelineStatus: message.documentPipelineStatus ?? null }
        : {}),
    });
  }, [onVisualizationData]);

  const clearAllOutputs = useCallback(() => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook || !Array.isArray(currentNotebook.cells)) {
      return false;
    }
    if (isExecuting) {
      onStatusMessage?.('No se pueden eliminar resultados mientras el notebook está ejecutándose', 'warning', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      return false;
    }

    const hadRuntimeState = currentNotebook.cells.some(hasCellRuntimeState);
    if (hadRuntimeState) {
      const clearedNotebook = stripNotebookRuntimeState(currentNotebook);
      notebookChangeReasonRef.current = 'persistable';
      notebookRef.current = clearedNotebook;
      setNotebook(clearedNotebook);
    }

    latestExecutionByCellRef.current.clear();
    latestPdfExecutionIdRef.current = null;
    setDependencyTarget(null);
    resetCellRunProgress();
    resetDocumentPipelineProgress();
    onClearRuntimeData?.();

    onStatusMessage?.(
      hadRuntimeState ? 'Resultados eliminados del notebook' : 'No había resultados para eliminar',
      hadRuntimeState ? 'success' : 'info',
      {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      },
    );
    return true;
  }, [filePath, isExecuting, onClearRuntimeData, onStatusMessage, resetCellRunProgress, resetDocumentPipelineProgress]);

  const attemptHardKernelReset = useCallback(() => {
    const currentNotebook = notebookRef.current;
    const currentKernelId = kernelIdRef.current;

    if (
      connectionStatus !== 'connected'
      || !filePath
      || !currentNotebook
      || !currentKernelId
      || hardResetInFlightRef.current
    ) {
      return false;
    }

    const strippedNotebook = stripNotebookRuntimeState(currentNotebook);
    hardResetInFlightRef.current = true;
    notebookChangeReasonRef.current = 'runtime';
    notebookRef.current = strippedNotebook;
    setNotebook(strippedNotebook);
    setKernelId(currentKernelId);
    setIsCreating(true);
    flushPendingExecutions(new Error('kernel_reset_hard_reload'));
    executeAllInProgressRef.current = false;
    setIsExecuting(false);
    setExecutingCellId(null);
    latestExecutionByCellRef.current.clear();
    latestPdfExecutionIdRef.current = null;
    updateKernelInterrupted(false);
    resetCellRunProgress();
    resetDocumentPipelineProgress();
    onClearRuntimeData?.();
    onStatusMessage?.('Recreando kernel del notebook...', 'warning', {
      target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
    });

    sendMessage({
      type: 'notebook_load',
      content: serializeNotebookForKernelLoad(strippedNotebook),
      path: filePath,
      previous_kernel_id: currentKernelId,
    });
    return true;
  }, [connectionStatus, filePath, flushPendingExecutions, onClearRuntimeData, onStatusMessage, sendMessage, updateKernelInterrupted, resetCellRunProgress, resetDocumentPipelineProgress]);

  const hasKnownExecutionId = useCallback((executionId) => {
    const normalizedExecutionId = typeof executionId === 'string' && executionId.trim()
      ? executionId.trim()
      : null;
    if (!normalizedExecutionId) {
      return false;
    }
    if (pendingExecutionRequestRef.current?.executionId === normalizedExecutionId) {
      return true;
    }
    if (latestPdfExecutionIdRef.current === normalizedExecutionId) {
      return true;
    }
    for (const latestExecutionId of latestExecutionByCellRef.current.values()) {
      if (latestExecutionId === normalizedExecutionId) {
        return true;
      }
    }
    for (const pendingExecution of pendingExecutionsRef.current.values()) {
      if (pendingExecution?.executionId === normalizedExecutionId) {
        return true;
      }
    }
    return false;
  }, []);

  const shouldAcceptNotebookMessage = useCallback((message) => {
    if (!message?.type) {
      return false;
    }
    const normalizedMessagePath = normalizeNotebookComparablePath(
      message.source_path || message.notebook_path || message.path || null,
    );
    const normalizedFilePath = normalizeNotebookComparablePath(filePath);
    if (normalizedMessagePath && normalizedFilePath) {
      return normalizedMessagePath === normalizedFilePath;
    }
    const activeKernelId = getActiveKernelId();
    if (message?.kernel_id && activeKernelId) {
      return message.kernel_id === activeKernelId;
    }
    if (NOTEBOOK_EXECUTION_SCOPED_MESSAGE_TYPES.has(message.type)) {
      return hasKnownExecutionId(message.execution_id);
    }
    if (NOTEBOOK_LIFECYCLE_MESSAGE_TYPES.has(message.type)) {
      if (!normalizedFilePath) {
        return false;
      }
      const pendingRequestPath = normalizeNotebookComparablePath(
        pendingExecutionRequestRef.current?.filePath || null,
      );
      if (pendingRequestPath && pendingRequestPath === normalizedFilePath) {
        return true;
      }
      return Boolean(kernelRequestSentRef.current || isCreating || hardResetInFlightRef.current);
    }
    return Boolean(filePath);
  }, [filePath, getActiveKernelId, hasKnownExecutionId, isCreating]);



  const handleWebSocketMessage = useCallback((message) => {
    switch (message.type) {
      case 'notebook_created': {
        const normNb = normalizeNotebook(message.notebook);
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(normNb);
        setKernelId(message.kernel_id);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        hardResetInFlightRef.current = false;
        resolveKernelInit(message.kernel_id, normNb);
        flushPendingExecutions(new Error('notebook_recreated'));
        // MANTENER estado si veníamos de un run-all
        setIsExecuting(false);
        setExecutingCellId(null);
        updateKernelInterrupted(false);
        resetCellRunProgress();
        resetDocumentPipelineProgress();
        setIsCreating(false);
        if (createTimeoutRef.current) {
          clearTimeout(createTimeoutRef.current);
          createTimeoutRef.current = null;
        }
        onStatusMessage?.('Notebook creado', 'success', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;
      }

      case 'notebook_stream': {
        const { cell_id, content } = message;
        if (!cell_id) break;
        patchCellById(cell_id, (cell) => {
          const text = content?.text;
          const name = content?.name || 'stdout';
          const streamChunk = Array.isArray(text) ? text.join('') : (text || '');
          const prevOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
          const last = prevOutputs[prevOutputs.length - 1];
          if (last && last.output_type === 'stream' && last.name === name) {
            const lastTextStr = Array.isArray(last.text) ? last.text.join('') : (last.text || '');
            let mergedText = lastTextStr;
            if (streamChunk.length > 0) {
              if (streamChunk.startsWith(lastTextStr)) {
                mergedText = streamChunk;
              } else if (lastTextStr.endsWith(streamChunk)) {
                mergedText = lastTextStr;
              } else {
                mergedText = lastTextStr + streamChunk;
              }
            }
            const merged = { ...last, text: mergedText };
            return { ...cell, outputs: [...prevOutputs.slice(0, -1), merged] };
          }
          return { ...cell, outputs: [...prevOutputs, { output_type: 'stream', name, text: streamChunk }] };
        });
        break;
      }

      case 'notebook_loaded': {
        logger.warn('notebook_loaded received from backend:', {
          kernel_id: message.kernel_id,
          cellCount: message.notebook?.cells?.length
        });
        const normNb = normalizeNotebook(message.notebook || notebookRef.current);
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(normNb);
        setKernelId(message.kernel_id);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        hardResetInFlightRef.current = false;
        resolveKernelInit(message.kernel_id, normNb);
        flushPendingExecutions(new Error('notebook_loaded'));
        // MANTENER estado si veníamos de run-all que provocó el load
        setIsExecuting(false);
        setExecutingCellId(null);
        updateKernelInterrupted(false);
        resetCellRunProgress();
        resetDocumentPipelineProgress();
        setIsCreating(false);
        onStatusMessage?.('Notebook cargado con kernel', 'success', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;
      }

      case 'notebook_attached': {
        const normNb = normalizeNotebook(message.notebook || notebookRef.current);
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(normNb);
        setKernelId(message.kernel_id);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        hardResetInFlightRef.current = false;
        setIsCreating(false);
        if (createTimeoutRef.current) {
          clearTimeout(createTimeoutRef.current);
          createTimeoutRef.current = null;
        }
        break;
      }

      case 'notebook_cell_deleted': {
        if (message?.cell_id) {
          notebookChangeReasonRef.current = 'runtime';
          setNotebook((prev) => {
            if (!prev || !Array.isArray(prev.cells)) return prev;
            return {
              ...prev,
              cells: prev.cells.filter((cell) => cell.id !== message.cell_id),
            };
          });
          if (selectedCellId === message.cell_id) {
            setSelectedCellId(null);
          }
        }
        applyNotebookDocumentPayload(message);
        break;
      }

      case 'notebook_cell_moved': {
        if (message?.cell_id && message?.direction) {
          notebookChangeReasonRef.current = 'runtime';
          setNotebook((prev) => {
            if (!prev || !Array.isArray(prev.cells)) return prev;
            const cells = [...prev.cells];
            const currentIndex = cells.findIndex((cell) => cell.id === message.cell_id);
            if (currentIndex < 0) return prev;
            const nextIndex = message.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= cells.length) return prev;
            [cells[currentIndex], cells[nextIndex]] = [cells[nextIndex], cells[currentIndex]];
            return { ...prev, cells };
          });
        }
        applyNotebookDocumentPayload(message);
        break;
      }

      case 'notebook_order_set': {
        const nextOrder = Array.isArray(message?.order) ? message.order : [];
        if (nextOrder.length > 0) {
          notebookChangeReasonRef.current = 'runtime';
          setNotebook((prev) => {
            if (!prev || !Array.isArray(prev.cells)) return prev;
            const byId = new Map(prev.cells.map((cell) => [cell.id, cell]));
            const orderedCells = [];
            nextOrder.forEach((cellId) => {
              const cell = byId.get(cellId);
              if (cell) {
                orderedCells.push(cell);
                byId.delete(cellId);
              }
            });
            byId.forEach((cell) => orderedCells.push(cell));
            return { ...prev, cells: orderedCells };
          });
        }
        applyNotebookDocumentPayload(message);
        break;
      }

      case 'notebook_cell_executed':
        logger.log('[NotebookEditor] notebook_cell_executed received:', {
          cellId: message.cell_id,
          executeAllInProgress: executeAllInProgressRef.current,
          pendingExecutions: pendingExecutionsRef.current.size,
        });
        if (message?.cell_id && message?.execution_id) {
          const expectedExecutionId = latestExecutionByCellRef.current.get(message.cell_id);
          if (expectedExecutionId && expectedExecutionId !== message.execution_id) {
            logger.log('[NotebookEditor] Ignoring stale notebook_cell_executed', {
              cellId: message.cell_id,
              expectedExecutionId,
              receivedExecutionId: message.execution_id,
            });
            break;
          }
        }

        // Finalizar ejecución actual; la cola (si existe) continuará al quedar isExecuting=false
        if (!executeAllInProgressRef.current) {
          logger.log('[NotebookEditor] Setting isExecuting=false for cell:', message.cell_id);
          setIsExecuting(false);
          completeCellRunProgress('Celda completada.');
        }
        setExecutingCellId(null);

        try {
          updateCellOutput(message.cell_id, message.outputs, message.execution_count, message.execution_duration_ms);
        } catch (e) {
          console.error('[NotebookEditor] Error updating cell output:', e);
        }
        // Resolver promesa pendiente si existe
        if (pendingExecutionsRef.current.has(message.cell_id)) {
          const pending = pendingExecutionsRef.current.get(message.cell_id);
          if (pending?.executionId && message?.execution_id && pending.executionId !== message.execution_id) {
            break;
          }
          if (pending?.timeoutId) {
            clearTimeout(pending.timeoutId);
          }
          pending?.resolve?.(message);
          pendingExecutionsRef.current.delete(message.cell_id);
        }
        if (message?.execution_id && message?.pdf_converting) {
          latestPdfExecutionIdRef.current = message.execution_id;
        }
        if (message?.variables_snapshot_degraded) {
          logger.warn('[NotebookEditor] Variables snapshot degraded for execution:', {
            cellId: message.cell_id,
            executionId: message.execution_id,
            diagnostics: message.execution_diagnostics || null,
          });
        }

        // Enviar datos de visualización
        if (onVisualizationData) {
          let derivedVars = {};
          try {
            const baseVars = message.variables || {};
            derivedVars = deriveEngineeringVarsFromOutputs(message.outputs || [], message.cell_id, baseVars);
            const vars = { ...baseVars, ...derivedVars };
            const dep = message.dependency_graph || { nodes: [], links: [] };
            const execStates = message.execution_states || [];
            const varCount = Object.keys(vars || {}).length;
            logger.log('[Notebook] variables recibidas:', varCount, Object.keys(vars || {}).slice(0, 5));
            logger.log('[Notebook] dependency_graph:', dep);
            logger.log('[Notebook] execution_states:', execStates.length, execStates);
            logger.log('[Notebook] call_stack en execution_states:', execStates.map(s => s.call_stack).filter(cs => cs && cs.length > 0));

          } catch (e) {
            logger.error('[Notebook] Error procesando datos de visualización:', e);
          }
          onVisualizationData({
            variables: { ...(message.variables || {}), ...derivedVars },
            executionStates: message.execution_states || [],
            totalSteps: message.execution_states?.length || 0,
            performanceData: message.performance_data || null,
            executionDiagnostics: message.execution_diagnostics || null,
            variablesSnapshotDegraded: Boolean(message.variables_snapshot_degraded),
            dependencyGraph: message.dependency_graph || { nodes: [], links: [] },
            docxBase64: message.docx_file_b64 || null,
            docxHash: message.docx_hash || null,
            docxDownloadUrl: buildDocxDownloadUrlFromPayload(message) || null,
            docxArtifactId: message.docx_artifact_id || null,
            docxFileName: message.docx_file_name || null,
            docxWarnings: message.docx_warnings || null,
            docxError: message.docx_error || null,
            docxSizeBytes: message.docx_size_bytes ?? null,
            docxStoreError: message.docx_store_error ?? null,
            docxProvenanceAvailable: Boolean(message.docx_provenance_available),
            docxProvenanceRef: message.docx_provenance_ref || buildDocxProvenancePath({ artifactId: message.docx_artifact_id || null }) || null,
            docxWorkspacePath: message.workspace_path || null,
            docxWorkspaceRelpath: message.workspace_relpath || null,
            docxWorkspaceWarning: message.workspace_warning || null,
            docxUpdatedAt: message.docx_updated_at || message.updated_at || message.created_at || Date.now(),
            sourcePath: message.source_path || null,
            sourceKind: message.source_kind || null,
            pdfBase64: message.pdf_file_b64 || null,
            pdfRefUrl: message.pdf_ref || null,
            pdfHash: message.pdf_hash || null,
            pdfConversionError: message.pdf_conversion_error || null,
            pdfAttempted: message.pdf_attempted ?? null,
            pdfConversionStdout: message.pdf_conversion_stdout ?? null,
            pdfConversionStderr: message.pdf_conversion_stderr ?? null,
            pdfConversionMs: message.pdf_conversion_ms ?? null,
            converterUsed: message.converter_used ?? null,    // NEW: "word" or "libreoffice"
            wordError: message.word_error ?? null,             // NEW: Word failure reason
            conversionStatus: null,
            documentPipelineStatus: null,
          });
        }
        break;
      case 'notebook_docx_update': {
        if (message?.execution_id && latestPdfExecutionIdRef.current && message.execution_id !== latestPdfExecutionIdRef.current) {
          logger.log('[NotebookEditor] Ignoring stale notebook_docx_update', {
            expectedExecutionId: latestPdfExecutionIdRef.current,
            receivedExecutionId: message.execution_id,
          });
          break;
        }
        if (message?.execution_id) {
          updateDocumentPipelineProgress({
            executionId: message.execution_id,
            stage: 'docx_ready',
            status: 'running',
            message: 'DOCX listo.',
          });
        }
        applyNotebookDocumentPayload(message);
        break;
      }

      // NEW: Handle async PDF conversion result
      case 'notebook_pdf_ready': {
        if (message?.execution_id && latestPdfExecutionIdRef.current && message.execution_id !== latestPdfExecutionIdRef.current) {
          logger.log('[NotebookEditor] Ignoring stale notebook_pdf_ready', {
            expectedExecutionId: latestPdfExecutionIdRef.current,
            receivedExecutionId: message.execution_id,
          });
          break;
        }
        if (onVisualizationData) {
          applyNotebookDocumentPayload({
            ...message,
            conversionStatus: null,
            documentPipelineStatus: null,
          });
          if (message.pdf_conversion_error) {
            const conversionError = message.word_error
              ? `${message.pdf_conversion_error} (Word: ${message.word_error})`
              : message.pdf_conversion_error;
            failDocumentPipelineProgress({
              executionId: message.execution_id || latestPdfExecutionIdRef.current,
              stage: 'pdf_convert',
              percent: 80,
              message: `Error generando documento: ${conversionError}`,
            });
          } else {
            completeDocumentPipelineProgress({
              executionId: message.execution_id || latestPdfExecutionIdRef.current,
              stage: 'pdf_convert',
              message: 'PDF listo en Documento.',
            });
          }
          if (message.pdf_file_b64 || message.pdf_ref) {
            const converter = message.converter_used === 'word' ? 'Microsoft Word' :
              message.converter_used === 'libreoffice' ? 'LibreOffice (fallback)' :
                message.converter_used === 'cached' ? 'Cache' : 'desconocido';
            // If LibreOffice was used and Word failed, include the reason
            if (message.converter_used === 'libreoffice' && message.word_error) {
              onStatusMessage?.(`PDF generado con LibreOffice (Word falló: ${message.word_error})`, 'warning', {
                target: createNotebookDocumentTarget(message.source_path || filePath, { actionLabel: 'Abrir documento' }),
              });
            } else {
              onStatusMessage?.(`PDF generado con ${converter}`, 'success', {
                target: createNotebookDocumentTarget(message.source_path || filePath, { actionLabel: 'Abrir documento' }),
              });
            }
          }

          // SAFETY NET: Si la ejecución quedó "colgada" (isExecuting=true) esperando el PDF, liberarla ahora.
          // Esto corrige el caso donde notebook_cell_executed no logró limpiar el estado en generaciones lentas.
          if (!executeAllInProgressRef.current) {
            setIsExecuting(false);
            setExecutingCellId(null);
          }
          if (message.pdf_conversion_error) {
            const conversionError = message.word_error
              ? `${message.pdf_conversion_error} (Word: ${message.word_error})`
              : message.pdf_conversion_error;
            onStatusMessage?.(`Error al generar PDF: ${conversionError}`, 'error', {
              target: createNotebookDocumentTarget(message.source_path || filePath, { actionLabel: 'Abrir documento' }),
            });
          }
        }
        break;
      }


      case 'notebook_execute_input': {
        // Actualizar execution_count de la celda
        const count = message?.content?.execution_count;
        const cellId = message?.cell_id;
        if (cellId && typeof count === 'number') {
          patchCellById(cellId, (cell) => ({ ...cell, execution_count: count }));
        }
        break;
      }

      case 'notebook_clear_output': {
        const cellId = message?.cell_id;
        if (cellId) {
          patchCellById(cellId, (cell) => ({ ...cell, outputs: [] }));
        }
        break;
      }

      case 'notebook_update_display_data':
        {
          const { cell_id, content } = message;
          if (cell_id) {
            patchCellById(cell_id, (cell) => {
              const displayId = resolveNotebookDisplayId(content);
              const previousOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
              const nextOutput = buildRichNotebookOutput('notebook_display_data', content);
              if (!displayId) {
                return { ...cell, outputs: [...previousOutputs, nextOutput] };
              }

              let replaced = false;
              const outputs = previousOutputs.map((output) => {
                const outputDisplayId = output?.transient?.display_id
                  || output?.metadata?.display_id
                  || null;
                if (outputDisplayId === displayId) {
                  replaced = true;
                  return nextOutput;
                }
                return output;
              });

              return { ...cell, outputs: replaced ? outputs : [...previousOutputs, nextOutput] };
            });
          }
        }
        // Actualizar visualización de datos de ingeniería en vivo (derivado de HTML de pandas)
        try {
          const pseudoOutput = [{
            output_type: 'display_data',
            data: message.content?.data || {},
            metadata: message.content?.metadata || {}
          }];
          const engineered = deriveEngineeringVarsFromOutputs(pseudoOutput, message.cell_id);
          if (onVisualizationData && Object.keys(engineered).length > 0) {
            onVisualizationData({
              variables: engineered,
              executionStates: [],
              totalSteps: 0,
              performanceData: null,
              dependencyGraph: { nodes: [], links: [] }
            });
          }
        } catch (e) { /* noop */ }
        break;

      case 'notebook_display_data':
      case 'notebook_execute_result': {
        const { cell_id, content } = message;
        if (!cell_id) break;
        patchCellById(cell_id, (cell) => {
          const out = buildRichNotebookOutput(message.type, content);
          const prevOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
          return { ...cell, outputs: [...prevOutputs, out] };
        });
        // Derivar variables de ingeniería inmediatamente para la pestaña Datos
        try {
          const pseudoOutput = [{
            output_type: message.type === 'notebook_display_data' ? 'display_data' : 'execute_result',
            data: content?.data || {},
            metadata: content?.metadata || {}
          }];
          const engineered = deriveEngineeringVarsFromOutputs(pseudoOutput, cell_id);
          if (onVisualizationData && Object.keys(engineered).length > 0) {
            onVisualizationData({
              variables: engineered,
              executionStates: [],
              totalSteps: 0,
              performanceData: null,
              dependencyGraph: { nodes: [], links: [] }
            });
          }
        } catch (e) { /* noop */ }
        break;
      }

      case 'notebook_comm_open':
      case 'notebook_comm_msg':
      case 'notebook_comm_close':
        // Placeholder para widgets: avisar al usuario (no interactivo aún)
        onStatusMessage?.('Mensaje de widget recibido (no soportado aún)', 'info');
        break;

      case 'notebook_cell_error':
        if (message?.cell_id && message?.execution_id) {
          const expectedExecutionId = latestExecutionByCellRef.current.get(message.cell_id);
          if (expectedExecutionId && expectedExecutionId !== message.execution_id) {
            logger.log('[NotebookEditor] Ignoring stale notebook_cell_error', {
              cellId: message.cell_id,
              expectedExecutionId,
              receivedExecutionId: message.execution_id,
            });
            break;
          }
        }
        if (message?.cell_id) {
          patchCellById(message.cell_id, (cell) => {
            const prevOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
            const inlineError = buildInlineNotebookErrorOutput(message);
            const lastOutput = prevOutputs[prevOutputs.length - 1];
            if (
              lastOutput?.output_type === 'error'
              && lastOutput?.ename === inlineError.ename
              && lastOutput?.evalue === inlineError.evalue
            ) {
              return cell;
            }
            return { ...cell, outputs: [...prevOutputs, inlineError] };
          });
        }
        if (!executeAllInProgressRef.current) {
          setIsExecuting(false);
        }
        setExecutingCellId(null);
        // Limpiar cola de ejecución para evitar que celdas encoladas se ejecuten tras un error
        executionQueueRef.current = [];
        logger.error('Error ejecutando celda:', message.error);
        failCellRunProgress(message.error || 'Error ejecutando celda');
        if (message?.execution_id && message.execution_id === latestPdfExecutionIdRef.current) {
          resetDocumentPipelineProgress();
        }
        if (pendingExecutionsRef.current.has(message.cell_id)) {
          const pending = pendingExecutionsRef.current.get(message.cell_id);
          if (pending?.executionId && message?.execution_id && pending.executionId !== message.execution_id) {
            break;
          }
          if (pending?.timeoutId) {
            clearTimeout(pending.timeoutId);
          }
          const err = new Error(message.error || 'Error ejecutando celda');
          pending?.reject?.(err);
          pendingExecutionsRef.current.delete(message.cell_id);
        }
        break;

      case 'notebook_progress_update':
        if (message?.execution_id && latestPdfExecutionIdRef.current && message.execution_id !== latestPdfExecutionIdRef.current) {
          break;
        }
        if (message?.execution_id) {
          refreshPendingExecutionLiveness(message.execution_id);
        }
        {
          const inferredScope = message?.progress_scope
            || (message?.progress_stage === 'cell_run' || message?.message === 'Ejecutando celda...' ? 'execution' : 'document');
          if (inferredScope === 'document') {
            const progressStatus = normalizeDocumentPipelineStatusValue(message.progress_status || message.status || 'running');
            const progressPayload = {
              executionId: message.execution_id || latestPdfExecutionIdRef.current,
              stage: message.progress_stage || null,
              status: progressStatus || 'running',
              message: message?.message || 'Procesando documento...',
              percent: message.progress_percent,
              indeterminate: message.progress_indeterminate,
              sharedResource: message.shared_resource || message.sharedResource || null,
            };
            if (isDocumentPipelineCompletedStatus(progressStatus)) {
              completeDocumentPipelineProgress({
                ...progressPayload,
                message: message?.message || 'PDF listo en Documento.',
              });
            } else if (isDocumentPipelineFailedStatus(progressStatus)) {
              failDocumentPipelineProgress(progressPayload);
            } else if (isDocumentPipelineCancelledStatus(progressStatus)) {
              resetDocumentPipelineProgress();
            } else {
              updateDocumentPipelineProgress(progressPayload);
            }
          } else {
            setCellRunProgress((prev) => {
              if (!prev.visible || prev.status !== 'running') {
                return prev;
              }
              return {
                ...prev,
                message: message?.message || prev.message,
              };
            });
          }
        }

        // Si hay error, mostrar toast
        if (!message.success && message.error_name) {
          onStatusMessage?.(`Error en celda: ${message.error_name}: ${message.error_value || ''}`, 'error', {
            target: createNotebookCodeTarget({
              filePath,
              cellId: message.cell_id || null,
            }),
          });
        }
        break;

      case 'notebook_execution_cancelled':
        if (!executeAllInProgressRef.current) {
          setIsExecuting(false);
          setExecutingCellId(null);
        }
        failCellRunProgress('Ejecución cancelada.');
        resetDocumentPipelineProgress();
        onStatusMessage?.('Ejecucion cancelada', 'warning', {
          target: createNotebookCodeTarget({
            filePath,
            cellId: executingCellId || null,
          }) || createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      case 'notebook_kernel_reset':
        hardResetInFlightRef.current = false;
        // Limpiar outputs de todas las celdas sin capturar 'notebook' del cierre
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(prev => {
          if (!prev) return prev;
          return stripNotebookRuntimeState(prev);
        });
        onClearRuntimeData?.();
        flushPendingExecutions(new Error('kernel_reset'));
        executeAllInProgressRef.current = false;
        setIsExecuting(false);
        setExecutingCellId(null);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        updateKernelInterrupted(false);
        resetCellRunProgress();
        resetDocumentPipelineProgress();
        onStatusMessage?.('Kernel reiniciado', 'info', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      case 'notebook_kernel_interrupted':
        flushPendingExecutions(new Error('kernel_interrupted'));
        executeAllInProgressRef.current = false;
        setIsExecuting(false);
        setExecutingCellId(null);
        latestPdfExecutionIdRef.current = null;
        updateKernelInterrupted(true);
        failCellRunProgress('Kernel interrumpido.');
        resetDocumentPipelineProgress();
        onStatusMessage?.('Kernel interrumpido', 'warning', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      case 'notebook_kernel_shutdown':
        hardResetInFlightRef.current = false;
        setKernelId(null);
        rejectKernelInit(new Error('kernel_shutdown'));
        flushPendingExecutions(new Error('kernel_shutdown'));
        executeAllInProgressRef.current = false;
        setIsExecuting(false);
        setExecutingCellId(null);
        setIsCreating(false);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        updateKernelInterrupted(false);
        resetCellRunProgress();
        resetDocumentPipelineProgress();
        onStatusMessage?.('Kernel apagado', 'info', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      case 'notebook_saved':
        // Descargar el archivo
        downloadNotebook(message.content);
        onStatusMessage?.('Notebook guardado', 'success', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      case 'notebook_error':
        logger.error('Error de notebook:', message.error);
        if (message?.cell_id) {
          patchCellById(message.cell_id, (cell) => {
            const prevOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
            const inlineError = buildInlineNotebookErrorOutput(message);
            const lastOutput = prevOutputs[prevOutputs.length - 1];
            if (
              lastOutput?.output_type === 'error'
              && lastOutput?.ename === inlineError.ename
              && lastOutput?.evalue === inlineError.evalue
            ) {
              return cell;
            }
            return { ...cell, outputs: [...prevOutputs, inlineError] };
          });
        }
        if (
          message?.error_code === 'notebook_reset_kernel_failed'
          && attemptHardKernelReset()
        ) {
          break;
        }
        setIsCreating(false);
        if (createTimeoutRef.current) {
          clearTimeout(createTimeoutRef.current);
          createTimeoutRef.current = null;
        }
        if (
          message?.error_code === 'notebook_create_failed'
          || message?.error_code === 'notebook_load_failed'
          || !kernelIdRef.current
        ) {
          setKernelId(null);
          rejectKernelInit(new Error(message.error || 'notebook_error'));
        }
        flushPendingExecutions(new Error(message.error || 'notebook_error'));
        executeAllInProgressRef.current = false;
        setIsExecuting(false);
        setExecutingCellId(null);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        hardResetInFlightRef.current = false;
        failCellRunProgress(message.error || 'Error de notebook');
        resetDocumentPipelineProgress();
        onStatusMessage?.(`Error: ${message.error}`, 'error', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        break;

      // Mensajes de análisis de dependencias - ahora se pasan vía prop 'lastMessage' al componente DependencyGraph
      case 'dependency_analysis_result':
      case 'impact_analysis_result':
      case 'dependency_analysis_error':
      case 'impact_analysis_error':
      case 'sensitivity_result':
      case 'optimization_progress':
      case 'optimization_result':
      case 'optimization_error':
      case 'load_envelope_result':
      case 'load_envelope_error':
      case 'code_checks_result':
      case 'code_checks_error':
      case 'scenario_comparison_result':
      case 'scenario_comparison_error':
        // Ignorar en este handler centralizado
        break;

      default:
        logger.log('Mensaje de notebook no manejado:', message.type);
        break;
    }

  }, [applyNotebookDocumentPayload, attemptHardKernelReset, executingCellId, filePath, onClearRuntimeData, onVisualizationData, updateCellOutput, onStatusMessage, flushPendingExecutions, refreshPendingExecutionLiveness, updateKernelInterrupted, normalizeNotebook, resolveKernelInit, rejectKernelInit, patchCellById, selectedCellId, completeCellRunProgress, updateDocumentPipelineProgress, completeDocumentPipelineProgress, failDocumentPipelineProgress, failCellRunProgress, resetCellRunProgress, resetDocumentPipelineProgress]);

  // Ref para evitar stale closure en el useEffect de lastMessage
  const handleWebSocketMessageRef = useRef(handleWebSocketMessage);
  useEffect(() => {
    handleWebSocketMessageRef.current = handleWebSocketMessage;
  }, [handleWebSocketMessage]);

  useEffect(() => {
    if (preferShellMessageRelay) {
      return undefined;
    }
    if (!lastMessageListenerPrimedRef.current) {
      lastMessageListenerPrimedRef.current = true;
      if (lastMessage && hasShellOwnedHydration) {
        return;
      }
    }
    if (lastMessage && shouldAcceptNotebookMessage(lastMessage)) {
      // Usar ref para garantizar que siempre llamamos la versión más reciente del handler
      handleWebSocketMessageRef.current(lastMessage);
    }
    // Solo depender de lastMessage para evitar bucles innecesarios
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShellOwnedHydration, lastMessage, preferShellMessageRelay, shouldAcceptNotebookMessage]);

  const consumeRemoteNotebookMessage = useCallback((message) => {
    if (!message?.type) return false;
    handleWebSocketMessageRef.current(message);
    return true;
  }, []);

  const createNewNotebook = () => {
    if (connectionStatus === 'connected') {
      setIsCreating(true);
      onStatusMessage?.('Creando notebook...', 'info', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      // Fallback por si no llega respuesta
      if (createTimeoutRef.current) {
        clearTimeout(createTimeoutRef.current);
      }
      createTimeoutRef.current = setTimeout(() => {
        if (isCreating) {
          setIsCreating(false);
          onStatusMessage?.('Tiempo de espera creando notebook. Verifica el backend.', 'warning', {
            target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
          });
        }
      }, 15000);
      sendMessage({
        type: 'notebook_create',
        previous_kernel_id: kernelIdRef.current || undefined,
        path: filePath || undefined,
      });
    }
  };

  const executionQueueRef = useRef([]);
  const executeCellRef = useRef(null); // Ref para evitar dependencia circular

  // Process execution queue when the editor has no active local or shell-owned execution lock
  useEffect(() => {
    if (!effectiveExecutionLock && executionQueueRef.current.length > 0 && connectionStatus === 'connected') {
      const nextCellId = executionQueueRef.current.shift();
      // Usar ref para evitar dependencia circular
      if (executeCellRef.current) {
        executeCellRef.current(nextCellId);
      }
    }
  }, [connectionStatus, effectiveExecutionLock]);

  const executeCell = useCallback(async (cellId, source) => {
    const initialActiveKernelId = getActiveKernelId();
    logger.log('[NotebookEditor] executeCell called:', {
      cellId,
      isExecuting,
      hasActiveShellBatchRun,
      connectionStatus,
      hasKernel: !!initialActiveKernelId,
    });

    const currentNotebook = notebookRef.current || notebook;
    const targetCell = currentNotebook?.cells?.find((cell) => cell.id === cellId) || null;
    const targetCellType = normalizeNotebookCellType(targetCell?.cell_type);
    if (targetCell && isDocxCell(targetCell) && !autoDocEnabled) {
      onStatusMessage?.('Celda DOCX omitida: DOCX/PDF esta desactivado.', 'info', {
        target: createNotebookCodeTarget({
          filePath,
          cellId,
        }),
      });
      return;
    }

    // If already executing, queue this cell
    if (effectiveExecutionLock) {
      logger.log('[NotebookEditor] Cell queued (already executing):', cellId);
      // Avoid duplicates in queue if needed, or allow re-runs
      if (!executionQueueRef.current.includes(cellId)) {
        executionQueueRef.current.push(cellId);
        onStatusMessage?.('Celda encolada para ejecución', 'info', {
          target: createNotebookCodeTarget({
            filePath,
            cellId,
          }),
        });
      }
      return;
    }

    if (connectionStatus !== 'connected') {
      onStatusMessage?.('WebSocket desconectado. Reintenta.', 'warning', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      return;
    }
    if (!notebook) {
      onStatusMessage?.('Notebook no cargado.', 'warning', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      return;
    }
    try {
      resetCellRunProgress();
      resetDocumentPipelineProgress();
      setIsExecuting(true);
      setExecutingCellId(cellId);

      // Check for sourceCode mapping or get from notebook (safety)
      let sourceCode = source;
      if (sourceCode === undefined) {
        const found = currentNotebook.cells.find(c => c.id === cellId);
        if (found) sourceCode = found.source;
      }

      const needsKernelStart = !initialActiveKernelId;
      let executionTimeout = null;
      let executionId = null;
      if (needsKernelStart) {
        executionTimeout = calculateExecutionTimeout(notebook.cells.length);
        executionId = nextExecutionId(cellId);
        latestPdfExecutionIdRef.current = executionId;
        const pendingRequest = {
          kind: 'single_cell',
          filePath,
          cellId,
          cellType: targetCellType,
          source: sourceCode,
          executionId,
          executionTimeoutMs: executionTimeout,
          enableTracing,
          emitDocx: autoDocEnabled,
          docxValidation: docxValidationEnabled,
          detached: false,
        };
        pendingExecutionRequestRef.current = pendingRequest;
        notifyPendingExecutionRequestChange(pendingRequest);
      }

      const ensureResult = initialActiveKernelId
        ? { kernelId: initialActiveKernelId, notebook: notebookRef.current || notebook }
        : await ensureKernel();
      const activeKernelId = ensureResult.kernelId || ensureResult; // Handle object or string (legacy check)
      if (!isMountedRef.current) {
        return;
      }

      if (needsKernelStart) {
        pendingExecutionRequestRef.current = null;
        notifyPendingExecutionRequestChange(null);
      }

      if (pendingExecutionsRef.current.has(cellId)) {
        const existing = pendingExecutionsRef.current.get(cellId);
        if (existing?.timeoutId) {
          clearTimeout(existing.timeoutId);
        }
        pendingExecutionsRef.current.delete(cellId);
      }

      if (executionTimeout == null) {
        executionTimeout = calculateExecutionTimeout(notebook.cells.length);
      }
      if (executionId == null) {
        executionId = nextExecutionId(cellId);
        latestPdfExecutionIdRef.current = executionId;
      }
      beginSingleCellRunProgress(executionId);
      const onTimeout = () => {
        const timeoutMessage = buildExecutionTimeoutMessage(cellId, executionId);
        logger.warn('[NotebookEditor] Single-cell execution timed out waiting for terminal message', {
          cellId,
          executionId,
          executionTimeout,
        });
        sendMessage({
          type: 'notebook_cancel_execution',
          kernel_id: activeKernelId,
          execution_id: executionId,
        });
        if (!executeAllInProgressRef.current && isMountedRef.current) {
          setIsExecuting(false);
          setExecutingCellId(null);
        }
        failCellRunProgress(timeoutMessage);
        onStatusMessage?.(`Ejecución interrumpida: ${timeoutMessage}`, 'warning', {
          target: createNotebookCodeTarget({
            filePath,
            cellId,
          }),
        });
      };
      const pendingExecution = schedulePendingExecutionTimeout(
        cellId,
        executionId,
        executionTimeout + EXECUTION_TIMEOUT_GRACE_MS,
        onTimeout,
      );
      pendingExecutionsRef.current.set(cellId, pendingExecution);

      sendMessage({
        type: 'notebook_execute_cell',
        kernel_id: activeKernelId,
        execution_id: executionId,
        cell_id: cellId,
        cell_type: targetCellType,
        path: filePath || undefined,
        source: sourceCode,
        execution_timeout_s: executionTimeout / 1000,
        enable_tracing: enableTracing,
        emit_docx: autoDocEnabled,
        docx_validation: docxValidationEnabled
      });
    } catch (err) {
      logger.error('No se pudo iniciar/usar kernel:', err);
      pendingExecutionRequestRef.current = null;
      notifyPendingExecutionRequestChange(null);
      if (pendingExecutionsRef.current.has(cellId)) {
        const pending = pendingExecutionsRef.current.get(cellId);
        if (pending?.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        pendingExecutionsRef.current.delete(cellId);
      }
      onStatusMessage?.(`No se pudo iniciar kernel: ${err.message || err}`, 'error', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      setIsExecuting(false);
      setExecutingCellId(null);
      failCellRunProgress(err?.message || 'No se pudo iniciar el kernel');
    }
  }, [autoDocEnabled, beginSingleCellRunProgress, connectionStatus, docxValidationEnabled, effectiveExecutionLock, enableTracing, ensureKernel, failCellRunProgress, filePath, getActiveKernelId, hasActiveShellBatchRun, isExecuting, nextExecutionId, notebook, notifyPendingExecutionRequestChange, onStatusMessage, resetCellRunProgress, resetDocumentPipelineProgress, schedulePendingExecutionTimeout, sendMessage]);

  const runActiveCell = useCallback(() => {
    if (!notebook || !Array.isArray(notebook.cells)) {
      onStatusMessage?.('Notebook no cargado.', 'warning', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      return false;
    }

    const selectedCodeCell = selectedCellId
      ? notebook.cells.find((cell) => cell.id === selectedCellId && isRunnableNotebookCell(cell, { includeDocx: autoDocEnabled }))
      : null;
    const firstCodeCell = notebook.cells.find((cell) => isRunnableNotebookCell(cell, { includeDocx: autoDocEnabled })) || null;
    const targetCell = selectedCodeCell || firstCodeCell;

    if (!targetCell) {
      onStatusMessage?.(
        autoDocEnabled
          ? 'No hay celdas ejecutables para ejecutar.'
          : 'No hay celdas de codigo para ejecutar con DOCX/PDF desactivado.',
        'warning',
        {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        },
      );
      return false;
    }

    setSelectedCellId(targetCell.id);
    executeCell(targetCell.id, targetCell.source);
    return true;
  }, [autoDocEnabled, executeCell, filePath, notebook, onStatusMessage, selectedCellId]);

  // Actualizar ref para evitar dependencia circular en useEffect
  useEffect(() => {
    executeCellRef.current = executeCell;
  }, [executeCell]);

  // Keyboard shortcut: Ctrl+Enter to execute selected cell
  useEffect(() => {
    if (typeof window !== 'undefined' && window.inspyroDesktop?.isDesktop) {
      return undefined;
    }

    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (selectedCellId && notebook && connectionStatus === 'connected') {
          const cell = notebook.cells.find(c => c.id === selectedCellId);
          if (cell && isPythonNotebookCell(cell)) {
            executeCell(selectedCellId, cell.source);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCellId, notebook, connectionStatus, executeCell]);

  const executeAll = useCallback(async () => {
    if (!notebook || connectionStatus !== 'connected' || executeAllInProgressRef.current) {
      return;
    }
    // Clear queue when running all to avoid conflicts
    executionQueueRef.current = [];

    // Incrementar runId para esta sesión - cualquier sesión anterior será invalidada
    executeAllRunIdRef.current += 1;
    const currentRunId = executeAllRunIdRef.current;

    executeAllInProgressRef.current = true;
    updateKernelInterrupted(false);
    resetCellRunProgress();
    resetDocumentPipelineProgress();
    let totalCodeCells = 0;
    let completedCodeCells = 0;
    let batchErrorMessage = null;
    let batchFailed = false;
    let lastAttemptedCellId = null;
    try {
      const activeKernelId = getActiveKernelId();
      const ensureResult = activeKernelId
        ? { kernelId: activeKernelId, notebook: notebookRef.current || notebook }
        : await ensureKernel();
      if (!isMountedRef.current) return;
      // Si se acaba de inicializar, ensureResult.notebook tiene los IDs actualizados
      const resolvedKernelId = ensureResult.kernelId || ensureResult;

      // Verificar que seguimos siendo la sesión activa después del await
      if (currentRunId !== executeAllRunIdRef.current) {
        logger.warn('executeAll: Sesión reemplazada por otra ejecución');
        return;
      }

      setIsExecuting(true);

      // Usar el notebook más reciente:
      // 1. Del resultado de load/create si existe (garantiza IDs sincronizados)
      // 2. Del ref (puede estar pendiente de update si fue muy rápido)
      // 3. Del state actual (closure)
      const currentNotebook = (ensureResult.notebook) || notebookRef.current || notebook;

      // Validación contra null para evitar errores
      if (!currentNotebook || !Array.isArray(currentNotebook.cells)) {
        logger.error('executeAll: Notebook no disponible o sin celdas');
        onStatusMessage?.('Error: Notebook no disponible', 'error', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
        return;
      }

      const cellsToRun = currentNotebook.cells;

      // Identify runnable cells to know which is the last one
      const codeCells = cellsToRun.filter(c => isRunnableNotebookCell(c, { includeDocx: autoDocEnabled }));
      totalCodeCells = codeCells.length;
      const lastCodeCellId = codeCells.length > 0 ? codeCells[codeCells.length - 1].id : null;

      beginBatchCellRunProgress(codeCells.length, currentRunId);

      for (const cell of cellsToRun) {
        // Verificar que seguimos siendo la sesión activa
        if (currentRunId !== executeAllRunIdRef.current) {
          logger.warn('executeAll: Sesión invalidada durante ejecución');
          break;
        }
        if (kernelInterruptedRef.current || !isMountedRef.current) break;
        if (!isRunnableNotebookCell(cell, { includeDocx: autoDocEnabled })) continue;
        lastAttemptedCellId = cell.id;
        setExecutingCellId(cell.id);
        if (pendingExecutionsRef.current.has(cell.id)) {
          const existing = pendingExecutionsRef.current.get(cell.id);
          if (existing?.timeoutId) {
            clearTimeout(existing.timeoutId);
          }
          pendingExecutionsRef.current.delete(cell.id);
        }
        // Reutiliza el presupuesto canónico por celda para todo el batch.
        const executionTimeout = calculateExecutionTimeout(cellsToRun.length);
        const executionId = nextExecutionId(cell.id);

        const promise = new Promise((resolve, reject) => {
          const onTimeout = () => {
            const timeoutMessage = buildExecutionTimeoutMessage(cell.id, executionId);
            logger.warn('[NotebookEditor] RunAll execution timed out waiting for terminal message', {
              cellId: cell.id,
              executionId,
              currentRunId,
              executionTimeout,
            });
            sendMessage({
              type: 'notebook_cancel_execution',
              kernel_id: resolvedKernelId,
              execution_id: executionId,
            });
            reject(new Error(timeoutMessage));
          };
          const pendingExecution = schedulePendingExecutionTimeout(
            cell.id,
            executionId,
            executionTimeout + EXECUTION_TIMEOUT_GRACE_MS,
            onTimeout,
          );
          pendingExecutionsRef.current.set(cell.id, {
            resolve,
            reject,
            ...pendingExecution,
          });
        });

        // Skip PDF for all but the last code cell to improve performance
        const isLast = cell.id === lastCodeCellId;
        if (isLast) {
          latestPdfExecutionIdRef.current = executionId;
        }

        sendMessage({
          type: 'notebook_execute_cell',
          kernel_id: resolvedKernelId,
          execution_id: executionId,
          cell_id: cell.id,
          cell_type: normalizeNotebookCellType(cell.cell_type),
          path: filePath || undefined,
          source: cell.source,
          execution_timeout_s: executionTimeout / 1000,
          enable_tracing: enableTracing,
          emit_docx: autoDocEnabled,
          docx_validation: docxValidationEnabled,
          skip_pdf: !isLast // Optimization: only generate PDF for final state
        });
        await promise;
        completedCodeCells += 1;
        advanceBatchCellRunProgress(completedCodeCells);
        if (kernelInterruptedRef.current || !isMountedRef.current) break;
      }
      if (kernelInterruptedRef.current) {
        batchFailed = true;
        batchErrorMessage = 'La ejecucion Run All fue interrumpida.';
      }
    } catch (err) {
      logger.error('Ejecución interrumpida por error:', err);
      onStatusMessage?.(`Ejecución interrumpida: ${err.message}`, 'warning', {
        target: createNotebookCodeTarget({
          filePath,
          cellId: lastAttemptedCellId || executingCellId || null,
        }) || createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      batchFailed = true;
      batchErrorMessage = err?.message || 'La ejecucion Run All no pudo completarse.';
    } finally {
      if (currentRunId === executeAllRunIdRef.current && onBatchExecutionEvent && totalCodeCells > 0) {
        onBatchExecutionEvent({
          status: batchFailed ? 'failed' : 'completed',
          total: totalCodeCells,
          executed: completedCodeCells,
          error: batchErrorMessage,
          runId: currentRunId,
        });
      }
      // Solo limpiar estado si seguimos siendo la sesión activa
      // Esto evita que una sesión anterior corrompa el estado de una nueva
      if (currentRunId === executeAllRunIdRef.current && isMountedRef.current) {
        executeAllInProgressRef.current = false;
        setIsExecuting(false);
        setExecutingCellId(null);
        updateKernelInterrupted(false);
        if (batchFailed) {
          failCellRunProgress(batchErrorMessage || 'La ejecución del notebook no pudo completarse.');
        } else if (totalCodeCells > 0) {
          completeCellRunProgress(`Todas las ${totalCodeCells} celdas terminaron.`);
        } else {
          resetCellRunProgress();
        }
      }
      // Queue processing will resume naturally via useEffect if items were added during executeAll
    }
  }, [advanceBatchCellRunProgress, autoDocEnabled, beginBatchCellRunProgress, completeCellRunProgress, connectionStatus, docxValidationEnabled, enableTracing, ensureKernel, executingCellId, failCellRunProgress, filePath, getActiveKernelId, nextExecutionId, notebook, onBatchExecutionEvent, onStatusMessage, resetCellRunProgress, resetDocumentPipelineProgress, schedulePendingExecutionTimeout, sendMessage, updateKernelInterrupted]);

  // updateCell, addCell, deleteCell, moveCell are now provided by useCellOperations hook

  const resetKernel = useCallback(() => {
    const activeKernelId = getActiveKernelId();
    if (connectionStatus === 'connected' && activeKernelId) {
      sendMessage({
        type: 'notebook_reset_kernel',
        kernel_id: activeKernelId
      });
    }
  }, [connectionStatus, getActiveKernelId, sendMessage]);

  const interruptKernel = useCallback(() => {
    const activeKernelId = getActiveKernelId();
    if (connectionStatus === 'connected' && activeKernelId) {
      sendMessage({
        type: 'notebook_interrupt_kernel',
        kernel_id: activeKernelId
      });
    }
  }, [connectionStatus, getActiveKernelId, sendMessage]);

  const shutdownKernel = useCallback(() => {
    const activeKernelId = getActiveKernelId();
    if (connectionStatus === 'connected' && activeKernelId) {
      sendMessage({
        type: 'notebook_shutdown_kernel',
        kernel_id: activeKernelId
      });
    }
  }, [connectionStatus, getActiveKernelId, sendMessage]);

  const saveNotebook = useCallback(() => {
    if (connectionStatus === 'connected' && notebook) {
      sendMessage({
        type: 'notebook_save',
        notebook: notebook,
        path: filePath || undefined,
      });
    }
  }, [connectionStatus, notebook, sendMessage, filePath]);

  const loadNotebook = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const parsed = JSON.parse(content);
        const normalized = normalizeNotebook(parsed);
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(normalized);
        setKernelId(null);
        kernelRequestSentRef.current = false;
        kernelInterruptedRef.current = false;
        setKernelInterrupted(false);
        latestExecutionByCellRef.current.clear();
        latestPdfExecutionIdRef.current = null;
        pendingExecutionsRef.current.clear();
        if (kernelStartTimeoutRef.current) {
          clearTimeout(kernelStartTimeoutRef.current);
          kernelStartTimeoutRef.current = null;
        }
        kernelInitPromiseRef.current = null;
        kernelInitResolverRef.current = { resolve: null, reject: null };
        resolveKernelInit(null);
        onStatusMessage?.('Notebook cargado. Ejecuta una celda para iniciar el kernel.', 'info', {
          target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
        });
      } catch (err) {
        logger.error('Error cargando notebook local:', err);
        onStatusMessage?.(`Error leyendo notebook: ${err.message || err}`, 'error');
      }
    };
    reader.readAsText(file);
  }, [filePath, normalizeNotebook, resolveKernelInit, onStatusMessage]);

  const downloadNotebook = (content) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notebook.ipynb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getPersistableNotebook = useCallback(() => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook || !Array.isArray(currentNotebook.cells)) {
      return currentNotebook;
    }
    return stripNotebookRuntimeState(currentNotebook);
  }, []);

  const serializeCellSource = useCallback((source) => {
    if (Array.isArray(source)) {
      const hasExplicitBreaks = source.some((line) => (
        typeof line === 'string' && /[\r\n]/.test(line)
      ));
      const text = hasExplicitBreaks ? source.join('') : source.join('\n');
      return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
    if (typeof source === 'string') {
      return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
    return '';
  }, []);

  const resolveCellIndexForNavigation = useCallback((navigation) => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook || !Array.isArray(currentNotebook.cells)) {
      return null;
    }

    if (navigation?.cellId) {
      const byIdIndex = currentNotebook.cells.findIndex((cell) => cell.id === navigation.cellId);
      if (byIdIndex >= 0) {
        return byIdIndex;
      }
    }

    if (
      Number.isInteger(navigation?.cellIndex) &&
      navigation.cellIndex >= 0 &&
      navigation.cellIndex < currentNotebook.cells.length
    ) {
      return navigation.cellIndex;
    }

    return null;
  }, []);

  const resolveFallbackCellIndexForNavigation = useCallback((navigation) => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook || !Array.isArray(currentNotebook.cells) || currentNotebook.cells.length === 0) {
      return null;
    }

    const rawLine = Number(navigation?.line);
    if (!Number.isFinite(rawLine) || rawLine <= 0) {
      return null;
    }

    const desiredLine = Math.max(1, Math.floor(rawLine));
    const rankedCandidates = currentNotebook.cells
      .map((cell, index) => {
        const lineCount = Math.max(1, serializeCellSource(cell?.source).split('\n').length);
        const hasEnoughLines = lineCount >= desiredLine;
        return {
          index,
          lineCount,
          enoughLinesPriority: hasEnoughLines ? 0 : 1,
          typePriority: isPythonNotebookCell(cell) ? 0 : 1,
          overshoot: Math.abs(lineCount - desiredLine),
        };
      })
      .sort((left, right) => (
        left.enoughLinesPriority - right.enoughLinesPriority
        || left.typePriority - right.typePriority
        || left.overshoot - right.overshoot
        || left.index - right.index
      ));

    return rankedCandidates[0]?.index ?? null;
  }, [serializeCellSource]);

  const navigateToCode = useCallback((navigation) => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook || !Array.isArray(currentNotebook.cells) || currentNotebook.cells.length === 0) {
      onStatusMessage?.('No hay un notebook activo para navegar', 'warning', {
        target: createNotebookFileTarget(filePath, { actionLabel: 'Abrir notebook' }),
      });
      return false;
    }

    const directTargetCellIndex = resolveCellIndexForNavigation(navigation);
    const fallbackTargetCellIndex = directTargetCellIndex === null
      ? resolveFallbackCellIndexForNavigation(navigation)
      : null;
    const targetCellIndex = directTargetCellIndex ?? fallbackTargetCellIndex;

    if (targetCellIndex === null) {
      onStatusMessage?.('No se pudo ubicar la celda de destino solicitada', 'warning', {
        target: createNotebookCodeTarget({
          filePath: navigation?.filePath || filePath,
          cellId: navigation?.cellId || null,
          cellIndex: Number.isInteger(navigation?.cellIndex) ? navigation.cellIndex : null,
          line: Number.isInteger(navigation?.line) ? navigation.line : null,
          column: Number.isInteger(navigation?.column) ? navigation.column : null,
        }),
      });
      return false;
    }

    if (directTargetCellIndex === null && fallbackTargetCellIndex !== null) {
      logger.log('[NotebookEditor] Falling back to notebook line-based navigation', {
        requestedCellId: navigation?.cellId || null,
        requestedLine: navigation?.line || null,
        resolvedCellIndex: fallbackTargetCellIndex,
      });
    }

    const targetCell = currentNotebook.cells[targetCellIndex];
    const rawLine = Number(navigation?.line);
    const rawColumn = Number(navigation?.column);
    const desiredLine = Number.isFinite(rawLine) && rawLine > 0 ? Math.floor(rawLine) : 1;
    const targetColumn = Number.isFinite(rawColumn) && rawColumn >= 0 ? Math.floor(rawColumn) : 0;
    const targetCellSource = serializeCellSource(targetCell.source);
    const lineCount = Math.max(1, targetCellSource.split('\n').length);
    const targetLine = Math.min(desiredLine, lineCount);

    setSelectedCellId(targetCell.id);
    setHighlightedLine({
      cellIndex: targetCellIndex,
      line: targetLine,
      column: targetColumn,
      token: Date.now(),
    });

    const targetCellElement = cellRefs.current[targetCellIndex];
    if (targetCellElement?.scrollIntoView) {
      targetCellElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (highlightClearTimeoutRef.current) {
      clearTimeout(highlightClearTimeoutRef.current);
    }
    highlightClearTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setHighlightedLine(null);
      }
      highlightClearTimeoutRef.current = null;
    }, 4500);

    return true;
  }, [filePath, onStatusMessage, resolveCellIndexForNavigation, resolveFallbackCellIndexForNavigation, serializeCellSource]);

  const focusCell = useCallback((cellId) => {
    if (!cellId) return false;
    return navigateToCode({ cellId });
  }, [navigateToCode]);

  const replaceNotebookSnapshot = useCallback((snapshot, meta = {}) => {
    const normalized = normalizeNotebook(snapshot);
    if (!normalized) return false;

    notebookChangeReasonRef.current = 'runtime';
    notebookRef.current = normalized;
    setNotebook(normalized);

    if (typeof meta.kernelId === 'string' && meta.kernelId) {
      setKernelId(meta.kernelId);
      kernelIdRef.current = meta.kernelId;
    }

    const focusCellId = meta.focusCellId || meta.focus_cell_id || null;
    if (focusCellId) {
      setTimeout(() => {
        if (isMountedRef.current) {
          focusCell(focusCellId);
        }
      }, 0);
    }

    return true;
  }, [focusCell, normalizeNotebook]);

  useEffect(() => {
    return () => {
      if (createTimeoutRef.current) {
        clearTimeout(createTimeoutRef.current);
      }
      if (kernelStartTimeoutRef.current) {
        clearTimeout(kernelStartTimeoutRef.current);
      }
      kernelInitPromiseRef.current = null;
      kernelInitResolverRef.current = { resolve: null, reject: null };
      if (pendingExecutionRequestRef.current) {
        const detachedRequest = {
          ...pendingExecutionRequestRef.current,
          detached: true,
        };
        pendingExecutionRequestRef.current = detachedRequest;
        notifyPendingExecutionRequestChange(detachedRequest);
      }
      flushPendingExecutions(new Error('component_unmounted'), { reject: false });
      if (highlightClearTimeoutRef.current) {
        clearTimeout(highlightClearTimeoutRef.current);
        highlightClearTimeoutRef.current = null;
      }
      clearCellRunHideTimeout();
      clearDocumentPipelineHideTimeout();
    };
  }, [flushPendingExecutions, clearCellRunHideTimeout, clearDocumentPipelineHideTimeout, notifyPendingExecutionRequestChange]);

  // Exponer acciones al padre via actionsRef
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        addCode: () => addCell(-1, 'code'),
        addMarkdown: () => addCell(-1, 'markdown'),
        executeAll,
        runActiveCell,
        interrupt: interruptKernel,
        reset: resetKernel,
        shutdown: shutdownKernel,
        save: saveNotebook,
        load: loadNotebook,
        clearOutputs: clearAllOutputs,
        // NEW: Direct access to current notebook state for reliable saving
        getNotebook: () => notebook,
        getPersistableNotebook,
        getExecutionState: () => ({
          isExecuting: effectiveExecutionLock,
          executingCellId: effectiveExecutingCellId,
          executeAllInProgress: executeAllInProgressRef.current,
          pendingExecutionCount: pendingExecutionsRef.current.size,
          shellBatchActive: hasActiveShellBatchRun,
        }),
        navigateToCode,
        focusCell,
        replaceNotebookSnapshot,
        consumeRemoteNotebookMessage,
      };
    }
  }, [actionsRef, addCell, clearAllOutputs, consumeRemoteNotebookMessage, effectiveExecutingCellId, effectiveExecutionLock, executeAll, focusCell, hasActiveShellBatchRun, interruptKernel, resetKernel, runActiveCell, shutdownKernel, saveNotebook, loadNotebook, notebook, getPersistableNotebook, navigateToCode, replaceNotebookSnapshot]);

  // Sincronizar estado del kernel con el padre
  useEffect(() => {
    if (onKernelStateChange) {
      if (filePathChangedThisRender && kernelId !== shellKernelId) {
        return;
      }
      onKernelStateChange({
        filePath: normalizedFilePath,
        kernelId,
        kernelInterrupted,
        ...(hasActiveShellBatchRun ? {} : {
          isExecuting,
          executingCellId,
          isCreating,
        }),
        hasNotebook: !!notebook,
      });
    }
  }, [executingCellId, filePathChangedThisRender, hasActiveShellBatchRun, isCreating, isExecuting, kernelId, kernelInterrupted, normalizedFilePath, notebook, onKernelStateChange, shellKernelId]);

  // Handle global click to deselect when clicking outside cells
  useEffect(() => {
    const handleGlobalClick = (e) => {
      // If clicking inside a cell or a dropdown/portal, do nothing
      if (e.target.closest('.notebook-cell') ||
        e.target.closest('.dropdown-menu-container') ||
        e.target.closest('.add-cell-btn')) {
        return;
      }

      // Otherwise, deselect
      setSelectedCellId(null);
    };

    document.addEventListener('mousedown', handleGlobalClick);
    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
    };
  }, []);

  // Handle cell selection without forcing scroll position
  const handleCellSelect = useCallback((cellId) => {
    setSelectedCellId(cellId);
  }, []);

  const handleCellDeselect = useCallback((cellId) => {
    setSelectedCellId(prev => (prev === cellId ? null : prev));
  }, []);

  useEffect(() => {
    onSelectedCellChange?.(selectedCellId);
  }, [onSelectedCellChange, selectedCellId]);

  const handleMoveUp = useCallback((cellId) => {
    moveCell(cellId, 'up');
  }, [moveCell]);

  const handleMoveDown = useCallback((cellId) => {
    moveCell(cellId, 'down');
  }, [moveCell]);

  const handleShowDependencyTree = useCallback((cellId, info) => {
    const currentNotebook = notebookRef.current;
    if (!currentNotebook) return;

    const index = currentNotebook.cells.findIndex(c => c.id === cellId);
    if (index === -1) return;

    const cell = currentNotebook.cells[index];
    const cellSource = serializeCellSource(cell.source);

    // For dependency analysis (backwards), we only need preceding cells.
    // For impact analysis (forwards/global), we theoretically need all cells or subsequent cells.
    // To match backend logic which appends the current cell at the end, we extract all other code cells.
    let contextCells = [];
    if (info.mode === 'impact') {
      contextCells = currentNotebook.cells.filter(c => isPythonNotebookCell(c) && c.id !== cellId);
    } else {
      contextCells = currentNotebook.cells.slice(0, index).filter(isPythonNotebookCell);
    }

    const contextCellsCode = contextCells.map(c => serializeCellSource(c.source));
    const contextCellIds = contextCells.map(c => c.id);

    setDependencyTarget({
      requestToken: `notebook_dependency_${Date.now()}_${++dependencyRequestSeqRef.current}`,
      symbol: info.symbol,
      sourceCode: cellSource,
      line: info.line,
      column: info.column,
      mode: info.mode,
      notebookContext: contextCellsCode,
      contextCellIds: contextCellIds,
      cellId: cellId
    });
  }, [serializeCellSource]);  // Si hay un initialNotebook pero notebook aún es null, significa que estamos cargando
  const shellOwnedProcessRail = buildShellBatchExecutionRail(shellBatchRunState);
  const activeProcessRail = shellOwnedProcessRail
    || (cellRunProgress.visible
      ? {
        tone: 'execution',
        label: cellRunProgress.label || 'Ejecutando notebook',
        message: cellRunProgress.message || 'Procesando código...',
        percent: cellRunProgress.percent || 0,
        indeterminate: cellRunProgress.mode === 'indeterminate' && cellRunProgress.status === 'running',
        status: cellRunProgress.status,
        meta: cellRunProgress.mode === 'determinate' && cellRunProgress.total > 0
          ? `${Math.round(cellRunProgress.percent)}%`
          : (cellRunProgress.status === 'completed' ? 'Listo' : 'En curso'),
      }
      : documentPipelineProgress.visible
      ? {
        tone: 'document',
        label: documentPipelineProgress.label || 'Generando documento',
        message: documentPipelineProgress.message || 'Procesando documento...',
        percent: documentPipelineProgress.percent || 0,
        indeterminate: documentPipelineProgress.indeterminate && documentPipelineProgress.status === 'running',
        status: documentPipelineProgress.status,
        meta: documentPipelineProgress.stage
          ? `${DOCUMENT_STAGE_LABELS[documentPipelineProgress.stage] || documentPipelineProgress.stage} · ${Math.round(documentPipelineProgress.percent || 0)}%`
          : `${Math.round(documentPipelineProgress.percent || 0)}%`,
      }
      : null);

  if (!notebook && initialNotebook) {
    return (
      <div className="notebook-welcome">
        <div className="welcome-content">
          <h2>📓 Inspyro Notebook</h2>
          <p>⏳ Cargando notebook...</p>
          <div className="connection-status">
            Estado: {connectionStatus === 'connected' ? '🟢 Conectado' : '🔴 Desconectado'}
          </div></div>
      </div>
    );
  }

  // Pantalla de bienvenida solo cuando no hay notebook ni initialNotebook
  if (!notebook && !initialNotebook) {
    return (
      <div className="notebook-welcome">
        <div className="welcome-content">
          <h2>🪐 Inspyro Notebook</h2>
          <p>Crea un nuevo notebook o carga uno existente para comenzar.</p>

          <div className="welcome-actions">
            <button
              onClick={createNewNotebook}
              disabled={connectionStatus !== 'connected' || isCreating}
              className="primary-btn"
              data-testid="notebook-create-button"
            >
              {isCreating ? '⏳ Creando...' : '📓 Nuevo Notebook'}
            </button>

            <label className="file-input-label">
              📁 Cargar .ipynb
              <input
                type="file"
                accept=".ipynb"
                onChange={loadNotebook}
                disabled={connectionStatus !== 'connected'}
                style={{ display: 'none' }}
                data-testid="notebook-load-input"
              />
            </label>
          </div>

          <div className="connection-status">
            Estado: {connectionStatus === 'connected' ? '🟢 Conectado' : '🔴 Desconectado'}
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className="notebook-editor" style={{ position: 'relative' }}>
      {activeProcessRail && (
        <div
          className={`notebook-process-rail notebook-process-rail--${activeProcessRail.tone} notebook-process-rail--${activeProcessRail.status}`}
          data-testid={`process-rail-${activeProcessRail.tone}`}
        >
          <div className="notebook-process-rail__header">
            <span className="notebook-process-rail__label">{activeProcessRail.label}</span>
            <span className="notebook-process-rail__meta">{activeProcessRail.meta}</span>
          </div>
          <div className="notebook-process-rail__track">
            <div
              className={`notebook-process-rail__fill ${activeProcessRail.indeterminate ? 'notebook-process-rail__fill--indeterminate' : ''}`}
              style={activeProcessRail.indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, activeProcessRail.percent || 0))}%` }}
            />
            <div className="notebook-process-rail__shimmer" />
          </div>
          <div className="notebook-process-rail__message">{activeProcessRail.message}</div>
        </div>
      )}
      {/* Toolbar eliminado - ahora está en el header principal de App.js */}

      {agentExecutionState && (
        <div className="notebook-agent-banner" data-testid="notebook-agent-banner">
          <span className="notebook-agent-banner__dot" />
          <div className="notebook-agent-banner__copy">
            <strong>Agent run in progress</strong>
            <span>{agentExecutionState.summary}</span>
          </div>
        </div>
      )}

      <div className="notebook-content scroll-surface" ref={notebookContentRef}>
        {notebook.cells.map((cell, index) => (
          <div
            key={cell.id}
            ref={(el) => { cellRefs.current[index] = el; }}
          >
            <NotebookCell
              key={cell.id}
              cell={cell}
              onExecute={executeCell}
              onUpdate={updateCell}
              onDelete={deleteCell}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              isExecuting={effectiveExecutionLock && effectiveExecutingCellId === cell.id}
              hasExecutionLock={effectiveExecutionLock}
              isActive={effectiveExecutingCellId === cell.id}
              isSelected={selectedCellId === cell.id}
              onSelect={handleCellSelect}
              onDeselect={handleCellDeselect}
              trustHtml={trustHtml}
              docxExecutionEnabled={autoDocEnabled}
              precedingCells={notebook.cells.slice(0, index)}
              cellIndex={index}
              notebookPath={filePath}
              highlightLine={highlightedLine?.cellIndex === index ? highlightedLine.line : null}
              highlightColumn={highlightedLine?.cellIndex === index ? highlightedLine.column : null}
              onShowDependencyTree={handleShowDependencyTree}
            />
          </div>
        ))}


        <div className="add-cell-bottom">
          <button
            onClick={(e) => {
              e.stopPropagation();
              addCell();
            }}
            className="add-cell-btn"
            data-testid="notebook-add-cell"
          >
            ➕ Agregar celda
          </button>
        </div>
        {/* DependencyGraph se renderiza exclusivamente en VisualizationPanel */}
      </div>
    </div>
  );
};

export default NotebookEditor;
