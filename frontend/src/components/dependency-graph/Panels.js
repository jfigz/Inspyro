/**
 * Panels.js - Componentes de panel de información del grafo de dependencias
 */

import React from 'react';
import { NODE_ICONS, NODE_TYPE_LABELS, CATEGORY_COLORS } from './constants';
import { formatRuntimeValue, checkValueInRange } from './utils';
import { formatNodeLocationLabel } from './nodeVisualProfile';

function getRuntimeQuantity(data) {
    const runtime = data.runtime_value || data.runtimeValue;
    if (!runtime || typeof runtime !== 'object') return null;
    if (runtime.type === 'Quantity' || runtime.is_quantity === true) {
        return runtime;
    }
    return null;
}

function InfoRow({ label, children, valueClassName = '' }) {
    if (children === null || children === undefined || children === '') return null;
    return (
        <div className="info-row">
            <span className="info-label">{label}</span>
            <span className={`info-value ${valueClassName}`.trim()}>{children}</span>
        </div>
    );
}

function formatTechnicalCellId(location) {
    if (typeof location?.cell_id !== 'string') return '';
    return location.cell_id.trim();
}

function formatOverviewRelations(data) {
    if (!data?.is_overview_node) return '';
    const parts = [];
    if (Number.isFinite(Number(data.overview_member_count))) {
        parts.push(`${data.overview_member_count} nodos internos`);
    }
    if (Number.isFinite(Number(data.overview_internal_edge_count))) {
        parts.push(`${data.overview_internal_edge_count} aristas internas`);
    }
    return parts.join(' - ');
}

/**
 * Legend - Leyenda de tipos de nodos y categorías de ingeniería
 */
export function Legend() {
    const nodeTypes = [
        { key: 'variable', label: 'Variable' },
        { key: 'function', label: 'Función' },
        { key: 'class', label: 'Clase' },
        { key: 'import', label: 'Import' },
        { key: 'parameter', label: 'Parámetro' },
        { key: 'constant', label: 'Constante' },
        { key: 'check', label: 'Verificación' },
    ];

    const categories = [
        { key: 'material', label: 'Material', ...CATEGORY_COLORS.material },
        { key: 'geometry', label: 'Geometría', ...CATEGORY_COLORS.geometry },
        { key: 'load', label: 'Carga', ...CATEGORY_COLORS.load },
        { key: 'result', label: 'Resultado', ...CATEGORY_COLORS.result },
        { key: 'factor', label: 'Factor', ...CATEGORY_COLORS.factor },
    ];

    return (
        <div className="dependency-legend" data-testid="dependency-graph-legend">
            <h5>Tipos de Nodos</h5>
            {nodeTypes.map(t => (
                <div key={t.key} className="dependency-legend-item">
                    <div className={`dependency-legend-color ${t.key}`}></div>
                    <span>{t.label}</span>
                </div>
            ))}
            <div className="dependency-legend-separator" />
            <h5>Categorías</h5>
            {categories.map(c => (
                <div key={c.key} className="dependency-legend-category">
                    <span className="dependency-legend-category-icon">{c.icon}</span>
                    <div
                        className="dependency-legend-category-dot"
                        style={{ background: c.border }}
                    />
                    <span>{c.label}</span>
                </div>
            ))}
        </div>
    );
}

/**
 * InfoPanel - Panel de información del nodo seleccionado (versión completa)
 */
