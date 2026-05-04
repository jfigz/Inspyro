import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import useWebSocket from './useWebSocket';
import { NOTEBOOK_WS_URL } from '../config/endpoints';
import { WS_MESSAGE_TYPES as WS_MSG } from '../contracts/wsMessageTypes.generated';
import {
    applyDocumentStatePayload,
    createEmptyDocumentState,
    resetDocumentState,
} from '../utils/docxArtifacts';
import { createFrontendLogger } from '../utils/frontendLogger';

const logger = createFrontendLogger('useAppWebSocket');

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;
const NOTEBOOK_PENDING_LIMIT = 64;
const NOTEBOOK_MESSAGE_QUEUE_LIMIT_PER_SOCKET = 250;

const createEmptyCodeExecutionState = () => ({
    output: '',
    isExecuting: false,
    runId: null,
    documentState: createEmptyDocumentState(),
});

const normalizeComparablePath = (value) => (
    typeof value === 'string' && value.trim()
        ? value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
        : null
);

const resolveNotebookQueueBucketKey = (entry = {}) => (
    normalizeComparablePath(
        entry?.socketKey
        || entry?.path
        || entry?.message?.source_path
        || entry?.message?.notebook_path
        || entry?.message?.path
        || null,
    ) || '__shared__'
);

const trimNotebookQueue = (entries, nextEntry) => {
    const next = [...entries, nextEntry];
    const targetBucket = resolveNotebookQueueBucketKey(nextEntry);
    const overflow = next.reduce((count, entry) => (
        resolveNotebookQueueBucketKey(entry) === targetBucket ? count + 1 : count
    ), 0) - NOTEBOOK_MESSAGE_QUEUE_LIMIT_PER_SOCKET;

    if (overflow <= 0) {
        return next;
    }

    let remainingDrops = overflow;
    return next.filter((entry) => {
        if (remainingDrops <= 0) {
            return true;
        }
        if (resolveNotebookQueueBucketKey(entry) !== targetBucket) {
            return true;
        }
        remainingDrops -= 1;
        return false;
    });
};

const buildExecutionOutput = ({ output = '', error = '', stdout = '', stderr = '', returnCode = null } = {}) => {
    let outputText = '';
    if (output) outputText += `SALIDA:\n${output}\n`;
    if (stdout) outputText += `SALIDA:\n${stdout}\n`;
    if (error) outputText += `ERRORES:\n${error}\n`;
    if (stderr) outputText += `ERRORES:\n${stderr}\n`;
    if (typeof returnCode === 'number' && returnCode !== 0) {
        outputText += `Codigo de salida: ${returnCode}\n`;
    }
    return outputText || 'Ejecucion completada sin salida.\n';
};

const createNotebookSocketEntry = (path, socketKey) => ({
    path,
    socketKey,
    socket: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    shouldReconnect: true,
    pendingMessages: [],
});

