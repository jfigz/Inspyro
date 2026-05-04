import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Resizer from './components/Resizer';
import FileTabs from './components/FileTabs';
import FolderSelector from './components/FolderSelector';
import McpPanel from './components/McpPanel';
import DesktopTitleBar from './components/DesktopTitleBar';
import NotebookIndexPanel from './components/NotebookIndexPanel';
import { ExplorerIconNotebookIndex, ExplorerIconSidebar } from './components/ExplorerIcons';
import { API_BASE } from './config/endpoints';
import {
  createExampleWorkspaceFiles,
  EXAMPLE_WORKSPACE_NAME,
  EXAMPLE_WORKSPACE_PRIMARY_NOTEBOOK,
} from './data/exampleWorkspaceSeed';
import './App.css';

// Hooks
import useFileSystem from './hooks/useFileSystem';
import useAppWebSocket from './hooks/useAppWebSocket';
import useMcpActivity from './hooks/useMcpActivity';
import useMcpShellControls from './hooks/useMcpShellControls';
import useMcpMirror from './hooks/useMcpMirror';
import useTemplateMessageHandler from './hooks/useTemplateMessageHandler';
import { createFrontendLogger } from './utils/frontendLogger';
import {
  applyMcpArtifactToDocumentState,
  applyDocumentStatePayload,
  buildDocxDownloadPath,
  createEmptyDocumentState,
  createDocxHistoryEntry,
  filterDocxHistoryEntries,
  getDocxStableIdentity,
  getDocxHistoryRecordKey,
  inferDocxSourceKind,
  loadDocxHistoryEntries,
  normalizeDocxHistoryEntry,
  resetDocumentState,
  saveDocxHistoryEntries,
  upsertDocxHistoryEntry,
} from './utils/docxArtifacts';
import { normalizeNotebookSnapshot } from './utils/notebookSnapshot';
import {
  isPythonNotebookCell,
  isRunnableNotebookCell,
  normalizeNotebookCellType,
} from './utils/notebookCellTypes';

const MonacoEditor = lazy(() => import('./components/MonacoEditor'));
const VisualizationPanel = lazy(() => import('./components/VisualizationPanel'));
const NotebookEditor = lazy(() => import('./components/NotebookEditor'));
const FileExplorer = lazy(() => import('./components/FileExplorer'));
const ProjectLauncher = lazy(() => import('./components/ProjectLauncher'));
const AgentWorkspaceHome = lazy(() => import('./components/AgentWorkspaceHome'));

const DEFAULT_CODE = `# Bienvenido a Inspyro
# Abre un archivo Python (.py) o Notebook (.ipynb) desde el explorador

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Ejemplo: calcular Fibonacci
for i in range(6):
    result = fibonacci(i)
    print(f"fibonacci({i}) = {result}")
`;

const LEFT_SIDEBAR_RAIL_WIDTH = 48;
const LEFT_SIDEBAR_PANEL_MIN_WIDTH = 220;
const LEFT_SIDEBAR_PANEL_MAX_WIDTH = 420;
const LEFT_SIDEBAR_DEFAULT_WIDTH = LEFT_SIDEBAR_RAIL_WIDTH + 260;
const SPLIT_PANEL_MIN_PERCENT = 25;
const SPLIT_PANEL_MAX_PERCENT = 75;
const COLLAPSED_VISUALIZATION_WIDTH = 40;
const NOTEBOOK_DEPENDENCY_PRIMARY_MAX_PERCENT = 48;

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
const getPrimarySplitWidthStyle = (panelWidth, isCollapsed = false) => (isCollapsed
  ? `calc(100% - ${COLLAPSED_VISUALIZATION_WIDTH}px)`
  : `calc(${panelWidth}% - var(--split-panel-offset))`);
const getVisualizationSplitWidthStyle = (panelWidth, isCollapsed = false) => (isCollapsed
  ? `${COLLAPSED_VISUALIZATION_WIDTH}px`
  : `calc(${100 - panelWidth}% - var(--split-panel-offset))`);

const normalizeComparablePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const getPathBasename = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
};

const getPathDirname = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim().replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (separatorIndex <= 0) return '';
  return trimmed.slice(0, separatorIndex);
};

const isNotebookPath = (value) => (
  typeof value === 'string'
  && value.trim().toLowerCase().endsWith('.ipynb')
);

const patchNotebookCellById = (notebook, cellId, updater) => {
  if (!notebook || !Array.isArray(notebook.cells) || !cellId || typeof updater !== 'function') {
    return notebook;
  }
  let changed = false;
  const nextCells = notebook.cells.map((cell) => {
    if (!cell || cell.id !== cellId) {
      return cell;
    }
    const nextCell = updater(cell);
    if (nextCell !== cell) {
      changed = true;
    }
    return nextCell;
  });
  return changed ? { ...notebook, cells: nextCells } : notebook;
};

const appendNotebookStreamOutput = (notebook, cellId, content = {}) => patchNotebookCellById(
  notebook,
  cellId,
  (cell) => {
    const text = content?.text;
    const name = content?.name || 'stdout';
    const streamChunk = Array.isArray(text) ? text.join('') : (text || '');
    const previousOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const lastOutput = previousOutputs[previousOutputs.length - 1];
    if (lastOutput && lastOutput.output_type === 'stream' && lastOutput.name === name) {
      const previousText = Array.isArray(lastOutput.text) ? lastOutput.text.join('') : (lastOutput.text || '');
      let mergedText = previousText;
      if (streamChunk.length > 0) {
        if (streamChunk.startsWith(previousText)) {
          mergedText = streamChunk;
        } else if (previousText.endsWith(streamChunk)) {
          mergedText = previousText;
        } else {
          mergedText = previousText + streamChunk;
        }
      }
      return {
        ...cell,
        outputs: [
          ...previousOutputs.slice(0, -1),
          { ...lastOutput, text: mergedText },
        ],
      };
    }
    return {
      ...cell,
      outputs: [
        ...previousOutputs,
        {
          output_type: 'stream',
          name,
          text: streamChunk,
        },
      ],
    };
  },
);

const resolveNotebookDisplayId = (content = {}) => (
  content?.transient?.display_id
  || content?.display_id
  || content?.metadata?.display_id
  || null
);

const buildNotebookRichOutput = (messageType, content = {}) => {
  const output = {
    output_type: messageType === 'notebook_display_data' ? 'display_data' : 'execute_result',
    data: content?.data || {},
    metadata: content?.metadata || {},
    execution_count: content?.execution_count ?? null,
  };
  const displayId = resolveNotebookDisplayId(content);
  if (displayId) {
    output.transient = { display_id: displayId };
  }
  return output;
};

const appendNotebookRichOutput = (notebook, cellId, messageType, content = {}) => patchNotebookCellById(
  notebook,
  cellId,
  (cell) => ({
    ...cell,
    outputs: [
      ...(Array.isArray(cell.outputs) ? cell.outputs : []),
      buildNotebookRichOutput(messageType, content),
    ],
  }),
);

const updateNotebookDisplayDataOutput = (notebook, cellId, content = {}) => patchNotebookCellById(
  notebook,
  cellId,
  (cell) => {
    const displayId = resolveNotebookDisplayId(content);
    const previousOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const nextOutput = buildNotebookRichOutput('notebook_display_data', content);
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
    return {
      ...cell,
      outputs: replaced ? outputs : [...previousOutputs, nextOutput],
    };
  },
);

const appendNotebookErrorOutput = (notebook, message = {}) => patchNotebookCellById(
  notebook,
  message?.cell_id,
  (cell) => {
    const previousOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const details = message?.details || {};
    const content = message?.content || {};
    const traceback = details.traceback || content.traceback || message.traceback || [];
    const inlineError = {
      output_type: 'error',
      ename: details.ename || content.ename || message.error_code || 'NotebookError',
      evalue: details.evalue || content.evalue || message.error || message.message || 'Error ejecutando celda',
      traceback: Array.isArray(traceback) ? traceback : [String(traceback || message.error || message.message || '')],
    };
    const lastOutput = previousOutputs[previousOutputs.length - 1];
    if (
      lastOutput?.output_type === 'error'
      && lastOutput?.ename === inlineError.ename
      && lastOutput?.evalue === inlineError.evalue
    ) {
      return cell;
    }
    return {
      ...cell,
      outputs: [...previousOutputs, inlineError],
    };
  },
);

const clearNotebookCellOutputs = (notebook, cellId) => patchNotebookCellById(
  notebook,
  cellId,
  (cell) => ({ ...cell, outputs: [] }),
);

const updateNotebookCellExecutionCount = (notebook, cellId, executionCount) => patchNotebookCellById(
  notebook,
  cellId,
  (cell) => ({ ...cell, execution_count: executionCount }),
);

const applyNotebookCellExecutionResult = (notebook, message) => patchNotebookCellById(
  notebook,
  message?.cell_id,
  (cell) => ({
    ...cell,
    outputs: Array.isArray(message?.outputs) ? message.outputs : (Array.isArray(cell.outputs) ? cell.outputs : []),
    execution_count: typeof message?.execution_count === 'number'
      ? message.execution_count
      : (message?.execution_count ?? cell.execution_count),
  }),
);

const deleteNotebookCell = (notebook, cellId) => {
  if (!notebook || !Array.isArray(notebook.cells) || !cellId) {
    return notebook;
  }
  return {
    ...notebook,
    cells: notebook.cells.filter((cell) => cell?.id !== cellId),
  };
};

const moveNotebookCell = (notebook, cellId, direction) => {
  if (!notebook || !Array.isArray(notebook.cells) || !cellId || !direction) {
    return notebook;
  }
  const currentIndex = notebook.cells.findIndex((cell) => cell?.id === cellId);
  if (currentIndex < 0) {
    return notebook;
  }
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= notebook.cells.length) {
    return notebook;
  }
  const nextCells = [...notebook.cells];
  [nextCells[currentIndex], nextCells[nextIndex]] = [nextCells[nextIndex], nextCells[currentIndex]];
  return { ...notebook, cells: nextCells };
};

const reorderNotebookCells = (notebook, order = []) => {
  if (!notebook || !Array.isArray(notebook.cells) || !Array.isArray(order) || order.length === 0) {
    return notebook;
  }
  const cellsById = new Map(notebook.cells.map((cell) => [cell.id, cell]));
  const orderedCells = [];
  order.forEach((cellId) => {
    const cell = cellsById.get(cellId);
    if (cell) {
      orderedCells.push(cell);
      cellsById.delete(cellId);
    }
  });
  cellsById.forEach((cell) => orderedCells.push(cell));
  return { ...notebook, cells: orderedCells };
};

const stripNotebookRuntimeState = (notebook) => {
  if (!notebook || !Array.isArray(notebook.cells)) {
    return notebook;
  }

  return {
    ...notebook,
    cells: notebook.cells.map((cell) => (
      isPythonNotebookCell(cell)
        ? {
          ...cell,
          outputs: [],
          execution_count: null,
          metadata: Object.fromEntries(
            Object.entries(cell?.metadata || {}).filter(([key]) => ![
              'execution_duration',
              'execution_duration_ms',
            ].includes(key)),
          ),
        }
        : cell
    )),
  };
};

const serializeNotebookForKernelLoad = (notebook) => (
  JSON.stringify(stripNotebookRuntimeState(notebook))
);

const getNotebookCodeCells = (notebook) => (
  Array.isArray(notebook?.cells)
    ? notebook.cells.filter(isPythonNotebookCell)
    : []
);

const cloneNotebookCellSource = (source) => {
  if (Array.isArray(source)) {
    return [...source];
  }
  return typeof source === 'string' ? source : '';
};

