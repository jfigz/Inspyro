import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatRuntimeValue } from './utils';

const MODES = {
    optimize: {
        label: 'Optimizar',
        type: 'optimize_design',
        resultType: 'optimization_result',
        errorType: 'optimization_error',
        progressType: 'optimization_progress',
    },
    envelope: {
        label: 'Envolvente',
        type: 'analyze_load_envelope',
        resultType: 'load_envelope_result',
        errorType: 'load_envelope_error',
    },
    checks: {
        label: 'Checks',
        type: 'run_code_checks',
        resultType: 'code_checks_result',
        errorType: 'code_checks_error',
    },
    scenarios: {
        label: 'Escenarios',
        type: 'compare_scenarios',
        resultType: 'scenario_comparison_result',
        errorType: 'scenario_comparison_error',
    },
};

function parseNumericRuntime(node) {
    const raw = formatRuntimeValue(node?.data?.runtimeValue);
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractFormulas(allNodes) {
    const formulas = {};
    (allNodes || []).forEach((node) => {
        const name = node?.data?.label;
        const preview = node?.data?.valuePreview;
        if (!name || !preview || typeof preview !== 'string') return;
        if (!preview.includes('=') || preview.endsWith('...')) return;
        const noComment = preview.split('#')[0].trim();
        const eqIndex = noComment.indexOf('=');
        if (eqIndex <= 0) return;
        const rhs = noComment.slice(eqIndex + 1).trim();
        if (!rhs || !/[a-zA-Z_]/.test(rhs)) return;
        formulas[name] = rhs;
    });
    return formulas;
}

function OptimizationPanel({
    inputNodes,
    outputNodes,
    allNodes,
    onClose,
    sendMessage,
    lastMessage,
}) {
    const [mode, setMode] = useState('optimize');
    const [payloadText, setPayloadText] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const pendingRef = useRef({ requestId: null, ...MODES.optimize });

    const currentValues = useMemo(() => {
        const values = {};
        (allNodes || []).forEach((node) => {
            const name = node?.data?.label;
            if (!name) return;
            const parsed = parseNumericRuntime(node);
            if (parsed !== null) values[name] = parsed;
        });
        return values;
    }, [allNodes]);

    const formulas = useMemo(() => extractFormulas(allNodes), [allNodes]);

    const defaultPayloads = useMemo(() => {
        const inputDefs = (inputNodes || [])
            .map((node) => {
                const name = node?.data?.label;
                const value = parseNumericRuntime(node);
                if (!name || value === null) return null;
                const spread = Math.max(Math.abs(value) * 0.2, 1e-3);
                return {
                    name,
                    min: value - spread,
                    max: value + spread,
                    initial: value,
                };
            })
            .filter(Boolean)
            .slice(0, 8);

        const outputDefs = (outputNodes || [])
            .map((node) => node?.data?.label)
            .filter(Boolean)
            .slice(0, 6);

        const firstInput = inputDefs[0]?.name || null;
        const firstOutput = outputDefs[0] || null;
        const firstOutputCurrent = firstOutput ? currentValues[firstOutput] : null;
        const baseChecks = firstOutput && Number.isFinite(firstOutputCurrent)
            ? [
                {
                    name: `check_${firstOutput}`,
                    lhs: firstOutput,
                    op: '<=',
                    rhs: firstOutputCurrent * 1.05,
                    message: `Control automatico para ${firstOutput}`,
                },
            ]
            : [];

        const optimizePayload = {
            objective: {
                targets: outputDefs.slice(0, 2).map((name) => ({
                    name,
                    goal: 'min',
                    weight: 1.0,
                })),
                penalty_weight: 1000,
            },
            variables: inputDefs,
            constraints: baseChecks,
            formulas,
            current_values: currentValues,
            iterations: 80,
            seed: 42,
        };

        const envelopePayload = {
            combinations: [
                { name: 'base', factors: {} },
                firstInput ? { name: 'combo_1.2', factors: { [firstInput]: 1.2 } } : null,
                firstInput ? { name: 'combo_0.8', factors: { [firstInput]: 0.8 } } : null,
            ].filter(Boolean),
            outputs: outputDefs,
            formulas,
            current_values: currentValues,
        };

        const checksPayload = {
            code_profile: 'custom',
            checks: baseChecks,
            formulas,
            current_values: currentValues,
        };

        const scenariosPayload = {
            baseline: { name: 'baseline', values: {} },
            candidates: firstInput && inputDefs[0]
                ? [
                    { name: `${firstInput}_plus_10`, values: { [firstInput]: inputDefs[0].initial * 1.1 } },
                    { name: `${firstInput}_minus_10`, values: { [firstInput]: inputDefs[0].initial * 0.9 } },
                ]
                : [],
            outputs: outputDefs,
            formulas,
            current_values: currentValues,
        };

        return {
            optimize: optimizePayload,
            envelope: envelopePayload,
            checks: checksPayload,
            scenarios: scenariosPayload,
        };
    }, [currentValues, formulas, inputNodes, outputNodes]);

    useEffect(() => {
        const next = defaultPayloads[mode] || {};
        setPayloadText(JSON.stringify(next, null, 2));
        setResult(null);
        setError(null);
        setProgress(null);
    }, [mode, defaultPayloads]);

    useEffect(() => {
        if (!lastMessage) return;
        const pending = pendingRef.current;
        if (!pending.requestId) return;
        if (lastMessage.request_id && lastMessage.request_id !== pending.requestId) return;

        if (pending.progressType && lastMessage.type === pending.progressType) {
            setProgress(lastMessage);
            return;
        }

        if (lastMessage.type === pending.resultType) {
            pendingRef.current.requestId = null;
            setIsRunning(false);
            setProgress(null);
            setError(null);
            setResult(lastMessage);
            return;
        }

        if (lastMessage.type === pending.errorType) {
            pendingRef.current.requestId = null;
            setIsRunning(false);
            setProgress(null);
            setError(lastMessage.error || 'Error en operacion de ingenieria');
        }
    }, [lastMessage]);

    const resetPayload = () => {
        setPayloadText(JSON.stringify(defaultPayloads[mode] || {}, null, 2));
        setError(null);
    };

    const runAction = () => {
        if (!sendMessage) {
            setError('No hay conexion WebSocket');
            return;
        }

        let parsedPayload = {};
        try {
            parsedPayload = payloadText?.trim() ? JSON.parse(payloadText) : {};
        } catch (exc) {
            setError(`JSON invalido: ${exc.message}`);
            return;
        }

        if (mode === 'optimize' && (!Array.isArray(parsedPayload.variables) || parsedPayload.variables.length === 0)) {
            setResult(null);
            setProgress(null);
            setError('No hay variables numericas de diseno para optimizar en este grafo.');
            return;
        }

        const modeConfig = MODES[mode];
        const requestId = `eng_${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        pendingRef.current = { requestId, ...modeConfig };

        setIsRunning(true);
        setError(null);
        setResult(null);
        setProgress(null);

        sendMessage({
            type: modeConfig.type,
            request_id: requestId,
            ...parsedPayload,
        });
    };

    return (
        <div className="optimization-panel">
            <div className="optimization-header">
                <h5>Optimizacion Estructural</h5>
                <button className="optimization-close-btn" onClick={onClose} aria-label="Cerrar optimizacion">x</button>
            </div>

            <div className="optimization-mode-toggle">
                {Object.entries(MODES).map(([modeId, cfg]) => (
                    <button
                        key={modeId}
                        className={mode === modeId ? 'active' : ''}
                        onClick={() => setMode(modeId)}
                    >
                        {cfg.label}
                    </button>
                ))}
            </div>

            <div className="optimization-help">
                Edita el payload JSON y ejecuta la operacion para este grafo.
            </div>

            <textarea
                className="optimization-json"
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                spellCheck={false}
            />

            <div className="optimization-actions">
                <button className="optimization-btn secondary" onClick={resetPayload} disabled={isRunning}>
                    Reset
                </button>
                <button className="optimization-btn primary" onClick={runAction} disabled={isRunning}>
                    {isRunning ? 'Ejecutando...' : 'Ejecutar'}
                </button>
            </div>

            {progress && (
                <div className="optimization-progress">
                    <strong>Progreso:</strong> {progress.status || 'running'}{typeof progress.iteration === 'number' ? ` (iter: ${progress.iteration})` : ''}
                </div>
            )}

            {error && (
                <div className="optimization-error">[!] {error}</div>
            )}

            {result && (
                <pre className="optimization-result">
                    {JSON.stringify(result, null, 2)}
                </pre>
            )}
        </div>
    );
}

export default OptimizationPanel;
