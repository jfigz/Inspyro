/**
 * DependencyNode - Componente de nodo personalizado para React Flow
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_ICONS, CATEGORY_COLORS } from './constants';
import { checkValueInRange, formatRuntimeValue } from './utils';

function DependencyNode({ data, selected }) {
    const nodeType = data.type || 'unknown';
    const isRoot = data.isRoot;
    const isExternal = data.isExternal;
    const hasLocation = data.location && (data.location.line > 0 || data.location.cell_index !== null);
    const formattedValue = formatRuntimeValue(data.runtimeValue);

    // Categoría y colores
    const category = data.category;
    const categoryStyle = category ? CATEGORY_COLORS[category] : null;
    const categoryIcon = categoryStyle?.icon || NODE_ICONS[nodeType];

    // Validación de rango
    const rangeStatus = formattedValue && data.validRange
        ? checkValueInRange(formattedValue, data.validRange)
        : null;

    // Estilo dinámico basado en categoría
    const nodeStyle = categoryStyle ? {
        backgroundColor: categoryStyle.bg,
        borderColor: categoryStyle.border,
    } : {};

    // Para nodos de verificación, mostrar estado
    const isCheck = data.isCheck || nodeType === 'check';
    const checkResult = data.checkResult;

    return (
        <div
            className={`dependency-node ${nodeType} ${selected ? 'selected' : ''} ${isRoot ? 'root' : ''} ${isExternal ? 'external' : ''} ${hasLocation ? 'navigable' : ''} ${category ? `category-${category}` : ''} ${rangeStatus ? `range-${rangeStatus}` : ''}`}
            style={nodeStyle}
            title={data.description || (hasLocation ? 'Doble clic para ir al código' : '')}
        >
            {/* Handle izquierdo - para recibir conexiones (target) */}
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: categoryStyle?.border || '#667eea', width: 10, height: 10 }}
            />

            {/* Header: icono + nombre + unidad */}
            <div className="dependency-node-header">
                <span className="dependency-node-icon">{categoryIcon}</span>
                <span className="dependency-node-name">
                    {data.label}
                    {data.unit && <span className="dependency-node-unit">[{data.unit}]</span>}
                </span>
            </div>

            {/* Descripción semántica */}
            {data.description && (
                <div className="dependency-node-description">
                    {data.description}
                </div>
            )}

            {/* Categoría + badge inferida */}
            {category && (
                <div className="dependency-node-category">
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                    {data.categoryInferred && (
                        <span className="inferred-badge" title="Categoría inferida por heurística">⚠️</span>
                    )}
                </div>
            )}

            {/* Valor de runtime con indicador de rango */}
            {formattedValue && (
                <div className={`dependency-node-runtime-value ${rangeStatus || ''}`}>
                    = {formattedValue}
                    {rangeStatus === 'ok' && <span className="range-indicator">🟢</span>}
                    {rangeStatus === 'warning' && <span className="range-indicator">🟡</span>}
                    {rangeStatus === 'error' && <span className="range-indicator">🔴</span>}
                </div>
            )}

            {/* Rango válido si existe */}
            {data.validRange && (
                <div className="dependency-node-range">
                    Rango: [{data.validRange[0] ?? '−∞'}, {data.validRange[1] ?? '∞'}]
                </div>
            )}

            {/* Resultado de verificación para checks */}
            {isCheck && (
                <div className={`dependency-node-check-result ${checkResult === true ? 'pass' : checkResult === false ? 'fail' : 'pending'}`}>
                    {checkResult === true && '✅ CUMPLE'}
                    {checkResult === false && '❌ NO CUMPLE'}
                    {checkResult === null && '⏳ Pendiente'}
                    {data.checkMessage && <div className="check-message">{data.checkMessage}</div>}
                </div>
            )}

            {/* Referencia normativa */}
            {data.reference && (
                <div className="dependency-node-reference" title={`Referencia: ${data.reference}`}>
                    📖 {data.reference}
                </div>
            )}

            {/* Preview de código (solo si no hay descripción ni valor) */}
            {data.valuePreview && !formattedValue && !data.description && (
                <div className="dependency-node-preview" title={data.valuePreview}>
                    {data.valuePreview}
                </div>
            )}

            {/* Ubicación */}
            {data.location && data.location.line > 0 && (
                <div className="dependency-node-location">
                    {data.location.cell_index !== null && data.location.cell_index !== undefined
                        ? `Celda ${data.location.cell_index + 1}, L${data.location.line}`
                        : `Línea ${data.location.line}`
                    }
                    <span className="navigate-hint"> 🔗</span>
                </div>
            )}

            {/* Handle derecho - para enviar conexiones (source) */}
            <Handle
                type="source"
                position={Position.Right}
                style={{ background: categoryStyle?.border || '#667eea', width: 10, height: 10 }}
            />
        </div>
    );
}

export default DependencyNode;