export function InfoPanel({
    node,
    canNavigate = false,
    onNavigate = null,
    onShowNeighbors = null,
    onShowPath = null,
    onExpandGroup = null,
}) {
    if (!node) return null;

    // Compatibilidad: node puede venir de React Flow (node.data) o D3 (node.data)
    const data = node.data || node;
    const nodeType = data.node_type || data.type || 'unknown';
    const runtimeQuantity = getRuntimeQuantity(data);
    const category = runtimeQuantity?.category || data.category;
    const displayUnit = runtimeQuantity?.unit || data.unit;
    const displayDescription = data.description || runtimeQuantity?.metadata?.description || runtimeQuantity?.description;
    const categoryStyle = category ? CATEGORY_COLORS[category] : null;

    // Formato de valor runtime
    const formattedValue = formatRuntimeValue(data.runtime_value || data.runtimeValue);

    // Estado de rango
    const rangeStatus = formattedValue && data.valid_range
        ? checkValueInRange(formattedValue, data.valid_range)
        : null;
    const canNavigateToNode = Boolean(
        canNavigate &&
        typeof onNavigate === 'function' &&
        data.location &&
        (
            Number(data.location.line) > 0 ||
            Number.isInteger(data.location.cell_index) ||
            (typeof data.location.cell_id === 'string' && data.location.cell_id.trim().length > 0)
        )
    );
    const locationLabel = formatNodeLocationLabel(data.location);
    const technicalCellId = formatTechnicalCellId(data.location);
    const overviewRelations = formatOverviewRelations(data);
    const overviewTypes = Array.isArray(data.overview_member_types)
        ? data.overview_member_types.join(', ')
        : '';
    const overviewFiles = Array.isArray(data.overview_files)
        ? data.overview_files.join(', ')
        : '';
    const codePreview = data.value_preview || data.valuePreview;
    return (
        <div
            className="dependency-info-panel"
            data-testid="dependency-graph-info-panel"
            data-category={category || undefined}
            style={categoryStyle ? { borderLeftColor: categoryStyle.border } : undefined}
        >
            {/* Header con nombre e icono */}
            <h4>
                {(categoryStyle?.icon) || NODE_ICONS[nodeType] || '📦'}{' '}
                {data.name || data.label}
                {displayUnit && <span className="info-unit">[{displayUnit}]</span>}
            </h4>

            <div className="dependency-info-panel-grid">
                <section className="dependency-info-section">
                    <h5>Resumen</h5>
                    <InfoRow label="Rol">{NODE_TYPE_LABELS[nodeType] || nodeType}</InfoRow>
                    <InfoRow label="Categoria" valueClassName="info-value-category">
                        {category ? `${category.charAt(0).toUpperCase()}${category.slice(1)}${data.category_inferred ? ' (inferida)' : ''}` : ''}
                    </InfoRow>
                    <InfoRow label="Proposito">{displayDescription}</InfoRow>
                    <InfoRow label="Valor" valueClassName="info-value-result">
                        {formattedValue ? `= ${formattedValue}` : ''}
                    </InfoRow>
                    <InfoRow label="Rango">
                        {data.valid_range ? `[${data.valid_range[0] ?? '-inf'}, ${data.valid_range[1] ?? 'inf'}]` : ''}
                    </InfoRow>
                    {data.is_check && (
                        <InfoRow label="Verificacion" valueClassName={`check-result ${data.check_result === true ? 'pass' : data.check_result === false ? 'fail' : 'pending'}`}>
                            {data.check_result === true && 'PASS'}
                            {data.check_result === false && 'FAIL'}
                            {data.check_result === null && 'Pendiente'}
                        </InfoRow>
                    )}
                    <InfoRow label="Mensaje">{data.check_message}</InfoRow>
                </section>

                <section className="dependency-info-section">
                    <h5>Relaciones</h5>
                    <InfoRow label="Grupo">{overviewRelations}</InfoRow>
                    <InfoRow label="Top miembros">{data.overview_member_preview}</InfoRow>
                    <InfoRow label="Tipos">{overviewTypes}</InfoRow>
                    <InfoRow label="Archivos">{overviewFiles}</InfoRow>
                    {!data.is_overview_node && (
                        <div className="info-muted">
                            Usa Ver vecinos o Ver camino para reducir el grafo sin perder contexto.
                        </div>
                    )}
                </section>

                <section className="dependency-info-section">
                    <h5>Origen</h5>
                    <InfoRow label="Nombre completo">{data.full_name && data.full_name !== data.name ? data.full_name : ''}</InfoRow>
                    <InfoRow label="Ruta" valueClassName="code">{data.scope_path}</InfoRow>
                    <InfoRow label="Ubicacion">{locationLabel}</InfoRow>
                    <InfoRow label="Referencia">{data.reference}</InfoRow>
                    <InfoRow label="ID tecnico">{technicalCellId}</InfoRow>
                </section>

                <section className="dependency-info-section dependency-info-section--code">
                    <h5>Codigo</h5>
                    {codePreview ? (
                        <code>{codePreview}</code>
                    ) : (
                        <div className="info-muted">Sin preview de codigo disponible.</div>
                    )}
                </section>
            </div>

            <div className="dependency-info-actions">
                {canNavigateToNode && (
                    <button className="info-navigate-btn" onClick={onNavigate}>
                        Ir al codigo
                    </button>
                )}
                {typeof onShowNeighbors === 'function' && (
                    <button className="info-navigate-btn secondary" onClick={onShowNeighbors}>
                        Ver vecinos
                    </button>
                )}
                {typeof onShowPath === 'function' && (
                    <button className="info-navigate-btn secondary" onClick={onShowPath}>
                        Ver camino
                    </button>
                )}
                {data.is_overview_node && typeof onExpandGroup === 'function' && (
                    <button className="info-navigate-btn secondary" onClick={onExpandGroup}>
                        Expandir grupo
                    </button>
                )}
            </div>

            <div className="dependency-info-legacy-rows" hidden>

            {/* Tipo */}
            <div className="info-row">
                <span className="info-label">Tipo:</span>
                <span className="info-value">{NODE_TYPE_LABELS[nodeType] || nodeType}</span>
            </div>

            {/* Categoría de ingeniería */}
            {category && (
                <div className="info-row">
                    <span className="info-label">Categoría:</span>
                    <span className="info-value" style={{ color: categoryStyle?.border }}>
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                        {data.category_inferred && ' ⚠️ (inferida)'}
                    </span>
                </div>
            )}

            {/* Descripción semántica */}
            {displayDescription && (
                <div className="info-row">
                    <span className="info-label">Descripción:</span>
                    <span className="info-value">{displayDescription}</span>
                </div>
            )}

            {/* Valor de runtime */}
            {formattedValue && (
                <div className="info-row">
                    <span className="info-label">Valor:</span>
                    <span className="info-value info-value-result">
                        = {formattedValue}
                        {rangeStatus === 'ok' && <span className="range-badge ok">🟢</span>}
                        {rangeStatus === 'warning' && <span className="range-badge warning">🟡</span>}
                        {rangeStatus === 'error' && <span className="range-badge error">🔴</span>}
                    </span>
                </div>
            )}

            {/* Rango válido */}
            {data.valid_range && (
                <div className="info-row">
                    <span className="info-label">Rango válido:</span>
                    <span className="info-value">
                        [{data.valid_range[0] ?? '−∞'}, {data.valid_range[1] ?? '∞'}]
                    </span>
                </div>
            )}

            {/* Resultado de verificación */}
            {data.is_check && (
                <div className="info-row">
                    <span className="info-label">Verificación:</span>
                    <span className={`info-value check-result ${data.check_result === true ? 'pass' :
                        data.check_result === false ? 'fail' : 'pending'
                        }`}>
                        {data.check_result === true && '✅ CUMPLE'}
                        {data.check_result === false && '❌ NO CUMPLE'}
                        {data.check_result === null && '⏳ Pendiente'}
                    </span>
                </div>
            )}

            {/* Mensaje del check */}
            {data.check_message && (
                <div className="info-row">
                    <span className="info-label">Mensaje:</span>
                    <span className="info-value">{data.check_message}</span>
                </div>
            )}

            {/* Referencia normativa */}
            {data.reference && (
                <div className="info-row">
                    <span className="info-label">Referencia:</span>
                    <span className="info-value">📖 {data.reference}</span>
                </div>
            )}

            {/* Nombre completo (qualified name) */}
            {data.full_name && data.full_name !== data.name && (
                <div className="info-row">
                    <span className="info-label">Nombre completo:</span>
                    <span className="info-value">{data.full_name}</span>
                </div>
            )}

            {/* Scope path */}
            {data.scope_path && (
                <div className="info-row">
                    <span className="info-label">Ruta:</span>
                    <span className="info-value code">{data.scope_path}</span>
                </div>
            )}

            {/* Ubicación en código */}
            {data.location && data.location.line > 0 && (
                <div className="info-row">
                    <span className="info-label">Ubicación:</span>
                    <span className="info-value">
                        {data.location.cell_id
                            ? `Celda ${data.location.cell_id}, `
                            : (data.location.cell_index !== null && data.location.cell_index !== undefined
                                ? `Celda ${data.location.cell_index + 1}, `
                                : '')
                        }
                        línea {data.location.line}
                        {canNavigate && <span className="navigate-hint"> 🔗 (doble clic para ir)</span>}
                    </span>
                </div>
            )}

            {/* Preview del código */}
            {(data.value_preview || data.valuePreview) && (
                <div className="info-row code-preview">
                    <span className="info-label">Código:</span>
                    <code className="info-value">{data.value_preview || data.valuePreview}</code>
                </div>
            )}

            {canNavigateToNode && (
                <button className="info-navigate-btn" onClick={onNavigate}>
                    Ir al código
                </button>
            )}
            </div>
        </div>
    );
}