const serializeNotebookCellSourceForAnalysis = (source) => {
  if (Array.isArray(source)) {
    const hasExplicitBreaks = source.some((line) => (
      typeof line === 'string' && /[\r\n]/.test(line)
    ));
    const text = hasExplicitBreaks ? source.join('') : source.join('\n');
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  return typeof source === 'string' ? source.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const maskPythonSourceForSymbolSearch = (source) => {
  let masked = '';
  let quoteChar = null;
  let tripleQuote = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextThree = source.slice(index, index + 3);

    if (quoteChar) {
      if (tripleQuote && nextThree === quoteChar.repeat(3)) {
        masked += '   ';
        index += 2;
        quoteChar = null;
        tripleQuote = false;
        escaped = false;
        continue;
      }
      if (!tripleQuote && !escaped && char === quoteChar) {
        masked += ' ';
        quoteChar = null;
        continue;
      }
      if (!tripleQuote && !escaped && char === '\\') {
        escaped = true;
        masked += ' ';
        continue;
      }
      escaped = false;
      masked += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (char === '#') {
      while (index < source.length && source[index] !== '\n') {
        masked += ' ';
        index += 1;
      }
      if (index < source.length && source[index] === '\n') {
        masked += '\n';
      }
      continue;
    }

    if (nextThree === '"""' || nextThree === "'''") {
      quoteChar = char;
      tripleQuote = true;
      masked += '   ';
      index += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      tripleQuote = false;
      escaped = false;
      masked += ' ';
      continue;
    }

    masked += char;
  }

  return masked;
};

const findSymbolLocationInSource = (source, symbol, options = {}) => {
  if (typeof source !== 'string' || typeof symbol !== 'string' || !symbol.trim()) {
    return {};
  }
  const normalizedSymbol = symbol.trim();
  const maskedLines = maskPythonSourceForSymbolSearch(source).split('\n');
  const allowDottedFallback = options.allowDottedFallback !== false;
  const tail = normalizedSymbol.includes('.')
    ? normalizedSymbol.split('.').filter(Boolean).pop()
    : null;
  const searchPlans = [
    {
      strategy: 'exact',
      pattern: new RegExp(`(^|[^A-Za-z0-9_.])(${escapeRegExp(normalizedSymbol)})(?=$|[^A-Za-z0-9_])`, 'g'),
      group: 2,
    },
  ];

  if (allowDottedFallback && tail) {
    searchPlans.push(
      {
        strategy: 'attribute',
        pattern: new RegExp(`\\.(${escapeRegExp(tail)})(?=$|[^A-Za-z0-9_])`, 'g'),
        group: 1,
      },
      {
        strategy: 'tail',
        pattern: new RegExp(`(^|[^A-Za-z0-9_.])(${escapeRegExp(tail)})(?=$|[^A-Za-z0-9_])`, 'g'),
        group: 2,
      },
    );
  }

  for (const plan of searchPlans) {
    for (let index = 0; index < maskedLines.length; index += 1) {
      const line = maskedLines[index];
      plan.pattern.lastIndex = 0;
      const match = plan.pattern.exec(line);
      if (match) {
        const column = match.index + (match[0].indexOf(match[plan.group]) || 0);
        if (plan.strategy === 'attribute' && tail) {
          const afterAttribute = line.slice(column + tail.length);
          const isMethodCall = /^\s*\(/.test(afterAttribute);
          const beforeAttribute = line.slice(0, match.index);
          const assignmentMatch = beforeAttribute.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^=]*$/);
          const assignmentName = assignmentMatch?.[1] || '';
          const aliasTailColumn = assignmentName.toLowerCase().indexOf(tail.toLowerCase());
          if (!isMethodCall && aliasTailColumn >= 0) {
            return {
              line: index + 1,
              column: line.indexOf(assignmentName) + aliasTailColumn,
              strategy: 'assignment_alias',
            };
          }
        }
        return {
          line: index + 1,
          column,
          strategy: plan.strategy,
        };
      }
    }
  }
  return {};
};

const findNotebookAnalysisTarget = (cells, symbol, activeCellId) => {
  const codeCells = (cells || [])
    .map((cell, index) => ({
      cell,
      index,
      sourceCode: serializeNotebookCellSourceForAnalysis(cell?.source),
    }))
      .filter((entry) => isPythonNotebookCell(entry.cell));

  const activeMatch = codeCells.find((entry) => entry.cell?.id === activeCellId);
  const ordered = activeMatch
    ? [activeMatch, ...codeCells.filter((entry) => entry !== activeMatch)]
    : codeCells;

  for (const entry of ordered) {
    const location = findSymbolLocationInSource(entry.sourceCode, symbol, { allowDottedFallback: true });
    if (Number.isInteger(location.line)) {
      return { ...entry, location };
    }
  }

  return codeCells[0] ? { ...codeCells[0], location: {} } : null;
};

const buildNotebookBatchCells = (notebook, { includeDocx = true } = {}) => (
  getNotebookCodeCells(notebook)
    .filter((cell) => isRunnableNotebookCell(cell, { includeDocx }))
    .map((cell, index) => ({
      order: index,
      cellId: typeof cell?.id === 'string' && cell.id.trim() ? cell.id : null,
      cellType: normalizeNotebookCellType(cell?.cell_type),
      source: cloneNotebookCellSource(cell?.source),
    }))
    .filter((cell) => Boolean(cell.cellId))
);

const NOTEBOOK_BATCH_PROGRESS_TITLE = 'Run All en progreso';
const NOTEBOOK_BATCH_SUCCESS_TITLE = 'Notebook completado';
const NOTEBOOK_BATCH_FAILURE_TITLE = 'Notebook interrumpido';
const NOTEBOOK_BATCH_KERNEL_WAIT_TIMEOUT_MS = 20000;
const NOTEBOOK_LIFECYCLE_ACK_TYPES = new Set([
  'notebook_created',
  'notebook_loaded',
  'notebook_attached',
]);
const NOTEBOOK_KERNEL_READY_SIGNAL_TYPES = new Set([
  'notebook_execute_input',
  'notebook_stream',
  'notebook_display_data',
  'notebook_execute_result',
  'notebook_cell_executed',
]);

const runAllLogger = createFrontendLogger('App][Run All');
const appLogger = createFrontendLogger('App');

const logNotebookBatchDebug = (...args) => {
  runAllLogger.info(...args);
};

const isNotebookBatchActive = (batchRunState) => (
  ['waiting_kernel', 'queued', 'running'].includes(batchRunState?.status || '')
);

const getNotebookBatchCurrentCellId = (batchRunState) => (
  batchRunState?.currentCellId
  || batchRunState?.pendingCells?.[0]?.cellId
  || null
);

const getNotebookBatchFirstPendingCell = (batchRunState) => (
  Array.isArray(batchRunState?.pendingCells) ? (batchRunState.pendingCells[0] || null) : null
);

const getNotebookBatchProgressPercent = (batchRunState) => {
  const total = Number(batchRunState?.total || 0);
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const executed = Math.max(0, Math.min(total, Number(batchRunState?.executed || 0)));
  if (batchRunState?.status === 'waiting_kernel') {
    return 4;
  }
  if (executed <= 0 && batchRunState?.status === 'queued') {
    return 6;
  }
  if (executed <= 0 && batchRunState?.status === 'running') {
    return 8;
  }
  return Math.round((executed / total) * 100);
};

const createNotebookBatchNotificationId = (path) => (
  `notebook_batch_${normalizeComparablePath(path) || path || 'unknown'}`
);

const buildNotebookRunProgressMessage = (batchRunState) => {
  if (!batchRunState) {
    return 'Ejecutando notebook...';
  }

  if (batchRunState.status === 'waiting_kernel') {
    return batchRunState.kernelRecoveryAttempts > 0
      ? 'Reiniciando kernel para continuar Run All...'
      : 'Iniciando kernel para ejecutar Run All...';
  }

  if (batchRunState.total <= 0) {
    return 'Ejecutando notebook...';
  }

  const executed = Math.max(0, Math.min(batchRunState.total, Number(batchRunState.executed || 0)));
  return `${executed} de ${batchRunState.total} celdas completadas`;
};

const isKernelNotFoundNotebookError = (message = {}) => {
  const errorText = `${message?.error || ''} ${message?.message || ''}`.toLowerCase();
  return (
    message?.error_code === 'notebook_execute_cell_failed'
    && (
      errorText.includes('kernel')
      && (
        errorText.includes('no encontrado')
        || errorText.includes('not found')
      )
    )
  );
};

const doesNotebookMessageMatchBatchExecution = (batchRunState, message = {}) => {
  if (!batchRunState || !message) {
    return false;
  }

  const currentExecutionId = typeof batchRunState.currentExecutionId === 'string'
    && batchRunState.currentExecutionId.trim()
    ? batchRunState.currentExecutionId
    : null;
  const messageExecutionId = typeof message.execution_id === 'string'
    && message.execution_id.trim()
    ? message.execution_id
    : null;

  if (currentExecutionId && messageExecutionId) {
    return currentExecutionId === messageExecutionId;
  }

  const currentCellId = getNotebookBatchCurrentCellId(batchRunState);
  const messageCellId = typeof message.cell_id === 'string'
    && message.cell_id.trim()
    ? message.cell_id
    : null;

  return Boolean(currentCellId && messageCellId && currentCellId === messageCellId);
};

const createEmptyNotebookKernelBindingRequest = () => ({
  requestId: null,
  status: 'idle',
  requestedAt: null,
  mode: null,
  origin: null,
  runId: null,
  timeoutMs: null,
  previousKernelId: null,
});

const deriveDocumentProgressPercent = (message = {}) => {
  const rawPercent = message.progress_percent ?? message.percent ?? null;
  if (typeof rawPercent === 'number' && Number.isFinite(rawPercent)) {
    return Math.max(0, Math.min(100, rawPercent));
  }
  return 0;
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

const describePdfSharedResource = (sharedResource, { concise = false } = {}) => {
  const normalized = normalizeDocumentSharedResource(sharedResource);
  if (!normalized || normalized.kind !== 'pdf_converter') {
    return null;
  }
  if (normalized.status === 'waiting') {
    return concise ? 'PDF en cola' : 'Esperando convertidor PDF compartido';
  }
  if (normalized.status === 'running') {
    return concise ? 'PDF' : 'Usando convertidor PDF compartido';
  }
  return concise ? 'PDF' : 'Convertidor PDF compartido';
};

const buildDocumentPipelineStatusFromMessage = (message = {}) => {
  const sharedResource = normalizeDocumentSharedResource(
    message.shared_resource || message.sharedResource || null,
  );
  return {
    scope: 'document',
    executionId: message.execution_id || null,
    stage: message.progress_stage || message.stage || null,
    status: message.progress_status || message.status || 'running',
    message: describePdfSharedResource(sharedResource) || message.message || '',
    percent: deriveDocumentProgressPercent(message),
    indeterminate: Boolean(message.progress_indeterminate ?? message.indeterminate),
    sharedResource,
  };
};

const createFileNotificationTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  return {
    kind: 'file',
    path,
    ...extra,
  };
};

const createCodeNotificationTarget = ({
  filePath = null,
  path = null,
  cellId = null,
  cellIndex = null,
  line = null,
  column = null,
  ...extra
} = {}) => {
  const resolvedFilePath = filePath || path || null;
  if (!resolvedFilePath && !cellId && !Number.isInteger(cellIndex)) {
    return null;
  }
  return {
    kind: 'code',
    ...(resolvedFilePath ? { filePath: resolvedFilePath } : {}),
    ...(typeof cellId === 'string' && cellId.trim() ? { cellId } : {}),
    ...(Number.isInteger(cellIndex) ? { cellIndex } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isInteger(column) && column >= 0 ? { column } : {}),
    ...extra,
  };
};

const createDocumentNotificationTarget = ({
  sourcePath = null,
  path = null,
  sourceKind = null,
  entry = null,
  surface = 'file',
  focusView = 'docx',
  ...extra
} = {}) => {
  const resolvedSourcePath = sourcePath || path || null;
  if (!resolvedSourcePath && !entry) {
    return null;
  }
  return {
    kind: 'document',
    ...(resolvedSourcePath ? { sourcePath: resolvedSourcePath } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(entry ? { entry } : {}),
    surface,
    focusView,
    ...extra,
  };
};

// eslint-disable-next-line no-unused-vars
const getNotificationTargetActionLabel = (target) => {
  if (typeof target?.actionLabel === 'string' && target.actionLabel.trim()) {
    return target.actionLabel.trim();
  }

  switch (target?.kind) {
    case 'document':
      return 'Abrir documento';
    case 'template':
      return 'Abrir plantilla';
    case 'workspace':
      return target.surface === 'home' ? 'Ir al inicio' : 'Ir a archivos';
    case 'agents':
      return 'Abrir agentes';
    case 'code':
      return isNotebookPath(target.filePath || target.path || '')
        ? 'Ir a la celda'
        : 'Ir al codigo';
    case 'file':
    default:
      return isNotebookPath(target?.path || target?.filePath || '')
        ? 'Abrir notebook'
        : 'Abrir archivo';
  }
};

const joinWorkspacePath = (parent, name) => {
  const base = String(parent || '').replace(/[\\/]+$/, '');
  if (!base) return name;
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${name}`;
};

const isSameOrDescendantComparablePath = (candidate, target) => {
  const normalizedCandidate = normalizeComparablePath(candidate);
  const normalizedTarget = normalizeComparablePath(target);
  if (!normalizedCandidate || !normalizedTarget) return false;
  return (
    normalizedCandidate === normalizedTarget
    || normalizedCandidate.startsWith(`${normalizedTarget}/`)
  );
};

const buildPdfServiceStatus = (payload = {}) => {
  const wordAvailable = Boolean(payload.word_available);
  const libreAvailable = Boolean(payload.pdf_available);
  const available = wordAvailable || libreAvailable;

  let sourceLabel = 'No disponible';
  if (wordAvailable && libreAvailable) sourceLabel = 'Word/LibreOffice';
  else if (wordAvailable) sourceLabel = 'Word';
  else if (libreAvailable) sourceLabel = 'LibreOffice';

  return {
    available,
    sourceLabel,
    error: false,
  };
};

const hasSamePdfServiceStatus = (left, right) => (
  left === right
  || (
    Boolean(left)
    && Boolean(right)
    && left.available === right.available
    && left.sourceLabel === right.sourceLabel
    && Boolean(left.error) === Boolean(right.error)
  )
);

const createEmptyNotebookKernelState = () => ({
  kernelId: null,
  kernelInterrupted: false,
  isExecuting: false,
  executingCellId: null,
  isCreating: false,
  hasNotebook: false,
});

const createEmptyNotebookSession = () => ({
  kernelState: createEmptyNotebookKernelState(),
  kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
  runtimeNotebook: null,
  runtimeVersion: 0,
  editorHydrationToken: 0,
  batchRunState: null,
  documentState: createEmptyDocumentState(),
  selectedCellId: null,
  templateInfo: null,
  templateBlob: null,
  templateOpenRequest: null,
  lastTemplateAttach: null,
});

export const collectNewConflictPaths = (conflictedPaths = [], warnedPaths = new Set()) => {
  const nextWarnedPaths = new Set(warnedPaths);
  const newlyWarnedPaths = [];

  conflictedPaths.forEach((path) => {
    const normalizedPath = normalizeComparablePath(path);
    if (!normalizedPath || nextWarnedPaths.has(normalizedPath)) {
      return;
    }
    nextWarnedPaths.add(normalizedPath);
    newlyWarnedPaths.push(path);
  });

  return {
    newlyWarnedPaths,
    nextWarnedPaths,
  };
};

export const pruneResolvedConflictPaths = (warnedPaths = new Set(), activeConflictPaths = []) => {
  const activePaths = new Set(
    Array.from(activeConflictPaths || [])
      .map((path) => normalizeComparablePath(path))
      .filter(Boolean),
  );
  const nextWarnedPaths = new Set();

  warnedPaths.forEach((path) => {
    if (activePaths.has(path)) {
      nextWarnedPaths.add(path);
    }
  });

  return nextWarnedPaths;
};

const readErrorMessage = async (response, fallbackMessage) => {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export const getWorkspaceSessionFromPayload = (payload = {}) => {
  const activeWorkspace = typeof payload?.active_workspace === 'string' && payload.active_workspace.trim()
    ? payload.active_workspace
    : null;
  const workspaceRoot = typeof payload?.workspace_root === 'string' ? payload.workspace_root : '';
  const workspacePath = typeof payload?.workspace_path === 'string' ? payload.workspace_path : '';
  const suggestedWorkspaceRoot = typeof payload?.suggested_workspace_root === 'string' && payload.suggested_workspace_root.trim()
    ? payload.suggested_workspace_root
    : workspaceRoot || workspacePath || '';

  return {
    activeWorkspace,
    workspaceRoot: workspaceRoot || workspacePath || '',
    workspacePath: workspacePath || workspaceRoot || '',
    suggestedWorkspaceRoot,
    recentWorkspaces: Array.isArray(payload?.recent_workspaces)
      ? payload.recent_workspaces.filter((item) => typeof item === 'string' && item.trim())
      : [],
    workspaceSource: typeof payload?.workspace_source === 'string' && payload.workspace_source.trim()
      ? payload.workspace_source
      : activeWorkspace
        ? 'active'
        : 'default',
  };
};

export const shouldShowProjectLauncher = (workspaceSession, openFiles) => {
  const hasActiveWorkspace = Boolean(workspaceSession?.activeWorkspace);
  const hasOpenFiles = Array.isArray(openFiles) && openFiles.length > 0;
  return !hasActiveWorkspace && !hasOpenFiles;
};

const EMPTY_HOME_SUMMARY = Object.freeze({
  workspace_path: '',
  notebook_runtime_items: [],
  code_runtime_items: [],
  runtime_items: [],
  recent_docx_items: [],
  mcp_service: null,
  mcp_clients: [],
  template_inventory: [],
  updated_at: null,
});

const HOME_CARD_ROW_LIMIT = 8;

const HOME_DATE_FORMATTER = new Intl.DateTimeFormat('es-CL', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const createHomeTarget = (kind, payload = null) => (
  kind ? { kind, payload } : null
);

const createHomeBadge = (label, tone = 'neutral') => (
  typeof label === 'string' && label.trim()
    ? { label: label.trim(), tone }
    : null
);

const createHomeAction = (label, target, tone = 'secondary', disabled = false) => (
  label && target
    ? {
      label,
      target,
      tone,
      disabled,
    }
    : null
);

const createHomeDetail = (label, value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : String(value).trim();
  return text ? { label, value: text } : null;
};

const resolveHomeBackendUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  if (/^(https?:|blob:|data:|about:)/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const fallbackOrigin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:3000';
    const backendBase = new URL(API_BASE, fallbackOrigin);
    return trimmed.startsWith('/')
      ? new URL(trimmed, backendBase.origin).toString()
      : new URL(trimmed, backendBase.toString()).toString();
  } catch {
    return trimmed;
  }
};

const buildHomeDocxDownloadUrl = (entry = {}) => resolveHomeBackendUrl(
  entry?.docx_download_url
  || entry?.docxDownloadUrl
  || entry?.docx_ref
  || entry?.docxRef
  || entry?.downloadUrl
  || entry?.download_url
  || entry?.ref
  || buildDocxDownloadPath({
    artifactId: entry?.artifact_id || entry?.docx_artifact_id || entry?.docxArtifactId || null,
    token: entry?.docx_file_token || entry?.docxFileToken || entry?.token || null,
    sourcePath: entry?.source_path || entry?.sourcePath || null,
    kernelId: entry?.kernel_id || entry?.kernelId || null,
  }),
);

const formatHomeTimestamp = (value) => {
  if (!value) {
    return 'Hace poco';
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Hace poco';
  }
  return HOME_DATE_FORMATTER.format(timestamp);
};

const formatHomeBytes = (value) => {
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

const formatHomeUptime = (value) => {
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

const clampHomePercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

const getHomeNotebookStateMeta = (state) => {
  const normalized = typeof state === 'string' ? state.trim().toLowerCase() : '';
  switch (normalized) {
    case 'running':
      return { label: 'Ejecutando', tone: 'accent' };
    case 'idle':
      return { label: 'Listo', tone: 'good' };
    case 'error':
      return { label: 'Con error', tone: 'warn' };
    case 'cancelled':
      return { label: 'Cancelado', tone: 'warn' };
    case 'interrupted':
      return { label: 'Interrumpido', tone: 'warn' };
    default:
      return { label: normalized ? normalized : 'Sin estado', tone: 'neutral' };
  }
};

const getHomeNotebookSharedResource = (item = {}) => normalizeDocumentSharedResource(
  item?.progress?.sharedResource
  || item?.progress?.shared_resource
  || item?.sharedResource
  || item?.shared_resource
  || null,
);

const isDocumentPipelineStatusActive = (status) => (
  ['queued', 'waiting', 'running'].includes(String(status || '').trim().toLowerCase())
);

const buildShellNotebookRuntimeItems = (notebookSessionsByPath = {}) => (
  Object.entries(notebookSessionsByPath || {})
    .filter(([path]) => isNotebookPath(path))
    .map(([path, session]) => {
      const batchRunState = session?.batchRunState || null;
      const documentPipelineStatus = session?.documentState?.documentPipelineStatus || null;
      const batchActive = isNotebookBatchActive(batchRunState);
      const documentPipelineActive = isDocumentPipelineStatusActive(documentPipelineStatus?.status);

      if (!batchActive && !documentPipelineActive) {
        return null;
      }

      const documentSharedResource = normalizeDocumentSharedResource(
        documentPipelineStatus?.sharedResource
        || documentPipelineStatus?.shared_resource
        || null,
      );
      const documentMessage = documentPipelineStatus?.message
        || describePdfSharedResource(documentSharedResource)
        || null;
      const progressPercent = batchActive
        ? getNotebookBatchProgressPercent(batchRunState)
        : clampHomePercent(documentPipelineStatus?.percent ?? documentPipelineStatus?.progress_percent);
      const fallbackPercent = documentSharedResource ? 80 : 8;

      return {
        source_kind: 'notebook',
        runtime_kind: 'notebook',
        kind: 'notebook',
        state: 'running',
        notebook_path: path,
        path,
        notebook_relpath: getPathBasename(path) || path,
        kernel_id: session?.kernelState?.kernelId || null,
        execution_id: batchRunState?.currentExecutionId || documentPipelineStatus?.executionId || null,
        current_cell_id: getNotebookBatchCurrentCellId(batchRunState),
        message: batchActive
          ? buildNotebookRunProgressMessage(batchRunState)
          : (documentMessage || 'Generando documento...'),
        progress: {
          scope: batchActive ? 'execution' : 'document',
          stage: batchActive ? 'run_all' : (documentPipelineStatus?.stage || 'pdf_convert'),
          status: batchRunState?.status || documentPipelineStatus?.status || 'running',
          message: batchActive
            ? buildNotebookRunProgressMessage(batchRunState)
            : (documentMessage || 'Generando documento...'),
          percent: progressPercent ?? fallbackPercent,
          indeterminate: Boolean(documentPipelineStatus?.indeterminate),
          sharedResource: documentSharedResource,
          shared_resource: documentSharedResource,
        },
      };
    })
    .filter(Boolean)
);

const formatHomeDocumentStage = (stage) => {
  const normalized = typeof stage === 'string' ? stage.trim().toLowerCase() : '';
  switch (normalized) {
    case 'queued':
      return 'Documento en cola';
    case 'docx_export':
      return 'Exportando DOCX';
    case 'docx_ready':
      return 'DOCX listo';
    case 'pdf_convert':
      return 'Generando PDF';
    default:
      return normalized ? normalized : null;
  }
};

const getHomeServiceStateMeta = (status) => {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  switch (normalized) {
    case 'running':
      return { label: 'En linea', tone: 'good' };
    case 'starting':
      return { label: 'Iniciando', tone: 'accent' };
    case 'stopped':
      return { label: 'Detenido', tone: 'muted' };
    case 'error':
      return { label: 'Con atencion', tone: 'warn' };
    default:
      return { label: 'Sin estado', tone: 'neutral' };
  }
};

const hasPdfArtifact = (item = {}) => Boolean(
  item?.pdf_ref
  || item?.pdfRef
  || item?.pdfFileName
  || item?.pdf_file_name
  || item?.pdfHash
  || item?.pdf_hash
);

const normalizeHomeRole = (item = {}) => String(item?.workspace_role || item?.workspaceRole || '').trim().toLowerCase();

const isHomeInternalItem = (item = {}) => (
  normalizeHomeRole(item) === 'internal'
  || item?.home_hidden === true
  || item?.homeHidden === true
  || /(^|\/)(_agent_runs|\.inspyro|docx_documents|backend\/demo_mcp|demo_mcp|mcp_smoke|mcp_torture)(\/|$)/.test(
    String(
      item?.notebook_relpath
      || item?.notebook_path
      || item?.source_path
      || item?.path
      || '',
    )
      .replace(/\\/g, '/')
      .toLowerCase(),
  )
);

const isHomeEmptyDocxItem = (item = {}) => {
  if (item?.docx_is_empty === true || item?.docxIsEmpty === true) {
    return true;
  }
  const sizeValue = item?.docx_size_bytes ?? item?.docxSizeBytes ?? item?.size_bytes ?? item?.sizeBytes;
  return sizeValue !== null && sizeValue !== undefined && Number(sizeValue) === 0;
};

const getHomeQualityStatus = (item = {}) => {
  const rawStatus = String(
    item?.docx_quality_status
    || item?.docxQualityStatus
    || item?.docx_quality?.status
    || item?.docxQuality?.status
    || '',
  ).trim().toLowerCase();
  const counts = item?.docx_quality_counts || item?.docxQualityCounts || item?.docx_quality?.counts || item?.docxQuality?.counts || {};
  if (['ok', 'pass', 'passed', 'success'].includes(rawStatus)) return 'ok';
  if (['warning', 'warnings', 'warn'].includes(rawStatus)) return 'warning';
  if (['error', 'failed', 'fail', 'review', 'revisar'].includes(rawStatus)) return 'error';
  if (Number(counts?.error || counts?.errors || 0) > 0) return 'error';
  if (Number(counts?.warning || counts?.warnings || 0) > 0) return 'warning';
  return rawStatus ? 'ok' : 'missing';
};

const getHomeQualityBadge = (item = {}) => {
  const status = getHomeQualityStatus(item);
  const counts = item?.docx_quality_counts || item?.docxQualityCounts || item?.docx_quality?.counts || item?.docxQuality?.counts || {};
  if (status === 'ok') return createHomeBadge('Calidad OK', 'good');
  if (status === 'warning') {
    const warnings = Number(counts?.warning || counts?.warnings || 0) || 0;
    return createHomeBadge(warnings > 0 ? `${warnings} avisos` : 'Con avisos', 'warn');
  }
  if (status === 'error') return createHomeBadge('Revisar calidad', 'warn');
  return createHomeBadge('Sin analizar', 'muted');
};

const getHomeRenderBadge = (item = {}) => {
  const status = String(item?.docx_render_status || item?.docxRenderStatus || item?.docx_render?.status || '').trim().toLowerCase();
  const pageCount = Number(item?.docx_render_page_count ?? item?.docxRenderPageCount ?? item?.docx_render?.page_count ?? 0) || 0;
  const cachedPages = Number(item?.docx_render_cached_pages ?? item?.docxRenderCachedPages ?? item?.docx_render?.cached_pages ?? 0) || 0;
  if (['complete', 'completed', 'ready_all'].includes(status)) return createHomeBadge('Visual listo', 'good');
  if (status === 'partial') return createHomeBadge(`${cachedPages}/${pageCount || '?'} paginas`, 'warn');
  if (['ready', 'pdf_ready'].includes(status)) return createHomeBadge('PDF listo', 'accent');
  if (['error', 'failed', 'fail'].includes(status)) return createHomeBadge('Visual error', 'warn');
  return createHomeBadge('Sin render', 'muted');
};

const limitHomeRows = (rows = []) => rows.slice(0, HOME_CARD_ROW_LIMIT);

const buildWorkspaceHomeData = ({
  summary,
  workspacePath,
  mirrorEnabled,
  mcpStatus,
  homeSummaryError,
  notebookSessionsByPath,
}) => {
  const joinHomePhrases = (phrases = []) => {
    const filtered = phrases.filter(Boolean);
    if (filtered.length === 0) {
      return '';
    }
    if (filtered.length === 1) {
      return filtered[0];
    }
    return `${filtered.slice(0, -1).join(', ')} y ${filtered[filtered.length - 1]}`;
  };
  const readOverviewCount = (key, fallback = 0) => {
    const value = Number(summary?.overview?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const resolvedWorkspacePath = summary?.workspace_path
    || summary?.workspace?.active_workspace
    || summary?.workspace?.workspace_root
    || workspacePath
    || '';
  const rawRuntimeItems = Array.isArray(summary?.runtime_items)
    ? summary.runtime_items
    : [];
  const backendNotebookRuntimeItems = Array.isArray(summary?.notebook_runtime_items)
    ? summary.notebook_runtime_items
    : Array.isArray(summary?.notebook_runtime)
      ? summary.notebook_runtime
      : rawRuntimeItems.filter((item) => (item?.source_kind || item?.runtime_kind || item?.kind) !== 'code');
  const shellNotebookRuntimeItems = buildShellNotebookRuntimeItems(notebookSessionsByPath);
  const shellNotebookRuntimeKeys = new Set(
    shellNotebookRuntimeItems
      .map((item) => normalizeComparablePath(item?.notebook_path || item?.path))
      .filter(Boolean),
  );
  const notebookRuntimeItems = [
    ...shellNotebookRuntimeItems,
    ...backendNotebookRuntimeItems.filter((item) => {
      const key = normalizeComparablePath(item?.notebook_path || item?.path);
      return !key || !shellNotebookRuntimeKeys.has(key);
    }),
  ];
  const codeRuntimeItems = Array.isArray(summary?.code_runtime_items)
    ? summary.code_runtime_items
    : rawRuntimeItems.filter((item) => (item?.source_kind || item?.runtime_kind || item?.kind) === 'code');
  const rawRecentDocxItems = Array.isArray(summary?.recent_docx_items)
    ? summary.recent_docx_items
    : [];
  const recentDocxItems = rawRecentDocxItems.filter((item) => !isHomeEmptyDocxItem(item));
  const rawTemplateItems = Array.isArray(summary?.template_inventory)
    ? summary.template_inventory
    : Array.isArray(summary?.template_inventory_summary?.items)
      ? summary.template_inventory_summary.items
      : [];
  const templateItems = rawTemplateItems
    .filter((item) => !isHomeInternalItem(item))
    .slice()
    .sort((left, right) => {
      const leftTemplateRank = left?.template_attached ? 0 : 1;
      const rightTemplateRank = right?.template_attached ? 0 : 1;
      if (leftTemplateRank !== rightTemplateRank) {
        return leftTemplateRank - rightTemplateRank;
      }
      const leftRank = Number(left?.home_rank ?? left?.homeRank ?? 10) || 10;
      const rightRank = Number(right?.home_rank ?? right?.homeRank ?? 10) || 10;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left?.notebook_relpath || left?.notebook_path || '').localeCompare(String(right?.notebook_relpath || right?.notebook_path || ''));
    });
  const mcpClients = Array.isArray(summary?.mcp_clients)
    ? summary.mcp_clients
    : Array.isArray(summary?.mcp_clients_summary?.items)
      ? summary.mcp_clients_summary.items
      : [];
  const mcpService = summary?.mcp_service || summary?.mcp || mcpStatus || null;
  const workspaceName = getPathBasename(resolvedWorkspacePath) || 'Espacio de trabajo';
  const normalizedUpdatedAt = summary?.updated_at || summary?.generated_at || null;
  const templateByPath = new Map();
  const latestDocxByPath = new Map();

  templateItems.forEach((item) => {
    const key = normalizeComparablePath(item?.notebook_path);
    if (key && !templateByPath.has(key)) {
      templateByPath.set(key, item);
    }
  });

  recentDocxItems.forEach((item) => {
    const key = normalizeComparablePath(item?.source_path || item?.sourcePath);
    if (key && !latestDocxByPath.has(key)) {
      latestDocxByPath.set(key, item);
    }
  });
  const shellNotebookCount = shellNotebookRuntimeKeys.size;
  const computedWorkspaceNotebookCount = Math.max(templateItems.length, shellNotebookCount);
  const workspaceNotebookCount = computedWorkspaceNotebookCount
    || readOverviewCount('workspace_notebook_count', 0);
  const computedTemplateAttachedCount = templateItems.filter((item) => item?.template_attached).length;
  const templateAttachedCount = templateItems.length
    ? computedTemplateAttachedCount
    : readOverviewCount('template_attached_count', computedTemplateAttachedCount);
  const runtimeCodeCount = readOverviewCount('runtime_code_count', codeRuntimeItems.length);
  const computedRuntimeActiveCount = [...notebookRuntimeItems, ...codeRuntimeItems]
    .filter((item) => String(item?.state || '').toLowerCase() === 'running')
    .length;
  const runtimeActiveCount = Math.max(
    readOverviewCount('runtime_active_count', computedRuntimeActiveCount),
    computedRuntimeActiveCount,
  );
  const recentDocxCount = recentDocxItems.length;
  const mcpClientCount = readOverviewCount('mcp_client_count', mcpClients.length);
  const mcpActiveRunCount = readOverviewCount(
    'mcp_active_run_count',
    Number(summary?.mcp_service?.activity?.active_count || summary?.mcp?.activity?.active_count || 0),
  );

  const notebookRows = notebookRuntimeItems.map((item, index) => {
    const notebookPath = item?.notebook_path || item?.path || null;
    const notebookName = item?.notebook_relpath || getPathBasename(notebookPath) || `Notebook ${index + 1}`;
    const notebookKey = normalizeComparablePath(notebookPath);
    const templateEntry = notebookKey ? (templateByPath.get(notebookKey) || null) : null;
    const latestDocx = item?.latest_docx_item || (notebookKey ? latestDocxByPath.get(notebookKey) : null) || null;
    const stateMeta = getHomeNotebookStateMeta(item?.state);
    const sharedResource = getHomeNotebookSharedResource(item);
    const sharedResourceMessage = describePdfSharedResource(sharedResource);
    const stageLabel = formatHomeDocumentStage(item?.progress?.stage);
    const progressPercent = clampHomePercent(item?.progress?.percent ?? item?.progress_percent);
    const progress = progressPercent !== null || item?.state === 'running'
      ? {
        value: progressPercent ?? (sharedResource ? 80 : 8),
        max: 100,
        label: sharedResourceMessage
          ? describePdfSharedResource(sharedResource, { concise: true })
          : `${progressPercent ?? 8}%`,
        tone: sharedResource?.status === 'waiting'
          ? 'warn'
          : stateMeta.tone === 'warn'
            ? 'warn'
            : latestDocx && item?.state !== 'running'
              ? 'good'
              : 'accent',
      }
      : null;
    const notebookPayload = notebookPath
      ? {
        path: notebookPath,
        name: getPathBasename(notebookPath) || notebookPath,
      }
      : null;

    return {
      id: item?.kernel_id || notebookPath || `runtime-${index}`,
      title: notebookName,
      subtitle: sharedResourceMessage || item?.progress?.message || item?.message || stateMeta.label,
      meta: stageLabel
        ? `${stateMeta.label} - ${stageLabel}`
        : `${stateMeta.label} - ${formatHomeTimestamp(item?.updated_at)}`,
      badges: [
        createHomeBadge(stateMeta.label, stateMeta.tone),
        sharedResourceMessage
          ? createHomeBadge(
            sharedResource?.status === 'waiting' ? 'PDF en cola' : 'PDF compartido',
            sharedResource?.status === 'waiting' ? 'warn' : 'accent',
          )
          : null,
        createHomeBadge(templateEntry?.template_attached || item?.template_attached ? 'Plantilla adjunta' : 'Sin plantilla', templateEntry?.template_attached || item?.template_attached ? 'good' : 'muted'),
      ].filter(Boolean),
      progress,
      target: notebookPayload ? createHomeTarget('notebook', notebookPayload) : null,
      details: [
        createHomeDetail('Ruta', notebookPath),
        createHomeDetail('Kernel', item?.kernel_id),
        createHomeDetail('Ultimo progreso', sharedResourceMessage || item?.progress?.message || item?.message || item?.progress?.status),
        createHomeDetail('Recurso compartido', sharedResourceMessage),
        createHomeDetail('Plantilla', templateEntry?.template_mirror_relpath || item?.template_mirror_relpath || (templateEntry?.template_attached || item?.template_attached ? 'Adjunta' : 'Sin plantilla')),
        createHomeDetail('Ultimo DOCX', latestDocx?.workspace_relpath || latestDocx?.docx_file_name || latestDocx?.docxFileName),
      ].filter(Boolean),
      actions: [
        notebookPayload ? createHomeAction('Abrir notebook', createHomeTarget('notebook', notebookPayload), 'primary') : null,
        latestDocx ? createHomeAction('Abrir DOCX', createHomeTarget('document', latestDocx), 'secondary') : null,
      ].filter(Boolean),
    };
  });

  const codeRows = codeRuntimeItems.map((item, index) => {
    const filePath = item?.file_path || item?.path || item?.source_path || null;
    const stateMeta = getHomeNotebookStateMeta(item?.state);
    const progressPercent = clampHomePercent(item?.progress?.percent ?? item?.progress_percent);
    const progress = progressPercent !== null || item?.state === 'running'
      ? {
        value: progressPercent ?? 8,
        max: 100,
        label: `${progressPercent ?? 8}%`,
        tone: stateMeta.tone === 'warn' ? 'warn' : 'accent',
      }
      : null;
    const filePayload = filePath
      ? {
        path: filePath,
        name: getPathBasename(filePath) || filePath,
      }
      : null;

    return {
      id: item?.run_id || item?.runtime_id || filePath || `code-runtime-${index}`,
      title: item?.file_relpath || getPathBasename(filePath) || `Script ${index + 1}`,
      subtitle: item?.progress?.message || item?.message || stateMeta.label,
      meta: item?.run_id
        ? `${stateMeta.label} - ${item.run_id}`
        : `${stateMeta.label} - ${formatHomeTimestamp(item?.updated_at)}`,
      badges: [
        createHomeBadge('Codigo', 'neutral'),
        createHomeBadge(stateMeta.label, stateMeta.tone),
      ].filter(Boolean),
      progress,
      target: filePayload ? createHomeTarget('file', filePayload) : null,
      details: [
        createHomeDetail('Ruta', filePath),
        createHomeDetail('Run', item?.run_id || item?.runtime_id),
        createHomeDetail('Ultimo progreso', item?.progress?.message || item?.message || item?.progress?.status),
      ].filter(Boolean),
      actions: [
        filePayload ? createHomeAction('Abrir archivo', createHomeTarget('file', filePayload), 'primary') : null,
      ].filter(Boolean),
    };
  });

  const docxRows = recentDocxItems.map((item, index) => {
    const sourcePath = item?.source_path || item?.sourcePath || null;
    const sourcePayload = sourcePath
      ? {
        path: sourcePath,
        name: getPathBasename(sourcePath) || sourcePath,
      }
      : null;
    const sourceTarget = sourcePayload
      ? createHomeTarget(isNotebookPath(sourcePath) ? 'notebook' : 'file', sourcePayload)
      : null;
    const label = item?.docx_file_name || item?.docxFileName || getPathBasename(item?.workspace_path) || `Documento ${index + 1}`;
    const fileTarget = createHomeTarget('document', { ...item, openMode: 'file' });
    const qualityTarget = createHomeTarget('document', { ...item, openMode: 'quality', focus: 'quality', focusQuality: true });
    return {
      id: item?.artifact_id || item?.id || `${label}-${index}`,
      title: label,
      subtitle: sourcePath ? getPathBasename(sourcePath) : 'Documento sin notebook origen',
      meta: formatHomeTimestamp(item?.updated_at || item?.created_at || item?.docx_updated_at || item?.docxUpdatedAt),
      badges: [
        createHomeBadge(hasPdfArtifact(item) ? 'DOCX + PDF' : 'DOCX', 'good'),
        createHomeBadge(item?.workspace_path ? 'Persistido' : 'Temporal', item?.workspace_path ? 'accent' : 'neutral'),
        getHomeQualityBadge(item),
        getHomeRenderBadge(item),
      ].filter(Boolean),
      target: fileTarget,
      details: [
        createHomeDetail('Origen', sourcePath),
        createHomeDetail('Archivo', item?.workspace_path || item?.delivery_path || item?.path),
        createHomeDetail('Tamano', formatHomeBytes(item?.size_bytes || item?.docx_size_bytes || item?.docxSizeBytes)),
        createHomeDetail('Calidad', getHomeQualityBadge(item)?.label),
        createHomeDetail('Visual', getHomeRenderBadge(item)?.label),
        createHomeDetail('Aviso', item?.docx_warning || item?.docxWarning),
      ].filter(Boolean),
      actions: [
        createHomeAction('Abrir DOCX', fileTarget, 'primary'),
        createHomeAction('Preparar entrega', qualityTarget, 'secondary'),
        sourceTarget ? createHomeAction(isNotebookPath(sourcePath) ? 'Abrir notebook origen' : 'Abrir origen', sourceTarget, 'secondary') : null,
      ].filter(Boolean),
    };
  });

  const serviceMeta = getHomeServiceStateMeta(mcpService?.status);
  const mcpRows = [
    {
      id: 'mcp-service',
      title: 'Servicio MCP local',
      subtitle: mcpService?.url || 'Servicio shell-owned del workspace',
      meta: `Puerto ${mcpService?.port || mcpStatus?.port || 8100}`,
      badges: [
        createHomeBadge(serviceMeta.label, serviceMeta.tone),
        createHomeBadge(mirrorEnabled ? 'Espejo activo' : 'Espejo inactivo', mirrorEnabled ? 'accent' : 'muted'),
      ].filter(Boolean),
      target: createHomeTarget('agents'),
      details: [
        createHomeDetail('Estado', serviceMeta.label),
        createHomeDetail('PID', mcpService?.pid),
        createHomeDetail('Uptime', formatHomeUptime(mcpService?.uptime_seconds || mcpStatus?.uptime_seconds)),
        createHomeDetail('Runs activos', mcpService?.activity?.active_count),
      ].filter(Boolean),
      actions: [
        createHomeAction('Abrir agentes', createHomeTarget('agents'), 'primary'),
      ],
    },
    ...mcpClients.map((client, index) => {
      const clientTarget = createHomeTarget('agents', {
        client_id: client?.client_id || null,
        client_label: client?.client_label || null,
      });
      const statusTone = client?.status === 'active' ? 'good' : 'muted';
      const recentActivity = Array.isArray(client?.recent_activity) ? client.recent_activity : [];
      const latestActivity = recentActivity[0] || null;
      return {
        id: client?.client_id || `mcp-client-${index}`,
        title: client?.client_label || client?.client_id || `Cliente MCP ${index + 1}`,
      subtitle: client?.transport || 'Transporte no informado',
        meta: latestActivity?.summary
          ? `${latestActivity.summary} - ${formatHomeTimestamp(latestActivity.ts)}`
          : `Ultimo heartbeat - ${formatHomeTimestamp(client?.last_seen_at)}`,
        badges: [
          createHomeBadge(client?.status === 'active' ? 'Activo' : 'Inactivo', statusTone),
          typeof client?.active_run_count === 'number' && client.active_run_count > 0
            ? createHomeBadge(`${client.active_run_count} run${client.active_run_count === 1 ? '' : 's'}`, 'accent')
            : null,
        ].filter(Boolean),
        target: clientTarget,
        details: [
          createHomeDetail('Cliente', client?.client_id),
          createHomeDetail('Ultimo heartbeat', formatHomeTimestamp(client?.last_seen_at)),
          createHomeDetail('Ultima actividad', latestActivity?.summary || client?.last_activity_summary),
          createHomeDetail('Actividad 1', recentActivity[0] ? `${recentActivity[0].tool_name || 'herramienta'} - ${recentActivity[0].summary || recentActivity[0].status || 'evento'}` : null),
          createHomeDetail('Actividad 2', recentActivity[1] ? `${recentActivity[1].tool_name || 'herramienta'} - ${recentActivity[1].summary || recentActivity[1].status || 'evento'}` : null),
          createHomeDetail('Actividad 3', recentActivity[2] ? `${recentActivity[2].tool_name || 'herramienta'} - ${recentActivity[2].summary || recentActivity[2].status || 'evento'}` : null),
        ].filter(Boolean),
        actions: [
          createHomeAction('Abrir agentes', clientTarget, 'primary'),
        ],
      };
    }),
  ];

  const templateRows = templateItems.filter((item) => item?.template_attached).map((item, index) => {
    const notebookPath = item?.notebook_path || null;
    const notebookPayload = notebookPath
      ? {
        path: notebookPath,
        name: getPathBasename(notebookPath) || notebookPath,
      }
      : null;
    const templatePayload = {
      ...item,
      sourcePath: notebookPath,
      path: notebookPath,
    };
    return {
      id: item?.notebook_path || `template-${index}`,
      title: item?.notebook_relpath || getPathBasename(notebookPath) || `Notebook ${index + 1}`,
      subtitle: item?.template_attached ? 'Plantilla lista para editar' : 'Sin plantilla adjunta',
      meta: item?.template_updated_at
        ? formatHomeTimestamp(item.template_updated_at)
        : item?.runtime_state
          ? getHomeNotebookStateMeta(item.runtime_state).label
          : 'Sin actividad reciente',
      badges: [
        createHomeBadge(item?.template_attached ? 'Plantilla adjunta' : 'Sin plantilla', item?.template_attached ? 'good' : 'muted'),
        item?.runtime_state ? createHomeBadge(getHomeNotebookStateMeta(item.runtime_state).label, getHomeNotebookStateMeta(item.runtime_state).tone) : null,
      ].filter(Boolean),
      target: item?.template_attached
        ? createHomeTarget('template', templatePayload)
        : (notebookPayload ? createHomeTarget('notebook', notebookPayload) : null),
      details: [
        createHomeDetail('Notebook', notebookPath),
        createHomeDetail('Espejo', item?.template_mirror_relpath || item?.template_mirror_path),
        createHomeDetail('Estilos', item?.style_count),
        createHomeDetail('Kernel', item?.kernel_id),
      ].filter(Boolean),
      actions: [
        createHomeAction('Abrir plantilla', createHomeTarget('template', templatePayload), 'primary'),
        item?.template_attached && notebookPayload
          ? createHomeAction('Abrir notebook', createHomeTarget('notebook', notebookPayload), 'secondary')
          : null,
      ].filter(Boolean),
    };
  });

  const runtimeNotebookKeys = new Set(
    notebookRuntimeItems
      .map((item) => normalizeComparablePath(item?.notebook_path || item?.path))
      .filter(Boolean),
  );
  const discoveredNotebookRows = templateItems
    .filter((item) => {
      const notebookKey = normalizeComparablePath(item?.notebook_path);
      return notebookKey && !runtimeNotebookKeys.has(notebookKey);
    })
    .map((item, index) => {
      const notebookPath = item?.notebook_path || null;
      const notebookKey = normalizeComparablePath(notebookPath);
      const latestDocx = notebookKey ? latestDocxByPath.get(notebookKey) : null;
      const notebookPayload = notebookPath
        ? {
          path: notebookPath,
          name: getPathBasename(notebookPath) || notebookPath,
        }
        : null;
      const templatePayload = {
        ...item,
        sourcePath: notebookPath,
        path: notebookPath,
      };
      const statusMeta = item?.runtime_state
        ? getHomeNotebookStateMeta(item.runtime_state)
        : { label: 'Listo para abrir', tone: 'neutral' };
      const metaText = joinHomePhrases([
        item?.template_updated_at ? `Plantilla ${formatHomeTimestamp(item.template_updated_at)}` : null,
        latestDocx ? `DOCX ${formatHomeTimestamp(latestDocx?.updated_at || latestDocx?.created_at || latestDocx?.docx_updated_at || latestDocx?.docxUpdatedAt)}` : null,
      ]) || 'Inventariado en el workspace';
      return {
        id: item?.notebook_path || `discovered-notebook-${index}`,
        title: item?.notebook_relpath || getPathBasename(notebookPath) || `Notebook ${index + 1}`,
        subtitle: item?.template_attached ? 'Notebook descubierto con plantilla persistida' : 'Notebook descubierto listo para abrir',
        meta: metaText,
        badges: [
          createHomeBadge('Inventariado', 'neutral'),
          createHomeBadge(item?.template_attached ? 'Plantilla adjunta' : 'Sin plantilla', item?.template_attached ? 'good' : 'muted'),
          createHomeBadge(statusMeta.label, statusMeta.tone),
        ].filter(Boolean),
        target: notebookPayload ? createHomeTarget('notebook', notebookPayload) : null,
        details: [
          createHomeDetail('Ruta', notebookPath),
          createHomeDetail('Plantilla', item?.template_mirror_relpath || item?.template_mirror_path || (item?.template_attached ? 'Adjunta' : 'Sin plantilla')),
          createHomeDetail('Ultimo DOCX', latestDocx?.workspace_relpath || latestDocx?.docx_file_name || latestDocx?.docxFileName),
          createHomeDetail('Estilos', item?.style_count),
        ].filter(Boolean),
        actions: [
          notebookPayload ? createHomeAction('Abrir notebook', createHomeTarget('notebook', notebookPayload), 'primary') : null,
          item?.template_attached ? createHomeAction('Abrir plantilla', createHomeTarget('template', templatePayload), 'secondary') : null,
        ].filter(Boolean),
      };
    });
  const notebookCardRows = limitHomeRows([...notebookRows, ...codeRows, ...discoveredNotebookRows]);
  const understandPrimaryTarget = notebookRows[0]?.target
    || discoveredNotebookRows[0]?.target
    || createHomeTarget('fileSurface');
  const latestDocx = docxRows[0] || null;
  const primaryTemplate = templateRows.find((item) => item?.target?.kind === 'template') || templateRows[0] || null;
  const deliverPrimaryTarget = latestDocx?.target || primaryTemplate?.target || understandPrimaryTarget;
  const understandSummary = joinHomePhrases([
    workspaceNotebookCount > 0 ? `${workspaceNotebookCount} notebook${workspaceNotebookCount === 1 ? '' : 's'} inventariados` : null,
    templateAttachedCount > 0 ? `${templateAttachedCount} con plantilla` : null,
    runtimeCodeCount > 0 ? `${runtimeCodeCount} script${runtimeCodeCount === 1 ? '' : 's'} activos` : null,
  ]);
  const runSummary = joinHomePhrases([
    runtimeActiveCount > 0 ? `${runtimeActiveCount} runtime${runtimeActiveCount === 1 ? '' : 's'} activos` : null,
    mcpActiveRunCount > 0 ? `${mcpActiveRunCount} run${mcpActiveRunCount === 1 ? '' : 's'} MCP activos` : null,
    mcpClientCount > 0 ? `${mcpClientCount} cliente${mcpClientCount === 1 ? '' : 's'} conectados` : null,
  ]);
  const deliverSummary = joinHomePhrases([
    recentDocxCount > 0 ? `${recentDocxCount} DOCX recientes` : null,
    templateAttachedCount > 0 ? `${templateAttachedCount} plantilla${templateAttachedCount === 1 ? '' : 's'} lista${templateAttachedCount === 1 ? '' : 's'}` : null,
  ]);
  const runtimeRows = [...notebookRows, ...codeRows];
  const activeRuntimeRows = runtimeRows.filter((row) => (
    Boolean(row?.progress)
    || row?.badges?.some((badge) => ['Ejecutando', 'Con error', 'Cancelado', 'Interrumpido'].includes(badge?.label))
  ));
  const docxAttentionRows = docxRows.filter((row, index) => (
    index === 0
    && row?.badges?.some((badge) => (
      ['Sin analizar', 'Revisar calidad', 'Con avisos', 'Sin render', 'Visual error'].includes(badge?.label)
      || /\baviso/.test(String(badge?.label || '').toLowerCase())
    ))
  ));
  const mcpAttentionRows = [
    serviceMeta.tone === 'warn' ? mcpRows[0] : null,
    mcpActiveRunCount > 0 ? {
      ...mcpRows[0],
      id: 'mcp-active-runs',
      title: 'Runs MCP activos',
      subtitle: `${mcpActiveRunCount} run${mcpActiveRunCount === 1 ? '' : 's'} en curso`,
      meta: serviceMeta.label,
      badges: [
        createHomeBadge(`${mcpActiveRunCount} MCP`, 'warn'),
        createHomeBadge(serviceMeta.label, serviceMeta.tone),
      ].filter(Boolean),
    } : null,
  ].filter(Boolean);
  const attentionItems = limitHomeRows([
    ...activeRuntimeRows.map((row) => ({
      ...row,
      tone: row?.progress?.tone || 'accent',
      attentionLabel: 'Ejecucion activa',
    })),
    ...mcpAttentionRows.map((row) => ({
      ...row,
      tone: row?.badges?.[0]?.tone || 'warn',
      attentionLabel: 'Agentes',
    })),
    ...docxAttentionRows.map((row) => ({
      ...row,
      tone: row?.badges?.some((badge) => badge?.tone === 'warn') ? 'warn' : 'good',
      attentionLabel: 'Entrega',
    })),
  ]);
  const stableAttentionTarget = latestDocx?.target || understandPrimaryTarget || createHomeTarget('fileSurface');
  const stableAttentionAction = createHomeAction(
    latestDocx ? 'Abrir ultimo DOCX' : (understandPrimaryTarget?.kind === 'notebook' ? 'Abrir primer notebook' : 'Ir a archivos'),
    stableAttentionTarget,
    'primary',
  );
  const normalizedAttentionItems = attentionItems.length ? attentionItems : [{
    id: 'attention-stable',
    title: 'Sin atenciones criticas',
    subtitle: 'No hay ejecuciones activas ni avisos relevantes en este momento.',
    meta: normalizedUpdatedAt ? `Actualizado ${formatHomeTimestamp(normalizedUpdatedAt)}` : 'Workspace estable',
    tone: 'good',
    badges: [
      createHomeBadge('Estable', 'good'),
    ].filter(Boolean),
    target: stableAttentionTarget,
    details: [
      createHomeDetail('Estado', 'Sin ejecuciones activas'),
      createHomeDetail('Ultimo resumen', normalizedUpdatedAt ? formatHomeTimestamp(normalizedUpdatedAt) : null),
    ].filter(Boolean),
    actions: [
      stableAttentionAction,
    ].filter(Boolean),
  }];
  const firstAttentionAction = normalizedAttentionItems[0]?.actions?.[0]
    || createHomeAction('Abrir detalle', normalizedAttentionItems[0]?.target, 'primary');
  const operationalQuickActions = [
    createHomeAction('Ir a archivos', createHomeTarget('fileSurface'), 'primary'),
    createHomeAction('Abrir agentes', createHomeTarget('agents'), 'ghost'),
    latestDocx ? createHomeAction('Abrir ultimo DOCX', latestDocx.target, 'secondary') : null,
    primaryTemplate ? createHomeAction('Abrir plantilla', primaryTemplate.target, 'secondary') : null,
  ].filter(Boolean);

  return {
    workspaceName,
    workspacePath: resolvedWorkspacePath,
    subtitle: homeSummaryError
      ? 'La home sigue operativa con el ultimo snapshot disponible mientras se recompone el resumen del workspace.'
      : 'Entender -> Ejecutar -> Entregar deja visible el estado del workspace sin depender de un editor montado.',
    meta: [
      workspaceNotebookCount ? `${workspaceNotebookCount} notebook${workspaceNotebookCount === 1 ? '' : 's'}` : 'Sin notebooks',
      runtimeActiveCount ? `${runtimeActiveCount} activos` : 'Sin ejecucion activa',
      recentDocxCount ? `${recentDocxCount} DOCX` : 'Sin DOCX',
      normalizedUpdatedAt ? `Actualizado ${formatHomeTimestamp(normalizedUpdatedAt)}` : null,
    ].filter(Boolean),
    headerActions: [
      createHomeAction('Ir a archivos', createHomeTarget('fileSurface'), 'primary'),
      createHomeAction('Abrir agentes', createHomeTarget('agents'), 'ghost'),
    ].filter(Boolean),
    operational: {
      quickActions: operationalQuickActions,
      attention: {
        title: 'Atencion',
        summary: attentionItems.length
          ? 'Lo que requiere una decision o seguimiento inmediato aparece primero.'
          : 'No hay bloqueos visibles; puedes retomar trabajo, agentes o entregables.',
        primaryAction: firstAttentionAction,
        items: normalizedAttentionItems,
      },
      lanes: {
        understand: {
          id: 'understand',
          title: 'Entender',
          kicker: 'Notebooks y contexto',
          tone: 'accent',
          badge: createHomeBadge(
            workspaceNotebookCount ? `${workspaceNotebookCount} inventariados` : 'Sin notebooks',
            workspaceNotebookCount ? 'accent' : 'muted',
          ),
          summary: understandSummary || 'Todavia no hay notebooks inventariados; usa Archivos para abrir o crear uno.',
          primaryAction: createHomeAction(
            understandPrimaryTarget?.kind === 'notebook' ? 'Abrir primer notebook' : 'Ir a archivos',
            understandPrimaryTarget,
            'primary',
          ),
          items: notebookCardRows,
          emptyState: {
            title: 'Sin notebooks inventariados',
            description: 'Los notebooks de usuario apareceran aqui cuando el workspace los descubra.',
            actions: [
              createHomeAction('Ir a archivos', createHomeTarget('fileSurface'), 'primary'),
            ].filter(Boolean),
          },
        },
        run: {
          id: 'run',
          title: 'Ejecutar',
          kicker: 'Runtimes y agentes',
          tone: 'warn',
          badge: createHomeBadge(
            (runtimeActiveCount + mcpActiveRunCount) > 0
              ? `${runtimeActiveCount + mcpActiveRunCount} activos`
              : serviceMeta.label,
            (runtimeActiveCount + mcpActiveRunCount) > 0 ? 'warn' : serviceMeta.tone,
          ),
          summary: runSummary || `Servicio ${serviceMeta.label.toLowerCase()} sin runs activos todavia.`,
          primaryAction: createHomeAction('Abrir agentes', createHomeTarget('agents'), 'primary'),
          items: limitHomeRows([...activeRuntimeRows, ...mcpRows]),
          emptyState: {
            title: 'Sin ejecucion activa',
            description: 'Los runtimes y clientes MCP apareceran aqui cuando empiece el trabajo.',
            actions: [
              createHomeAction('Abrir agentes', createHomeTarget('agents'), 'primary'),
            ],
          },
        },
        deliver: {
          id: 'deliver',
          title: 'Entregar',
          kicker: 'DOCX, calidad y formato',
          tone: 'good',
          badge: createHomeBadge(
            recentDocxCount ? `${recentDocxCount} DOCX` : (templateAttachedCount ? `${templateAttachedCount} plantilla${templateAttachedCount === 1 ? '' : 's'}` : 'Sin entrega'),
            recentDocxCount ? 'good' : (templateAttachedCount ? 'accent' : 'muted'),
          ),
          summary: deliverSummary || 'Cuando exista un DOCX o una plantilla persistida, quedara listo para preparar entrega.',
          primaryAction: createHomeAction(
            latestDocx ? 'Abrir ultimo DOCX' : (primaryTemplate ? 'Abrir plantilla' : 'Abrir notebook'),
            deliverPrimaryTarget,
            'primary',
          ),
          items: limitHomeRows([...docxRows, ...templateRows]),
          emptyState: {
            title: 'Sin entregables',
            description: 'Las plantillas y DOCX listos apareceran aqui junto a su origen.',
            actions: [
              createHomeAction(primaryTemplate ? 'Abrir plantilla' : 'Abrir notebook', primaryTemplate?.target || understandPrimaryTarget, 'primary'),
            ].filter(Boolean),
          },
        },
      },
    },
    journey: {
      title: 'Entender -> Ejecutar -> Entregar',
      summary: 'La home persistente explica el objetivo del producto y deja cada etapa a un click.',
      stages: [
        {
          id: 'understand',
          title: 'Entender',
          tone: 'accent',
          badge: createHomeBadge(
            workspaceNotebookCount ? `${workspaceNotebookCount} notebook${workspaceNotebookCount === 1 ? '' : 's'}` : 'Sin notebooks',
            workspaceNotebookCount ? 'accent' : 'muted',
          ),
          summary: understandSummary || 'Todavia no hay notebooks inventariados; usa Archivos para abrir o crear uno.',
          actions: [
            createHomeAction(
              understandPrimaryTarget?.kind === 'notebook' ? 'Abrir primer notebook' : 'Ir a archivos',
              understandPrimaryTarget,
              'primary',
            ),
          ].filter(Boolean),
        },
        {
          id: 'run',
          title: 'Ejecutar',
          tone: 'warn',
          badge: createHomeBadge(
            (runtimeActiveCount + mcpActiveRunCount) > 0
              ? `${runtimeActiveCount + mcpActiveRunCount} activos`
              : 'En espera',
            (runtimeActiveCount + mcpActiveRunCount) > 0 ? 'warn' : 'muted',
          ),
          summary: runSummary || 'Los runtimes y los agentes apareceran aqui cuando empiece la ejecucion.',
          actions: [
            createHomeAction('Abrir agentes', createHomeTarget('agents'), 'primary'),
          ],
        },
        {
          id: 'deliver',
          title: 'Entregar',
          tone: 'good',
          badge: createHomeBadge(
            recentDocxCount ? `${recentDocxCount} DOCX` : (templateAttachedCount ? 'Plantilla lista' : 'Sin entrega'),
            recentDocxCount ? 'good' : (templateAttachedCount ? 'accent' : 'muted'),
          ),
          summary: deliverSummary || 'Cuando se genere un entregable, quedara visible aqui junto a su origen.',
          actions: [
            createHomeAction(
              latestDocx ? 'Abrir ultimo DOCX' : (primaryTemplate ? 'Abrir plantilla' : 'Abrir notebook'),
              deliverPrimaryTarget,
              'primary',
            ),
          ].filter(Boolean),
        },
      ],
    },
    cards: {
      notebooks: {
        summary: understandSummary || 'Todavia no hay notebooks inventariados en este workspace.',
        badge: createHomeBadge(
          workspaceNotebookCount ? `${workspaceNotebookCount} inventariados` : 'Sin notebooks',
          workspaceNotebookCount ? 'accent' : 'muted',
        ),
        primaryTarget: understandPrimaryTarget,
        rows: notebookCardRows,
        emptyState: {
          title: 'Sin notebooks inventariados',
          description: 'La tarjeta mostrara notebooks descubiertos del workspace, scripts activos y cualquier runtime reciente.',
          actions: [
            createHomeAction('Ir a archivos', createHomeTarget('fileSurface'), 'primary'),
          ].filter(Boolean),
        },
      },
      docx: {
        summary: recentDocxCount
          ? `${recentDocxCount} entrega${recentDocxCount === 1 ? '' : 's'} recientes listas para abrir.`
          : (templateAttachedCount
            ? 'Hay plantillas listas; el proximo entregable aparecera aqui.'
            : 'Todavia no hay entregables DOCX registrados para este workspace.'),
        badge: createHomeBadge(recentDocxCount ? `${recentDocxCount} recientes` : 'Sin DOCX', recentDocxCount ? 'good' : 'muted'),
        primaryTarget: deliverPrimaryTarget,
        rows: docxRows,
        actions: [
          latestDocx ? createHomeAction('Abrir ultimo DOCX', latestDocx.target, 'primary') : null,
          latestDocx ? createHomeAction('Preparar entrega', createHomeTarget('document', { ...(latestDocx.target?.payload || {}), openMode: 'quality', focus: 'quality', focusQuality: true }), 'secondary') : null,
        ].filter(Boolean),
        emptyState: {
          title: 'No hay DOCX generados',
          description: 'Los entregables apareceran aqui con acceso directo al archivo y a su notebook origen.',
          actions: [
            createHomeAction(primaryTemplate ? 'Abrir plantilla' : 'Abrir notebook', primaryTemplate?.target || understandPrimaryTarget, 'primary'),
          ].filter(Boolean),
        },
      },
      mcpClients: {
        summary: runSummary || `Servicio ${serviceMeta.label.toLowerCase()} sin clientes ni runs activos todavia.`,
        badge: createHomeBadge(
          (runtimeActiveCount + mcpActiveRunCount) > 0 ? `${runtimeActiveCount + mcpActiveRunCount} activos` : serviceMeta.label,
          (runtimeActiveCount + mcpActiveRunCount) > 0 ? 'warn' : serviceMeta.tone,
        ),
        primaryTarget: createHomeTarget('agents'),
        rows: mcpRows,
        emptyState: {
          title: 'Sin clientes MCP',
          description: 'El servicio local esta listo, pero todavia no hay clientes reportando heartbeat o actividad.',
          actions: [
            createHomeAction('Abrir agentes', createHomeTarget('agents'), 'primary'),
          ],
        },
      },
      templates: {
        summary: templateAttachedCount
          ? `${templateAttachedCount} plantilla${templateAttachedCount === 1 ? '' : 's'} persistida${templateAttachedCount === 1 ? '' : 's'} lista${templateAttachedCount === 1 ? '' : 's'} para editar.`
          : 'Todavia no hay plantillas persistidas para notebooks de usuario en este workspace.',
        badge: createHomeBadge(templateAttachedCount ? `${templateAttachedCount} adjunta${templateAttachedCount === 1 ? '' : 's'}` : 'Sin plantilla', templateAttachedCount ? 'good' : 'muted'),
        primaryTarget: primaryTemplate?.target || understandPrimaryTarget,
        rows: limitHomeRows(templateRows),
        emptyState: {
          title: 'Sin plantillas persistidas',
          description: 'Cuando un notebook cargue una plantilla, quedara visible aqui junto a su espejo del workspace.',
          actions: [
            createHomeAction('Ir a archivos', createHomeTarget('fileSurface'), 'ghost'),
          ].filter(Boolean),
        },
      },
    },
  };
};

function App() {
  // Helpers refs
  const notebookActionsRef = useRef(null);
  const pdfStatusAbortRef = useRef(null);
  const pdfServiceStatusRef = useRef(null);
  const notificationSeqRef = useRef(0);
  const docxHistoryLoadedRef = useRef(false);
  const lastRecordedDocxHistoryKeyRef = useRef({ code: null, notebook: null });
  const reportedWorkspaceRef = useRef(null);
  const desktopNotificationKeysRef = useRef(new Set());
  const workspaceConflictWarningPathsRef = useRef(new Set());
  const workspaceLaunchIntentRef = useRef(null);
  const desktopApi = typeof window !== 'undefined' ? window.inspyroDesktop : null;
  const isDesktopShell = Boolean(desktopApi?.isDesktop);

  // ==================== CUSTOM HOOKS ====================
  const {
    currentWorkspace,
    openFiles,
    activeFile,
    modifiedFiles,
    externalStaleFiles,
    externalConflictFiles,
    code,
    notebookData,
    notebookSyncState,
    autoSaveEnabled,
    setCode,
    setNotebookData,
    setAutoSaveEnabled,
    handleFileOpen,
    handleFileSelect,
    handleFileDrop,
    handleWorkspaceChange,
    saveFile,
    reloadFile,
    reloadFileByPath,
    renameOpenFile,
    removeOpenFile,
    applyExternalWorkspaceEvents,
  } = useFileSystem(API_BASE, DEFAULT_CODE, notebookActionsRef);
  const [notebookSessionsByPath, setNotebookSessionsByPath] = useState({});
  const notebookSessionsRef = useRef({});
  const pendingNotebookExecutionByPathRef = useRef({});
  const lastNotebookQueueMessageIdsRef = useRef({
    global: 0,
    notebook: 0,
  });
  const notebookBatchRunSeqRef = useRef(0);
  const notebookKernelBindingSeqRef = useRef(0);
  const waitingKernelTimeoutsRef = useRef({});
  const kickOffNotebookBatchExecutionRef = useRef(null);

  const {
    connectionStatus,
    sendMessage,
    lastMessage,
    messageQueue,
    notebookMessageQueue = [],
    sendNotebookMessage,
    getNotebookConnectionStatus,
    getNotebookLastMessage,
    output,
    isExecuting,
    editorExecutionData,
    notebookExecutionData: legacyNotebookExecutionData = null,
    handleExecuteCode,
    cancelCodeExecution,
    clearCodeExecutionState,
    codeExecutionStateByPath,
  } = useAppWebSocket({
    sourcePath: activeFile?.path || null,
    notebookPaths: Object.keys(notebookSessionsByPath),
  });

  // ==================== COMPONENT LOCAL UI STATE ====================
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [explorerWidthPx, setExplorerWidthPx] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH);
  const [leftSidebarView, setLeftSidebarView] = useState('explorer');
  const [isVizCollapsed, setIsVizCollapsed] = useState(false);
  const [codePanelWidth, setCodePanelWidth] = useState(45);
  const [notebookPanelWidth, setNotebookPanelWidth] = useState(58);

  // Estados controlados por App para el notebook
  const [nbAutoDocEnabled, setNbAutoDocEnabled] = useState(true);
  const [nbTrustHtml, setNbTrustHtml] = useState(false);
  const [nbEnableTracing, setNbEnableTracing] = useState(false);
  const [nbDocxValidationEnabled, setNbDocxValidationEnabled] = useState(true);

  const [notifications, setNotifications] = useState([]);
  const [pdfServiceStatus, setPdfServiceStatus] = useState(null);
  const mainContainerRef = useRef(null);
  const leftSidebarShellRef = useRef(null);
  const codePanelRef = useRef(null);
  const codeVisualizationPanelRef = useRef(null);
  const notebookPanelRef = useRef(null);
  const notebookSplitContainerRef = useRef(null);
  const notebookVisualizationPanelRef = useRef(null);
  const activeResizeSessionRef = useRef(null);

  // Estado para vista de dependencias en VisualizationPanel
  const [dependencyTarget, setDependencyTarget] = useState(null);
  const dependencyRequestSeqRef = useRef(0);
  const [codeNavigationTarget, setCodeNavigationTarget] = useState(null);
  const [pendingNotebookNavigation, setPendingNotebookNavigation] = useState(null);
  const [fileExplorerRefreshToken, setFileExplorerRefreshToken] = useState(0);
  const [visualizationViewRequest, setVisualizationViewRequest] = useState(null);
  const [lastWorkspaceFsEvent, setLastWorkspaceFsEvent] = useState(null);

  // Estado MCP
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [mcpClientFilter, setMcpClientFilter] = useState(null);

  const [workspaceSession, setWorkspaceSession] = useState({
    activeWorkspace: null,
    workspaceRoot: '',
    workspacePath: '',
    suggestedWorkspaceRoot: '',
    recentWorkspaces: [],
    workspaceSource: 'default',
    isLoading: true,
    error: null,
  });
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const [workspacePickerStartPath, setWorkspacePickerStartPath] = useState('');
  const [workspaceActionPending, setWorkspaceActionPending] = useState(false);
  const [workspaceActionLabel, setWorkspaceActionLabel] = useState('');
  const [postWorkspaceAction, setPostWorkspaceAction] = useState(null);
  const [workspaceSurface, setWorkspaceSurface] = useState('home');
  const [emptyFileSurfaceRequested, setEmptyFileSurfaceRequested] = useState(false);
  const [unsupportedFilePrompt, setUnsupportedFilePrompt] = useState(null);
  const [homeSummary, setHomeSummary] = useState(EMPTY_HOME_SUMMARY);
  const [, setHomeSummaryLoading] = useState(false);
  const [homeSummaryError, setHomeSummaryError] = useState(null);
  const [docxHistoryEntries, setDocxHistoryEntries] = useState(() => loadDocxHistoryEntries());
  const activeNotebookPath = activeFile?.path?.endsWith('.ipynb') ? activeFile.path : null;
  const updateNotebookSession = useCallback((path, updater) => {
    if (typeof path !== 'string' || !path.trim()) {
      return;
    }
    setNotebookSessionsByPath((current) => {
      const previous = current[path] || createEmptyNotebookSession();
      const next = typeof updater === 'function' ? updater(previous) : {
        ...previous,
        ...updater,
      };
      if (!next) {
        return current;
      }
      const nextState = {
        ...current,
        [path]: next,
      };
      notebookSessionsRef.current = nextState;
      return nextState;
    });
  }, []);
  const applyRuntimeNotebookSnapshotToSession = useCallback((previous, resolvedNotebook, options = {}) => {
    const {
      rehydrateEditor = false,
    } = options || {};
    const normalizedNotebook = normalizeNotebookSnapshot(resolvedNotebook);
    if (!normalizedNotebook && !previous.runtimeNotebook) {
      return previous;
    }
    return {
      ...previous,
      runtimeNotebook: normalizedNotebook,
      runtimeVersion: (previous.runtimeVersion || 0) + 1,
      editorHydrationToken: rehydrateEditor
        ? ((previous.editorHydrationToken || 0) + 1)
        : (previous.editorHydrationToken || 0),
      kernelState: {
        ...previous.kernelState,
        hasNotebook: Boolean(normalizedNotebook),
      },
    };
  }, []);
  const removeNotebookSession = useCallback((path) => {
    if (typeof path !== 'string' || !path.trim()) {
      return;
    }
    setNotebookSessionsByPath((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, path)) {
        return current;
      }
      const nextState = { ...current };
      delete nextState[path];
      notebookSessionsRef.current = nextState;
      return nextState;
    });
  }, []);
  const sendNotebookMessageSafe = useCallback((path, message) => {
    if (!message || typeof message !== 'object') {
      return false;
    }
    if (typeof sendNotebookMessage === 'function') {
      return sendNotebookMessage(path || message.path || message.source_path || message.notebook_path || null, message);
    }
    sendMessage(message);
    return true;
  }, [sendMessage, sendNotebookMessage]);
  const getNotebookConnectionStatusSafe = useCallback((path) => {
    if (typeof getNotebookConnectionStatus === 'function') {
      return getNotebookConnectionStatus(path);
    }
    return connectionStatus;
  }, [connectionStatus, getNotebookConnectionStatus]);
  const getNotebookLastMessageSafe = useCallback((path) => {
    if (typeof getNotebookLastMessage === 'function') {
      return getNotebookLastMessage(path);
    }
    return lastMessage;
  }, [getNotebookLastMessage, lastMessage]);
  const setPendingNotebookExecution = useCallback((path, request) => {
    if (typeof path !== 'string' || !path.trim()) {
      return;
    }
    if (!request) {
      delete pendingNotebookExecutionByPathRef.current[path];
      return;
    }
    pendingNotebookExecutionByPathRef.current[path] = {
      ...request,
      filePath: request.filePath || path,
    };
  }, []);
  const getPendingNotebookExecution = useCallback((path) => {
    if (typeof path !== 'string' || !path.trim()) {
      return null;
    }
    if (pendingNotebookExecutionByPathRef.current[path]) {
      return pendingNotebookExecutionByPathRef.current[path];
    }
    const normalizedPath = normalizeComparablePath(path);
    const matchedEntry = Object.entries(pendingNotebookExecutionByPathRef.current).find(([candidatePath]) => (
      normalizeComparablePath(candidatePath) === normalizedPath
    ));
    return matchedEntry ? matchedEntry[1] : null;
  }, []);
  const resolveNotebookSessionPath = useCallback((path) => {
    if (typeof path !== 'string' || !path.trim()) {
      return null;
    }
    if (notebookSessionsRef.current[path]) {
      return path;
    }
    const normalizedPath = normalizeComparablePath(path);
    const matchedSessionPath = Object.keys(notebookSessionsRef.current).find((candidatePath) => (
      normalizeComparablePath(candidatePath) === normalizedPath
    ));
    if (matchedSessionPath) {
      return matchedSessionPath;
    }
    const matchedOpenNotebook = (openFiles || []).find((file) => (
      file?.path?.toLowerCase().endsWith('.ipynb')
      && normalizeComparablePath(file.path) === normalizedPath
    ));
    return matchedOpenNotebook?.path || null;
  }, [openFiles]);
  const findNotebookSessionPathByKernelId = useCallback((kernelId) => {
    if (typeof kernelId !== 'string' || !kernelId.trim()) {
      return null;
    }
    const matchedEntry = Object.entries(notebookSessionsRef.current).find(([, session]) => (
      session?.kernelState?.kernelId === kernelId
    ));
    return matchedEntry?.[0] || null;
  }, []);
  const findNotebookSessionPathByBindingRequestId = useCallback((requestId) => {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      return null;
    }
    const matchedEntry = Object.entries(notebookSessionsRef.current).find(([, session]) => (
      session?.kernelBindingRequest?.requestId === requestId
    ));
    return matchedEntry?.[0] || null;
  }, []);
  const findNotebookSessionPathByExecutionId = useCallback((executionId) => {
    if (typeof executionId !== 'string' || !executionId.trim()) {
      return null;
    }
    const normalizedExecutionId = executionId.trim();
    const matches = [];

    Object.entries(notebookSessionsRef.current).forEach(([path, session]) => {
      const currentExecutionId = typeof session?.batchRunState?.currentExecutionId === 'string'
        ? session.batchRunState.currentExecutionId.trim()
        : null;
      if (currentExecutionId && currentExecutionId === normalizedExecutionId) {
        matches.push(path);
      }
    });

    Object.entries(pendingNotebookExecutionByPathRef.current).forEach(([path, request]) => {
      const pendingExecutionId = typeof request?.executionId === 'string'
        ? request.executionId.trim()
        : null;
      if (!pendingExecutionId || pendingExecutionId !== normalizedExecutionId) {
        return;
      }
      if (!matches.some((candidatePath) => normalizeComparablePath(candidatePath) === normalizeComparablePath(path))) {
        matches.push(path);
      }
    });

    return matches.length === 1 ? matches[0] : null;
  }, []);
  const findWaitingNotebookSessionPathByCellId = useCallback((cellId) => {
    if (typeof cellId !== 'string' || !cellId.trim()) {
      return null;
    }
    const matches = Object.entries(notebookSessionsRef.current).filter(([, session]) => (
      session?.batchRunState?.status === 'waiting_kernel'
      && getNotebookBatchCurrentCellId(session.batchRunState) === cellId
    ));
    return matches.length === 1 ? matches[0][0] : null;
  }, []);
  const resolveNotebookMessagePath = useCallback((message, options = {}) => {
    if (!message || typeof message !== 'object') {
      return null;
    }
    const {
      preferBindingRequestId = false,
      allowWaitingBatchCellMatch = false,
      fallbackSocketPath = null,
    } = options;

    if (preferBindingRequestId) {
      const matchedRequestPath = findNotebookSessionPathByBindingRequestId(message.request_id);
      if (matchedRequestPath) {
        return matchedRequestPath;
      }
    }

    const explicitPath = message.source_path
      || message.notebook_path
      || message.path
      || null;
    const resolvedPath = resolveNotebookSessionPath(explicitPath);
    if (resolvedPath) {
      return resolvedPath;
    }
    const socketFallbackPath = resolveNotebookSessionPath(fallbackSocketPath);
    if (socketFallbackPath) {
      return socketFallbackPath;
    }
    const matchedExecutionPath = findNotebookSessionPathByExecutionId(message.execution_id);
    if (matchedExecutionPath) {
      return matchedExecutionPath;
    }
    if (allowWaitingBatchCellMatch) {
      const matchedWaitingBatchPath = findWaitingNotebookSessionPathByCellId(message.cell_id);
      if (matchedWaitingBatchPath) {
        return matchedWaitingBatchPath;
      }
    }
    const matchedKernelPath = findNotebookSessionPathByKernelId(message.kernel_id);
    if (matchedKernelPath) {
      return matchedKernelPath;
    }
    if (typeof explicitPath === 'string' && explicitPath.trim()) {
      return explicitPath;
    }
    if (typeof fallbackSocketPath === 'string' && fallbackSocketPath.trim()) {
      return fallbackSocketPath;
    }
    return null;
  }, [
    findNotebookSessionPathByBindingRequestId,
    findNotebookSessionPathByExecutionId,
    findNotebookSessionPathByKernelId,
    findWaitingNotebookSessionPathByCellId,
    resolveNotebookSessionPath,
  ]);
  const activeNotebookSessionPath = activeNotebookPath
    ? (resolveNotebookSessionPath(activeNotebookPath) || activeNotebookPath)
    : null;
  const activeNotebookSession = activeNotebookSessionPath
    ? (notebookSessionsByPath[activeNotebookSessionPath] || createEmptyNotebookSession())
    : createEmptyNotebookSession();
  const activeRuntimeNotebook = activeNotebookSession.runtimeNotebook || null;
  const activeNotebookComparablePath = normalizeComparablePath(
    activeNotebookSessionPath || activeNotebookPath || null,
  );
  const notebookSyncComparablePath = normalizeComparablePath(notebookSyncState.path || null);
  const activeNotebookPersistedData = (
    notebookData
    && activeNotebookComparablePath
    && notebookSyncComparablePath
    && activeNotebookComparablePath === notebookSyncComparablePath
  )
    ? notebookData
    : null;
  const activeNotebookInitialData = activeRuntimeNotebook || activeNotebookPersistedData || null;
  const activeNotebookInitialToken = activeRuntimeNotebook
    ? (activeNotebookSession.editorHydrationToken || notebookSyncState.token || 0)
    : (activeNotebookPersistedData ? notebookSyncState.token : 0);
  const isNotebookEditorVisible = Boolean(activeNotebookPath) && workspaceSurface === 'file';
  const notebookExecutionData = activeNotebookSession.documentState;
  const notebookKernelState = activeNotebookSession.kernelState;
  const activeNotebookSelectedCellId = activeNotebookSession.selectedCellId || null;
  const activeNotebookTransportPath = activeNotebookSessionPath || activeNotebookPath || activeFile?.path || null;
  const activeNotebookTemplateInfo = activeNotebookSession.templateInfo || null;
  const activeNotebookTemplateBlob = activeNotebookSession.templateBlob || null;
  const activeNotebookTemplateOpenRequest = activeNotebookSession.templateOpenRequest || null;
  const activeNotebookConnectionStatus = activeNotebookSessionPath
    ? getNotebookConnectionStatusSafe(activeNotebookSessionPath)
    : connectionStatus;
  const activeNotebookLastMessage = activeNotebookSessionPath
    ? getNotebookLastMessageSafe(activeNotebookSessionPath)
    : lastMessage;
  const usingDedicatedNotebookMessageQueue = Array.isArray(notebookMessageQueue) && notebookMessageQueue.length > 0;
  const effectiveNotebookMessageQueue = Array.isArray(notebookMessageQueue) && notebookMessageQueue.length > 0
    ? notebookMessageQueue
    : messageQueue;
  const sendActiveNotebookMessage = useCallback((message) => (
    sendNotebookMessageSafe(activeNotebookTransportPath, message)
  ), [activeNotebookTransportPath, sendNotebookMessageSafe]);
  const setNotebookExecutionData = useCallback((next, options = {}) => {
    const targetPath = options.path || activeNotebookSessionPath || activeNotebookPath;
    if (!targetPath) {
      return;
    }
    updateNotebookSession(targetPath, (previous) => ({
      ...previous,
      documentState: typeof next === 'function'
        ? next(previous.documentState || createEmptyDocumentState())
        : next,
    }));
  }, [activeNotebookPath, activeNotebookSessionPath, updateNotebookSession]);
  const applyNotebookDocumentMessage = useCallback((message, targetPath, options = {}) => {
    if (!message?.type || !targetPath) {
      return;
    }

    if (message.type === 'notebook_mdoc_cleared') {
      setNotebookExecutionData(
        (previous) => resetDocumentState(previous, { preserveVariables: true }),
        { path: targetPath },
      );
      return;
    }

    if (message.type === 'notebook_progress_update' && message.progress_scope === 'document') {
      const documentPipelineStatus = buildDocumentPipelineStatusFromMessage(message);
      const documentPipelineActive = isDocumentPipelineStatusActive(documentPipelineStatus?.status);
      setNotebookExecutionData(
        (previous) => applyDocumentStatePayload(previous, {
          ...message,
          conversionStatus: documentPipelineActive && documentPipelineStatus.message
            ? { message: documentPipelineStatus.message }
            : null,
          documentPipelineStatus: documentPipelineActive ? documentPipelineStatus : null,
        }, {
          sourcePath: options.sourcePath || message.source_path || message.notebook_path || targetPath,
          sourceKind: options.sourceKind || message.source_kind || inferDocxSourceKind(
            options.sourcePath || message.source_path || message.notebook_path || targetPath,
          ),
        }),
        { path: targetPath },
      );
      return;
    }

    const sourcePath = options.sourcePath || message.source_path || message.notebook_path || targetPath;
    const sourceKind = options.sourceKind || message.source_kind || inferDocxSourceKind(sourcePath);
    const mergedPayload = message.type === 'notebook_pdf_ready'
      ? {
        ...message,
        conversionStatus: null,
        documentPipelineStatus: null,
      }
      : message.type === 'pdf_reconverted'
        ? {
          ...message,
          pdfConversionError: message.pdf_conversion_error || (message.status === 'error'
            ? (message.error || 'conversion_failed')
            : null),
          conversionStatus: null,
          documentPipelineStatus: null,
        }
        : message;

    setNotebookExecutionData(
      (previous) => applyDocumentStatePayload(previous, mergedPayload, {
        sourcePath,
        sourceKind,
      }),
      { path: targetPath },
    );
  }, [setNotebookExecutionData]);
  const handleActiveNotebookKernelStateChange = useCallback((nextKernelState) => {
    const reportedPath = (
      typeof nextKernelState?.filePath === 'string' && nextKernelState.filePath.trim()
        ? nextKernelState.filePath
        : null
    );
    const targetPath = reportedPath
      ? (resolveNotebookSessionPath(reportedPath) || reportedPath)
      : (activeNotebookSessionPath || activeNotebookPath);
    if (!targetPath) {
      return;
    }
    updateNotebookSession(targetPath, (previous) => ({
      ...previous,
      kernelState: {
        ...createEmptyNotebookKernelState(),
        ...(previous.kernelState || {}),
        ...(() => {
          const normalizedNextKernelState = { ...(nextKernelState || {}) };
          delete normalizedNextKernelState.filePath;
          if (isNotebookBatchActive(previous.batchRunState)) {
            delete normalizedNextKernelState.isExecuting;
            delete normalizedNextKernelState.executingCellId;
            delete normalizedNextKernelState.isCreating;
          }
          return normalizedNextKernelState;
        })(),
      },
    }));
  }, [activeNotebookPath, activeNotebookSessionPath, resolveNotebookSessionPath, updateNotebookSession]);

  const handleActiveNotebookSelectionChange = useCallback((selectedCellId) => {
    const targetPath = activeNotebookSessionPath || activeNotebookPath;
    if (!targetPath) {
      return;
    }
    updateNotebookSession(targetPath, (previous) => ({
      ...previous,
      selectedCellId: typeof selectedCellId === 'string' && selectedCellId.trim()
        ? selectedCellId
        : null,
    }));
  }, [activeNotebookPath, activeNotebookSessionPath, updateNotebookSession]);

  const handlePendingNotebookExecutionRequestChange = useCallback((request) => {
    const targetPath = activeNotebookSessionPath || activeFile?.path || null;
    if (!targetPath) {
      return;
    }
    setPendingNotebookExecution(targetPath, request);
  }, [activeFile?.path, activeNotebookSessionPath, setPendingNotebookExecution]);

  const setNotebookRuntimeSnapshot = useCallback((path, notebookOrUpdater, options = {}) => {
    if (typeof path !== 'string' || !path.trim()) {
      return;
    }
    updateNotebookSession(path, (previous) => {
      const previousNotebook = previous.runtimeNotebook || null;
      const resolvedNotebook = typeof notebookOrUpdater === 'function'
        ? notebookOrUpdater(previousNotebook, previous)
        : notebookOrUpdater;
      return applyRuntimeNotebookSnapshotToSession(previous, resolvedNotebook, options);
    });
  }, [applyRuntimeNotebookSnapshotToSession, updateNotebookSession]);

  useEffect(() => {
    pdfServiceStatusRef.current = pdfServiceStatus;
  }, [pdfServiceStatus]);

  useEffect(() => {
    const targetPath = activeNotebookSessionPath || activeNotebookPath;
    if (!targetPath || !notebookData) {
      return;
    }
    const targetComparablePath = normalizeComparablePath(targetPath);
    const notebookDataComparablePath = normalizeComparablePath(notebookSyncState.path || null);
    if (
      !targetComparablePath
      || !notebookDataComparablePath
      || targetComparablePath !== notebookDataComparablePath
    ) {
      return;
    }
    const normalizedNotebook = normalizeNotebookSnapshot(notebookData);
    updateNotebookSession(targetPath, (previous) => {
      const shouldAdoptNotebook = !previous.runtimeNotebook || !isNotebookEditorVisible;
      if (!shouldAdoptNotebook) {
        return previous;
      }
      return applyRuntimeNotebookSnapshotToSession(previous, normalizedNotebook);
    });
  }, [
    activeNotebookPath,
    activeNotebookSessionPath,
    applyRuntimeNotebookSnapshotToSession,
    isNotebookEditorVisible,
    notebookData,
    notebookSyncState.path,
    updateNotebookSession,
  ]);

  const requestNotebookKernelBinding = useCallback((path, {
    allowCreate = true,
    origin = 'manual',
    runtimeNotebookOverride = null,
    forceLoad = false,
  } = {}) => {
    const targetPath = resolveNotebookSessionPath(path) || path;
    logNotebookBatchDebug('requestNotebookKernelBinding', {
      targetPath,
      allowCreate,
      connectionStatus: getNotebookConnectionStatusSafe(targetPath),
      origin,
    });
    if (!isNotebookPath(targetPath)) {
      logNotebookBatchDebug('requestNotebookKernelBinding aborted', {
        targetPath,
        reason: 'invalid_target',
      });
      return false;
    }

    const session = notebookSessionsRef.current[targetPath] || createEmptyNotebookSession();
    const runtimeNotebook = normalizeNotebookSnapshot(
      runtimeNotebookOverride
      || session.runtimeNotebook
      || (normalizeComparablePath(targetPath) === normalizeComparablePath(activeNotebookPath)
        ? activeNotebookInitialData
        : null),
    );
    const kernelId = session.kernelState?.kernelId || null;
    const existingBindingRequest = session.kernelBindingRequest || createEmptyNotebookKernelBindingRequest();
    if (existingBindingRequest.status === 'pending' && existingBindingRequest.requestId) {
      logNotebookBatchDebug('binding_requested reuse', {
        targetPath,
        requestId: existingBindingRequest.requestId,
        mode: existingBindingRequest.mode,
        origin: existingBindingRequest.origin,
      });
      updateNotebookSession(targetPath, (previous) => {
        const nextSession = runtimeNotebook
          ? applyRuntimeNotebookSnapshotToSession(previous, runtimeNotebook)
          : previous;
        return {
          ...nextSession,
          kernelState: {
            ...nextSession.kernelState,
            isCreating: true,
            hasNotebook: Boolean(runtimeNotebook || previous.runtimeNotebook),
          },
          kernelBindingRequest: {
            ...existingBindingRequest,
            timeoutMs: existingBindingRequest.timeoutMs || NOTEBOOK_BATCH_KERNEL_WAIT_TIMEOUT_MS,
            runId: previous.batchRunState?.runId || existingBindingRequest.runId || null,
          },
        };
      });
      return true;
    }

    notebookKernelBindingSeqRef.current += 1;
    const requestId = `notebook_bind_${Date.now()}_${notebookKernelBindingSeqRef.current}`;
    const requestedAt = Date.now();
    const bindingBase = {
      requestId,
      status: 'pending',
      requestedAt,
      origin,
      runId: session.batchRunState?.runId || null,
      timeoutMs: NOTEBOOK_BATCH_KERNEL_WAIT_TIMEOUT_MS,
      previousKernelId: kernelId || null,
    };

    if (kernelId && !forceLoad) {
      logNotebookBatchDebug('binding_requested', {
        targetPath,
        requestId,
        mode: 'attach',
        origin,
        kernelId,
      });
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        kernelState: {
          ...previous.kernelState,
          isCreating: true,
          hasNotebook: Boolean(runtimeNotebook || previous.runtimeNotebook),
        },
        kernelBindingRequest: {
          ...bindingBase,
          mode: 'attach',
          runId: previous.batchRunState?.runId || bindingBase.runId,
        },
      }));
      sendNotebookMessageSafe(targetPath, {
        type: 'notebook_attach_kernel',
        path: targetPath,
        kernel_id: kernelId,
        request_id: requestId,
      });
      return true;
    }

    if (!allowCreate || !runtimeNotebook) {
      logNotebookBatchDebug('requestNotebookKernelBinding aborted', {
        targetPath,
        reason: !allowCreate ? 'creation_disallowed' : 'missing_runtime_notebook',
      });
      return false;
    }

    logNotebookBatchDebug('binding_requested', {
      targetPath,
      requestId,
      mode: 'load',
      origin,
      hasRuntimeNotebook: Boolean(runtimeNotebook),
      serializedBytes: runtimeNotebook ? serializeNotebookForKernelLoad(runtimeNotebook).length : 0,
    });
    const serializedNotebook = serializeNotebookForKernelLoad(runtimeNotebook);
    updateNotebookSession(targetPath, (previous) => {
      const nextSession = runtimeNotebook
        ? applyRuntimeNotebookSnapshotToSession(previous, runtimeNotebook)
        : previous;
      return {
        ...nextSession,
        kernelState: {
          ...nextSession.kernelState,
          isCreating: true,
          hasNotebook: true,
        },
        kernelBindingRequest: {
          ...bindingBase,
          mode: 'load',
          runId: previous.batchRunState?.runId || bindingBase.runId,
        },
      };
    });
    sendNotebookMessageSafe(targetPath, {
      type: 'notebook_load',
      content: serializedNotebook,
      path: targetPath,
      request_id: requestId,
    });
    return true;
  }, [
    applyRuntimeNotebookSnapshotToSession,
    activeNotebookInitialData,
    activeNotebookPath,
    getNotebookConnectionStatusSafe,
    notebookKernelBindingSeqRef,
    resolveNotebookSessionPath,
    sendNotebookMessageSafe,
    updateNotebookSession,
  ]);

  useEffect(() => {
    if (!activeNotebookPath || !legacyNotebookExecutionData || typeof legacyNotebookExecutionData !== 'object') {
      return;
    }
    if (!Object.keys(legacyNotebookExecutionData).length) {
      return;
    }
    setNotebookExecutionData((previous) => {
      const nextSourcePath = legacyNotebookExecutionData.docxSourcePath
        || legacyNotebookExecutionData.sourcePath
        || activeNotebookPath
        || previous.docxSourcePath
        || null;
      const nextSourceKind = legacyNotebookExecutionData.docxSourceKind
        || legacyNotebookExecutionData.sourceKind
        || inferDocxSourceKind(nextSourcePath);
      const nextDocumentState = applyDocumentStatePayload(previous, legacyNotebookExecutionData, {
        sourcePath: nextSourcePath,
        sourceKind: nextSourceKind,
        docxEventId: legacyNotebookExecutionData.docxEventId
          || legacyNotebookExecutionData.docx_event_id
          || previous.docxEventId
          || null,
        docxUpdatedAt: legacyNotebookExecutionData.docxUpdatedAt
          || legacyNotebookExecutionData.docx_updated_at
          || previous.docxUpdatedAt
          || null,
      });
      return {
        ...nextDocumentState,
        variables: Object.prototype.hasOwnProperty.call(legacyNotebookExecutionData, 'variables')
          ? (legacyNotebookExecutionData.variables || {})
          : previous.variables,
      };
    });
  }, [activeNotebookPath, legacyNotebookExecutionData, setNotebookExecutionData]);

  const pushNotification = useCallback((notification) => {
    if (!notification?.message && !notification?.title) return null;
    const id = notification.id ?? `notif_${Date.now()}_${notificationSeqRef.current += 1}`;
    const timestamp = notification.timestamp instanceof Date
      ? notification.timestamp
      : new Date(notification.timestamp || Date.now());
    const target = notification.target || notification.meta?.target || null;

    const nextNotification = {
      ...notification,
      id,
      type: notification.type || 'info',
      title: notification.title || null,
      message: notification.message || notification.title || '',
      timestamp,
      read: Boolean(notification.read),
      dismissible: notification.dismissible !== false,
      progress: notification.progress,
      target,
      actions: Array.isArray(notification.actions) && notification.actions.length > 0
        ? notification.actions.filter(Boolean)
        : undefined,
    };

    setNotifications((current) => {
      const next = current.filter((item) => item.id !== id);
      next.push(nextNotification);
      return next.slice(-120);
    });
    return id;
  }, []);

  const registerDesktopNotificationKey = useCallback((key) => {
    if (!key) return true;
    if (desktopNotificationKeysRef.current.has(key)) {
      return false;
    }

    desktopNotificationKeysRef.current.add(key);
    if (desktopNotificationKeysRef.current.size > 200) {
      const oldestKey = desktopNotificationKeysRef.current.values().next().value;
      if (oldestKey) {
        desktopNotificationKeysRef.current.delete(oldestKey);
      }
    }
    return true;
  }, []);

  const emitDesktopNotification = useCallback((payload, dedupeKey = null) => {
    if (!desktopApi?.emitDesktopNotification) {
      return;
    }
    if (!payload?.title || !payload?.body) {
      return;
    }
    if (dedupeKey && !registerDesktopNotificationKey(dedupeKey)) {
      return;
    }

    Promise.resolve(desktopApi.emitDesktopNotification(payload)).catch(() => {});
  }, [desktopApi, registerDesktopNotificationKey]);

  const dismissNotification = useCallback((id) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const handleStatusMessage = useCallback((message, type = 'info', meta = {}) => {
    if (!message) return;
    pushNotification({
      ...meta,
      type,
      message,
      title: Object.prototype.hasOwnProperty.call(meta || {}, 'title') ? meta.title : null,
      timestamp: meta?.timestamp || new Date(),
    });
  }, [pushNotification]);

  const openWithDefaultApplication = useCallback(async (fileOrPath, options = {}) => {
    const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
    if (!path) {
      return false;
    }

    const name = (typeof fileOrPath === 'object' && fileOrPath?.name)
      || getPathBasename(path)
      || path;
    const shouldNotify = options.notify !== false;

    try {
      if (desktopApi?.openPath) {
        await desktopApi.openPath(path);
      } else {
        const response = await fetch(`${API_BASE}/api/files/open-default`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'No se pudo abrir con la aplicacion por defecto'));
        }
      }

      if (shouldNotify) {
        handleStatusMessage(`Abriendo ${name} con la aplicacion por defecto`, 'success', {
          target: createFileNotificationTarget(path),
        });
      }
      return true;
    } catch (error) {
      const message = error?.message || 'No se pudo abrir con la aplicacion por defecto';
      handleStatusMessage(message, 'warning', {
        title: 'No se pudo abrir el archivo',
        target: createFileNotificationTarget(path),
      });
      return false;
    }
  }, [desktopApi, handleStatusMessage]);

  const syncNotebookBatchNotification = useCallback((path, batchRunState, overrides = {}) => {
    if (!path || !batchRunState) {
      return null;
    }

    const notificationId = createNotebookBatchNotificationId(path);
    pushNotification({
      id: notificationId,
      type: overrides.type || 'progress',
      title: overrides.title || NOTEBOOK_BATCH_PROGRESS_TITLE,
      message: overrides.message || batchRunState.message || buildNotebookRunProgressMessage(batchRunState),
      progress: Object.prototype.hasOwnProperty.call(overrides, 'progress')
        ? overrides.progress
        : getNotebookBatchProgressPercent(batchRunState),
      target: overrides.target || createFileNotificationTarget(path, { actionLabel: 'Abrir notebook' }),
      timestamp: overrides.timestamp || new Date(),
    });
    return notificationId;
  }, [pushNotification]);

  const notifyNotebookBatchCompleted = useCallback((path, {
    executed = 0,
    total = 0,
    runId = null,
  } = {}) => {
    if (!path) {
      return;
    }

    const message = `Run All completado (${executed}/${total} celdas).`;
    pushNotification({
      id: createNotebookBatchNotificationId(path),
      type: 'success',
      title: NOTEBOOK_BATCH_SUCCESS_TITLE,
      message,
      target: createDocumentNotificationTarget({
        sourcePath: path,
        sourceKind: 'notebook',
      }),
      timestamp: new Date(),
    });
    emitDesktopNotification(
      { title: NOTEBOOK_BATCH_SUCCESS_TITLE, body: message, level: 'success' },
      `batch:success:${path}:${runId || total}:${executed}`,
    );
  }, [emitDesktopNotification, pushNotification]);

  const notifyNotebookBatchFailed = useCallback((path, {
    error = null,
    runId = null,
    total = 0,
  } = {}) => {
    if (!path) {
      return;
    }

    const failureMessage = error || 'La ejecucion del notebook no pudo completarse.';
    pushNotification({
      id: createNotebookBatchNotificationId(path),
      type: 'warning',
      title: NOTEBOOK_BATCH_FAILURE_TITLE,
      message: failureMessage,
      target: createFileNotificationTarget(path, {
        actionLabel: 'Abrir notebook',
      }),
      timestamp: new Date(),
    });
    emitDesktopNotification(
      { title: NOTEBOOK_BATCH_FAILURE_TITLE, body: failureMessage, level: 'error' },
      `batch:error:${path}:${runId || total}:${failureMessage}`,
    );
  }, [emitDesktopNotification, pushNotification]);

  const promoteNotebookBatchFromKernelReady = useCallback((path, {
    kernelId = null,
    status = 'queued',
    currentCellId = null,
    currentExecutionId = null,
    requestId = null,
    reason = 'binding_ack_matched',
  } = {}) => {
    const targetPath = resolveNotebookSessionPath(path) || path;
    if (!isNotebookPath(targetPath)) {
      return false;
    }

    const session = notebookSessionsRef.current[targetPath] || createEmptyNotebookSession();
    const batchRunState = session.batchRunState;
    if (!batchRunState || batchRunState.status !== 'waiting_kernel') {
      if (kernelId || session.kernelBindingRequest?.status === 'pending') {
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          kernelBindingRequest: previous.kernelBindingRequest?.requestId
            ? {
              ...previous.kernelBindingRequest,
              status: previous.kernelBindingRequest.requestId === requestId || !requestId
                ? 'resolved'
                : previous.kernelBindingRequest.status,
            }
            : previous.kernelBindingRequest,
          kernelState: {
            ...previous.kernelState,
            ...(kernelId ? { kernelId } : {}),
            kernelInterrupted: false,
            isCreating: false,
            hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
          },
        }));
      }
      return false;
    }

    const nextStatus = status === 'running' ? 'running' : 'queued';
    const nextBatchRunState = {
      ...batchRunState,
      status: nextStatus,
      currentCellId: nextStatus === 'running'
        ? (currentCellId || getNotebookBatchCurrentCellId(batchRunState))
        : null,
      currentExecutionId: nextStatus === 'running'
        ? (currentExecutionId || batchRunState.currentExecutionId || null)
        : null,
      waitingForKernelSince: null,
    };
    nextBatchRunState.message = buildNotebookRunProgressMessage(nextBatchRunState);

    updateNotebookSession(targetPath, (previous) => ({
      ...previous,
      batchRunState: previous.batchRunState?.runId === batchRunState.runId
        ? nextBatchRunState
        : previous.batchRunState,
      kernelBindingRequest: previous.kernelBindingRequest?.requestId
        ? {
          ...previous.kernelBindingRequest,
          status: previous.kernelBindingRequest.requestId === requestId || !requestId
            ? 'resolved'
            : previous.kernelBindingRequest.status,
        }
        : previous.kernelBindingRequest,
      kernelState: {
        ...createEmptyNotebookKernelState(),
        ...(previous.kernelState || {}),
        ...(kernelId ? { kernelId } : {}),
        kernelInterrupted: false,
        isExecuting: isNotebookBatchActive(nextBatchRunState),
        executingCellId: getNotebookBatchCurrentCellId(nextBatchRunState),
        isCreating: false,
        hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
      },
    }));
    syncNotebookBatchNotification(targetPath, nextBatchRunState);
    logNotebookBatchDebug(reason, {
      targetPath,
      requestId: requestId || session.kernelBindingRequest?.requestId || null,
      kernelId: kernelId || session.kernelState?.kernelId || null,
      status: nextBatchRunState.status,
      currentCellId: nextBatchRunState.currentCellId,
      currentExecutionId: nextBatchRunState.currentExecutionId,
    });
    return true;
  }, [resolveNotebookSessionPath, syncNotebookBatchNotification, updateNotebookSession]);

  const notifyExternalWorkspaceConflicts = useCallback((conflictedPaths = []) => {
    const { newlyWarnedPaths, nextWarnedPaths } = collectNewConflictPaths(
      conflictedPaths,
      workspaceConflictWarningPathsRef.current,
    );
    workspaceConflictWarningPathsRef.current = nextWarnedPaths;

    if (!newlyWarnedPaths.length) {
      return;
    }

    const exactConflictTarget = newlyWarnedPaths.length === 1
      ? createFileNotificationTarget(newlyWarnedPaths[0])
      : null;

    handleStatusMessage(
      `Cambios externos detectados en ${newlyWarnedPaths.length} archivo(s) con cambios locales sin guardar.`,
      'warning',
      exactConflictTarget ? { target: exactConflictTarget } : undefined,
    );
  }, [handleStatusMessage]);

  const applyWorkspacePayload = useCallback((payload) => {
    const nextWorkspaceSession = getWorkspaceSessionFromPayload(payload);
    setWorkspaceSession((previous) => ({
      ...previous,
      ...nextWorkspaceSession,
      isLoading: false,
      error: null,
    }));
    handleWorkspaceChange(nextWorkspaceSession.activeWorkspace || '');
    return nextWorkspaceSession;
  }, [handleWorkspaceChange]);

  const refreshWorkspaceSession = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/system/info`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo leer el workspace activo'));
      }
      const data = await response.json();
      applyWorkspacePayload(data);
      return data;
    } catch (error) {
      const message = error?.message || 'No se pudo leer el workspace activo';
      setWorkspaceSession((previous) => ({
        ...previous,
        isLoading: false,
        error: message,
      }));
      throw error;
    }
  }, [applyWorkspacePayload]);

  const refreshHomeSummary = useCallback(async ({ silent = false } = {}) => {
    const activeWorkspacePath = workspaceSession.activeWorkspace || currentWorkspace || '';
    if (!activeWorkspacePath) {
      setHomeSummary(EMPTY_HOME_SUMMARY);
      setHomeSummaryError(null);
      return EMPTY_HOME_SUMMARY;
    }

    if (!silent) {
      setHomeSummaryLoading(true);
    }
    try {
      const response = await fetch(`${API_BASE}/api/system/home-summary`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo cargar el resumen del inicio'));
      }
      const payload = await response.json();
      const normalizedSummary = {
        ...EMPTY_HOME_SUMMARY,
        ...payload,
        workspace_path: payload?.workspace_path
          || payload?.workspace?.active_workspace
          || payload?.workspace?.workspace_root
          || activeWorkspacePath,
        notebook_runtime_items: Array.isArray(payload?.notebook_runtime_items)
          ? payload.notebook_runtime_items
          : Array.isArray(payload?.notebook_runtime)
            ? payload.notebook_runtime
            : [],
        recent_docx_items: Array.isArray(payload?.recent_docx_items) ? payload.recent_docx_items : [],
        mcp_service: payload?.mcp_service || payload?.mcp || null,
        mcp_clients: Array.isArray(payload?.mcp_clients)
          ? payload.mcp_clients
          : Array.isArray(payload?.mcp_clients_summary?.items)
            ? payload.mcp_clients_summary.items
            : [],
        template_inventory: Array.isArray(payload?.template_inventory)
          ? payload.template_inventory
          : Array.isArray(payload?.template_inventory_summary?.items)
            ? payload.template_inventory_summary.items
            : [],
        updated_at: payload?.updated_at || payload?.generated_at || null,
      };
      setHomeSummary(normalizedSummary);
      setHomeSummaryError(null);
      return normalizedSummary;
    } catch (error) {
      const message = error?.message || 'No se pudo cargar el resumen del inicio';
      setHomeSummary((previous) => ({
        ...previous,
        workspace_path: previous.workspace_path || activeWorkspacePath,
      }));
      setHomeSummaryError(message);
      return null;
    } finally {
      if (!silent) {
        setHomeSummaryLoading(false);
      }
    }
  }, [currentWorkspace, workspaceSession.activeWorkspace]);

  const persistWorkspaceSelection = useCallback(async (path) => {
    const response = await fetch(`${API_BASE}/api/system/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'No se pudo abrir el workspace'));
    }

    return response.json();
  }, []);

  const createWorkspaceRequest = useCallback(async ({ parentPath, name }) => {
    const response = await fetch(`${API_BASE}/api/system/workspace/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_path: parentPath,
        name,
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'No se pudo crear el workspace'));
    }

    return response.json();
  }, []);

  const createWorkspaceItem = useCallback(async ({ path, name, type }) => {
    const response = await fetch(`${API_BASE}/api/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name, type }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, `No se pudo crear ${type}`));
    }

    return response.json();
  }, []);

  const writeWorkspaceFile = useCallback(async ({ path, content }) => {
    const response = await fetch(`${API_BASE}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, `No se pudo escribir ${path}`));
    }

    return response.json();
  }, []);

  const finalizeWorkspaceMutation = useCallback((payload) => {
    const nextWorkspaceSession = applyWorkspacePayload(payload);
    setShowWorkspaceSelector(false);
    setWorkspaceSurface('home');
    setFileExplorerRefreshToken((value) => value + 1);
    return nextWorkspaceSession;
  }, [applyWorkspacePayload]);

  const clearWorkspaceLaunchIntent = useCallback(() => {
    workspaceLaunchIntentRef.current = null;
  }, []);

  const setWorkspaceLaunchIntent = useCallback((intent) => {
    workspaceLaunchIntentRef.current = intent || null;
  }, []);

  const consumeWorkspaceLaunchIntent = useCallback(() => {
    const nextIntent = workspaceLaunchIntentRef.current;
    workspaceLaunchIntentRef.current = null;
    return nextIntent;
  }, []);

  const seedExampleWorkspace = useCallback(async (workspaceRoot) => {
    const createdFolders = new Set();
    const files = createExampleWorkspaceFiles();

    for (const entry of files) {
      const segments = entry.path.split('/').filter(Boolean);
      const fileName = segments.pop();
      let parentPath = workspaceRoot;

      for (const segment of segments) {
        const nextPath = joinWorkspacePath(parentPath, segment);
        const normalized = normalizeComparablePath(nextPath) || nextPath;

        if (!createdFolders.has(normalized)) {
          await createWorkspaceItem({
            path: parentPath,
            name: segment,
            type: 'folder',
          });
          createdFolders.add(normalized);
        }

        parentPath = nextPath;
      }

      await createWorkspaceItem({
        path: parentPath,
        name: fileName,
        type: 'file',
      });
      await writeWorkspaceFile({
        path: joinWorkspacePath(parentPath, fileName),
        content: entry.content,
      });
    }

    return {
      notebookPath: joinWorkspacePath(workspaceRoot, EXAMPLE_WORKSPACE_PRIMARY_NOTEBOOK),
    };
  }, [createWorkspaceItem, writeWorkspaceFile]);

  const handleWorkspaceSelectorClose = useCallback(() => {
    clearWorkspaceLaunchIntent();
    setWorkspaceActionLabel('');
    setShowWorkspaceSelector(false);
  }, [clearWorkspaceLaunchIntent]);

  const handleWorkspaceSelectorOpen = useCallback((startPath = '') => {
    setWorkspacePickerStartPath(startPath || '');
    setShowWorkspaceSelector(true);
  }, []);

  const handleCreateProjectRequest = useCallback(() => {
    clearWorkspaceLaunchIntent();
    setWorkspaceActionLabel('');
    handleWorkspaceSelectorOpen(
      workspaceSession.suggestedWorkspaceRoot || workspaceSession.workspaceRoot || '',
    );
  }, [
    clearWorkspaceLaunchIntent,
    handleWorkspaceSelectorOpen,
    workspaceSession.suggestedWorkspaceRoot,
    workspaceSession.workspaceRoot,
  ]);

  const handleOpenWorkspaceRequest = useCallback(() => {
    clearWorkspaceLaunchIntent();
    setWorkspaceActionLabel('');
    handleWorkspaceSelectorOpen(workspaceSession.activeWorkspace || '');
  }, [clearWorkspaceLaunchIntent, handleWorkspaceSelectorOpen, workspaceSession.activeWorkspace]);

  const handleStartWithAgentRequest = useCallback(() => {
    setWorkspaceLaunchIntent({
      startAgents: true,
      source: 'launcher',
    });
    setWorkspaceActionLabel('Elige o crea un workspace para la sesión con agentes...');
    handleWorkspaceSelectorOpen(
      workspaceSession.suggestedWorkspaceRoot || workspaceSession.workspaceRoot || '',
    );
  }, [
    handleWorkspaceSelectorOpen,
    setWorkspaceLaunchIntent,
    workspaceSession.suggestedWorkspaceRoot,
    workspaceSession.workspaceRoot,
  ]);

  const handleWorkspaceSelect = useCallback(async (path) => {
    setWorkspaceActionPending(true);
    setWorkspaceSession((previous) => ({ ...previous, error: null }));
    setWorkspaceActionLabel('Abriendo workspace...');

    try {
      const data = await persistWorkspaceSelection(path);
      finalizeWorkspaceMutation(data);
      const launchIntent = consumeWorkspaceLaunchIntent();
      if (launchIntent) {
        setPostWorkspaceAction(launchIntent);
      }
      return data;
    } catch (error) {
      const message = error?.message || 'No se pudo abrir el workspace';
      setWorkspaceSession((previous) => ({ ...previous, error: message }));
      handleStatusMessage(message, 'warning');
      throw error;
    } finally {
      setWorkspaceActionPending(false);
      setWorkspaceActionLabel('');
    }
  }, [consumeWorkspaceLaunchIntent, finalizeWorkspaceMutation, handleStatusMessage, persistWorkspaceSelection]);

  const handleWorkspaceCreate = useCallback(async ({ parentPath, name }) => {
    setWorkspaceActionPending(true);
    setWorkspaceSession((previous) => ({ ...previous, error: null }));
    setWorkspaceActionLabel('Creando workspace...');

    try {
      const data = await createWorkspaceRequest({ parentPath, name });
      finalizeWorkspaceMutation(data);
      const launchIntent = consumeWorkspaceLaunchIntent();
      if (launchIntent) {
        setPostWorkspaceAction(launchIntent);
      }
      return data;
    } catch (error) {
      const message = error?.message || 'No se pudo crear el workspace';
      setWorkspaceSession((previous) => ({ ...previous, error: message }));
      handleStatusMessage(message, 'warning');
      throw error;
    } finally {
      setWorkspaceActionPending(false);
      setWorkspaceActionLabel('');
    }
  }, [consumeWorkspaceLaunchIntent, createWorkspaceRequest, finalizeWorkspaceMutation, handleStatusMessage]);

  const handleStartFromExampleRequest = useCallback(async () => {
    setWorkspaceActionPending(true);
    setWorkspaceSession((previous) => ({ ...previous, error: null }));
    clearWorkspaceLaunchIntent();

    const parentPath = workspaceSession.suggestedWorkspaceRoot
      || workspaceSession.workspaceRoot
      || workspaceSession.workspacePath
      || '';

    try {
      setWorkspaceActionLabel('Creando el workspace de ejemplo...');

      let workspaceData = null;
      let lastError = null;
      const candidateNames = [EXAMPLE_WORKSPACE_NAME];
      for (let index = 2; index <= 5; index += 1) {
        candidateNames.push(`${EXAMPLE_WORKSPACE_NAME}-${index}`);
      }

      for (const candidateName of candidateNames) {
        try {
          workspaceData = await createWorkspaceRequest({
            parentPath,
            name: candidateName,
          });
          break;
        } catch (error) {
          if (/exist/i.test(error?.message || '')) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }

      if (!workspaceData) {
        throw lastError || new Error('No se pudo crear el workspace de ejemplo');
      }

      const nextWorkspaceSession = finalizeWorkspaceMutation(workspaceData);
      const workspaceRoot = nextWorkspaceSession.activeWorkspace
        || nextWorkspaceSession.workspaceRoot
        || nextWorkspaceSession.workspacePath;

      setWorkspaceActionLabel('Escribiendo los archivos demo...');
      const exampleInfo = await seedExampleWorkspace(workspaceRoot);

      setWorkspaceActionLabel('Abriendo el notebook demo...');
      setPostWorkspaceAction({
        startAgents: true,
        openFilePath: exampleInfo.notebookPath,
        source: 'example',
      });

      pushNotification({
        type: 'success',
        title: 'Workspace de ejemplo listo',
        message: 'La demo del informe estructural está lista para explorar.',
        target: createFileNotificationTarget(exampleInfo.notebookPath, {
          actionLabel: 'Abrir ejemplo',
        }),
      });
      return workspaceData;
    } catch (error) {
      const message = error?.message || 'No se pudo preparar el workspace de ejemplo';
      setWorkspaceSession((previous) => ({ ...previous, error: message }));
      handleStatusMessage(message, 'warning');
      throw error;
    } finally {
      setWorkspaceActionPending(false);
      setWorkspaceActionLabel('');
    }
  }, [
    clearWorkspaceLaunchIntent,
    createWorkspaceRequest,
    finalizeWorkspaceMutation,
    handleStatusMessage,
    pushNotification,
    seedExampleWorkspace,
    workspaceSession.suggestedWorkspaceRoot,
    workspaceSession.workspacePath,
    workspaceSession.workspaceRoot,
  ]);

  const handleWorkspaceInfoChange = useCallback((payload) => {
    if (!payload) return;
    applyWorkspacePayload(payload);
  }, [applyWorkspacePayload]);

  const triggerWorkspaceRefresh = useCallback(() => {
    setFileExplorerRefreshToken((value) => value + 1);
    refreshWorkspaceSession().catch(() => {});
  }, [refreshWorkspaceSession]);

  useEffect(() => {
    workspaceConflictWarningPathsRef.current = pruneResolvedConflictPaths(
      workspaceConflictWarningPathsRef.current,
      externalConflictFiles,
    );
  }, [externalConflictFiles]);

  useEffect(() => {
    workspaceConflictWarningPathsRef.current = new Set();
  }, [currentWorkspace]);

  const reloadActiveFile = useCallback(async () => {
    if (!activeFile) return null;
    return reloadFile(activeFile);
  }, [activeFile, reloadFile]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'workspace_fs_event') {
      return undefined;
    }

    const normalizedCurrentWorkspace = normalizeComparablePath(currentWorkspace);
    const normalizedEventWorkspace = normalizeComparablePath(lastMessage.workspace_path);
    if (
      normalizedCurrentWorkspace
      && normalizedEventWorkspace
      && normalizedCurrentWorkspace !== normalizedEventWorkspace
    ) {
      return undefined;
    }

    const eventPayload = {
      id: `workspace_fs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...lastMessage,
    };
    setLastWorkspaceFsEvent(eventPayload);

    let cancelled = false;
    const run = async () => {
      const openFilesBeforeEvent = openFiles;
      const summary = await applyExternalWorkspaceEvents(lastMessage.events || []);
      if (cancelled) return;
      if (summary?.removedPaths?.length) {
        const deletedFiles = openFilesBeforeEvent.filter((file) => (
          summary.removedPaths.some((removedPath) => isSameOrDescendantComparablePath(file?.path, removedPath))
        ));
        for (const file of deletedFiles) {
          if (file.path.toLowerCase().endsWith('.ipynb')) {
            const kernelId = notebookSessionsRef.current[file.path]?.kernelState?.kernelId || null;
            if (kernelId && getNotebookConnectionStatusSafe(file.path) === 'connected') {
              sendNotebookMessageSafe(file.path, {
                type: 'notebook_shutdown_kernel',
                kernel_id: kernelId,
                path: file.path,
              });
            }
            removeNotebookSession(file.path);
            continue;
          }

          const codeRuntime = codeExecutionStateByPath[file.path]
            || Object.entries(codeExecutionStateByPath).find(([candidatePath]) => (
              normalizeComparablePath(candidatePath) === normalizeComparablePath(file.path)
            ))?.[1]
            || null;
          if (connectionStatus === 'connected' && (codeRuntime?.runId || codeRuntime?.isExecuting)) {
            cancelCodeExecution(file.path, codeRuntime?.runId || null);
          }
          clearCodeExecutionState(file.path, { suppressIncoming: true });
        }
      }
      if (summary?.conflictedPaths?.length) {
        notifyExternalWorkspaceConflicts(summary.conflictedPaths);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    applyExternalWorkspaceEvents,
    cancelCodeExecution,
    clearCodeExecutionState,
    codeExecutionStateByPath,
    connectionStatus,
    currentWorkspace,
    getNotebookConnectionStatusSafe,
    lastMessage,
    notifyExternalWorkspaceConflicts,
    openFiles,
    removeNotebookSession,
    sendNotebookMessageSafe,
  ]);

  const processNotebookQueueMessage = useCallback((message, entryMeta = {}) => {
    const messageType = message?.type;
    if (!messageType) {
      return;
    }

    const isNotebookMessage = String(messageType).startsWith('notebook_');
    if (!isNotebookMessage && messageType !== 'pdf_reconverted') {
      return;
    }

    const targetPath = resolveNotebookMessagePath(message, {
      preferBindingRequestId: NOTEBOOK_LIFECYCLE_ACK_TYPES.has(messageType),
      allowWaitingBatchCellMatch: NOTEBOOK_KERNEL_READY_SIGNAL_TYPES.has(messageType),
      fallbackSocketPath: entryMeta?.path || null,
    });
    if (!targetPath) {
      return;
    }

    const isVisibleTarget = isNotebookEditorVisible
      && normalizeComparablePath(targetPath) === normalizeComparablePath(activeNotebookPath);
    const getCurrentSession = () => (notebookSessionsRef.current[targetPath] || createEmptyNotebookSession());
    const syncKernelState = (updater) => {
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        kernelState: updater(
          {
            ...createEmptyNotebookKernelState(),
            ...(previous.kernelState || {}),
          },
          previous,
        ),
      }));
    };
    const maybePromoteWaitingBatchFromExecutionSignal = () => {
      const currentSession = getCurrentSession();
      const waitingBatchRunState = currentSession.batchRunState;
      if (waitingBatchRunState?.status !== 'waiting_kernel') {
        return false;
      }

      const firstPendingCell = getNotebookBatchFirstPendingCell(waitingBatchRunState);
      const matchesFirstPendingCell = Boolean(
        firstPendingCell?.cellId
        && message.cell_id
        && firstPendingCell.cellId === message.cell_id,
      );
      if (!matchesFirstPendingCell || (!message.execution_id && !message.kernel_id)) {
        return false;
      }

      return promoteNotebookBatchFromKernelReady(targetPath, {
        kernelId: message.kernel_id || currentSession.kernelState?.kernelId || null,
        status: 'running',
        currentCellId: message.cell_id || firstPendingCell?.cellId || null,
        currentExecutionId: message.execution_id || null,
        reason: 'binding_promoted_from_execution_signal',
      });
    };
    const relayVisibleNotebookMessage = () => {
      if (!isVisibleTarget) {
        return false;
      }
      return Boolean(notebookActionsRef.current?.consumeRemoteNotebookMessage?.(message));
    };

    switch (messageType) {
      case 'notebook_created':
      case 'notebook_loaded':
      case 'notebook_attached': {
        const currentSession = getCurrentSession();
        const activeBindingRequest = currentSession.kernelBindingRequest || createEmptyNotebookKernelBindingRequest();
        const hasStaleBindingAck = Boolean(
          message.request_id
          && activeBindingRequest.status === 'pending'
          && activeBindingRequest.requestId
          && activeBindingRequest.requestId !== message.request_id,
        );
        if (hasStaleBindingAck) {
          logNotebookBatchDebug('binding_ack_ignored_stale_request', {
            targetPath,
            requestId: message.request_id,
            expectedRequestId: activeBindingRequest.requestId,
            messageType,
          });
          return;
        }

        if (message.notebook) {
          setNotebookRuntimeSnapshot(targetPath, message.notebook);
        }

        const promotedBatch = message.kernel_id
          ? promoteNotebookBatchFromKernelReady(targetPath, {
            kernelId: message.kernel_id,
            status: 'queued',
            requestId: message.request_id || null,
            reason: 'binding_ack_matched',
          })
          : false;
        if (!promotedBatch) {
          updateNotebookSession(targetPath, (previous) => ({
            ...previous,
            kernelBindingRequest: previous.kernelBindingRequest?.requestId
              ? {
                ...previous.kernelBindingRequest,
                status: previous.kernelBindingRequest.requestId === message.request_id || !message.request_id
                  ? 'resolved'
                  : previous.kernelBindingRequest.status,
              }
              : previous.kernelBindingRequest,
            kernelState: {
              ...createEmptyNotebookKernelState(),
              ...(previous.kernelState || {}),
              kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
              kernelInterrupted: false,
              isExecuting: isNotebookBatchActive(previous.batchRunState),
              executingCellId: getNotebookBatchCurrentCellId(previous.batchRunState),
              isCreating: false,
              hasNotebook: Boolean(message.notebook || previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
        }

        const pendingExecution = getPendingNotebookExecution(targetPath);
        if (
          !pendingExecution?.detached
          || getNotebookConnectionStatusSafe(targetPath) !== 'connected'
          || !message.kernel_id
        ) {
          relayVisibleNotebookMessage();
          return;
        }

        sendNotebookMessageSafe(targetPath, {
          type: 'notebook_execute_cell',
          kernel_id: message.kernel_id,
          execution_id: pendingExecution.executionId,
          cell_id: pendingExecution.cellId,
          cell_type: normalizeNotebookCellType(pendingExecution.cellType),
          path: targetPath,
          source: pendingExecution.source,
          execution_timeout_s: (pendingExecution.executionTimeoutMs || 600000) / 1000,
          enable_tracing: Boolean(pendingExecution.enableTracing),
          emit_docx: Boolean(pendingExecution.emitDocx),
          docx_validation: Boolean(pendingExecution.docxValidation),
        });
        setPendingNotebookExecution(targetPath, null);
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          kernelState: {
            ...previous.kernelState,
            kernelId: message.kernel_id,
            isExecuting: true,
            hasNotebook: true,
          },
        }));
        relayVisibleNotebookMessage();
        return;
      }

      case 'notebook_stream':
        maybePromoteWaitingBatchFromExecutionSignal();
        setNotebookRuntimeSnapshot(targetPath, (notebook) => appendNotebookStreamOutput(
          notebook,
          message.cell_id,
          message.content,
        ));
        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isExecuting: true,
          executingCellId: message.cell_id || kernelState.executingCellId || null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_execute_input':
        maybePromoteWaitingBatchFromExecutionSignal();
        setNotebookRuntimeSnapshot(targetPath, (notebook) => updateNotebookCellExecutionCount(
          notebook,
          message.cell_id,
          message?.content?.execution_count ?? null,
        ));
        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isExecuting: true,
          executingCellId: message.cell_id || kernelState.executingCellId || null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_clear_output':
        setNotebookRuntimeSnapshot(targetPath, (notebook) => clearNotebookCellOutputs(
          notebook,
          message.cell_id,
        ));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_display_data':
      case 'notebook_execute_result':
        maybePromoteWaitingBatchFromExecutionSignal();
        setNotebookRuntimeSnapshot(targetPath, (notebook) => appendNotebookRichOutput(
          notebook,
          message.cell_id,
          message.type,
          message.content,
        ));
        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isExecuting: true,
          executingCellId: message.cell_id || kernelState.executingCellId || null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_update_display_data':
        maybePromoteWaitingBatchFromExecutionSignal();
        setNotebookRuntimeSnapshot(targetPath, (notebook) => updateNotebookDisplayDataOutput(
          notebook,
          message.cell_id,
          message.content,
        ));
        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isExecuting: true,
          executingCellId: message.cell_id || kernelState.executingCellId || null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_comm_open':
      case 'notebook_comm_msg':
      case 'notebook_comm_close':
        relayVisibleNotebookMessage();
        return;

      case 'notebook_cell_executed': {
        maybePromoteWaitingBatchFromExecutionSignal();
        const pendingExecution = getPendingNotebookExecution(targetPath);
        if (
          pendingExecution?.executionId
          && typeof message.execution_id === 'string'
          && pendingExecution.executionId === message.execution_id
        ) {
          setPendingNotebookExecution(targetPath, null);
        }
        setNotebookRuntimeSnapshot(targetPath, (notebook) => applyNotebookCellExecutionResult(
          notebook,
          message,
        ));

        const currentSession = getCurrentSession();
        const batchRunState = currentSession.batchRunState;
        if (batchRunState) {
          const matchesBatchExecution = doesNotebookMessageMatchBatchExecution(batchRunState, message);
          if (!matchesBatchExecution) {
            return;
          }

          const remainingCells = (batchRunState.pendingCells || []).filter((cell) => cell.cellId !== message.cell_id);
          const executed = Math.min(batchRunState.total || 0, (batchRunState.executed || 0) + 1);
          const nextBatchRunState = remainingCells.length > 0
            ? {
              ...batchRunState,
              executed,
              pendingCells: remainingCells,
              currentCellId: null,
              currentExecutionId: null,
              status: 'queued',
              waitingForKernelSince: null,
              message: `${executed} de ${batchRunState.total || executed} celdas completadas`,
            }
            : null;
          updateNotebookSession(targetPath, (previous) => ({
            ...previous,
            batchRunState: nextBatchRunState,
            kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
            kernelState: {
              ...previous.kernelState,
              kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
              kernelInterrupted: false,
              isCreating: false,
              isExecuting: isNotebookBatchActive(nextBatchRunState),
              executingCellId: getNotebookBatchCurrentCellId(nextBatchRunState),
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
          if (nextBatchRunState) {
            logNotebookBatchDebug('processNotebookQueueMessage batch advanced', {
              targetPath,
              executed,
              total: batchRunState.total,
              nextCellId: getNotebookBatchCurrentCellId(nextBatchRunState),
            });
            syncNotebookBatchNotification(targetPath, nextBatchRunState);
          } else {
            logNotebookBatchDebug('processNotebookQueueMessage batch completed', {
              targetPath,
              executed,
              total: batchRunState.total,
              runId: batchRunState.runId,
            });
            notifyNotebookBatchCompleted(targetPath, {
              executed,
              total: batchRunState.total || executed,
              runId: batchRunState.runId,
            });
          }
          relayVisibleNotebookMessage();
          return;
        }

        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isCreating: false,
          isExecuting: false,
          executingCellId: null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;
      }

      case 'notebook_cell_deleted':
        setNotebookRuntimeSnapshot(targetPath, (notebook) => deleteNotebookCell(
          notebook,
          message.cell_id,
        ));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_cell_moved':
        setNotebookRuntimeSnapshot(targetPath, (notebook) => moveNotebookCell(
          notebook,
          message.cell_id,
          message.direction,
        ));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_order_set':
        setNotebookRuntimeSnapshot(targetPath, (notebook) => reorderNotebookCells(
          notebook,
          message.order,
        ));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_progress_update': {
        if (message.progress_scope === 'document') {
          applyNotebookDocumentMessage(message, targetPath);
          relayVisibleNotebookMessage();
          return;
        }

        const currentBatchRunState = notebookSessionsRef.current[targetPath]?.batchRunState || null;
        if (currentBatchRunState) {
          if (!doesNotebookMessageMatchBatchExecution(currentBatchRunState, message)) {
            return;
          }

          updateNotebookSession(targetPath, (previous) => ({
            ...previous,
            batchRunState: previous.batchRunState
              ? {
                ...previous.batchRunState,
                message: message.message || previous.batchRunState.message,
              }
              : previous.batchRunState,
            kernelState: {
              ...previous.kernelState,
              kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
              kernelInterrupted: false,
              isExecuting: true,
              executingCellId: previous.batchRunState?.currentCellId
                || message.cell_id
                || previous.kernelState?.executingCellId
                || null,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
          syncNotebookBatchNotification(targetPath, {
            ...currentBatchRunState,
            message: message.message || currentBatchRunState.message,
          });
          relayVisibleNotebookMessage();
          return;
        }

        syncKernelState((kernelState, previous) => ({
          ...kernelState,
          kernelId: message.kernel_id || kernelState.kernelId || null,
          kernelInterrupted: false,
          isExecuting: true,
          executingCellId: message.cell_id || kernelState.executingCellId || null,
          hasNotebook: Boolean(previous.runtimeNotebook || kernelState.hasNotebook),
        }));
        relayVisibleNotebookMessage();
        return;
      }

      case 'notebook_docx_update':
      case 'notebook_pdf_ready':
      case 'notebook_mdoc_cleared':
      case 'pdf_reconverted':
        applyNotebookDocumentMessage(message, targetPath);
        relayVisibleNotebookMessage();
        return;

      case 'notebook_cell_error':
      case 'notebook_execution_cancelled':
      case 'notebook_error': {
        const currentBatchRunState = notebookSessionsRef.current[targetPath]?.batchRunState || null;
        if (currentBatchRunState && !doesNotebookMessageMatchBatchExecution(currentBatchRunState, message)) {
          return;
        }
        if (message?.cell_id && message.type !== 'notebook_execution_cancelled') {
          setNotebookRuntimeSnapshot(targetPath, (notebook) => appendNotebookErrorOutput(notebook, message));
        }

        const shouldRecoverKernel = Boolean(
          currentBatchRunState
          && doesNotebookMessageMatchBatchExecution(currentBatchRunState, message)
          && isKernelNotFoundNotebookError(message)
          && (currentBatchRunState.kernelRecoveryAttempts || 0) < 1,
        );
        if (shouldRecoverKernel) {
          const runtimeNotebook = normalizeNotebookSnapshot(
            currentBatchRunState.runtimeNotebookSnapshot
            || notebookSessionsRef.current[targetPath]?.runtimeNotebook
            || (normalizeComparablePath(targetPath) === normalizeComparablePath(activeNotebookPath)
              ? activeNotebookInitialData
              : null),
          );
          updateNotebookSession(targetPath, (previous) => ({
            ...previous,
            batchRunState: previous.batchRunState
              ? {
                ...previous.batchRunState,
                status: 'waiting_kernel',
                currentCellId: null,
                currentExecutionId: null,
                waitingForKernelSince: Date.now(),
                kernelRecoveryAttempts: (previous.batchRunState.kernelRecoveryAttempts || 0) + 1,
                message: 'Reiniciando kernel para continuar Run All...',
              }
              : previous.batchRunState,
            kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
            kernelState: {
              ...createEmptyNotebookKernelState(),
              ...(previous.kernelState || {}),
              kernelId: null,
              kernelInterrupted: false,
              isExecuting: true,
              executingCellId: previous.batchRunState?.pendingCells?.[0]?.cellId || null,
              isCreating: false,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
          logNotebookBatchDebug('processNotebookQueueMessage batch recovery', {
            targetPath,
            runId: currentBatchRunState.runId,
            executionId: message.execution_id,
            message: message.message || message.error,
          });
          syncNotebookBatchNotification(targetPath, {
            ...currentBatchRunState,
            status: 'waiting_kernel',
            currentCellId: null,
            currentExecutionId: null,
            waitingForKernelSince: Date.now(),
            kernelRecoveryAttempts: (currentBatchRunState.kernelRecoveryAttempts || 0) + 1,
            message: 'Reiniciando kernel para continuar Run All...',
          });
          if (runtimeNotebook) {
            const bindingStarted = requestNotebookKernelBinding(targetPath, {
              allowCreate: true,
              origin: 'run_all_recovery',
              runtimeNotebookOverride: runtimeNotebook,
              forceLoad: true,
            });
            if (!bindingStarted) {
              updateNotebookSession(targetPath, (previous) => ({
                ...previous,
                batchRunState: null,
                kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
                kernelState: {
                  ...createEmptyNotebookKernelState(),
                  ...(previous.kernelState || {}),
                  kernelId: null,
                  kernelInterrupted: false,
                  isExecuting: false,
                  executingCellId: null,
                  isCreating: false,
                  hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
                },
              }));
              notifyNotebookBatchFailed(targetPath, {
                error: 'No se pudo reiniciar el kernel para continuar Run All.',
                runId: currentBatchRunState.runId,
                  total: currentBatchRunState.total,
                });
              }
            }
            relayVisibleNotebookMessage();
            return;
          }

          setPendingNotebookExecution(targetPath, null);
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          batchRunState: null,
          kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
          kernelState: {
            ...createEmptyNotebookKernelState(),
            ...(previous.kernelState || {}),
            kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
            isExecuting: false,
            executingCellId: null,
            isCreating: false,
            hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
          },
        }));
          if (currentBatchRunState) {
            logNotebookBatchDebug('processNotebookQueueMessage batch failed', {
              targetPath,
            runId: currentBatchRunState.runId,
            executionId: message.execution_id,
            error: message.error || message.message,
          });
          notifyNotebookBatchFailed(targetPath, {
            error: message.error || message.message,
            runId: currentBatchRunState.runId,
              total: currentBatchRunState.total,
            });
          }
          relayVisibleNotebookMessage();
          return;
        }

      case 'notebook_kernel_reset':
        setNotebookRuntimeSnapshot(targetPath, (notebook) => stripNotebookRuntimeState(notebook));
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          batchRunState: null,
          kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
          kernelState: {
            ...createEmptyNotebookKernelState(),
            ...(previous.kernelState || {}),
            kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
            kernelInterrupted: false,
            isExecuting: false,
            executingCellId: null,
            isCreating: false,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_kernel_interrupted':
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          batchRunState: null,
          kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
          kernelState: {
            ...createEmptyNotebookKernelState(),
            ...(previous.kernelState || {}),
            kernelId: message.kernel_id || previous.kernelState?.kernelId || null,
            kernelInterrupted: true,
            isExecuting: false,
            executingCellId: null,
            isCreating: false,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
        relayVisibleNotebookMessage();
        return;

      case 'notebook_kernel_shutdown':
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          batchRunState: null,
          kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
          kernelState: {
            ...createEmptyNotebookKernelState(),
            ...(previous.kernelState || {}),
            kernelId: null,
            kernelInterrupted: false,
            isExecuting: false,
            executingCellId: null,
            isCreating: false,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
        relayVisibleNotebookMessage();
        return;

      default:
        return;
    }
  }, [
    activeNotebookInitialData,
    activeNotebookPath,
    applyNotebookDocumentMessage,
    getPendingNotebookExecution,
    getNotebookConnectionStatusSafe,
    isNotebookEditorVisible,
    notifyNotebookBatchCompleted,
    notifyNotebookBatchFailed,
    promoteNotebookBatchFromKernelReady,
    requestNotebookKernelBinding,
    resolveNotebookMessagePath,
    sendNotebookMessageSafe,
    setNotebookRuntimeSnapshot,
    setPendingNotebookExecution,
    syncNotebookBatchNotification,
    updateNotebookSession,
  ]);

  useEffect(() => {
    const queueCursorKey = usingDedicatedNotebookMessageQueue ? 'notebook' : 'global';
    const lastProcessedId = lastNotebookQueueMessageIdsRef.current[queueCursorKey] || 0;
    const nextEntries = (Array.isArray(effectiveNotebookMessageQueue) ? effectiveNotebookMessageQueue : []).filter((entry) => (
      Number.isFinite(entry?.id) && entry.id > lastProcessedId
    ));
    if (nextEntries.length === 0) {
      return;
    }

    nextEntries.forEach((entry) => {
      processNotebookQueueMessage(entry.message, entry);
      lastNotebookQueueMessageIdsRef.current[queueCursorKey] = entry.id;
    });
  }, [effectiveNotebookMessageQueue, processNotebookQueueMessage, usingDedicatedNotebookMessageQueue]);

  const handleMcpArtifact = useCallback((artifactOrEvent, mirrorEvent = null) => {
    const artifact = artifactOrEvent?.kind ? artifactOrEvent : artifactOrEvent?.ui_hints?.artifact;
    const sourceEvent = artifactOrEvent?.kind ? mirrorEvent : artifactOrEvent;
    if (!artifact) {
      return;
    }

    const sourcePath = artifact.source_path
      || artifact.notebook_path
      || sourceEvent?.resource?.notebook_path
      || sourceEvent?.payload?.notebook_path
      || sourceEvent?.ui_hints?.reload_path
      || sourceEvent?.resource?.path
      || null;
    const eventPath = normalizeComparablePath(sourcePath);
    const artifactEventId = sourceEvent?.step_id
      || sourceEvent?.event_id
      || sourceEvent?.run_id
      || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const artifactUpdatedAt = Date.parse(sourceEvent?.ts || '')
      || artifact.docx_updated_at
      || artifact.updated_at
      || Date.now();
    const artifactPayload = {
      ...artifact,
      source_path: sourcePath,
      source_kind: artifact.source_kind || inferDocxSourceKind(sourcePath),
      docx_event_id: artifactEventId,
      docx_updated_at: artifactUpdatedAt,
    };
    const historyEntry = createDocxHistoryEntry(artifactPayload, {
      sourcePath,
      sourceKind: artifactPayload.source_kind,
      docxEventId: artifactEventId,
      docxUpdatedAt: artifactUpdatedAt,
      createdAt: artifactUpdatedAt,
      origin: 'mcp',
    });
    if (historyEntry) {
      setDocxHistoryEntries((current) => upsertDocxHistoryEntry(current, historyEntry));
    }

    if (!activeFile?.path || !activeFile.path.endsWith('.ipynb')) {
      return;
    }

    const activePath = normalizeComparablePath(activeFile.path);
    if (!eventPath || !activePath || eventPath !== activePath) {
      return;
    }

    setNotebookExecutionData((prev) => applyMcpArtifactToDocumentState(prev, artifactPayload));
  }, [activeFile?.path, setNotebookExecutionData]);

  const focusDocxView = useCallback(({ surface = 'file', focus = null } = {}) => {
    if (surface === 'file') {
      setWorkspaceSurface('file');
    }
    setVisualizationViewRequest({
      view: 'docx',
      focus,
      token: Date.now(),
    });
  }, []);

  const clearNotebookRuntimeData = useCallback(() => {
    setNotebookExecutionData(createEmptyDocumentState());
  }, [setNotebookExecutionData]);

  const persistActiveNotebookRuntimeSnapshot = useCallback((path = activeNotebookSessionPath || activeNotebookPath) => {
    const targetPath = typeof path === 'string' && path.trim()
      ? (resolveNotebookSessionPath(path) || path)
      : null;
    if (!targetPath) {
      return null;
    }
    const runtimeNotebook = normalizeNotebookSnapshot(
      notebookActionsRef.current?.getNotebook?.()
      || notebookSessionsRef.current[targetPath]?.runtimeNotebook
      || (normalizeComparablePath(targetPath) === normalizeComparablePath(activeNotebookPath)
        ? activeNotebookInitialData
        : null),
    );
    if (!runtimeNotebook) {
      return null;
    }
    setNotebookRuntimeSnapshot(targetPath, runtimeNotebook);
    setNotebookData(runtimeNotebook, {
      origin: 'runtime',
      path: targetPath,
      markProgrammatic: true,
    });
    return runtimeNotebook;
  }, [
    activeNotebookInitialData,
    activeNotebookPath,
    activeNotebookSessionPath,
    resolveNotebookSessionPath,
    setNotebookData,
    setNotebookRuntimeSnapshot,
  ]);

  const handleRequestActiveNotebookKernelStart = useCallback(() => {
    const targetPath = activeNotebookSessionPath || activeFile?.path || null;
    if (!isNotebookPath(targetPath)) {
      return false;
    }
    return requestNotebookKernelBinding(targetPath, { allowCreate: true, origin: 'manual' });
  }, [activeFile?.path, activeNotebookSessionPath, requestNotebookKernelBinding]);

  const dispatchNotebookExecuteCell = useCallback((path, {
    kernelId,
    cellId,
    cellType = 'code',
    source,
    executionId,
    executionTimeoutMs = 600000,
    enableTracing = false,
    emitDocx = false,
    docxValidation = true,
    skipPdf = false,
  }) => {
    if (!isNotebookPath(path) || !kernelId || !cellId) {
      return null;
    }
    const resolvedExecutionId = executionId || `exec_${Date.now()}_${cellId}`;
    try {
      sendNotebookMessageSafe(path, {
        type: 'notebook_execute_cell',
        kernel_id: kernelId,
        execution_id: resolvedExecutionId,
        cell_id: cellId,
        cell_type: normalizeNotebookCellType(cellType),
        path,
        source,
        execution_timeout_s: executionTimeoutMs / 1000,
        enable_tracing: Boolean(enableTracing),
        emit_docx: Boolean(emitDocx),
        docx_validation: Boolean(docxValidation),
        skip_pdf: Boolean(skipPdf),
      });
    } catch (error) {
      logNotebookBatchDebug('dispatchNotebookExecuteCell failed', {
        path,
        kernelId,
        cellId,
        executionId: resolvedExecutionId,
        error: error?.message || String(error),
      });
      return null;
    }
    updateNotebookSession(path, (previous) => ({
      ...previous,
      kernelState: {
        ...previous.kernelState,
        kernelId,
        isCreating: false,
        isExecuting: true,
        executingCellId: cellId,
        hasNotebook: true,
      },
    }));
    return resolvedExecutionId;
  }, [sendNotebookMessageSafe, updateNotebookSession]);

  const kickOffNotebookBatchExecution = useCallback((path, forcedKernelId = null) => {
    const targetPath = resolveNotebookSessionPath(path) || path;
    if (!isNotebookPath(targetPath)) {
      return false;
    }
    const session = notebookSessionsRef.current[targetPath] || createEmptyNotebookSession();
    const batchRunState = session.batchRunState;
    if (!batchRunState) {
      return false;
    }
    if (batchRunState.status !== 'queued') {
      return false;
    }
    if (batchRunState.currentExecutionId || batchRunState.currentCellId) {
      return false;
    }
    const kernelId = forcedKernelId || session.kernelState?.kernelId || null;
    const nextBatchCell = getNotebookBatchFirstPendingCell(batchRunState);
    if (!kernelId || !nextBatchCell?.cellId) {
      return false;
    }
    const executionId = `batch_${Date.now()}_${batchRunState.runId}_${nextBatchCell.cellId}`;
    const isLastCell = batchRunState.pendingCells.length === 1;
    const lockedBatchRunState = {
      ...batchRunState,
      status: 'running',
      currentCellId: nextBatchCell.cellId,
      currentExecutionId: executionId,
      waitingForKernelSince: null,
    };
    lockedBatchRunState.message = buildNotebookRunProgressMessage(lockedBatchRunState);
    updateNotebookSession(targetPath, (previous) => ({
      ...previous,
      batchRunState: previous.batchRunState?.runId === batchRunState.runId
        ? lockedBatchRunState
        : previous.batchRunState,
      kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
      kernelState: {
        ...previous.kernelState,
        kernelId,
        isCreating: false,
        isExecuting: true,
        executingCellId: nextBatchCell.cellId,
        hasNotebook: true,
      },
    }));
    syncNotebookBatchNotification(targetPath, lockedBatchRunState);

    const dispatchedExecutionId = dispatchNotebookExecuteCell(targetPath, {
      kernelId,
      cellId: nextBatchCell.cellId,
      cellType: nextBatchCell.cellType,
      source: nextBatchCell.source,
      executionId,
      executionTimeoutMs: batchRunState.executionTimeoutMs || 600000,
      enableTracing: batchRunState.enableTracing,
      emitDocx: batchRunState.emitDocx,
      docxValidation: batchRunState.docxValidation,
      skipPdf: !isLastCell,
    });
    if (!dispatchedExecutionId) {
      const blockedBatchRunState = {
        ...batchRunState,
        status: 'waiting_kernel',
        currentCellId: null,
        currentExecutionId: null,
        waitingForKernelSince: Date.now(),
        message: 'No se pudo iniciar Run All. Reintenta.',
      };
      logNotebookBatchDebug('kickOffNotebookBatchExecution blocked', {
        targetPath,
        kernelId,
        cellId: nextBatchCell.cellId,
      });
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        batchRunState: previous.batchRunState
          ? blockedBatchRunState
          : previous.batchRunState,
        kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
        kernelState: {
          ...previous.kernelState,
          isExecuting: false,
          executingCellId: null,
          isCreating: false,
          hasNotebook: true,
        },
      }));
      syncNotebookBatchNotification(targetPath, blockedBatchRunState, {
        type: 'warning',
        title: NOTEBOOK_BATCH_FAILURE_TITLE,
        message: blockedBatchRunState.message,
        progress: undefined,
      });
      return false;
    }
    logNotebookBatchDebug('kickOffNotebookBatchExecution started', {
      targetPath,
      kernelId,
      cellId: nextBatchCell.cellId,
      executionId: dispatchedExecutionId,
    });
    return true;
  }, [dispatchNotebookExecuteCell, resolveNotebookSessionPath, syncNotebookBatchNotification, updateNotebookSession]);

  useEffect(() => {
    kickOffNotebookBatchExecutionRef.current = kickOffNotebookBatchExecution;
  }, [kickOffNotebookBatchExecution]);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    Object.entries(notebookSessionsByPath).forEach(([path, session]) => {
      if (!isNotebookPath(path) || !session?.batchRunState) {
        return;
      }
      if (session.batchRunState.status !== 'queued') {
        return;
      }
      if (session.batchRunState.currentExecutionId || session.batchRunState.currentCellId) {
        return;
      }
      if (!session.kernelState?.kernelId) {
        return;
      }
      kickOffNotebookBatchExecution(path, session.kernelState.kernelId);
    });
  }, [connectionStatus, kickOffNotebookBatchExecution, notebookSessionsByPath]);

  useEffect(() => {
    const targetPath = activeNotebookSessionPath || activeNotebookPath;
    if (!targetPath || !notebookKernelState?.kernelId) {
      return;
    }

    const session = notebookSessionsRef.current[targetPath] || createEmptyNotebookSession();
    if (session.batchRunState?.status !== 'waiting_kernel') {
      return;
    }
    if (
      session.kernelBindingRequest?.status === 'pending'
      && session.kernelBindingRequest?.mode === 'load'
      && (
        !notebookKernelState.kernelId
        || notebookKernelState.kernelId === session.kernelBindingRequest.previousKernelId
      )
    ) {
      return;
    }

    promoteNotebookBatchFromKernelReady(targetPath, {
      kernelId: notebookKernelState.kernelId,
      status: 'queued',
      reason: 'binding_promoted_from_editor',
    });
  }, [
    activeNotebookPath,
    activeNotebookSessionPath,
    notebookKernelState?.kernelId,
    promoteNotebookBatchFromKernelReady,
  ]);

  useEffect(() => {
    const timeouts = waitingKernelTimeoutsRef.current;
    const activeTimeoutKeys = new Set();

    Object.entries(notebookSessionsByPath).forEach(([path, session]) => {
      if (!isNotebookPath(path) || session?.batchRunState?.status !== 'waiting_kernel') {
        return;
      }

      const requestId = session.kernelBindingRequest?.requestId || 'no-request';
      const runId = session.batchRunState?.runId || 'no-run';
      const waitingStartedAt = session.batchRunState?.waitingForKernelSince
        || session.kernelBindingRequest?.requestedAt
        || Date.now();
      const timeoutKey = `${runId}:${requestId}:${waitingStartedAt}`;
      activeTimeoutKeys.add(path);

      if (timeouts[path]?.key === timeoutKey) {
        return;
      }

      if (timeouts[path]) {
        clearTimeout(timeouts[path].timerId);
      }

      const remainingMs = Math.max(
        0,
        NOTEBOOK_BATCH_KERNEL_WAIT_TIMEOUT_MS - (Date.now() - waitingStartedAt),
      );
      timeouts[path] = {
        key: timeoutKey,
        timerId: setTimeout(() => {
          const latestSession = notebookSessionsRef.current[path] || createEmptyNotebookSession();
          const latestBatchRunState = latestSession.batchRunState;
          const latestBindingRequest = latestSession.kernelBindingRequest || createEmptyNotebookKernelBindingRequest();

          if (
            latestBatchRunState?.status !== 'waiting_kernel'
            || (latestBatchRunState?.runId || 'no-run') !== runId
            || (latestBindingRequest.requestId || 'no-request') !== requestId
          ) {
            return;
          }

          const kernelId = latestSession.kernelState?.kernelId || null;
          logNotebookBatchDebug('binding_timeout', {
            targetPath: path,
            requestId,
            runId,
            kernelId,
          });

          if (kernelId) {
            promoteNotebookBatchFromKernelReady(path, {
              kernelId,
              status: 'queued',
              requestId: latestBindingRequest.requestId || null,
              reason: 'binding_timeout_promoted',
            });
            return;
          }

          updateNotebookSession(path, (previous) => ({
            ...previous,
            batchRunState: null,
            kernelBindingRequest: previous.kernelBindingRequest?.requestId === latestBindingRequest.requestId
              ? {
                ...previous.kernelBindingRequest,
                status: 'timeout',
              }
              : previous.kernelBindingRequest,
            kernelState: {
              ...createEmptyNotebookKernelState(),
              ...(previous.kernelState || {}),
              kernelId: null,
              kernelInterrupted: false,
              isExecuting: false,
              executingCellId: null,
              isCreating: false,
              hasNotebook: Boolean(previous.runtimeNotebook || previous.kernelState?.hasNotebook),
            },
          }));
          notifyNotebookBatchFailed(path, {
            error: 'Timeout iniciando kernel para Run All',
            runId: latestBatchRunState?.runId || null,
            total: latestBatchRunState?.total || 0,
          });
        }, remainingMs),
      };
    });

    Object.keys(timeouts).forEach((path) => {
      if (activeTimeoutKeys.has(path)) {
        return;
      }
      clearTimeout(timeouts[path].timerId);
      delete timeouts[path];
    });
  }, [
    notebookSessionsByPath,
    notifyNotebookBatchFailed,
    promoteNotebookBatchFromKernelReady,
    updateNotebookSession,
  ]);

  useEffect(() => () => {
    Object.values(waitingKernelTimeoutsRef.current).forEach((entry) => {
      if (entry?.timerId) {
        clearTimeout(entry.timerId);
      }
    });
    waitingKernelTimeoutsRef.current = {};
  }, []);

  const handleExecuteNotebookBatch = useCallback(() => {
    const targetPath = activeNotebookSessionPath || activeNotebookPath;
    if (!targetPath) {
      return false;
    }
    const session = notebookSessionsRef.current[targetPath] || createEmptyNotebookSession();
    const runtimeNotebook = normalizeNotebookSnapshot(
      session.runtimeNotebook
      || activeNotebookInitialData
      || notebookData,
    );
    const batchCells = buildNotebookBatchCells(runtimeNotebook, { includeDocx: nbAutoDocEnabled });
    if (!runtimeNotebook || batchCells.length === 0) {
      handleStatusMessage(
        nbAutoDocEnabled
          ? 'No hay celdas ejecutables para ejecutar.'
          : 'No hay celdas de codigo para ejecutar con DOCX/PDF desactivado.',
        'warning',
        {
          target: createFileNotificationTarget(targetPath, { actionLabel: 'Abrir notebook' }),
        },
      );
      return false;
    }

    notebookBatchRunSeqRef.current += 1;
    const runId = notebookBatchRunSeqRef.current;
    const activeKernelId = session.kernelState?.kernelId || null;
    const firstBatchCell = batchCells[0] || null;
    const initialBatchRunState = {
      runId,
      status: activeKernelId ? 'queued' : 'waiting_kernel',
      total: batchCells.length,
      executed: 0,
      pendingCells: batchCells,
      currentCellId: null,
      currentExecutionId: null,
      executionTimeoutMs: 600000,
      enableTracing: nbEnableTracing,
      emitDocx: nbAutoDocEnabled,
      docxValidation: nbDocxValidationEnabled,
      kernelRecoveryAttempts: 0,
      waitingForKernelSince: activeKernelId ? null : Date.now(),
      runtimeNotebookSnapshot: runtimeNotebook,
      message: buildNotebookRunProgressMessage({
        status: activeKernelId ? 'queued' : 'waiting_kernel',
        total: batchCells.length,
        executed: 0,
        kernelRecoveryAttempts: 0,
      }),
    };
    logNotebookBatchDebug('handleExecuteNotebookBatch start', {
      targetPath,
      runId,
      activeKernelId,
      totalCells: batchCells.length,
    });
    updateNotebookSession(targetPath, (previous) => {
      const nextSession = applyRuntimeNotebookSnapshotToSession(previous, runtimeNotebook);
      return {
        ...nextSession,
        batchRunState: initialBatchRunState,
        documentState: resetDocumentState(previous.documentState, { preserveVariables: true }),
        kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
        kernelState: {
          ...nextSession.kernelState,
          isExecuting: true,
          executingCellId: firstBatchCell?.cellId || null,
          kernelInterrupted: false,
          hasNotebook: true,
        },
      };
    });
    syncNotebookBatchNotification(targetPath, initialBatchRunState);

    if (!activeKernelId) {
      const bindingStarted = requestNotebookKernelBinding(targetPath, {
        allowCreate: true,
        origin: 'run_all',
        runtimeNotebookOverride: runtimeNotebook,
      });
      if (!bindingStarted) {
        const failureMessage = 'No se pudo iniciar el kernel para Run All.';
        logNotebookBatchDebug('handleExecuteNotebookBatch failed before kernel start', {
          targetPath,
          runId,
        });
        updateNotebookSession(targetPath, (previous) => ({
          ...previous,
          batchRunState: null,
          kernelBindingRequest: createEmptyNotebookKernelBindingRequest(),
          kernelState: {
            ...previous.kernelState,
            isExecuting: false,
            executingCellId: null,
            isCreating: false,
          },
        }));
        notifyNotebookBatchFailed(targetPath, {
          error: failureMessage,
          runId,
          total: batchCells.length,
        });
      }
      return bindingStarted;
    }
    return true;
  }, [
    applyRuntimeNotebookSnapshotToSession,
    activeNotebookInitialData,
    activeNotebookPath,
    activeNotebookSessionPath,
    handleStatusMessage,
    nbAutoDocEnabled,
    nbDocxValidationEnabled,
    nbEnableTracing,
    notifyNotebookBatchFailed,
    notebookData,
    requestNotebookKernelBinding,
    syncNotebookBatchNotification,
    updateNotebookSession,
  ]);

  const openWorkspaceResource = useCallback(async (resource) => {
    const path = typeof resource === 'string' ? resource : resource?.path;
    if (!path) {
      return null;
    }

    const nextFile = typeof resource === 'string'
      ? {
        path,
        name: path.split(/[\\/]/).pop() || path,
      }
      : {
        ...resource,
        path,
        name: resource?.name || path.split(/[\\/]/).pop() || path,
      };

    if (activeNotebookPath && normalizeComparablePath(path) !== normalizeComparablePath(activeNotebookPath)) {
      persistActiveNotebookRuntimeSnapshot(activeNotebookPath);
    }

    const openedFile = await Promise.resolve(handleFileOpen(nextFile));
    if (openedFile?.error) {
      setUnsupportedFilePrompt({
        path,
        name: nextFile.name || getPathBasename(path) || path,
        message: openedFile.error,
        unsupported: openedFile.unsupported === true,
      });
      setEmptyFileSurfaceRequested(false);
      setWorkspaceSurface('file');
      if (openedFile.unsupported !== true) {
        handleStatusMessage(openedFile.error, 'warning', {
          target: createFileNotificationTarget(path),
        });
      }
      return null;
    }
    if (openedFile?.path) {
      setUnsupportedFilePrompt(null);
      setEmptyFileSurfaceRequested(false);
      setWorkspaceSurface('file');
    }
    return openedFile;
  }, [activeNotebookPath, handleFileOpen, handleStatusMessage, persistActiveNotebookRuntimeSnapshot]);

  const handleNativeFileOpen = useCallback(async (targetPath) => {
    const filePath = typeof targetPath === 'string' ? targetPath.trim() : '';
    if (!filePath) {
      return;
    }

    const activeWorkspacePath = workspaceSession.activeWorkspace || currentWorkspace || '';
    try {
      if (activeWorkspacePath && isSameOrDescendantComparablePath(filePath, activeWorkspacePath)) {
        await openWorkspaceResource({
          path: filePath,
          name: getPathBasename(filePath) || filePath,
          isDirectory: false,
        });
        return;
      }

      const parentWorkspacePath = getPathDirname(filePath);
      if (!parentWorkspacePath) {
        handleStatusMessage(`No se pudo abrir ${filePath}: no se pudo inferir el workspace.`, 'warning');
        return;
      }

      setWorkspaceLaunchIntent({
        source: 'native-file-association',
        openFilePath: filePath,
      });
      await handleWorkspaceSelect(parentWorkspacePath);
    } catch (error) {
      handleStatusMessage(error?.message || `No se pudo abrir ${filePath}`, 'warning', {
        target: createFileNotificationTarget(filePath),
      });
    }
  }, [
    currentWorkspace,
    handleStatusMessage,
    handleWorkspaceSelect,
    openWorkspaceResource,
    setWorkspaceLaunchIntent,
    workspaceSession.activeWorkspace,
  ]);

  const selectWorkspaceResource = useCallback(async (resource) => {
    const path = typeof resource === 'string' ? resource : resource?.path;
    if (!path) {
      return null;
    }

    const nextFile = typeof resource === 'string'
      ? {
        path,
        name: path.split(/[\\/]/).pop() || path,
      }
      : resource;

    if (activeNotebookPath && normalizeComparablePath(path) !== normalizeComparablePath(activeNotebookPath)) {
      persistActiveNotebookRuntimeSnapshot(activeNotebookPath);
    }

    await Promise.resolve(handleFileSelect(nextFile));
    setUnsupportedFilePrompt(null);
    setEmptyFileSurfaceRequested(false);
    setWorkspaceSurface('file');
    return nextFile;
  }, [activeNotebookPath, handleFileSelect, persistActiveNotebookRuntimeSnapshot]);

  const removeWorkspaceResource = useCallback((path) => {
    const removed = removeOpenFile(path);
    if (!removed) {
      return false;
    }

    const remainingFiles = (openFiles || []).filter(
      (file) => !isSameOrDescendantComparablePath(file?.path, path),
    );
    setUnsupportedFilePrompt((current) => (
      isSameOrDescendantComparablePath(current?.path, path) ? null : current
    ));
    if (remainingFiles.length === 0) {
      setEmptyFileSurfaceRequested(false);
      setWorkspaceSurface('home');
    }
    return true;
  }, [openFiles, removeOpenFile]);

  const getCodeRuntimeForPath = useCallback((path) => {
    if (!path) {
      return null;
    }
    if (codeExecutionStateByPath[path]) {
      return codeExecutionStateByPath[path];
    }
    const normalizedPath = normalizeComparablePath(path);
    const matchedEntry = Object.entries(codeExecutionStateByPath).find(([candidatePath]) => (
      normalizeComparablePath(candidatePath) === normalizedPath
    ));
    return matchedEntry ? matchedEntry[1] : null;
  }, [codeExecutionStateByPath]);

  const stopWorkspaceRuntime = useCallback(async (filePath) => {
    if (!filePath) {
      return false;
    }
    setPendingNotebookExecution(filePath, null);
    if (filePath.toLowerCase().endsWith('.ipynb')) {
      const kernelId = notebookSessionsRef.current[filePath]?.kernelState?.kernelId || null;
      if (kernelId && getNotebookConnectionStatusSafe(filePath) === 'connected') {
        sendNotebookMessageSafe(filePath, {
          type: 'notebook_shutdown_kernel',
          kernel_id: kernelId,
          path: filePath,
        });
      }
      removeNotebookSession(filePath);
      return true;
    }

    const codeRuntime = getCodeRuntimeForPath(filePath);
    if (connectionStatus === 'connected' && (codeRuntime?.runId || codeRuntime?.isExecuting)) {
      cancelCodeExecution(filePath, codeRuntime?.runId || null);
    }
    clearCodeExecutionState(filePath, { suppressIncoming: true });
    return Boolean(codeRuntime);
  }, [
    cancelCodeExecution,
    clearCodeExecutionState,
    connectionStatus,
    getNotebookConnectionStatusSafe,
    getCodeRuntimeForPath,
    removeNotebookSession,
    sendNotebookMessageSafe,
    setPendingNotebookExecution,
  ]);

  const closeWorkspacePath = useCallback(async (path, { alreadyRemoved = false } = {}) => {
    if (!path) {
      return false;
    }

    const affectedFiles = (openFiles || []).filter(
      (file) => isSameOrDescendantComparablePath(file?.path, path),
    );

    for (const file of affectedFiles) {
      // eslint-disable-next-line no-await-in-loop
      await stopWorkspaceRuntime(file.path);
    }

    if (alreadyRemoved) {
      return affectedFiles.length > 0;
    }
    return removeWorkspaceResource(path);
  }, [openFiles, removeWorkspaceResource, stopWorkspaceRuntime]);

  const closeWorkspaceFile = useCallback(async (file) => {
    if (!file?.path) {
      return false;
    }
    return closeWorkspacePath(file.path);
  }, [closeWorkspacePath]);

  const getPreferredNotebookPath = useCallback(() => {
    if (activeFile?.path?.toLowerCase().endsWith('.ipynb')) {
      return activeFile.path;
    }

    const openNotebook = (openFiles || []).find((file) => file?.path?.toLowerCase().endsWith('.ipynb'));
    if (openNotebook?.path) {
      return openNotebook.path;
    }

    const historicalNotebook = (docxHistoryEntries || []).find((entry) => (
      typeof entry?.sourcePath === 'string'
      && entry.sourcePath.toLowerCase().endsWith('.ipynb')
    ));
    return historicalNotebook?.sourcePath || null;
  }, [activeFile?.path, docxHistoryEntries, openFiles]);

  const handleOpenDocumentFromHome = useCallback(async (entry = null) => {
    const sourcePath = entry?.sourcePath || entry?.source_path || getPreferredNotebookPath();
    const focus = entry?.focus === 'quality' || entry?.focusQuality ? 'quality' : null;
    if (!sourcePath) {
      focusDocxView({ surface: 'home', focus });
      return false;
    }

    const openedFile = await openWorkspaceResource({
      path: sourcePath,
      name: sourcePath.split(/[\\/]/).pop() || sourcePath,
    });
    if (!openedFile?.path) {
      return false;
    }

    focusDocxView({ focus });
    return true;
  }, [focusDocxView, getPreferredNotebookPath, openWorkspaceResource]);

  const openWorkspaceDocumentFromHome = useCallback(async (entry = null) => {
    const sourcePath = entry?.sourcePath || entry?.source_path || null;
    const sourceKind = entry?.sourceKind || entry?.source_kind || inferDocxSourceKind(sourcePath);
    const openMode = entry?.openMode || entry?.open_mode || null;

    if (openMode === 'source' || entry?.focus === 'quality' || entry?.focusQuality) {
      return handleOpenDocumentFromHome(entry);
    }

    const workspaceDocumentPath = entry?.workspace_path || entry?.docxWorkspacePath || null;
    if (workspaceDocumentPath && desktopApi?.openPath) {
      try {
        await desktopApi.openPath(workspaceDocumentPath);
        return true;
      } catch (error) {
        handleStatusMessage(error?.message || 'No se pudo abrir el DOCX con la aplicacion del sistema', 'warning');
      }
    }

    const downloadUrl = buildHomeDocxDownloadUrl(entry);
    if (downloadUrl && typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return true;
    }

    if (sourceKind === 'notebook' || (typeof sourcePath === 'string' && sourcePath.toLowerCase().endsWith('.ipynb'))) {
      return handleOpenDocumentFromHome(entry);
    }
    return handleOpenDocumentFromHome(entry);
  }, [desktopApi, handleOpenDocumentFromHome, handleStatusMessage]);

  const tokenizeTemplateMirror = useCallback(async (templateMirrorPath) => {
    if (typeof templateMirrorPath !== 'string' || !templateMirrorPath.trim()) {
      return null;
    }

    const response = await fetch(`${API_BASE}/api/templates/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: templateMirrorPath }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'No se pudo reatachar el template persistido'));
    }

    const payload = await response.json();
    return payload?.template_token || null;
  }, []);

  const handleOpenTemplateFromHome = useCallback(async (entry = null) => {
    const notebookPath = entry?.sourcePath
      || entry?.source_path
      || entry?.path
      || getPreferredNotebookPath();
    if (!notebookPath) {
      setMcpPanelOpen(true);
      return false;
    }

    const openedFile = await openWorkspaceResource({
      path: notebookPath,
      name: notebookPath.split(/[\\/]/).pop() || notebookPath,
    });
    if (!openedFile?.path) {
      return false;
    }

    const templateMirrorPath = entry?.template_mirror_path || entry?.templateMirrorPath || null;
    let templateToken = entry?.template_token || entry?.templateToken || null;
    if (templateMirrorPath) {
      try {
        templateToken = await tokenizeTemplateMirror(templateMirrorPath);
      } catch (error) {
        handleStatusMessage(error?.message || 'No se pudo reatachar el template del workspace', 'warning');
      }
    }

    if (templateToken) {
      updateNotebookSession(openedFile.path, (previous) => ({
        ...previous,
        templateBlob: {
          templateToken,
          sourcePath: openedFile.path,
          templateMirrorPath,
        },
      }));
    } else {
      updateNotebookSession(openedFile.path, (previous) => ({
        ...previous,
        templateBlob: null,
      }));
    }

    focusDocxView();
    updateNotebookSession(openedFile.path, (previous) => ({
      ...previous,
      templateOpenRequest: {
        token: Date.now(),
        sourcePath: openedFile.path,
        entry: {
          ...entry,
          sourcePath: openedFile.path,
          template_token: templateToken || entry?.template_token || entry?.templateToken || null,
        },
      },
    }));
    return true;
  }, [
    focusDocxView,
    getPreferredNotebookPath,
    handleStatusMessage,
    openWorkspaceResource,
    tokenizeTemplateMirror,
    updateNotebookSession,
  ]);

  const handleOpenMcpClientFromHome = useCallback((client = null) => {
    const clientId = typeof client?.client_id === 'string' && client.client_id.trim() ? client.client_id.trim() : null;
    const clientLabel = typeof client?.client_label === 'string' && client.client_label.trim() ? client.client_label.trim() : null;
    setMcpClientFilter(clientId || clientLabel ? { clientId, clientLabel } : null);
    setMcpPanelOpen(true);
  }, []);

  const handleClearMcpClientFilter = useCallback(() => {
    setMcpClientFilter(null);
  }, []);

  const handleGoToWorkspaceHome = useCallback(() => {
    persistActiveNotebookRuntimeSnapshot();
    setUnsupportedFilePrompt(null);
    setEmptyFileSurfaceRequested(false);
    setWorkspaceSurface('home');
  }, [persistActiveNotebookRuntimeSnapshot]);

  const handleGoToFileSurface = useCallback(() => {
    setLeftSidebarView('explorer');
    setExplorerCollapsed(false);
    setEmptyFileSurfaceRequested((openFiles || []).length === 0);
    setWorkspaceSurface('file');
  }, [openFiles]);

  useEffect(() => {
    if (!docxHistoryLoadedRef.current) {
      docxHistoryLoadedRef.current = true;
      setDocxHistoryEntries((current) => current.map((entry) => normalizeDocxHistoryEntry(entry)).filter(Boolean));
    }
  }, []);

  const recordDocxHistoryFromState = useCallback((state, origin = 'ui') => {
    if (!state) {
      return;
    }

    const entry = createDocxHistoryEntry(
      {
        docx_hash: state.docxHash || null,
        docx_download_url: state.docxDownloadUrl || null,
        docx_file_token: state.docxFileToken || null,
        docx_artifact_id: state.docxArtifactId || null,
        docx_file_name: state.docxFileName || null,
        docx_size_bytes: state.docxSizeBytes ?? null,
        docx_provenance_available: state.docxProvenanceAvailable ?? false,
        docx_provenance_ref: state.docxProvenanceRef || null,
        docx_updated_at: state.docxUpdatedAt ?? null,
        docx_source_path: state.docxSourcePath || null,
        docx_source_kind: state.docxSourceKind || inferDocxSourceKind(state.docxSourcePath),
        docx_event_id: state.docxEventId,
        workspace_path: state.docxWorkspacePath || null,
        workspace_relpath: state.docxWorkspaceRelpath || null,
        workspace_warning: state.docxWorkspaceWarning || null,
      },
      {
        id: state.docxEventId,
        createdAt: Date.now(),
        sourcePath: state.docxSourcePath || null,
        sourceKind: state.docxSourceKind || inferDocxSourceKind(state.docxSourcePath),
        docxEventId: state.docxEventId,
        docxUpdatedAt: state.docxUpdatedAt ?? null,
        origin,
      },
    );

    if (!entry) {
      return;
    }

    const stableKey = getDocxHistoryRecordKey(entry)
      || entry.id
      || getDocxStableIdentity(entry, { allowHashFallback: true });
    if (!stableKey || lastRecordedDocxHistoryKeyRef.current[origin] === stableKey) {
      return;
    }

    lastRecordedDocxHistoryKeyRef.current = {
      ...lastRecordedDocxHistoryKeyRef.current,
      [origin]: stableKey,
    };

    setDocxHistoryEntries((current) => upsertDocxHistoryEntry(current, entry));
  }, []);

  useEffect(() => {
    if (editorExecutionData?.docxEventId) {
      recordDocxHistoryFromState(editorExecutionData, 'code');
    }
  }, [editorExecutionData, recordDocxHistoryFromState]);

  useEffect(() => {
    if (notebookExecutionData?.docxEventId) {
      recordDocxHistoryFromState(notebookExecutionData, 'notebook');
    }
  }, [notebookExecutionData, recordDocxHistoryFromState]);

  useEffect(() => {
    saveDocxHistoryEntries(docxHistoryEntries);
  }, [docxHistoryEntries]);

  const notifyDocxState = useCallback((state, originLabel) => {
    const eventKey = state?.docxEventId || state?.docxArtifactId || state?.docxHash;
    if (!eventKey) {
      return;
    }

    const errorMessage = state.docxError || state.docxStoreError || null;
    if (errorMessage) {
      emitDesktopNotification(
        {
          title: `${originLabel}: exportacion DOCX fallida`,
          body: String(errorMessage),
          level: 'error',
        },
        `docx:error:${originLabel}:${eventKey}`,
      );
      return;
    }

    const hasArtifact = Boolean(
      state.docxDownloadUrl
      || state.docxFileToken
      || state.docxArtifactId
      || state.docxBase64
      || state.docxHash,
    );
    if (!hasArtifact) {
      return;
    }

    emitDesktopNotification(
      {
        title: `${originLabel}: DOCX listo`,
        body: state.docxFileName || 'El documento DOCX ya esta disponible.',
        level: 'success',
      },
      `docx:success:${originLabel}:${eventKey}`,
    );
  }, [emitDesktopNotification]);

  const notifyPdfState = useCallback((state, originLabel) => {
    const eventKey = state?.pdfHash || state?.pdfRefUrl || null;
    const errorMessage = state?.pdfConversionError || state?.wordError || null;
    if (!eventKey && !errorMessage) {
      return;
    }

    if (errorMessage) {
      emitDesktopNotification(
        {
          title: `${originLabel}: exportacion PDF fallida`,
          body: String(errorMessage),
          level: 'error',
        },
        `pdf:error:${originLabel}:${eventKey || errorMessage}`,
      );
      return;
    }

    const hasArtifact = Boolean(state?.pdfBase64 || state?.pdfRefUrl || state?.pdfHash);
    if (!hasArtifact) {
      return;
    }

    emitDesktopNotification(
      {
        title: `${originLabel}: PDF listo`,
        body: 'La exportacion PDF ya esta disponible.',
        level: 'success',
      },
      `pdf:success:${originLabel}:${eventKey}`,
    );
  }, [emitDesktopNotification]);

  useEffect(() => {
    notifyDocxState(editorExecutionData, 'Editor');
  }, [
    editorExecutionData,
    editorExecutionData.docxArtifactId,
    editorExecutionData.docxBase64,
    editorExecutionData.docxDownloadUrl,
    editorExecutionData.docxError,
    editorExecutionData.docxEventId,
    editorExecutionData.docxFileToken,
    editorExecutionData.docxHash,
    editorExecutionData.docxStoreError,
    notifyDocxState,
  ]);

  useEffect(() => {
    notifyDocxState(notebookExecutionData, 'Notebook');
  }, [
    notebookExecutionData,
    notebookExecutionData.docxArtifactId,
    notebookExecutionData.docxBase64,
    notebookExecutionData.docxDownloadUrl,
    notebookExecutionData.docxError,
    notebookExecutionData.docxEventId,
    notebookExecutionData.docxFileToken,
    notebookExecutionData.docxHash,
    notebookExecutionData.docxStoreError,
    notifyDocxState,
  ]);

  useEffect(() => {
    notifyPdfState(editorExecutionData, 'Editor');
  }, [
    editorExecutionData,
    editorExecutionData.pdfBase64,
    editorExecutionData.pdfConversionError,
    editorExecutionData.pdfHash,
    editorExecutionData.pdfRefUrl,
    notifyPdfState,
  ]);

  useEffect(() => {
    notifyPdfState(notebookExecutionData, 'Notebook');
  }, [
    notebookExecutionData,
    notebookExecutionData.pdfBase64,
    notebookExecutionData.pdfConversionError,
    notebookExecutionData.pdfHash,
    notebookExecutionData.pdfRefUrl,
    notebookExecutionData.wordError,
    notifyPdfState,
  ]);

  const handleSaveActive = useCallback(async () => {
    if (!activeFile) {
      return false;
    }

    try {
      await saveFile(activeFile);
      return true;
    } catch (error) {
      const message = error?.message || 'No se pudo guardar el archivo activo';
      handleStatusMessage(message, 'warning', {
        target: createFileNotificationTarget(activeFile.path),
      });
      emitDesktopNotification(
        { title: 'Guardado fallido', body: message, level: 'error' },
        `save:${activeFile.path}:${message}`,
      );
      return false;
    }
  }, [activeFile, emitDesktopNotification, handleStatusMessage, saveFile]);

  const editorDocxSourcePath = editorExecutionData.docxSourcePath
    || activeFile?.path
    || null;
  const editorDocxSourceKind = editorExecutionData.docxSourceKind
    || inferDocxSourceKind(editorDocxSourcePath);
  const notebookDocxSourcePath = notebookExecutionData.docxSourcePath
    || activeFile?.path
    || null;
  const notebookDocxSourceKind = notebookExecutionData.docxSourceKind
    || inferDocxSourceKind(notebookDocxSourcePath);
  const editorDocxHistory = useMemo(
    () => filterDocxHistoryEntries(docxHistoryEntries, editorDocxSourcePath),
    [docxHistoryEntries, editorDocxSourcePath],
  );
  const notebookDocxHistory = useMemo(
    () => filterDocxHistoryEntries(docxHistoryEntries, notebookDocxSourcePath),
    [docxHistoryEntries, notebookDocxSourcePath],
  );
  const editorDocumentState = useMemo(() => ({
    ...editorExecutionData,
    sourcePath: editorDocxSourcePath,
    sourceKind: editorDocxSourceKind,
    docxHistory: editorDocxHistory,
    pdfServiceStatus,
  }), [editorDocxHistory, editorDocxSourceKind, editorDocxSourcePath, editorExecutionData, pdfServiceStatus]);
  const notebookDocumentState = useMemo(() => ({
    ...notebookExecutionData,
    sourcePath: notebookDocxSourcePath,
    sourceKind: notebookDocxSourceKind,
    docxHistory: notebookDocxHistory,
    pdfServiceStatus,
  }), [notebookDocxHistory, notebookDocxSourceKind, notebookDocxSourcePath, notebookExecutionData, pdfServiceStatus]);

  const {
    activity: mcpActivity,
    activeRuns: mcpActiveRuns,
    runningCount: mcpRunningCount,
    mirrorEnabled,
    setMirrorEnabled,
    toggleMirrorEnabled,
    agentExecutionState,
  } = useMcpActivity({
    connectionStatus,
    lastMessage,
    messageQueue,
    activeFile,
    modifiedFiles,
    onNotify: pushNotification,
    onRefreshWorkspace: triggerWorkspaceRefresh,
    onReloadActiveFile: reloadActiveFile,
    onApplyArtifact: handleMcpArtifact,
  });

  const {
    mcpStatus,
    setMcpStatus,
    refreshMcpStatus,
    handleMcpQuickAction,
  } = useMcpShellControls({
    emitDesktopNotification,
    handleStatusMessage,
    setMirrorEnabled,
  });

  useMcpMirror({
    mirrorEnabled,
    lastMessage,
    messageQueue,
    workspaceSurface,
    activeFile,
    openFiles,
    modifiedFiles,
    handleFileOpen: openWorkspaceResource,
    handleFileSelect: selectWorkspaceResource,
    notebookActionsRef,
    onNotify: pushNotification,
    onRefreshWorkspace: triggerWorkspaceRefresh,
    onTemplateInfoChange: (nextTemplateInfo, meta = {}) => {
      const targetPath = resolveNotebookSessionPath(
        meta?.path
        || meta?.sourcePath
        || meta?.resourcePath
        || meta?.notebookPath
        || null
      ) || meta?.path || meta?.sourcePath || meta?.resourcePath || meta?.notebookPath || null;
      if (!targetPath) {
        return;
      }
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        templateInfo: nextTemplateInfo,
      }));
    },
    onTemplateBlobChange: (nextTemplateBlob, meta = {}) => {
      const targetPath = resolveNotebookSessionPath(
        meta?.path
        || meta?.sourcePath
        || meta?.resourcePath
        || meta?.notebookPath
        || null
      ) || meta?.path || meta?.sourcePath || meta?.resourcePath || meta?.notebookPath || null;
      if (!targetPath) {
        return;
      }
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        templateBlob: nextTemplateBlob,
        lastTemplateAttach: null,
      }));
    },
    onFocusDocx: () => focusDocxView({ surface: workspaceSurface === 'home' ? 'home' : 'file' }),
    onApplyArtifact: handleMcpArtifact,
    reloadFileByPath,
    renameOpenFile,
    removeOpenFile: removeWorkspaceResource,
  });

  useEffect(() => {
    if (!postWorkspaceAction) {
      return undefined;
    }

    const action = postWorkspaceAction;
    let cancelled = false;
    setPostWorkspaceAction(null);

    const run = async () => {
      if (action.openFilePath) {
        await openWorkspaceResource({
          path: action.openFilePath,
          name: action.openFilePath.split(/[\\/]/).pop() || action.openFilePath,
          isDirectory: false,
        });
      }

      if (cancelled || !action.startAgents) {
        return;
      }

      setMcpPanelOpen(true);
      if (mcpStatus?.status !== 'running' && mcpStatus?.status !== 'starting') {
        await handleMcpQuickAction('start');
      }
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handleMcpQuickAction, mcpStatus?.status, openWorkspaceResource, postWorkspaceAction]);

  // ==================== EFFECTS & LOGIC ====================

  const refreshPdfServiceStatus = useCallback(async ({ silent = false } = {}) => {
    if (connectionStatus !== 'connected') {
      return null;
    }

    pdfStatusAbortRef.current?.abort();
    const controller = new AbortController();
    pdfStatusAbortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/pdf-status`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const nextStatus = buildPdfServiceStatus(await response.json());
      const previousStatus = pdfServiceStatusRef.current;
      const hasChanged = !hasSamePdfServiceStatus(previousStatus, nextStatus);

      if (hasChanged) {
        pdfServiceStatusRef.current = nextStatus;
        setPdfServiceStatus(nextStatus);
      }

      if (!silent && (hasChanged || !previousStatus)) {
        handleStatusMessage(
          nextStatus.available ? `PDF: disponible (${nextStatus.sourceLabel})` : 'PDF: no disponible',
          nextStatus.available ? 'success' : 'warning',
        );
      }

      return nextStatus;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      }

      const nextStatus = { available: false, sourceLabel: 'No disponible', error: true };
      const previousStatus = pdfServiceStatusRef.current;
      const hasChanged = !hasSamePdfServiceStatus(previousStatus, nextStatus);

      if (hasChanged) {
        pdfServiceStatusRef.current = nextStatus;
        setPdfServiceStatus(nextStatus);
      }

      if (!silent && (hasChanged || !previousStatus || !previousStatus.error)) {
        handleStatusMessage('No se pudo consultar el estado del servicio PDF', 'warning');
      }

      return nextStatus;
    } finally {
      if (pdfStatusAbortRef.current === controller) {
        pdfStatusAbortRef.current = null;
      }
    }
  }, [connectionStatus, handleStatusMessage]);

  useEffect(() => {
    refreshWorkspaceSession().catch(() => {});
  }, [refreshWorkspaceSession]);

  useEffect(() => {
    if (!workspaceSession.activeWorkspace && !currentWorkspace) {
      setHomeSummary(EMPTY_HOME_SUMMARY);
      setHomeSummaryError(null);
      return;
    }
    refreshHomeSummary().catch(() => {});
  }, [currentWorkspace, refreshHomeSummary, workspaceSession.activeWorkspace]);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      pdfStatusAbortRef.current?.abort();
      return undefined;
    }

    refreshPdfServiceStatus({ silent: Boolean(pdfServiceStatusRef.current) }).catch(() => {});
    return () => {
      pdfStatusAbortRef.current?.abort();
    };
  }, [connectionStatus, refreshPdfServiceStatus]);

  const handleDocumentVisibilityChange = useCallback((isVisible) => {
    if (!isVisible) {
      return;
    }
    refreshPdfServiceStatus({ silent: true }).catch(() => {});
  }, [refreshPdfServiceStatus]);

  const handleNotebookRetryPdf = useCallback(() => {
    refreshPdfServiceStatus({ silent: true }).catch(() => {});
    sendNotebookMessageSafe(activeNotebookSessionPath || activeNotebookPath, {
      type: 'force_reconvert_pdf',
      kernel_id: notebookKernelState.kernelId,
      path: activeNotebookSessionPath || activeNotebookPath || null,
    });
  }, [
    activeNotebookPath,
    activeNotebookSessionPath,
    notebookKernelState.kernelId,
    refreshPdfServiceStatus,
    sendNotebookMessageSafe,
  ]);

  const editorDocumentActions = useMemo(() => ({
    onRetryPdf: null,
    onClearDocx: () => sendMessage({ type: 'clear_mdoc' }),
    onStatusMessage: handleStatusMessage,
  }), [handleStatusMessage, sendMessage]);

  const notebookDocumentActions = useMemo(() => ({
    onRetryPdf: handleNotebookRetryPdf,
    onClearDocx: () => sendNotebookMessageSafe(activeNotebookSessionPath || activeNotebookPath, {
      type: 'notebook_mdoc_clear',
      kernel_id: notebookKernelState.kernelId,
      path: activeNotebookSessionPath || activeNotebookPath || null,
    }),
    onStatusMessage: handleStatusMessage,
  }), [
    activeNotebookPath,
    activeNotebookSessionPath,
    handleNotebookRetryPdf,
    handleStatusMessage,
    notebookKernelState.kernelId,
    sendNotebookMessageSafe,
  ]);

  // MCP Status Polling
  useEffect(() => {
    let cancelled = false;

    const syncStatus = async () => {
      if (cancelled) return;
      await refreshMcpStatus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncStatus();
      }
    };

    syncStatus();
    const interval = setInterval(syncStatus, 5000);
    window.addEventListener('focus', syncStatus);
    window.addEventListener('online', syncStatus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', syncStatus);
      window.removeEventListener('online', syncStatus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshMcpStatus]);

  const mode = activeFile && activeFile.path.endsWith('.ipynb') ? 'notebook' : 'code';
  const activeDependencyTarget = useMemo(() => {
    if (!dependencyTarget) {
      return null;
    }
    const targetPath = dependencyTarget.filePath || dependencyTarget.sourcePath || null;
    if (
      targetPath
      && activeFile?.path
      && normalizeComparablePath(targetPath) !== normalizeComparablePath(activeFile.path)
    ) {
      return null;
    }
    return dependencyTarget;
  }, [activeFile?.path, dependencyTarget]);
  useEffect(() => {
    if (!dependencyTarget || !activeFile?.path) {
      return;
    }
    const targetPath = dependencyTarget.filePath || dependencyTarget.sourcePath || null;
    if (targetPath && normalizeComparablePath(targetPath) !== normalizeComparablePath(activeFile.path)) {
      setDependencyTarget(null);
    }
  }, [activeFile?.path, dependencyTarget]);
  const showProjectLauncher = shouldShowProjectLauncher(workspaceSession, openFiles);
  const showWorkspaceHome = Boolean(workspaceSession.activeWorkspace) && !showProjectLauncher && workspaceSurface === 'home';
  const notebookIndexNotebookPath = workspaceSurface === 'file' ? activeNotebookPath : null;
  const notebookIndexNotebook = notebookIndexNotebookPath
    ? normalizeNotebookSnapshot(activeRuntimeNotebook || activeNotebookInitialData || null)
    : null;
  const notebookIndexActiveCellId = (
    notebookIndexNotebookPath
    && notebookIndexNotebook?.cells?.some((cell) => cell?.id === activeNotebookSelectedCellId)
  ) ? activeNotebookSelectedCellId : null;
  const leftSidebarPanelWidth = Math.max(
    LEFT_SIDEBAR_PANEL_MIN_WIDTH,
    explorerWidthPx - LEFT_SIDEBAR_RAIL_WIDTH,
  );

  const handleLeftSidebarSectionSelect = useCallback((nextView) => {
    if (!nextView) {
      return;
    }
    if (explorerCollapsed) {
      setLeftSidebarView(nextView);
      setExplorerCollapsed(false);
      return;
    }
    if (leftSidebarView === nextView) {
      setExplorerCollapsed(true);
      return;
    }
    setLeftSidebarView(nextView);
  }, [explorerCollapsed, leftSidebarView]);

  useEffect(() => {
    if (showProjectLauncher) {
      setUnsupportedFilePrompt(null);
      setWorkspaceSurface('home');
      return;
    }
    if (
      workspaceSession.activeWorkspace
      && openFiles.length === 0
      && workspaceSurface !== 'home'
      && !emptyFileSurfaceRequested
      && !unsupportedFilePrompt
    ) {
      setWorkspaceSurface('home');
    }
  }, [emptyFileSurfaceRequested, openFiles.length, showProjectLauncher, unsupportedFilePrompt, workspaceSession.activeWorkspace, workspaceSurface]);

  useEffect(() => {
    if (openFiles.length > 0 && emptyFileSurfaceRequested) {
      setEmptyFileSurfaceRequested(false);
    }
  }, [emptyFileSurfaceRequested, openFiles.length]);

  useEffect(() => {
    if (!showWorkspaceHome) {
      return undefined;
    }

    let cancelled = false;
    const syncHomeSummary = async () => {
      if (cancelled) return;
      await refreshHomeSummary({ silent: true });
    };

    syncHomeSummary().catch(() => {});
    const intervalId = window.setInterval(() => {
      syncHomeSummary().catch(() => {});
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncHomeSummary().catch(() => {});
      }
    };

    window.addEventListener('focus', syncHomeSummary);
    window.addEventListener('online', syncHomeSummary);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncHomeSummary);
      window.removeEventListener('online', syncHomeSummary);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshHomeSummary, showWorkspaceHome]);

  useEffect(() => {
    if (!desktopApi?.reportWorkspace) {
      return;
    }

    const workspacePath = workspaceSession.activeWorkspace || currentWorkspace || '';
    const normalizedWorkspace = normalizeComparablePath(workspacePath);
    if (!normalizedWorkspace || reportedWorkspaceRef.current === normalizedWorkspace) {
      return;
    }

    reportedWorkspaceRef.current = normalizedWorkspace;
    Promise.resolve(desktopApi.reportWorkspace(workspacePath)).catch(() => {});
  }, [currentWorkspace, desktopApi, workspaceSession.activeWorkspace]);

  useEffect(() => {
    if (!desktopApi?.onMenuAction) {
      return undefined;
    }

    return desktopApi.onMenuAction((action) => {
      switch (action?.type) {
        case 'open-workspace':
          handleOpenWorkspaceRequest();
          break;
        case 'open-recent-workspace':
          if (action?.payload?.path) {
            handleWorkspaceSelect(action.payload.path).catch(() => {});
          }
          break;
        case 'open-native-file':
          if (action?.payload?.path) {
            handleNativeFileOpen(action.payload.path).catch(() => {});
          }
          break;
        case 'open-native-url':
          if (action?.payload?.url) {
            handleStatusMessage(`Enlace Inspyro recibido: ${action.payload.url}`, 'info');
          }
          break;
        case 'close-active-file':
          if (activeFile) {
            closeWorkspaceFile(activeFile);
          }
          break;
        case 'save-active':
          void handleSaveActive();
          break;
        case 'run-active-cell':
          if (mode === 'notebook') {
            notebookActionsRef.current?.runActiveCell?.();
          } else if (!showProjectLauncher && workspaceSurface === 'file') {
            handleExecuteCode(code, activeFile?.path || null);
          }
          break;
        case 'interrupt-kernel':
          notebookActionsRef.current?.interrupt?.();
          break;
        case 'reset-kernel':
          notebookActionsRef.current?.reset?.();
          break;
        case 'clear-outputs':
          notebookActionsRef.current?.clearOutputs?.();
          break;
        case 'toggle-explorer':
          setExplorerCollapsed((previous) => !previous);
          break;
        case 'toggle-visualization':
          setIsVizCollapsed((previous) => !previous);
          break;
        case 'toggle-mcp-panel':
          setMcpPanelOpen((previous) => !previous);
          break;
        case 'mcp-start':
          void handleMcpQuickAction('start');
          break;
        case 'mcp-stop':
          void handleMcpQuickAction('stop');
          break;
        case 'mcp-restart':
          void handleMcpQuickAction('restart');
          break;
        default:
          break;
      }
    });
  }, [
    activeFile,
    code,
    desktopApi,
    handleExecuteCode,
    handleNativeFileOpen,
    handleMcpQuickAction,
    handleOpenWorkspaceRequest,
    handleSaveActive,
    handleStatusMessage,
    handleWorkspaceSelect,
    mode,
    closeWorkspaceFile,
    showProjectLauncher,
    workspaceSurface,
  ]);

  // Handle Resize
  const beginExplorerResize = useCallback(() => {
    const shellElement = leftSidebarShellRef.current;
    activeResizeSessionRef.current = {
      kind: 'explorer',
      currentWidthPx: explorerWidthPx,
      shellElement,
      explorerElement: shellElement?.querySelector?.('.file-explorer') || null,
    };
    document.body.classList.add('app-shell-layout-resizing');
  }, [explorerWidthPx]);

  const applyExplorerResizePreview = useCallback((session, nextWidthPx) => {
    const clampedWidth = clampNumber(
      nextWidthPx,
      LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MIN_WIDTH,
      LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MAX_WIDTH,
    );
    session.currentWidthPx = clampedWidth;
    if (session.shellElement) {
      session.shellElement.style.width = `${clampedWidth}px`;
    }
    if (session.explorerElement) {
      session.explorerElement.style.width = `${clampedWidth - LEFT_SIDEBAR_RAIL_WIDTH}px`;
    }
  }, []);

  const beginSplitResize = useCallback((targetMode) => {
    const isNotebookSplit = targetMode === 'notebook';
    const containerElement = isNotebookSplit
      ? notebookSplitContainerRef.current
      : mainContainerRef.current;
    activeResizeSessionRef.current = {
      kind: 'split',
      mode: targetMode,
      currentPercent: isNotebookSplit ? notebookPanelWidth : codePanelWidth,
      containerElement,
      containerWidth: Math.max(1, containerElement?.getBoundingClientRect?.().width || 1),
      primaryElement: isNotebookSplit ? notebookPanelRef.current : codePanelRef.current,
      visualizationElement: isNotebookSplit
        ? notebookVisualizationPanelRef.current
        : codeVisualizationPanelRef.current,
    };
    document.body.classList.add('app-shell-layout-resizing');
  }, [codePanelWidth, notebookPanelWidth]);

  const applySplitResizePreview = useCallback((session, nextPercent) => {
    const clampedPercent = clampNumber(nextPercent, SPLIT_PANEL_MIN_PERCENT, SPLIT_PANEL_MAX_PERCENT);
    session.currentPercent = clampedPercent;
    if (session.primaryElement) {
      session.primaryElement.style.width = getPrimarySplitWidthStyle(clampedPercent, false);
    }
    if (session.visualizationElement) {
      session.visualizationElement.style.width = getVisualizationSplitWidthStyle(clampedPercent, false);
    }
  }, []);

  const commitActiveResize = useCallback(() => {
    const session = activeResizeSessionRef.current;
    activeResizeSessionRef.current = null;
    document.body.classList.remove('app-shell-layout-resizing');
    if (!session) {
      return;
    }

    if (session.kind === 'explorer') {
      const nextWidth = clampNumber(
        session.currentWidthPx,
        LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MIN_WIDTH,
        LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MAX_WIDTH,
      );
      setExplorerWidthPx(nextWidth);
      return;
    }

    if (session.kind === 'split') {
      const nextPercent = clampNumber(
        session.currentPercent,
        SPLIT_PANEL_MIN_PERCENT,
        SPLIT_PANEL_MAX_PERCENT,
      );
      if (session.mode === 'notebook') {
        setNotebookPanelWidth(nextPercent);
      } else {
        setCodePanelWidth(nextPercent);
      }
    }
  }, []);

  useEffect(() => () => {
    document.body.classList.remove('app-shell-layout-resizing');
  }, []);

  const handleResize = useCallback((delta) => {
    const activeSession = activeResizeSessionRef.current;
    if (activeSession?.kind === 'split') {
      const containerWidth = Math.max(
        1,
        activeSession.containerWidth
          || activeSession.containerElement?.getBoundingClientRect?.().width
          || 1,
      );
      applySplitResizePreview(
        activeSession,
        activeSession.currentPercent + ((delta / containerWidth) * 100),
      );
      return;
    }

    const activeSplitContainer = mode === 'notebook'
      ? notebookSplitContainerRef.current
      : mainContainerRef.current;
    const containerWidth = Math.max(1, activeSplitContainer?.getBoundingClientRect?.().width || 1);
    const panelPercent = (delta / containerWidth) * 100;
    const updatePanelWidth = mode === 'notebook' ? setNotebookPanelWidth : setCodePanelWidth;
    updatePanelWidth((prev) => clampNumber(
      prev + panelPercent,
      SPLIT_PANEL_MIN_PERCENT,
      SPLIT_PANEL_MAX_PERCENT,
    ));
  }, [applySplitResizePreview, mode]);

  const handleExplorerResize = useCallback((delta) => {
    const activeSession = activeResizeSessionRef.current;
    if (activeSession?.kind === 'explorer') {
      applyExplorerResizePreview(activeSession, activeSession.currentWidthPx + delta);
      return;
    }

    setExplorerWidthPx((prev) => clampNumber(
      prev + delta,
      LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MIN_WIDTH,
      LEFT_SIDEBAR_RAIL_WIDTH + LEFT_SIDEBAR_PANEL_MAX_WIDTH,
    ));
  }, [applyExplorerResizePreview]);

  useTemplateMessageHandler({
    messageQueue: effectiveNotebookMessageQueue,
    resolveMessagePath: resolveNotebookMessagePath,
    updateNotebookSession,
    activeNotebookPath: activeNotebookTransportPath,
    onStatusMessage: handleStatusMessage,
  });

  const handleShowCodeDependencyTree = useCallback((request) => {
    if (!request?.symbol) {
      return;
    }

    const sourceCode = code || '';
    const resolvedLocation = findSymbolLocationInSource(sourceCode, request.symbol);
    const requestToken = request.requestToken
      || `code_dependency_${Date.now()}_${++dependencyRequestSeqRef.current}`;
    setWorkspaceSurface('file');
    setDependencyTarget({
      requestToken,
      filePath: activeFile?.path || null,
      symbol: request.symbol,
      line: Number.isInteger(request.line) ? request.line : resolvedLocation.line,
      column: Number.isInteger(request.column) ? request.column : resolvedLocation.column,
      mode: request.mode || 'dependencies',
      sourceCode,
      notebookContext: null,
      contextCellIds: null,
      cellId: null,
    });
    if (isVizCollapsed) {
      setIsVizCollapsed(false);
    }
  }, [activeFile?.path, code, isVizCollapsed]);

  const handleManualNotebookDependencyAnalysis = useCallback((request) => {
    const symbol = typeof request?.symbol === 'string' ? request.symbol.trim() : '';
    if (!symbol) {
      return;
    }

    const notebook = activeNotebookInitialData;
    const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
    if (cells.length === 0) {
      handleStatusMessage('Abre o carga una celda de codigo antes de analizar dependencias', 'warning');
      return;
    }

    const mode = request.mode || 'dependencies';
    const targetMatch = findNotebookAnalysisTarget(cells, symbol, activeNotebookSelectedCellId);
    if (!targetMatch) {
      handleStatusMessage('No hay celdas de codigo disponibles para analizar dependencias', 'warning');
      return;
    }

    const targetCell = targetMatch.cell;
    const targetIndex = targetMatch.index;
    const sourceCode = targetMatch.sourceCode;
    const contextCells = mode === 'impact'
      ? cells.filter((cell, index) => isPythonNotebookCell(cell) && index !== targetIndex)
      : cells.slice(0, targetIndex).filter(isPythonNotebookCell);
    const resolvedLocation = targetMatch.location || findSymbolLocationInSource(sourceCode, symbol);

    setWorkspaceSurface('file');
    setNotebookPanelWidth((prev) => Math.min(prev, NOTEBOOK_DEPENDENCY_PRIMARY_MAX_PERCENT));
    setDependencyTarget({
      requestToken: `manual_notebook_dependency_${Date.now()}_${++dependencyRequestSeqRef.current}`,
      filePath: activeFile?.path || activeNotebookPath || null,
      symbol,
      line: resolvedLocation.line,
      column: resolvedLocation.column,
      mode,
      sourceCode,
      notebookContext: contextCells.map((cell) => serializeNotebookCellSourceForAnalysis(cell.source)),
      contextCellIds: contextCells.map((cell) => cell.id).filter(Boolean),
      cellId: targetCell.id || null,
    });
    if (isVizCollapsed) {
      setIsVizCollapsed(false);
    }
  }, [
    activeNotebookInitialData,
    activeNotebookPath,
    activeNotebookSelectedCellId,
    activeFile?.path,
    handleStatusMessage,
    isVizCollapsed,
  ]);

  const handleNotebookDependencyTargetChange = useCallback((target) => {
    if (!target) {
      setDependencyTarget(null);
      return;
    }

    setNotebookPanelWidth((prev) => Math.min(prev, NOTEBOOK_DEPENDENCY_PRIMARY_MAX_PERCENT));
    setDependencyTarget({
      ...target,
      filePath: target.filePath || target.sourcePath || activeFile?.path || activeNotebookPath || null,
      requestToken: target.requestToken
        || `notebook_dependency_${Date.now()}_${++dependencyRequestSeqRef.current}`,
    });
  }, [activeFile?.path, activeNotebookPath]);

  useEffect(() => {
    if (!pendingNotebookNavigation) {
      return;
    }

    const targetPath = normalizeComparablePath(pendingNotebookNavigation.filePath);
    const activePath = normalizeComparablePath(activeFile?.path);
    if (targetPath && targetPath !== activePath) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let retryTimerId = null;

    const tryNavigate = () => {
      if (cancelled) {
        return;
      }
      const ok = notebookActionsRef.current?.navigateToCode?.(pendingNotebookNavigation);
      if (ok) {
        if (targetPath) {
          updateNotebookSession(pendingNotebookNavigation.filePath, (previous) => ({
            ...previous,
            selectedCellId: pendingNotebookNavigation.cellId || previous.selectedCellId || null,
          }));
        }
        setPendingNotebookNavigation(null);
        return;
      }
      attempts += 1;
      if (attempts >= 10) {
        return;
      }
      retryTimerId = setTimeout(tryNavigate, 0);
    };

    tryNavigate();

    return () => {
      cancelled = true;
      if (retryTimerId) {
        clearTimeout(retryTimerId);
      }
    };
  }, [
    activeFile?.path,
    notebookData,
    notebookSyncState.token,
    pendingNotebookNavigation,
    updateNotebookSession,
  ]);

  const handleNavigateToCode = useCallback(async (navigation) => {
    const requestedFilePath = typeof navigation?.filePath === 'string' && navigation.filePath.trim()
      ? navigation.filePath
      : null;
    const normalizedRequestedPath = normalizeComparablePath(requestedFilePath);
    const normalizedActivePath = normalizeComparablePath(activeFile?.path);
    const hasCellIndex = Number.isInteger(navigation?.cellIndex);
    const hasCellId = typeof navigation?.cellId === 'string' && navigation.cellId.trim().length > 0;
    const hasLine = Number.isInteger(navigation?.line) && navigation.line > 0;
    const isNotebookTarget = Boolean(
      requestedFilePath
      && requestedFilePath.toLowerCase().endsWith('.ipynb')
      && (hasCellIndex || hasCellId)
    );
    const shouldOpenFile = Boolean(
      requestedFilePath
      && (
        !requestedFilePath.toLowerCase().endsWith('.ipynb')
        || normalizedRequestedPath !== normalizedActivePath
        || (!hasCellIndex && !hasCellId)
      )
    );

    if (shouldOpenFile) {
      const openedFile = await openWorkspaceResource({
        path: requestedFilePath,
        name: requestedFilePath.split(/[\\/]/).pop(),
      });
      if (openedFile?.path) {
        if (isNotebookTarget) {
          updateNotebookSession(openedFile.path, (previous) => ({
            ...previous,
            selectedCellId: navigation?.cellId || previous.selectedCellId || null,
          }));
          setPendingNotebookNavigation({
            ...navigation,
            filePath: openedFile.path,
            token: Date.now(),
          });
          return true;
        }
        setCodeNavigationTarget({
          filePath: openedFile.path,
          line: hasLine ? navigation.line : null,
          column: Number.isInteger(navigation?.column) && navigation.column >= 0 ? navigation.column : null,
          symbol: navigation?.symbol || null,
          token: Date.now(),
        });
        return true;
      }
    }

    const ok = notebookActionsRef.current?.navigateToCode?.(navigation);
    if (ok) {
      if (requestedFilePath && isNotebookPath(requestedFilePath)) {
        updateNotebookSession(requestedFilePath, (previous) => ({
          ...previous,
          selectedCellId: navigation?.cellId || previous.selectedCellId || null,
        }));
      } else if (activeNotebookPath) {
        updateNotebookSession(activeNotebookPath, (previous) => ({
          ...previous,
          selectedCellId: navigation?.cellId || previous.selectedCellId || null,
        }));
      }
      setWorkspaceSurface('file');
      return true;
    }

    handleStatusMessage(
      'No se pudo navegar al código del símbolo seleccionado',
      'warning',
      {
        target: createCodeNotificationTarget({
          filePath: requestedFilePath || activeFile?.path || null,
          cellId: navigation?.cellId || null,
          cellIndex: hasCellIndex ? navigation.cellIndex : null,
          line: hasLine ? navigation.line : null,
          column: Number.isInteger(navigation?.column) && navigation.column >= 0 ? navigation.column : null,
        }),
      },
    );
    return false;
  }, [
    activeFile?.path,
    activeNotebookPath,
    handleStatusMessage,
    openWorkspaceResource,
    updateNotebookSession,
  ]);

  const dispatchNotificationTarget = useCallback(async (target) => {
    if (!target || typeof target !== 'object') {
      return false;
    }

    const targetKind = target.kind || target.type;

    switch (targetKind) {
      case 'workspace':
        if (target.surface === 'home') {
          handleGoToWorkspaceHome();
          return true;
        }
        handleGoToFileSurface();
        return true;

      case 'agents':
      case 'open_panel':
        if (target.panel && target.panel !== 'mcp') {
          return false;
        }
        if (target.clientId || target.clientLabel || target.client_id || target.client_label) {
          handleOpenMcpClientFromHome({
            client_id: target.clientId || target.client_id || null,
            client_label: target.clientLabel || target.client_label || null,
          });
          return true;
        }
        setMcpPanelOpen(true);
        return true;

      case 'document': {
        const sourcePath = target.sourcePath || target.path || target.entry?.sourcePath || target.entry?.source_path || null;
        if (!sourcePath) {
          focusDocxView({ surface: target.surface === 'home' ? 'home' : 'file' });
          return true;
        }
        return handleOpenDocumentFromHome(
          target.entry || (sourcePath ? { sourcePath, source_path: sourcePath } : null),
        );
      }

      case 'focus_document': {
        const sourcePath = target.sourcePath || target.path || null;
        if (!sourcePath) {
          focusDocxView({ surface: target.surface === 'home' ? 'home' : 'file' });
          return true;
        }
        return handleOpenDocumentFromHome({ sourcePath, source_path: sourcePath });
      }

      case 'template': {
        return handleOpenTemplateFromHome({
          ...target,
          sourcePath: target.sourcePath || target.path || null,
        });
      }

      case 'code':
      case 'navigate_code':
        return handleNavigateToCode({
          filePath: target.filePath || target.path || null,
          cellId: target.cellId || null,
          cellIndex: Number.isInteger(target.cellIndex) ? target.cellIndex : null,
          line: Number.isInteger(target.line) ? target.line : null,
          column: Number.isInteger(target.column) ? target.column : null,
          symbol: target.symbol || null,
        });

      case 'file':
      case 'open_resource':
      default: {
        const path = target.path || target.filePath || target.sourcePath || null;
        if (!path) {
          return false;
        }
        const openedFile = await openWorkspaceResource({
          path,
          name: getPathBasename(path) || path,
        });
        return Boolean(openedFile?.path);
      }
    }
  }, [
    focusDocxView,
    handleGoToFileSurface,
    handleGoToWorkspaceHome,
    handleOpenMcpClientFromHome,
    handleNavigateToCode,
    handleOpenDocumentFromHome,
    handleOpenTemplateFromHome,
    openWorkspaceResource,
  ]);

  // Reattach persistent template when kernel changes (restart/reconnect).
  useEffect(() => {
    const kid = notebookKernelState.kernelId;
    if (!(kid && activeNotebookTransportPath && activeNotebookConnectionStatus === 'connected' && activeNotebookTemplateBlob)) {
      return;
    }

    let attachKey = null;
    let payload = null;

    if (activeNotebookTemplateBlob.templateToken) {
      attachKey = `token:${activeNotebookTemplateBlob.templateToken}`;
      payload = {
        type: 'template_attach',
        kernel_id: kid,
        template_token: activeNotebookTemplateBlob.templateToken,
        path: activeNotebookTransportPath,
      };
    } else if (activeNotebookTemplateBlob.legacyBase64) {
      attachKey = `legacy:${activeNotebookTemplateBlob.legacyBase64.length}`;
      payload = {
        type: 'template_upload',
        kernel_id: kid,
        docx_base64: activeNotebookTemplateBlob.legacyBase64,
        path: activeNotebookTransportPath,
      };
    } else if (typeof activeNotebookTemplateBlob === 'string') {
      // Backward compatibility for previous app state shape.
      attachKey = `legacy-string:${activeNotebookTemplateBlob.length}`;
      payload = {
        type: 'template_upload',
        kernel_id: kid,
        docx_base64: activeNotebookTemplateBlob,
        path: activeNotebookTransportPath,
      };
    }

    if (!payload || !attachKey) {
      return;
    }

    const last = activeNotebookSession.lastTemplateAttach;
    if (last?.kernelId === kid && last?.attachKey === attachKey) {
      return;
    }

    updateNotebookSession(activeNotebookTransportPath, (previous) => ({
      ...previous,
      lastTemplateAttach: { kernelId: kid, attachKey },
    }));
    sendActiveNotebookMessage(payload);
  }, [
    activeNotebookConnectionStatus,
    activeNotebookSession.lastTemplateAttach,
    activeNotebookTemplateBlob,
    activeNotebookTransportPath,
    notebookKernelState.kernelId,
    sendActiveNotebookMessage,
    updateNotebookSession,
  ]);

  // Derived State
  const codePanelStyleWidth = getPrimarySplitWidthStyle(codePanelWidth, isVizCollapsed);
  const codeVisualizationPanelStyleWidth = getVisualizationSplitWidthStyle(codePanelWidth, isVizCollapsed);
  const notebookPanelStyleWidth = getPrimarySplitWidthStyle(notebookPanelWidth, isVizCollapsed);
  const notebookVisualizationPanelStyleWidth = getVisualizationSplitWidthStyle(notebookPanelWidth, isVizCollapsed);

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Conectado';
      case 'connecting': return 'Conectando...';
      case 'disconnected': return 'Sin conexión';
      default: return 'Desconocido';
    }
  };

  const connectionStatusText = getConnectionStatusText();
  const workspaceHomeData = useMemo(() => buildWorkspaceHomeData({
    summary: homeSummary,
    workspacePath: workspaceSession.activeWorkspace
      || currentWorkspace
      || workspaceSession.workspaceRoot
      || workspaceSession.workspacePath
      || '',
    mirrorEnabled,
    mcpStatus,
    homeSummaryError,
    notebookSessionsByPath,
  }), [
    currentWorkspace,
    homeSummary,
    homeSummaryError,
    mcpStatus,
    mirrorEnabled,
    notebookSessionsByPath,
    workspaceSession.activeWorkspace,
    workspaceSession.workspacePath,
    workspaceSession.workspaceRoot,
  ]);

  const handleNotebookBatchExecutionEvent = useCallback((event) => {
    if (!event?.status) {
      return;
    }

    const targetPath = event?.path || activeFile?.path || null;

    if (event.status === 'completed') {
      notifyNotebookBatchCompleted(targetPath, {
        executed: event.executed ?? 0,
        total: event.total ?? 0,
        runId: event.runId ?? null,
      });
      return;
    }

    notifyNotebookBatchFailed(targetPath, {
      error: event.error || 'La ejecucion del notebook no pudo completarse.',
      runId: event.runId ?? null,
      total: event.total ?? 0,
    });
  }, [activeFile?.path, notifyNotebookBatchCompleted, notifyNotebookBatchFailed]);

  const notebookToolbarProps = !showProjectLauncher && workspaceSurface === 'file' && mode === 'notebook'
    ? {
      kernelId: notebookKernelState.kernelId,
      kernelInterrupted: notebookKernelState.kernelInterrupted,
      isExecuting: notebookKernelState.isExecuting,
      hasNotebook: notebookKernelState.hasNotebook,
      connectionStatus,
      onAddCode: () => notebookActionsRef.current?.addCode?.(),
      onAddMarkdown: () => notebookActionsRef.current?.addMarkdown?.(),
      onExecuteAll: handleExecuteNotebookBatch,
      onInterrupt: () => notebookActionsRef.current?.interrupt?.(),
      onReset: () => notebookActionsRef.current?.reset?.(),
      onShutdown: () => notebookActionsRef.current?.shutdown?.(),
      onClearOutputs: () => notebookActionsRef.current?.clearOutputs?.(),
      onSave: () => { void handleSaveActive(); },
      onLoad: (event) => notebookActionsRef.current?.load?.(event),
      autoDocEnabled: nbAutoDocEnabled,
      onToggleAutoDoc: setNbAutoDocEnabled,
      autoSaveEnabled,
      onToggleAutoSave: () => setAutoSaveEnabled((value) => !value),
      trustHtml: nbTrustHtml,
      onToggleTrustHtml: setNbTrustHtml,
      enableTracing: nbEnableTracing,
      onToggleTracing: setNbEnableTracing,
      docxValidationEnabled: nbDocxValidationEnabled,
      onToggleDocxValidation: setNbDocxValidationEnabled,
    }
    : null;

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="loading-spinner small">Cargando interfaz...</div>}>
        <div className="App">
          <DesktopTitleBar
            isDesktop={isDesktopShell}
            showProjectLauncher={showProjectLauncher}
            isWorkspaceHome={showWorkspaceHome}
            workspaceName={(workspaceSession.activeWorkspace || currentWorkspace || '').split(/[\\/]/).pop() || 'Espacio de trabajo'}
            mode={mode}
            hasContextualFile={workspaceSurface === 'file' && Boolean(activeFile?.path)}
            hasOpenFiles={openFiles.length > 0}
            connectionStatus={connectionStatus}
            connectionStatusText={connectionStatusText}
            notifications={notifications}
            onDismissNotification={dismissNotification}
            onDismissAllNotifications={dismissAllNotifications}
            onNavigate={dispatchNotificationTarget}
            mcpStatus={mcpStatus}
            mcpRunningCount={mcpRunningCount}
            mirrorEnabled={mirrorEnabled}
            onToggleMirror={toggleMirrorEnabled}
            onToggleMcpPanel={() => setMcpPanelOpen((value) => !value)}
            onMcpQuickAction={handleMcpQuickAction}
            onGoHome={handleGoToWorkspaceHome}
            onGoToFileSurface={handleGoToFileSurface}
            notebookToolbarProps={notebookToolbarProps}
            onExecuteCode={() => handleExecuteCode(code, activeFile?.path || null)}
            isCodeExecuting={isExecuting}
          />

          <div className="main-layout">
            {!showProjectLauncher && (
              <>
                <div
                  ref={leftSidebarShellRef}
                  className={`left-sidebar-shell${explorerCollapsed ? ' is-collapsed' : ''}`}
                  style={explorerCollapsed ? undefined : { width: `${explorerWidthPx}px` }}
                >
                  <div className="left-sidebar-shell__rail" aria-label="Secciones laterales">
                    <button
                      type="button"
                      className={`left-sidebar-shell__rail-button${leftSidebarView === 'explorer' ? ' is-active' : ''}`}
                      aria-label="Explorador de archivos"
                      title="Explorador de archivos"
                      onClick={() => handleLeftSidebarSectionSelect('explorer')}
                    >
                      <ExplorerIconSidebar />
                    </button>
                    <button
                      type="button"
                      className={`left-sidebar-shell__rail-button${leftSidebarView === 'notebook_index' ? ' is-active' : ''}`}
                      aria-label="Indice de notebook"
                      title="Indice de notebook"
                      onClick={() => handleLeftSidebarSectionSelect('notebook_index')}
                    >
                      <ExplorerIconNotebookIndex />
                    </button>
                  </div>

                  {!explorerCollapsed && (
                    <div className="left-sidebar-shell__content">
                      {leftSidebarView === 'explorer' ? (
                        <div className="left-sidebar-shell__explorer">
                          <FileExplorer
                            onFileOpen={openWorkspaceResource}
                            onOpenDefaultApplication={openWithDefaultApplication}
                            onWorkspaceChange={handleWorkspaceChange}
                            onWorkspaceInfoChange={handleWorkspaceInfoChange}
                            onPathRenamed={renameOpenFile}
                            onPathDeleted={closeWorkspacePath}
                            onStatusMessage={handleStatusMessage}
                            currentWorkspace={currentWorkspace}
                            activeFilePath={activeFile?.path || null}
                            modifiedFiles={modifiedFiles}
                            externalStalePaths={externalStaleFiles}
                            externalConflictPaths={externalConflictFiles}
                            lastWorkspaceEvent={lastWorkspaceFsEvent}
                            widthPx={leftSidebarPanelWidth}
                            refreshToken={fileExplorerRefreshToken}
                            isCollapsed={false}
                            onToggleCollapse={() => setExplorerCollapsed((prev) => !prev)}
                          />
                        </div>
                      ) : (
                        <div className="left-sidebar-shell__index">
                          <NotebookIndexPanel
                            notebook={notebookIndexNotebook}
                            notebookPath={notebookIndexNotebookPath}
                            activeCellId={notebookIndexActiveCellId}
                            onToggleCollapse={() => setExplorerCollapsed((prev) => !prev)}
                            onNavigate={handleNavigateToCode}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!explorerCollapsed && (
                  <Resizer
                    direction="horizontal"
                    onResize={handleExplorerResize}
                    onResizeStart={beginExplorerResize}
                    onResizeEnd={commitActiveResize}
                    ariaLabel="Redimensionar explorador de archivos"
                    testId="shell-resizer-explorer"
                  />
                )}
              </>
            )}

            <div className={`content-area${showProjectLauncher ? ' launcher-mode' : ''}${showWorkspaceHome ? ' home-mode' : ''}`}>
              {showProjectLauncher ? (
                <div className="launcher-stage scroll-surface">
                  <ProjectLauncher
                    isLoading={workspaceSession.isLoading}
                    isBusy={workspaceActionPending}
                    busyLabel={workspaceActionLabel}
                    errorMessage={workspaceSession.error}
                    suggestedWorkspaceRoot={workspaceSession.suggestedWorkspaceRoot}
                    recentWorkspaces={workspaceSession.recentWorkspaces}
                    onCreateProject={handleCreateProjectRequest}
                    onStartWithAgent={handleStartWithAgentRequest}
                    onStartFromExample={handleStartFromExampleRequest}
                    onOpenWorkspace={handleOpenWorkspaceRequest}
                    onOpenRecentWorkspace={handleWorkspaceSelect}
                  />
                </div>
              ) : showWorkspaceHome ? (
                <div className="workspace-home-stage scroll-surface">
                  <AgentWorkspaceHome
                    workspaceData={workspaceHomeData}
                    onOpenFile={openWorkspaceResource}
                    onOpenNotebook={openWorkspaceResource}
                    onOpenDocument={openWorkspaceDocumentFromHome}
                    onOpenTemplate={handleOpenTemplateFromHome}
                    onStartAgents={() => handleMcpQuickAction('start')}
                    onStopAgents={() => handleMcpQuickAction('stop')}
                    onRestartAgents={() => handleMcpQuickAction('restart')}
                    onToggleMirror={toggleMirrorEnabled}
                    onOpenAgentsPanel={handleOpenMcpClientFromHome}
                    onGoToFileSurface={handleGoToFileSurface}
                  />
                </div>
              ) : (
                <>
                  <FileTabs
                    openFiles={openFiles}
                    activeFile={activeFile}
                    onFileSelect={selectWorkspaceResource}
                    onFileClose={closeWorkspaceFile}
                    onFileSave={saveFile}
                    modifiedFiles={modifiedFiles}
                    onDrop={handleFileDrop}
                  />

                  <div className="main-container" ref={mainContainerRef}>
                {unsupportedFilePrompt ? (
                  <div className="unsupported-file-state" role="status" aria-live="polite">
                    <div className="unsupported-file-state__icon">
                      <ExplorerIconSidebar />
                    </div>
                    <h2>{unsupportedFilePrompt.name || 'Archivo no soportado'}</h2>
                    <p>Inspyro no puede abrir este archivo en el editor interno.</p>
                    {unsupportedFilePrompt.message && (
                      <p className="unsupported-file-state__detail">{unsupportedFilePrompt.message}</p>
                    )}
                    <button
                      type="button"
                      className="unsupported-file-state__button"
                      onClick={() => void openWithDefaultApplication(unsupportedFilePrompt)}
                    >
                      Abrir con aplicacion por defecto
                    </button>
                  </div>
                ) : mode === 'code' ? (
                  <>
                    <div ref={codePanelRef} className="code-panel" style={{ width: codePanelStyleWidth }}>
                      <div className="editor-container">
                        <MonacoEditor
                          value={code}
                          onChange={setCode}
                          language="python"
                          highlightLine={
                            codeNavigationTarget
                            && normalizeComparablePath(codeNavigationTarget.filePath) === normalizeComparablePath(activeFile?.path)
                              ? codeNavigationTarget.line
                              : null
                          }
                          highlightColumn={
                            codeNavigationTarget
                            && normalizeComparablePath(codeNavigationTarget.filePath) === normalizeComparablePath(activeFile?.path)
                              ? codeNavigationTarget.column
                              : null
                          }
                          onShowDependencyTree={handleShowCodeDependencyTree}
                        />
                      </div>
                      <div className="output-container scroll-surface">
                        <pre className="output-stdout">{output}</pre>
                      </div>
                    </div>

                    {!isVizCollapsed && (
                      <Resizer
                        direction="horizontal"
                        onResize={handleResize}
                        onResizeStart={() => beginSplitResize('code')}
                        onResizeEnd={commitActiveResize}
                        testId="shell-resizer-code-viz"
                        ariaLabel="Redimensionar panel de visualización"
                      />
                    )}

                    <VisualizationPanel
                      panelRef={codeVisualizationPanelRef}
                      style={{ width: codeVisualizationPanelStyleWidth }}
                      documentState={editorDocumentState}
                      documentActions={editorDocumentActions}
                      variables={editorExecutionData.variables}
                      isCollapsed={isVizCollapsed}
                      onToggleCollapse={() => setIsVizCollapsed(prev => !prev)}
                      dependencyProps={activeDependencyTarget ? {
                        dependencyTarget: activeDependencyTarget,
                        filePath: activeFile?.path,
                        kernelId: null,
                        sendMessage,
                        lastMessage,
                        onCloseDependency: () => setDependencyTarget(null),
                        onNavigateToCode: handleNavigateToCode
                      } : null}
                      onRequestDependencyAnalysis={(request) => {
                        if (request?.symbol) {
                          handleShowCodeDependencyTree(request);
                          return;
                        }
                      }}
                      onNavigateToCode={handleNavigateToCode}
                      requestedView={visualizationViewRequest}
                      onDocumentVisibilityChange={handleDocumentVisibilityChange}
                      templateOpenRequest={null}
                      onTemplateOpenHandled={() => {}}
                    />
                  </>
                ) : (
                  <div className="notebook-container" ref={notebookSplitContainerRef}>
                    <div ref={notebookPanelRef} className="notebook-panel" style={{ width: notebookPanelStyleWidth }}>
                      <NotebookEditor
                        connectionStatus={activeNotebookConnectionStatus}
                        sendMessage={sendActiveNotebookMessage}
                        lastMessage={activeNotebookLastMessage}
                        preferShellMessageRelay
                        initialNotebook={activeNotebookInitialData}
                        initialNotebookOrigin={activeRuntimeNotebook ? 'runtime' : notebookSyncState.origin}
                        initialNotebookToken={activeNotebookInitialToken}
                        initialKernelId={notebookKernelState.kernelId}
                        shellBatchRunState={activeNotebookSession.batchRunState}
                        filePath={activeFile?.path}
                        autoSaveEnabled={autoSaveEnabled}
                        onToggleAutoSave={() => setAutoSaveEnabled((v) => !v)}
                        actionsRef={notebookActionsRef}
                        onKernelStateChange={handleActiveNotebookKernelStateChange}
                        externalAutoDocEnabled={nbAutoDocEnabled}
                        onAutoDocChange={setNbAutoDocEnabled}
                        externalTrustHtml={nbTrustHtml}
                        onTrustHtmlChange={setNbTrustHtml}
                        externalEnableTracing={nbEnableTracing}
                        onEnableTracingChange={setNbEnableTracing}
                        externalDocxValidationEnabled={nbDocxValidationEnabled}
                        onDocxValidationChange={setNbDocxValidationEnabled}
                        onStatusMessage={handleStatusMessage}
                        onSelectedCellChange={handleActiveNotebookSelectionChange}
                        onClearRuntimeData={clearNotebookRuntimeData}
                        onBatchExecutionEvent={handleNotebookBatchExecutionEvent}
                        onPendingExecutionRequestChange={handlePendingNotebookExecutionRequestChange}
                        onNotebookChange={(data, notebookFilePath, changeMeta) => {
                          if (!notebookFilePath || notebookFilePath !== activeFile?.path) {
                            appLogger.warn('onNotebookChange IGNORED - filePath mismatch:', {
                              receivedPath: notebookFilePath,
                              activeFilePath: activeFile?.path
                            });
                            return;
                          }
                          if (changeMeta && changeMeta.persistable === false) {
                            setNotebookRuntimeSnapshot(notebookFilePath, data);
                            return;
                          }
                          setNotebookRuntimeSnapshot(notebookFilePath, data);
                          setNotebookData(data, {
                            origin: 'persistable',
                            path: notebookFilePath,
                          });
                        }}
                        onVisualizationData={(data) => {
                          setNotebookExecutionData(prev => {
                            const safeData = data || {};
                            const nextSourcePath = safeData.sourcePath || activeFile?.path || prev.docxSourcePath || null;
                            const nextSourceKind = safeData.sourceKind || inferDocxSourceKind(nextSourcePath);
                            const nextDocumentState = applyDocumentStatePayload(prev, safeData, {
                              sourcePath: nextSourcePath,
                              sourceKind: nextSourceKind,
                              docxEventId: safeData.docxEventId || safeData.docx_event_id || `docx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                              docxUpdatedAt: safeData.docxUpdatedAt || safeData.docx_updated_at || safeData.updatedAt || safeData.updated_at || Date.now(),
                            });
                            return {
                              ...nextDocumentState,
                              variables: Object.prototype.hasOwnProperty.call(safeData, 'variables')
                                ? (safeData.variables || {})
                                : prev.variables,
                            };
                          });
                        }}
                        onDependencyTargetChange={handleNotebookDependencyTargetChange}
                        agentExecutionState={agentExecutionState}
                      />
                    </div>

                    {!isVizCollapsed && (
                      <Resizer
                        direction="horizontal"
                        onResize={handleResize}
                        onResizeStart={() => beginSplitResize('notebook')}
                        onResizeEnd={commitActiveResize}
                        ariaLabel="Redimensionar panel de visualización"
                      />
                    )}

                    <VisualizationPanel
                        panelRef={notebookVisualizationPanelRef}
                        style={{ width: notebookVisualizationPanelStyleWidth }}
                        documentState={notebookDocumentState}
                        documentActions={notebookDocumentActions}
                        variables={notebookExecutionData.variables}
                        isCollapsed={isVizCollapsed}
                        onToggleCollapse={() => setIsVizCollapsed(prev => !prev)}
                        dependencyProps={activeDependencyTarget ? {
                          dependencyTarget: activeDependencyTarget,
                          filePath: activeFile?.path,
                          kernelId: notebookKernelState.kernelId,
                          sendMessage,
                          lastMessage,
                          onCloseDependency: () => setDependencyTarget(null),
                          onNavigateToCode: handleNavigateToCode
                        } : null}
                        onRequestDependencyAnalysis={(request) => {
                          if (request?.symbol) {
                            handleManualNotebookDependencyAnalysis(request);
                            return;
                          }
                        }}
                        onNavigateToCode={handleNavigateToCode}
                        kernelId={notebookKernelState.kernelId}
                        sendMessage={sendActiveNotebookMessage}
                        lastMessage={activeNotebookLastMessage}
                        templateInfo={activeNotebookTemplateInfo}
                        onTemplateChange={(nextTemplateInfo) => {
                          if (!activeNotebookTransportPath) {
                            return;
                          }
                          updateNotebookSession(activeNotebookTransportPath, (previous) => ({
                            ...previous,
                            templateInfo: nextTemplateInfo,
                          }));
                        }}
                        onTemplateUpload={(nextTemplateBlob) => {
                          if (!activeNotebookTransportPath) {
                            return;
                          }
                          updateNotebookSession(activeNotebookTransportPath, (previous) => ({
                            ...previous,
                            templateBlob: nextTemplateBlob,
                            lastTemplateAttach: null,
                          }));
                        }}
                        onDocumentVisibilityChange={handleDocumentVisibilityChange}
                        templateOpenRequest={activeNotebookTemplateOpenRequest}
                        onTemplateOpenHandled={(token) => {
                          if (!activeNotebookTransportPath) {
                            return;
                          }
                          updateNotebookSession(activeNotebookTransportPath, (previous) => (
                            previous.templateOpenRequest?.token === token
                              ? {
                                ...previous,
                                templateOpenRequest: null,
                              }
                              : previous
                          ));
                        }}
                        onRequestKernelStart={handleRequestActiveNotebookKernelStart}
                        requestedView={visualizationViewRequest}
                      />
                  </div>
                )}
                  </div>
                </>
              )}
            </div>
          </div>
          <FolderSelector
            isOpen={showWorkspaceSelector}
            onClose={handleWorkspaceSelectorClose}
            onSelect={handleWorkspaceSelect}
            onCreateWorkspace={handleWorkspaceCreate}
            initialPath={workspacePickerStartPath}
          />
        </div>
      </Suspense>
      <McpPanel
        isOpen={mcpPanelOpen}
        onClose={() => {
          setMcpPanelOpen(false);
          setMcpClientFilter(null);
        }}
        mcpStatus={mcpStatus}
        onStatusChange={setMcpStatus}
        activity={mcpActivity}
        activeRuns={mcpActiveRuns}
        runningCount={mcpRunningCount}
        mirrorEnabled={mirrorEnabled}
        onToggleMirror={toggleMirrorEnabled}
        onQuickAction={handleMcpQuickAction}
        clientFilter={mcpClientFilter}
        onClearClientFilter={handleClearMcpClientFilter}
      />
    </ErrorBoundary>
  );
}

export default App;
