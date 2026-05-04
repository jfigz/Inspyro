/**
 * SensitivityPanel - Panel de análisis de sensibilidad
 * 
 * Permite modificar variables de entrada y ver el impacto en los outputs.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { formatRuntimeValue } from './utils';

function SensitivityPanel({
    inputNodes,
    outputNodes,
    allNodes,
    onClose,
    sendMessage,
    lastMessage
}) {
    const [sliderValues, setSliderValues] = useState({});
    const [mode, setMode] = useState('percent');
    const [isCalculating, setIsCalculating] = useState(false);
    const [results, setResults] = useState({});
    const [error, setError] = useState(null);
    const timeoutRef = useRef(null);
    const pendingRequestIdRef = useRef(null);

    const clearPendingTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    const inputSignature = useMemo(() => {
        if (!inputNodes || inputNodes.length === 0) return '';
        return inputNodes
            .map((node) => `${node.id}:${formatRuntimeValue(node.data.runtimeValue) ?? ''}`)
            .join('|');
    }, [inputNodes]);

    // Inicializar sliders
    useEffect(() => {
        if (!inputNodes || inputNodes.length === 0) {
            setSliderValues({});
            setResults({});
            setError(null);
            setIsCalculating(false);
            pendingRequestIdRef.current = null;
            clearPendingTimeout();
            return;
        }

        const initial = {};
        inputNodes.forEach(node => {
            const currentValue = parseFloat(formatRuntimeValue(node.data.runtimeValue)) || 0;
            initial[node.id] = {
                percent: 0,
                absolute: currentValue,
                original: currentValue,
                name: node.data.label
            };
        });
        setSliderValues(initial);
        setResults({});
        setError(null);
        setIsCalculating(false);
        pendingRequestIdRef.current = null;
        clearPendingTimeout();
    }, [inputNodes, inputSignature]);

    useEffect(() => {
        return () => {
            clearPendingTimeout();
            pendingRequestIdRef.current = null;
        };
    }, []);

    // Listener para resultados del backend
    useEffect(() => {
        if (!lastMessage) return;

        if (lastMessage.type === 'sensitivity_result') {
            const pendingId = pendingRequestIdRef.current;
            if (pendingId && lastMessage.request_id && lastMessage.request_id !== pendingId) {
                return;
            }
            pendingRequestIdRef.current = null;
            clearPendingTimeout();
            setIsCalculating(false);
            if (lastMessage.success) {
                setResults(lastMessage.results || {});
                setError(null);
            } else {
                setError(lastMessage.error || 'Error desconocido');
            }
        }
    }, [lastMessage]);

    if (!inputNodes || inputNodes.length === 0) return null;

    const getNewValue = (nodeId) => {
        const sv = sliderValues[nodeId];
        if (!sv) return null;
        return mode === 'percent'
            ? sv.original * (1 + sv.percent / 100)
            : sv.absolute;
    };

    const getPercentChange = (nodeId) => {
        const sv = sliderValues[nodeId];
        if (!sv || sv.original === 0) return 0;
        return mode === 'percent'
            ? sv.percent
            : ((sv.absolute - sv.original) / sv.original) * 100;
    };

    const runSensitivityAnalysis = () => {
        if (!sendMessage) {
            setError('No hay conexión con el servidor');
            return;
        }

        setIsCalculating(true);
        setError(null);
        clearPendingTimeout();

        const modifiedVariables = {};
        Object.keys(sliderValues).forEach(nodeId => {
            const sv = sliderValues[nodeId];
            const newValue = getNewValue(nodeId);
            if (newValue !== sv.original) {
                modifiedVariables[sv.name] = newValue;
            }
        });

        const outputVariables = outputNodes.map(n => n.data.label);
        const formulas = {};
        const currentValues = {};

        allNodes.forEach(node => {
            const name = node.data.label;
            const value = node.data.runtimeValue;

            if (value !== undefined && value !== null) {
                const numValue = parseFloat(formatRuntimeValue(value));
                if (!isNaN(numValue)) {
                    currentValues[name] = numValue;
                }
            }

            let preview = node.data.valuePreview;
            if (preview && preview.includes('=')) {
                const commentIndex = preview.indexOf('#');
                if (commentIndex > 0) {
                    preview = preview.substring(0, commentIndex).trim();
                }
                if (!preview.endsWith('...')) {
                    const parts = preview.split('=');
                    if (parts.length >= 2) {
                        const formula = parts.slice(1).join('=').trim();
                        if (formula && /[a-zA-Z_]/.test(formula) && !/^[\d.]+$/.test(formula)) {
                            formulas[name] = formula;
                        }
                    }
                }
            }
        });

        const requestId = `sens_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        pendingRequestIdRef.current = requestId;

        sendMessage({
            type: 'sensitivity_analyze',
            request_id: requestId,
            modified_variables: modifiedVariables,
            output_variables: outputVariables,
            formulas: formulas,
            current_values: currentValues
        });

        timeoutRef.current = setTimeout(() => {
            if (pendingRequestIdRef.current !== requestId) return;
            pendingRequestIdRef.current = null;
            timeoutRef.current = null;
            setIsCalculating((prev) => {
                if (!prev) return prev;
                setError('Timeout: no se recibió respuesta del servidor');
                return false;
            });
        }, 10000);
    };

    const hasChanges = Object.keys(sliderValues).some(nodeId => {
        const sv = sliderValues[nodeId];
        return mode === 'percent' ? sv.percent !== 0 : sv.absolute !== sv.original;
    });

    return (
        <div className="sensitivity-panel">
            <div className="sensitivity-header">
                <h5>📊 Análisis de Sensibilidad</h5>
                <button className="sensitivity-close-btn" onClick={onClose} aria-label="Cerrar sensibilidad">✕</button>
            </div>

            <div className="sensitivity-mode-toggle">
                <button className={mode === 'percent' ? 'active' : ''} onClick={() => setMode('percent')}>
                    Porcentaje (±%)
                </button>
                <button className={mode === 'absolute' ? 'active' : ''} onClick={() => setMode('absolute')}>
                    Valor Absoluto
                </button>
            </div>

            <div className="sensitivity-hint">
                {mode === 'percent'
                    ? 'Ajusta el % de cambio para cada variable'
                    : 'Ingresa el nuevo valor absoluto'
                }
            </div>

            <div className="sensitivity-sliders">
                {inputNodes.slice(0, 8).map(node => {
                    const sv = sliderValues[node.id] || { percent: 0, absolute: 0, original: 0 };
                    const percentChange = getPercentChange(node.id);
                    const newValue = getNewValue(node.id);

                    return (
                        <div key={node.id} className="sensitivity-slider-row">
                            <div className="sensitivity-label">
                                <span className="sensitivity-name">{node.data.label}</span>
                                {node.data.unit && <span className="sensitivity-unit">[{node.data.unit}]</span>}
                            </div>

                            {mode === 'percent' ? (
                                <>
                                    <input
                                        type="range"
                                        min="-50"
                                        max="50"
                                        value={sv.percent}
                                        onChange={(e) => setSliderValues(prev => ({
                                            ...prev,
                                            [node.id]: { ...sv, percent: parseInt(e.target.value) }
                                        }))}
                                        className="sensitivity-slider"
                                    />
                                    <span className={`sensitivity-pct ${sv.percent > 0 ? 'pos' : sv.percent < 0 ? 'neg' : ''}`}>
                                        {sv.percent > 0 ? '+' : ''}{sv.percent}%
                                    </span>
                                </>
                            ) : (
                                <>
                                    <input
                                        type="number"
                                        value={sv.absolute}
                                        onChange={(e) => setSliderValues(prev => ({
                                            ...prev,
                                            [node.id]: { ...sv, absolute: parseFloat(e.target.value) || 0 }
                                        }))}
                                        className="sensitivity-input"
                                        step="any"
                                    />
                                    <span className={`sensitivity-pct ${percentChange > 0 ? 'pos' : percentChange < 0 ? 'neg' : ''}`}>
                                        {percentChange > 0 ? '+' : ''}{percentChange.toFixed(0)}%
                                    </span>
                                </>
                            )}

                            <div className="sensitivity-values">
                                <span className="original">{sv.original?.toFixed(2)}</span>
                                <span className="arrow">→</span>
                                <span className="new">{newValue?.toFixed(2)}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="sensitivity-actions">
                <button
                    className={`sensitivity-calculate-btn ${isCalculating ? 'calculating' : ''}`}
                    onClick={runSensitivityAnalysis}
                    disabled={isCalculating || !hasChanges}
                >
                    {isCalculating ? '⏳ Calculando...' : '🔄 Recalcular'}
                </button>
            </div>

            {error && (
                <div className="sensitivity-error">⚠️ {error}</div>
            )}

            {outputNodes?.length > 0 && (
                <div className="sensitivity-impact">
                    <h6>{Object.keys(results).length > 0 ? 'Resultados Calculados' : 'Outputs a Monitorear'}</h6>
                    {outputNodes.slice(0, 6).map(node => {
                        const varName = node.data.label;
                        const currentValue = parseFloat(formatRuntimeValue(node.data.runtimeValue)) || 0;
                        const newValue = results[varName];
                        const hasResult = newValue !== undefined && newValue !== null;
                        const percentChange = hasResult && currentValue !== 0
                            ? ((newValue - currentValue) / currentValue) * 100
                            : 0;

                        return (
                            <div key={node.id} className="sensitivity-impact-row">
                                <span className="impact-name">{varName}</span>
                                {hasResult ? (
                                    <>
                                        <div className="sensitivity-result-values">
                                            <span className="original">{currentValue.toFixed(3)}</span>
                                            <span className="arrow">→</span>
                                            <span className={`new ${percentChange > 0 ? 'pos' : percentChange < 0 ? 'neg' : ''}`}>
                                                {typeof newValue === 'number' ? newValue.toFixed(3) : String(newValue)}
                                            </span>
                                        </div>
                                        <span className={`sensitivity-delta ${percentChange > 0 ? 'pos' : percentChange < 0 ? 'neg' : ''}`}>
                                            {percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span className="sensitivity-waiting">
                                            {currentValue.toFixed(3)} {node.data.unit ? `[${node.data.unit}]` : ''}
                                        </span>
                                        <span className="sensitivity-delta">—</span>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default SensitivityPanel;