/**
 * TraceTable - Tabla de trace de cálculo
 */
export function TraceTable({ trace, onClose }) {
    if (!trace || trace.length === 0) return null;

    return (
        <div className="trace-table-overlay">
            <div className="trace-table-panel">
                <div className="trace-table-header">
                    <h4>📊 Trace de Cálculo</h4>
                    <button className="trace-close-btn" onClick={onClose} aria-label="Cerrar trace">✕</button>
                </div>
                <div className="trace-table-content">
                    <table className="trace-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Variable</th>
                                <th>Fórmula</th>
                                <th>Valor</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trace.map(step => (
                                <tr
                                    key={step.node_id}
                                    className={`trace-row ${step.category || ''} ${step.is_check ? 'check' : ''}`}
                                    title={step.description || step.variable}
                                >
                                    <td className="trace-step">{step.step}</td>
                                    <td className="trace-variable">
                                        {step.variable}
                                        {step.is_check && <span className="trace-check-badge">✓</span>}
                                    </td>
                                    <td className="trace-formula">{step.formula}</td>
                                    <td className="trace-value">{step.value ?? '—'}</td>
                                    <td className="trace-unit">{step.unit || ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/**
 * IOSidebar - Sidebar para inputs/outputs
 */
export function IOSidebar({ title, icon, nodes, allNodes, onNodeClick }) {
    if (!nodes || nodes.length === 0) return null;

    return (
        <div className="io-sidebar">
            <div className="io-sidebar-header">
                <span className="io-icon">{icon}</span>
                <h5>{title}</h5>
                <span className="io-count">{nodes.length}</span>
            </div>
            <div className="io-sidebar-list">
                {nodes.map(nodeId => {
                    // Buscar el nodo en allNodes
                    const node = allNodes?.find(n => n.id === nodeId);
                    const data = node?.data || {};
                    return (
                        <div
                            key={nodeId}
                            className="io-sidebar-item"
                            onClick={() => onNodeClick?.(nodeId)}
                            title={data.description || data.name || nodeId}
                        >
                            <span className="io-item-name">{data.name || nodeId}</span>
                            {(getRuntimeQuantity(data)?.unit || data.unit) && (
                                <span className="io-item-unit">[{getRuntimeQuantity(data)?.unit || data.unit}]</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
