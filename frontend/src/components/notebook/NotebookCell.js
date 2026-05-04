import React, { useState, useEffect, useRef, lazy } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import OutputRenderer from '../OutputRenderer';
import DropdownMenu from '../DropdownMenu';
import { createFrontendLogger } from '../../utils/frontendLogger';
import {
    isDocxCell as isDocxNotebookCell,
    isMarkdownCell as isMarkdownNotebookCell,
    isPythonNotebookCell,
    normalizeNotebookCellType,
} from '../../utils/notebookCellTypes';
import '../NotebookEditor.css';
import {
    IconPlay,
    IconCode,
    IconText,
    IconDocx,
    IconChevronUp,
    IconChevronDown,
    IconTrash,
    IconCheck,
    IconMenu,
    IconMinus,
    IconSquare
} from '../Icons';

// Lazy load de MonacoEditor para no penalizar el chunk de NotebookCell
const MonacoEditor = lazy(() => import('../MonacoEditor'));
const logger = createFrontendLogger('NotebookCell');

const resolveExecutionDurationMs = (cell) => {
    const directDuration = cell?.metadata?.execution_duration_ms ?? cell?.metadata?.execution_duration;
    const numericDuration = Number(directDuration);
    if (Number.isFinite(numericDuration) && numericDuration >= 0) {
        return numericDuration;
    }

    const startedAt = cell?.metadata?.execution?.shell?.execute_reply?.started;
    const endedAt = cell?.metadata?.execution?.shell?.execute_reply?.end;
    if (startedAt && endedAt) {
        const diff = new Date(endedAt).getTime() - new Date(startedAt).getTime();
        if (Number.isFinite(diff) && diff >= 0) {
            return diff;
        }
    }

    return null;
};

const formatExecutionDuration = (durationMs) => {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        return null;
    }

    return `${(Math.round(durationMs / 100) / 10).toFixed(1)}s`;
};

const readMimeBundle = (output) => (
    output && output.data && typeof output.data === 'object' && !Array.isArray(output.data)
        ? output.data
        : {}
);

const classifyOutput = (output) => {
    if (!output) return null;
    if (output.output_type === 'error') return 'error';
    if (output.output_type === 'stream') return output.name === 'stderr' ? 'stderr' : 'stdout';
    const data = readMimeBundle(output);
    if (data['text/html']) return 'tabla/html';
    if (data['application/vnd.plotly.v1+json']) return 'plotly';
    if (data['application/vnd.vega.v5+json'] || data['application/vnd.vega-lite.v5+json']) return 'vega';
    if (data['image/png'] || data['image/jpeg'] || data['image/gif'] || data['image/webp'] || data['image/svg+xml']) return 'imagen';
    if (data['text/latex']) return 'latex';
    if (data['application/json']) return 'json';
    if (data['application/pdf']) return 'pdf';
    if (data['application/vnd.jupyter.widget-view+json']) return 'widget';
    if (data['text/markdown']) return 'markdown';
    if (data['text/plain']) return 'texto';
    return output.output_type || 'output';
};

const buildOutputBadges = (outputs = []) => {
    const labels = [];
    outputs.forEach((output) => {
        const label = classifyOutput(output);
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    });
    return labels.slice(0, 4);
};

const buildCompactOutputBadges = (outputs = []) => {
    const labels = buildOutputBadges(outputs);
    if (labels.length <= 1) {
        return labels;
    }
    return [`+${labels.length} tipos`];
};

const formatOutputCount = (count) => {
    if (!count) return 'sin resultados';
    return count === 1 ? '1 resultado' : `${count} resultados`;
};