export default function useAppWebSocket({ sourcePath = null, notebookPaths = [] } = {}) {
    const {
        connectionStatus,
        sendMessage,
        lastMessage,
        messageQueue,
    } = useWebSocket();

    const [codeExecutionStateByPath, setCodeExecutionStateByPath] = useState({});
    const [notebookConnectionStatusByPath, setNotebookConnectionStatusByPath] = useState({});
    const [notebookLastMessageByPath, setNotebookLastMessageByPath] = useState({});
    const [notebookMessageQueue, setNotebookMessageQueue] = useState([]);
    const runSeqRef = useRef(0);
    const suppressedCodePathsRef = useRef(new Set());
    const notebookSocketsRef = useRef(new Map());
    const notebookMessageSeqRef = useRef(0);

    const setNotebookConnectionStatus = useCallback((socketKey, status) => {
        if (!socketKey) {
            return;
        }
        setNotebookConnectionStatusByPath((current) => (
            current[socketKey] === status
                ? current
                : {
                    ...current,
                    [socketKey]: status,
                }
        ));
    }, []);

    const clearNotebookReconnectTimer = useCallback((entry) => {
        if (entry?.reconnectTimer) {
            clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = null;
        }
    }, []);

    const closeNotebookSocket = useCallback((socketKey) => {
        const entry = notebookSocketsRef.current.get(socketKey);
        if (!entry) {
            return;
        }
        entry.shouldReconnect = false;
        clearNotebookReconnectTimer(entry);
        const socket = entry.socket;
        entry.socket = null;
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;
            try {
                socket.close();
            } catch (error) {
                logger.warn('Could not close notebook websocket:', error);
            }
        }
        notebookSocketsRef.current.delete(socketKey);
        setNotebookConnectionStatusByPath((current) => {
            if (!Object.prototype.hasOwnProperty.call(current, socketKey)) {
                return current;
            }
            const next = { ...current };
            delete next[socketKey];
            return next;
        });
        setNotebookLastMessageByPath((current) => {
            if (!Object.prototype.hasOwnProperty.call(current, socketKey)) {
                return current;
            }
            const next = { ...current };
            delete next[socketKey];
            return next;
        });
    }, [clearNotebookReconnectTimer]);

    const flushPendingNotebookMessages = useCallback((entry) => {
        if (!entry?.socket || entry.socket.readyState !== WebSocket.OPEN || entry.pendingMessages.length === 0) {
            return;
        }
        const pending = [...entry.pendingMessages];
        entry.pendingMessages = [];
        pending.forEach((message) => {
            try {
                entry.socket.send(JSON.stringify(message));
            } catch (error) {
                logger.error('Error sending buffered notebook websocket message:', error);
                entry.pendingMessages.unshift(message);
            }
        });
    }, []);

    const connectNotebookSocket = useCallback((requestedPath) => {
        const socketKey = normalizeComparablePath(requestedPath);
        if (!socketKey) {
            return null;
        }

        const existingEntry = notebookSocketsRef.current.get(socketKey);
        if (
            existingEntry?.socket
            && (
                existingEntry.socket.readyState === WebSocket.OPEN
                || existingEntry.socket.readyState === WebSocket.CONNECTING
            )
        ) {
            existingEntry.path = requestedPath;
            return existingEntry;
        }

        const entry = existingEntry || createNotebookSocketEntry(requestedPath, socketKey);
        entry.path = requestedPath;
        entry.shouldReconnect = true;
        clearNotebookReconnectTimer(entry);
        setNotebookConnectionStatus(socketKey, 'connecting');

        try {
            const socket = new WebSocket(NOTEBOOK_WS_URL);
            entry.socket = socket;
            notebookSocketsRef.current.set(socketKey, entry);

            socket.onopen = () => {
                const currentEntry = notebookSocketsRef.current.get(socketKey);
                if (!currentEntry || currentEntry.socket !== socket) {
                    return;
                }
                currentEntry.reconnectAttempts = 0;
                setNotebookConnectionStatus(socketKey, 'connected');
                clearNotebookReconnectTimer(currentEntry);
                flushPendingNotebookMessages(currentEntry);
            };

            socket.onmessage = (event) => {
                const currentEntry = notebookSocketsRef.current.get(socketKey);
                if (!currentEntry || currentEntry.socket !== socket) {
                    return;
                }
                try {
                    const message = JSON.parse(event.data);
                    setNotebookLastMessageByPath((current) => ({
                        ...current,
                        [socketKey]: message,
                    }));
                    const messageId = ++notebookMessageSeqRef.current;
                    setNotebookMessageQueue((current) => trimNotebookQueue(current, {
                        id: messageId,
                        path: currentEntry.path,
                        socketKey,
                        message,
                    }));
                } catch (error) {
                    logger.error('Error parsing notebook websocket message:', error);
                }
            };

            socket.onerror = (error) => {
                const currentEntry = notebookSocketsRef.current.get(socketKey);
                if (!currentEntry || currentEntry.socket !== socket) {
                    return;
                }
                logger.error('Notebook WebSocket error:', error);
                setNotebookConnectionStatus(socketKey, 'disconnected');
            };

            socket.onclose = () => {
                const currentEntry = notebookSocketsRef.current.get(socketKey);
                if (!currentEntry || currentEntry.socket !== socket) {
                    return;
                }
                currentEntry.socket = null;
                setNotebookConnectionStatus(socketKey, 'disconnected');

                if (!currentEntry.shouldReconnect) {
                    return;
                }

                clearNotebookReconnectTimer(currentEntry);
                const timeout = Math.min(
                    INITIAL_RECONNECT_DELAY_MS * (2 ** currentEntry.reconnectAttempts),
                    MAX_RECONNECT_DELAY_MS,
                );
                currentEntry.reconnectTimer = setTimeout(() => {
                    currentEntry.reconnectTimer = null;
                    currentEntry.reconnectAttempts += 1;
                    connectNotebookSocket(currentEntry.path);
                }, timeout);
            };
        } catch (error) {
            logger.error('Failed to create notebook WebSocket:', error);
            setNotebookConnectionStatus(socketKey, 'disconnected');
        }

        return entry;
    }, [
        clearNotebookReconnectTimer,
        flushPendingNotebookMessages,
        setNotebookConnectionStatus,
    ]);

    useEffect(() => {
        const nextEntriesByKey = new Map();
        (Array.isArray(notebookPaths) ? notebookPaths : []).forEach((path) => {
            const socketKey = normalizeComparablePath(path);
            if (!socketKey || nextEntriesByKey.has(socketKey)) {
                return;
            }
            nextEntriesByKey.set(socketKey, { path, socketKey });
        });

        nextEntriesByKey.forEach(({ path, socketKey }) => {
            const existingEntry = notebookSocketsRef.current.get(socketKey);
            if (existingEntry) {
                existingEntry.path = path;
                existingEntry.shouldReconnect = true;
                if (!existingEntry.socket || existingEntry.socket.readyState === WebSocket.CLOSED) {
                    connectNotebookSocket(path);
                }
                return;
            }
            connectNotebookSocket(path);
        });

        Array.from(notebookSocketsRef.current.keys()).forEach((socketKey) => {
            const stillNeeded = nextEntriesByKey.has(socketKey);
            if (!stillNeeded) {
                closeNotebookSocket(socketKey);
            }
        });
    }, [closeNotebookSocket, connectNotebookSocket, notebookPaths]);

    useEffect(() => () => {
        Array.from(notebookSocketsRef.current.keys()).forEach((socketKey) => {
            closeNotebookSocket(socketKey);
        });
    }, [closeNotebookSocket]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return undefined;
        }

        const reconnectNotebookSockets = () => {
            Array.from(notebookSocketsRef.current.values()).forEach((entry) => {
                if (!entry.shouldReconnect) {
                    return;
                }
                const readyState = entry.socket?.readyState;
                if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
                    return;
                }
                connectNotebookSocket(entry.path);
            });
        };

        const handleFocusReconnect = () => {
            reconnectNotebookSockets();
        };
        const handleVisibilityReconnect = () => {
            if (document.visibilityState === 'visible') {
                reconnectNotebookSockets();
            }
        };

        window.addEventListener('focus', handleFocusReconnect);
        window.addEventListener('online', handleFocusReconnect);
        document.addEventListener('visibilitychange', handleVisibilityReconnect);

        return () => {
            window.removeEventListener('focus', handleFocusReconnect);
            window.removeEventListener('online', handleFocusReconnect);
            document.removeEventListener('visibilitychange', handleVisibilityReconnect);
        };
    }, [connectNotebookSocket]);

    useEffect(() => {
        const pingInterval = setInterval(() => {
            Array.from(notebookSocketsRef.current.values()).forEach((entry) => {
                if (entry.socket?.readyState === WebSocket.OPEN) {
                    try {
                        entry.socket.send(JSON.stringify({ type: 'ping' }));
                    } catch (error) {
                        logger.warn('Error sending notebook websocket ping:', error);
                    }
                }
            });
        }, 30000);

        return () => clearInterval(pingInterval);
    }, []);

    const sendNotebookMessage = useCallback((pathOrMessage, maybeMessage = null) => {
        const message = maybeMessage && typeof maybeMessage === 'object' ? maybeMessage : pathOrMessage;
        const explicitPath = maybeMessage && typeof pathOrMessage === 'string' ? pathOrMessage : null;
        const candidatePath = explicitPath
            || message?.path
            || message?.source_path
            || message?.notebook_path
            || null;
        const socketKey = normalizeComparablePath(candidatePath);
        if (!socketKey || !message || typeof message !== 'object') {
            return false;
        }

        const entry = connectNotebookSocket(candidatePath);
        if (!entry) {
            return false;
        }

        if (entry.socket?.readyState === WebSocket.OPEN) {
            try {
                entry.socket.send(JSON.stringify(message));
                return true;
            } catch (error) {
                logger.error('Error sending notebook websocket message:', error);
            }
        }

        if (entry.pendingMessages.length >= NOTEBOOK_PENDING_LIMIT) {
            entry.pendingMessages = entry.pendingMessages.slice(entry.pendingMessages.length - NOTEBOOK_PENDING_LIMIT + 1);
        }
        entry.pendingMessages.push(message);
        return false;
    }, [connectNotebookSocket]);

    const getNotebookConnectionStatus = useCallback((path) => {
        const socketKey = normalizeComparablePath(path);
        return (socketKey && notebookConnectionStatusByPath[socketKey]) || 'disconnected';
    }, [notebookConnectionStatusByPath]);

    const getNotebookLastMessage = useCallback((path) => {
        const socketKey = normalizeComparablePath(path);
        return (socketKey && notebookLastMessageByPath[socketKey]) || null;
    }, [notebookLastMessageByPath]);

    const updateCodeExecutionState = useCallback((filePath, updater) => {
        if (typeof filePath !== 'string' || !filePath.trim()) {
            return;
        }
        const normalizedPath = normalizeComparablePath(filePath);
        if (normalizedPath) {
            suppressedCodePathsRef.current.delete(normalizedPath);
        }
        setCodeExecutionStateByPath((current) => {
            const previous = current[filePath] || createEmptyCodeExecutionState();
            const next = updater(previous);
            if (!next) {
                return current;
            }
            return {
                ...current,
                [filePath]: next,
            };
        });
    }, []);

    const applyEditorExecutionPayload = useCallback((previous, message, variables, filePath) => ({
        ...applyDocumentStatePayload(previous, message, {
            sourcePath: filePath,
            docxEventId: message.docx_event_id || message.run_id || message.execution_id || `docx_${Date.now()}`,
            docxUpdatedAt: message.docx_updated_at || message.updated_at || message.created_at || Date.now(),
        }),
        variables: variables || {},
        conversionStatus: null,
        documentPipelineStatus: null,
    }), []);

    const handleWebSocketMessage = useCallback((message) => {
        const messagePath = message?.file_path || message?.source_path || sourcePath || null;
        const normalizedMessagePath = normalizeComparablePath(messagePath);

        if (normalizedMessagePath && suppressedCodePathsRef.current.has(normalizedMessagePath)) {
            return;
        }

        switch (message.type) {
            case 'execution_started': {
                if (!messagePath) break;
                updateCodeExecutionState(messagePath, (previous) => ({
                    ...previous,
                    isExecuting: true,
                    runId: message.run_id || previous.runId || null,
                    output: 'Ejecutando codigo...\n',
                    documentState: createEmptyDocumentState(),
                }));
                break;
            }

            case 'execution_completed': {
                if (!messagePath) break;
                updateCodeExecutionState(messagePath, (previous) => {
                    if (message.run_id && previous.runId && message.run_id !== previous.runId) {
                        return previous;
                    }
                    return {
                        ...previous,
                        isExecuting: false,
                        runId: message.run_id || previous.runId || null,
                        output: buildExecutionOutput({
                            stdout: message.stdout,
                            stderr: message.stderr,
                            returnCode: message.return_code,
                        }),
                        documentState: applyEditorExecutionPayload(
                            previous.documentState,
                            message,
                            message.final_variables || {},
                            messagePath,
                        ),
                    };
                });
                break;
            }

            case WS_MSG.EXECUTION_RESULT: {
                if (!messagePath) break;
                updateCodeExecutionState(messagePath, (previous) => {
                    if (message.run_id && previous.runId && message.run_id !== previous.runId) {
                        return previous;
                    }
                    return {
                        ...previous,
                        isExecuting: false,
                        runId: message.run_id || previous.runId || null,
                        output: buildExecutionOutput({
                            output: message.output,
                            error: message.error,
                        }),
                        documentState: applyEditorExecutionPayload(
                            previous.documentState,
                            message,
                            message.variables || {},
                            messagePath,
                        ),
                    };
                });
                break;
            }

            case WS_MSG.PDF_RECONVERTED: {
                if (!messagePath) break;
                const mergedPayload = {
                    ...message,
                    pdfConversionError: message.pdf_conversion_error || (message.status === 'error'
                        ? (message.error || 'conversion_failed')
                        : null),
                    conversionStatus: null,
                    documentPipelineStatus: null,
                };
                updateCodeExecutionState(messagePath, (previous) => ({
                    ...previous,
                    documentState: applyDocumentStatePayload(previous.documentState, mergedPayload, {
                        sourcePath: messagePath,
                    }),
                }));
                break;
            }

            case WS_MSG.EXECUTION_ERROR: {
                if (!messagePath) break;
                updateCodeExecutionState(messagePath, (previous) => {
                    if (message.run_id && previous.runId && message.run_id !== previous.runId) {
                        return previous;
                    }
                    return {
                        ...previous,
                        isExecuting: false,
                        runId: message.run_id || previous.runId || null,
                        output: `ERROR: ${message.error}\n${message.traceback || ''}`,
                    };
                });
                break;
            }

            case 'mdoc_cleared': {
                if (!messagePath) break;
                updateCodeExecutionState(messagePath, (previous) => ({
                    ...previous,
                    documentState: resetDocumentState(previous.documentState, { preserveVariables: true }),
                }));
                break;
            }

            case WS_MSG.DEPENDENCY_ANALYSIS_RESULT:
            case WS_MSG.IMPACT_ANALYSIS_RESULT:
            case 'dependency_analysis_error':
            case 'impact_analysis_error':
            case WS_MSG.SENSITIVITY_RESULT:
            case 'optimization_progress':
            case 'optimization_result':
            case 'optimization_error':
            case 'load_envelope_result':
            case 'load_envelope_error':
            case 'code_checks_result':
            case 'code_checks_error':
            case 'scenario_comparison_result':
            case 'scenario_comparison_error':
            case 'mcp_activity_event':
            case 'mcp_mirror_event':
            case 'workspace_fs_event':
            case 'notebook_mdoc_cleared':
            case 'pong':
                break;

            default:
                logger.log('Mensaje no manejado por App:', message.type);
        }
    }, [applyEditorExecutionPayload, sourcePath, updateCodeExecutionState]);

    useEffect(() => {
        if (lastMessage) {
            handleWebSocketMessage(lastMessage);
        }
    }, [lastMessage, handleWebSocketMessage]);

    const handleExecuteCode = useCallback((code, filePath = null) => {
        if (connectionStatus !== 'connected' || typeof filePath !== 'string' || !filePath.trim()) {
            return null;
        }

        const normalizedPath = normalizeComparablePath(filePath);
        if (normalizedPath) {
            suppressedCodePathsRef.current.delete(normalizedPath);
        }
        runSeqRef.current += 1;
        const runId = `code_run_${Date.now()}_${runSeqRef.current}`;
        updateCodeExecutionState(filePath, () => ({
            output: 'Ejecutando codigo...\n',
            isExecuting: true,
            runId,
            documentState: createEmptyDocumentState(),
        }));
        sendMessage({
            type: WS_MSG.EXECUTE_CODE,
            code,
            mode: 'run_all',
            capture_level: 'none',
            file_path: filePath,
            run_id: runId,
        });
        return runId;
    }, [connectionStatus, sendMessage, updateCodeExecutionState]);

    const cancelCodeExecution = useCallback((filePath, runId = null) => {
        if (connectionStatus !== 'connected' || typeof filePath !== 'string' || !filePath.trim()) {
            return false;
        }
        const effectiveRunId = runId || codeExecutionStateByPath[filePath]?.runId || null;
        sendMessage({
            type: 'cancel_code_execution',
            file_path: filePath,
            ...(effectiveRunId ? { run_id: effectiveRunId } : {}),
        });
        updateCodeExecutionState(filePath, (previous) => ({
            ...previous,
            isExecuting: false,
        }));
        return true;
    }, [codeExecutionStateByPath, connectionStatus, sendMessage, updateCodeExecutionState]);

    const clearCodeExecutionState = useCallback((filePath, { suppressIncoming = false } = {}) => {
        if (typeof filePath !== 'string' || !filePath.trim()) {
            return false;
        }
        const normalizedPath = normalizeComparablePath(filePath);
        if (normalizedPath) {
            if (suppressIncoming) {
                suppressedCodePathsRef.current.add(normalizedPath);
            } else {
                suppressedCodePathsRef.current.delete(normalizedPath);
            }
        }
        setCodeExecutionStateByPath((current) => {
            if (!Object.prototype.hasOwnProperty.call(current, filePath)) {
                return current;
            }
            const nextState = { ...current };
            delete nextState[filePath];
            return nextState;
        });
        return true;
    }, []);

    const activeCodeExecutionState = useMemo(() => (
        (sourcePath && codeExecutionStateByPath[sourcePath])
        || createEmptyCodeExecutionState()
    ), [codeExecutionStateByPath, sourcePath]);

    return {
        connectionStatus,
        sendMessage,
        lastMessage,
        messageQueue,
        notebookConnectionStatusByPath,
        notebookLastMessageByPath,
        notebookMessageQueue,
        sendNotebookMessage,
        getNotebookConnectionStatus,
        getNotebookLastMessage,
        output: activeCodeExecutionState.output,
        setOutput: (value) => updateCodeExecutionState(sourcePath, (previous) => ({
            ...previous,
            output: value,
        })),
        isExecuting: activeCodeExecutionState.isExecuting,
        editorExecutionData: activeCodeExecutionState.documentState,
        codeExecutionStateByPath,
        handleExecuteCode,
        cancelCodeExecution,
        clearCodeExecutionState,
    };
}