const NotebookCellBase = ({
    cell,
    onExecute,
    onUpdate,
    onDelete,
    onMoveUp,
    onMoveDown,
    isExecuting = false,
    hasExecutionLock = false,
    isActive = false,
    isSelected = false,
    onSelect = null,
    onDeselect = null, // New prop
    trustHtml = false,
    precedingCells = [],  // Celdas anteriores para contexto LSP
    cellIndex = 0,        // Índice de la celda actual
    notebookPath = null,  // Path del notebook para URI estable
    highlightLine = null, // Línea a resaltar (navegación desde grafo)
    highlightColumn = null, // Columna a resaltar (navegación desde grafo)
    docxExecutionEnabled = true,
    onShowDependencyTree = null  // Callback para mostrar árbol de dependencias
}) => {
    const cellType = normalizeNotebookCellType(cell.cell_type);
    const isDocxCell = isDocxNotebookCell(cell);
    const isMarkdownCell = isMarkdownNotebookCell(cell);
    const isPythonCell = isPythonNotebookCell(cell);
    const isDocxExecutionBlocked = isDocxCell && !docxExecutionEnabled;

    // Ref para trackear el cell.id actual y detectar cambios de celda
    const cellIdRef = useRef(cell.id);
    const cellTypeRef = useRef(cellType);

    // View Mode State: 'minimized' | 'medium' | 'expanded'
    const [viewMode, setViewMode] = useState(() => (isPythonCell ? 'minimized' : 'medium'));

    // Función helper para convertir source array a string
    const sourceToString = (sourceArray) => {
        if (!Array.isArray(sourceArray)) return sourceArray || '';
        // Manejar formato ipynb (líneas terminan en \n) y formato interno (sin \n)
        return sourceArray.map(line => line.endsWith('\n') ? line.slice(0, -1) : line).join('\n');
    };

    const [source, setSource] = useState(() => sourceToString(cell.source));
    const [isEditing, setIsEditing] = useState(isPythonCell);
    const canRenderMarkdown = isMarkdownCell && isEditing;

    // Live execution timer
    const [executionTimer, setExecutionTimer] = useState(0);
    const executionIntervalRef = useRef(null);

    useEffect(() => {
        if (isExecuting && isPythonCell) {
            setExecutionTimer(0);
            executionIntervalRef.current = setInterval(() => {
                setExecutionTimer(prev => prev + 100); // Update every 100ms
            }, 100);
        } else {
            if (executionIntervalRef.current) {
                clearInterval(executionIntervalRef.current);
                executionIntervalRef.current = null;
            }
        }
        return () => {
            if (executionIntervalRef.current) clearInterval(executionIntervalRef.current);
        };
    }, [isExecuting, isPythonCell]);

    // Format timer to 1 decimal place seconds (e.g. 1.2s)
    const formattedTimer = (executionTimer / 1000).toFixed(1);

    // Keep local editor state aligned with remote notebook snapshots for the same cell.
    useEffect(() => {
        const nextSource = sourceToString(cell.source);
        const isNewCell = cellIdRef.current !== cell.id;
        const cellTypeChanged = cellTypeRef.current !== cellType;

        if (isNewCell) {
            cellIdRef.current = cell.id;
        }

        if (cellTypeChanged) {
            cellTypeRef.current = cellType;
        }

        if (isNewCell || nextSource !== source) {
            setSource(nextSource);
        }

        if (isNewCell || cellTypeChanged) {
            setIsEditing(isPythonCell);
            if (isPythonCell) {
                setViewMode('minimized');
            }
        }
    }, [cell.id, cell.source, cellType, isPythonCell, source]);

    useEffect(() => {
        if (isPythonCell && (highlightLine || highlightColumn)) {
            setViewMode('expanded');
        }
    }, [highlightColumn, highlightLine, isPythonCell]);

    const handleSourceChange = (newSource) => {
        setSource(newSource);
        onUpdate(cell.id, newSource.split('\n'));
    };

    // Ref para debounce de ejecución
    const executeDebounceRef = useRef(false);

    const handlePrimaryAction = (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        if (canRenderMarkdown) {
            setIsEditing(false);
            return;
        }

        // Debounce: evitar múltiples clicks rápidos
        if (executeDebounceRef.current) {
            logger.warn('Execute debounced for cell:', cell.id);
            return;
        }

        if (isPythonCell) {
            if (isDocxExecutionBlocked) {
                return;
            }
            logger.info('Execute triggered for cell:', cell.id, 'isActive:', isActive, 'isExecuting:', isExecuting);
            executeDebounceRef.current = true;
            onExecute(cell.id, source.split('\n'));

            // Reset debounce después de 500ms
            setTimeout(() => {
                executeDebounceRef.current = false;
            }, 500);
        }
    };

    const toggleCellType = () => {
        const newType = isMarkdownCell ? 'code' : 'markdown';
        onUpdate(cell.id, source.split('\n'), newType);
    };

    const toggleDocxCellType = (e) => {
        e.stopPropagation();
        const newType = isDocxCell ? 'code' : 'docx';
        onUpdate(cell.id, source.split('\n'), newType);
    };

    // Calculate Editor Height based on View Mode
    const getEditorHeight = () => {
        const effectiveMode = viewMode;

        if (effectiveMode === 'minimized') return 0;

        // 2. Estimate content height
        const lineCount = source.split('\n').length;
        const lineHeight = 19; // Approx monaco line height (default is usually 18-20px)
        const padding = 20;
        const contentHeight = (lineCount * lineHeight) + padding;

        // 3. Define max limits per mode
        const limits = {
            minimized: 0,
            medium: 380,   // ~20 lines
            expanded: 1350 // ~70 lines (70 * 19px)
        };

        // 4. Calculate final height
        // It should be the content height, but clamped by the mode's max limit.
        const modeLimit = limits[effectiveMode] || limits.medium;

        // Ensure we don't show a huge empty box for short code, 
        // but also respect the max limit of the mode.
        return Math.min(contentHeight, modeLimit);
    };

    const renderOutput = () => {
        if (!cell.outputs || cell.outputs.length === 0) return null;
        const outputCount = cell.outputs.length;
        const outputBadges = buildOutputBadges(cell.outputs);
        return (
            <div className="cell-output">
                <div className="output-header">
                    <div className="output-header__meta">
                        <span className="output-header__count">{formatOutputCount(outputCount)}</span>
                    </div>
                    <div className="output-header__secondary">
                        {outputBadges.map((label) => (
                            <span key={label} className="output-badge">{label}</span>
                        ))}
                        <button
                            className="copy-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                try {
                                    const textToCopy = (cell.outputs || []).map(o => JSON.stringify(o, null, 2)).join('\n');
                                    navigator.clipboard.writeText(textToCopy);
                                } catch (err) { /* noop */ }
                            }}
                            title="Copiar output como JSON"
                            aria-label="Copiar output como JSON"
                        >JSON</button>
                    </div>
                </div>
                {cell.outputs.map((output, index) => (
                    <div key={index} className={`output-item output-${output.output_type || 'unknown'}`}>
                        <OutputRenderer output={output} trustHtml={trustHtml} />
                    </div>
                ))}
            </div>
        );
    };

    const renderMarkdown = () => {
        if (!isMarkdownCell || isEditing) return null;

        return (
            <MarkdownRenderer
                source={source}
                trustHtml={trustHtml}
                onClick={() => setIsEditing(true)}
            />
        );
    };

    // Determine if the cell has an error state from its last execution
    const hasError = isPythonCell && cell.outputs?.some(o => o.output_type === 'error');
    const showRunRail = isPythonCell || canRenderMarkdown;
    const isLockedByAnotherCell = isPythonCell && hasExecutionLock && !isExecuting;
    const lastExecutionDurationText = isPythonCell ? formatExecutionDuration(resolveExecutionDurationMs(cell)) : null;
    const runStatusText = isPythonCell
        ? (isActive && isExecuting ? `${formattedTimer}s` : lastExecutionDurationText)
        : null;
    const runButtonTitle = canRenderMarkdown
        ? 'Renderizar markdown'
        : (isActive && isExecuting
            ? `Ejecutando (${formattedTimer}s)`
            : (isDocxExecutionBlocked ? 'DOCX/PDF desactivado' : (isLockedByAnotherCell ? 'Ejecutar (se encolará)' : 'Ejecutar (Ctrl+Enter)')));
    const runButtonClassName = [
        'cell-run-button',
        canRenderMarkdown ? 'is-markdown' : '',
        isDocxCell ? 'is-docx' : '',
        isDocxExecutionBlocked ? 'is-disabled' : '',
        isExecuting ? 'is-executing' : '',
        isActive ? 'is-active' : '',
    ].filter(Boolean).join(' ');
    const resolvedRunButtonTitle = canRenderMarkdown
        ? runButtonTitle
        : (isActive && isExecuting
            ? runButtonTitle
            : (isDocxExecutionBlocked
                ? 'DOCX/PDF desactivado'
                : (isLockedByAnotherCell
                ? 'Ejecutar (se encolará)'
                : (lastExecutionDurationText ? `Ejecutar (última: ${lastExecutionDurationText})` : runButtonTitle))));

    const lineCount = source ? source.split('\n').length : 0;
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const hasOutputs = outputs.length > 0;
    const quietCollapsedSummary = hasOutputs && !hasError && !isExecuting;
    const collapsedOutputBadges = buildCompactOutputBadges(outputs);
    const hasExecutionCount = cell.execution_count !== null && cell.execution_count !== undefined;
    const collapsedExecutionCountText = hasExecutionCount ? `[${cell.execution_count}]` : null;
    const collapsedDurationText = isActive && isExecuting ? `${formattedTimer}s` : lastExecutionDurationText;
    const collapsedStatusText = hasError
        ? 'con error'
        : (isActive && isExecuting ? 'ejecutando' : (hasExecutionCount ? null : 'sin ejecutar'));
    const shouldRenderEditor = !isPythonCell || viewMode !== 'minimized';

    return (
        <div
            className={`notebook-cell cell-kind-${cellType} view-${viewMode} ${viewMode === 'minimized' && isPythonCell ? 'is-code-collapsed' : ''} ${isExecuting ? 'executing' : ''} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${hasError ? 'cell-error-state' : ''}`}
            onClick={(e) => {
                // Stop propagation so the background click handler doesn't catch this and deselect immediately
                e.stopPropagation();
                if (!e.target.closest('.cell-control-btn') && !e.target.closest('.cell-hover-controls') && !e.target.closest('.cell-side-actions') && !e.target.closest('.dropdown-menu-container') && onSelect) {
                    onSelect(cell.id);
                }
            }}
        >
            <div className={`cell-frame ${cellType}-cell`}>
                {showRunRail && (
                    <div className={`cell-side-actions ${isPythonCell ? 'for-code' : 'for-markdown'} ${runStatusText ? 'has-status' : ''}`}>
                        <button
                            onClick={handlePrimaryAction}
                            className={runButtonClassName}
                            title={resolvedRunButtonTitle}
                            aria-label={resolvedRunButtonTitle}
                            disabled={isDocxExecutionBlocked}
                            data-testid={isPythonCell ? 'cell-run-button' : 'cell-render-button'}
                        >
                            {canRenderMarkdown ? <IconCheck /> : <IconPlay />}
                        </button>
                        {runStatusText && (
                            <span className="cell-run-status" aria-live={isActive ? 'polite' : undefined}>
                                {runStatusText}
                            </span>
                        )}
                    </div>
                )}

                {/* Controles flotantes - aparecen al hover */}
                <div className="cell-hover-controls">

                    {/* Quick Toggle Button (Minimize/Maximize) */}
                    {isPythonCell && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (viewMode === 'minimized') {
                                    setViewMode('expanded');
                                } else {
                                    setViewMode('minimized');
                                    if (onDeselect) onDeselect(cell.id);
                                }
                            }}
                            className="cell-control-btn monitor-btn"
                            title={viewMode === 'minimized' ? "Maximizar celda" : "Minimizar celda"}
                        >
                            {viewMode === 'minimized' ? <IconSquare /> : <IconMinus />}
                        </button>
                    )}

                    {/* View Mode Dropdown for Code Cells */}
                    {isPythonCell && (
                        <DropdownMenu
                            icon={<IconMenu />} // Or IconSettings/IconChevronDown
                            title="Vista"
                            className="cell-view-mode-dropdown"
                            options={[
                                {
                                    label: 'Minimizado (Solo barra)',
                                    onClick: () => {
                                        setViewMode('minimized');
                                        if (onDeselect) onDeselect(cell.id);
                                    },
                                    icon: viewMode === 'minimized' ? <IconCheck /> : null
                                },
                                {
                                    label: 'Medio (20 líneas)',
                                    onClick: () => setViewMode('medium'),
                                    icon: viewMode === 'medium' ? <IconCheck /> : null
                                },
                                {
                                    label: 'Expandido (Alto)',
                                    onClick: () => setViewMode('expanded'),
                                    icon: viewMode === 'expanded' ? <IconCheck /> : null
                                }
                            ]}
                        />
                    )}

                    {/* Separador visual */}
                    {isPythonCell && (
                        <button
                            onClick={toggleDocxCellType}
                            className={`cell-control-btn toggle-docx ${isDocxCell ? 'active' : ''}`}
                            title={isDocxCell ? 'Convertir a código Python' : 'Marcar como celda DOCX'}
                            data-testid="cell-toggle-docx"
                        >
                            <IconDocx />
                        </button>
                    )}
                    {isPythonCell && <div className="control-separator" />}
                    {/* Otros controles con colores */}
                    <button onClick={toggleCellType} className="cell-control-btn toggle-type" title={`Cambiar a ${isMarkdownCell ? 'Code' : 'Markdown'}`}>
                        {isMarkdownCell ? <IconCode /> : <IconText />}
                    </button>
                    <button onClick={() => onMoveUp && onMoveUp(cell.id)} className="cell-control-btn move" title="Mover arriba">
                        <IconChevronUp />
                    </button>
                    <button onClick={() => onMoveDown && onMoveDown(cell.id)} className="cell-control-btn move" title="Mover abajo">
                        <IconChevronDown />
                    </button>
                    <button onClick={() => onDelete && onDelete(cell.id)} className="cell-control-btn delete" title="Eliminar celda">
                        <IconTrash />
                    </button>
                </div>

                {/* Indicador de ejecución - solo para código */}
                {isPythonCell && viewMode !== 'minimized' && (
                    <button
                        className="cell-collapse-strip"
                        type="button"
                        title="Minimizar celda"
                        aria-label="Minimizar celda"
                        data-testid="cell-collapse-strip"
                        onClick={(e) => {
                            e.stopPropagation();
                            setViewMode('minimized');
                            if (onDeselect) onDeselect(cell.id);
                        }}
                    >
                        <span className="cell-collapse-strip__line" />
                        <IconChevronUp />
                        <span className="cell-collapse-strip__line" />
                    </button>
                )}

                {
                    isPythonCell && cell.execution_count && (
                        <div className="execution-indicator">[{cell.execution_count}]</div>
                    )
                }

                {/* Contenido de la celda */}
                <div className="cell-content">
                    {(isPythonCell || isEditing) && (
                        <>
                            {isDocxCell && (
                                <div className="docx-cell-chip" data-testid="docx-cell-chip">
                                    <IconDocx />
                                    <span>DOCX</span>
                                </div>
                            )}
                            {/* Minimized bar: source stays hidden until explicit expansion. */}
                            {isPythonCell && viewMode === 'minimized' && (
                                <div
                                    className={`minimized-code-preview ${quietCollapsedSummary ? 'is-quiet' : 'needs-context'}`}
                                    title="Expandir codigo"
                                    role="button"
                                    tabIndex={0}
                                    data-testid="minimized-code-preview"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setViewMode('expanded');
                                        onSelect?.(cell.id);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setViewMode('expanded');
                                            onSelect?.(cell.id);
                                        }
                                    }}
                                >
                                    <div className="minimized-code-preview__main">
                                        <span className={`minimized-code-preview__kind ${isDocxCell ? 'is-docx' : ''}`}>
                                            {isDocxCell ? 'DOCX' : 'PY'}
                                        </span>
                                    </div>
                                    <div className="minimized-code-preview__meta">
                                        {collapsedExecutionCountText && (
                                            <span className="minimized-code-preview__execution-count">{collapsedExecutionCountText}</span>
                                        )}
                                        {collapsedDurationText && (
                                            <span className="minimized-code-preview__duration">{collapsedDurationText}</span>
                                        )}
                                        {collapsedStatusText && <span>{collapsedStatusText}</span>}
                                        {!hasExecutionCount && !isActive && !hasError && (
                                            <span>{lineCount} {lineCount === 1 ? 'linea' : 'lineas'}</span>
                                        )}
                                        <span>{formatOutputCount(outputs.length)}</span>
                                        {collapsedOutputBadges.map((label) => (
                                            <span key={label} className="minimized-code-preview__badge">{label}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Code Editor: Show only when the user explicitly expands it */}
                            {shouldRenderEditor && (
                            <div
                                className="cell-editor-container"
                                style={{ display: (isPythonCell && !isSelected && viewMode === 'minimized') ? 'none' : 'block' }}
                            >
                                <React.Suspense fallback={<div className="cell-loading">Cargando editor...</div>}>
                                    <MonacoEditor
                                        value={source}
                                        onChange={handleSourceChange}
                                        language={isPythonCell ? 'python' : 'markdown'}
                                        height={getEditorHeight()}
                                        minHeight={isPythonCell ? 50 : 180}
                                        notebookContext={isPythonCell ? {
                                            precedingCells,
                                            notebookPath,
                                            cellIndex
                                        } : null}
                                        highlightLine={isPythonCell ? highlightLine : null}
                                        highlightColumn={isPythonCell ? highlightColumn : null}
                                        onShowDependencyTree={isPythonCell && onShowDependencyTree ? (info) => onShowDependencyTree(cell.id, info) : null}
                                        onExecute={isPythonCell ? handlePrimaryAction : null}
                                    />
                                </React.Suspense>
                            </div>
                            )}
                        </>
                    )}

                    {renderMarkdown()}
                </div>
            </div>

            {renderOutput()}
        </div >
    );
};

// Exportar memoizado por defecto
export default React.memo(NotebookCellBase);
