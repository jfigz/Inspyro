/**
 * MonacoEditorLSP - Editor Monaco con integración Language Server Protocol
 * 
 * Este componente conecta Monaco Editor con un Python Language Server (pylsp)
 * vía WebSocket para proporcionar autocompletado inteligente, diagnósticos,
 * hover con información de tipos, y otras características de IDE.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor from '@monaco-editor/react';
import { findUnitTokens, getUnitDescription } from './notebook/unitTokens';
import { API_BASE, LSP_WS_URL } from '../config/endpoints';
import { createFrontendLogger } from '../utils/frontendLogger';
import { resolveDependencyTargetFromModel } from './dependencyTargetResolver';
import { isPythonNotebookCell } from '../utils/notebookCellTypes';

const logger = createFrontendLogger('MonacoEditorLSP');

// Helper para obtener configuración del sistema
const fetchSystemInfo = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/system/info`);
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    } catch (e) {
        logger.error('Failed to fetch system info, using fallbacks:', e);
        return {
            workspace_root: '.',
            stubs_path: null,
            path_separator: '/'
        };
    }
};

/**
 * Normaliza un path del sistema a una URI file:// absoluta.
 * Siempre produce URIs absolutas (file:///C:/... en Windows, file:///... en POSIX).
 */
const normalizeFileUri = (path) => {
    if (!path || typeof path !== 'string') return null;
    if (path.startsWith('file://')) return path.replace(/\/+$/, '');
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const hasDrive = /^[a-zA-Z]:\//.test(normalized);
    if (!hasDrive && !normalized.startsWith('/')) {
        // Path relativo — no se puede convertir a URI absoluta sin root
        return null;
    }
    const uriPath = hasDrive ? `/${normalized}` : normalized;
    return `file://${uriPath}`;
};

const joinFileUri = (baseUri, part) => {
    if (!baseUri) return null;
    const base = baseUri.replace(/\/+$/, '');
    const suffix = part.replace(/^\/+/, '');
    return `${base}/${suffix}`;
};

const normalizeCellSource = (source) => {
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
};

/**
 * Cliente LSP simplificado para comunicación con pylsp
 */
/**
 * Cliente LSP compartido (singleton) para comunicación con pylsp.
 * Todos los editores Monaco comparten la misma conexión para evitar
 * spawning múltiples procesos pylsp.
 */
class SharedLSPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.pendingRequests = new Map();
        this.initialized = false;
        this._connecting = null; // Promise de conexión en curso
        this._openDocuments = new Set(); // URIs de documentos abiertos
        this._diagnosticsListeners = new Map(); // uri -> Set<callback>
        this._refCount = 0; // Número de componentes que usan este cliente
        this._modelToDocUri = new Map(); // Monaco model URI -> LSP document URI
        this._requestIdCounter = 0; // Per-instance request IDs
    }

    /**
     * Incrementa el refcount y conecta si es la primera referencia.
     * Retorna el cliente listo para usar.
     */
    async acquire() {
        this._refCount++;
        if (!this.initialized && !this._connecting) {
            await this.connect();
        } else if (this._connecting) {
            await this._connecting;
        }
        return this;
    }

    /**
     * Decrementa el refcount y desconecta si ya nadie lo usa.
     */
    release() {
        this._refCount = Math.max(0, this._refCount - 1);
        if (this._refCount === 0) {
            this.disconnect();
        }
    }

    connect() {
        if (this._connecting) return this._connecting;
        this._connecting = new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                this.ws.onopen = () => {
                    if (process.env.NODE_ENV !== 'production') console.log('🔤 LSP: WebSocket conectado');
                    this.initialize().then(() => {
                        this._connecting = null;
                        resolve();
                    }).catch((err) => {
                        this._connecting = null;
                        reject(err);
                    });
                };

                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (e) {
                        console.error('🔤 LSP: Error parseando mensaje', e);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('🔤 LSP: WebSocket error', error);
                    this._connecting = null;
                    reject(error);
                };

                this.ws.onclose = () => {
                    if (process.env.NODE_ENV !== 'production') console.log('🔤 LSP: WebSocket cerrado');
                    this.initialized = false;
                    this._openDocuments.clear();
                    this._connecting = null;
                };
            } catch (error) {
                this._connecting = null;
                reject(error);
            }
        });
        return this._connecting;
    }

    async initialize() {
        // Obtener configuración dinámica del sistema
        const sysInfo = await fetchSystemInfo();
        this._sysInfo = sysInfo;

        // Configuración de workspace para pylsp
        // Debe ser siempre una URI absoluta (file:///C:/... en Windows)
        const workspaceRoot = normalizeFileUri(sysInfo.workspace_root);
        this._workspaceRootUri = workspaceRoot;

        // Usar stubs_path absoluto del backend, o fallback calculado
        const stubsPath = sysInfo.stubs_path || null;
        const extraPaths = stubsPath ? [stubsPath] : [];

        if (!workspaceRoot) {
            console.warn('🔤 LSP: No se pudo construir URI de workspace, LSP puede no funcionar correctamente');
        }

        const result = await this.sendRequest('initialize', {
            processId: null,
            rootUri: workspaceRoot,
            workspaceFolders: workspaceRoot ? [
                {
                    uri: workspaceRoot,
                    name: 'inspyro-workspace'
                }
            ] : [],
            capabilities: {
                textDocument: {
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: true
                    },
                    completion: {
                        dynamicRegistration: false,
                        completionItem: {
                            snippetSupport: true,
                            documentationFormat: ['markdown', 'plaintext'],
                            deprecatedSupport: true,
                            preselectSupport: true
                        },
                        contextSupport: true
                    },
                    hover: {
                        dynamicRegistration: false,
                        contentFormat: ['markdown', 'plaintext']
                    },
                    signatureHelp: {
                        dynamicRegistration: false,
                        signatureInformation: {
                            documentationFormat: ['markdown', 'plaintext'],
                            parameterInformation: {
                                labelOffsetSupport: true
                            }
                        }
                    },
                    publishDiagnostics: {
                        relatedInformation: true,
                        tagSupport: { valueSet: [1, 2] }
                    }
                },
                workspace: {
                    workspaceFolders: true,
                    configuration: true,
                    didChangeConfiguration: {
                        dynamicRegistration: true
                    }
                }
            }
        });

        // Enviar initialized notification
        this.sendNotification('initialized', {});

        // Configurar jedi con extra_paths absolutas para stubs de la API DOCX
        this.sendNotification('workspace/didChangeConfiguration', {
            settings: {
                pylsp: {
                    plugins: {
                        jedi: {
                            extra_paths: extraPaths
                        },
                        jedi_completion: {
                            enabled: true,
                            include_params: true,
                            include_class_objects: true,
                            fuzzy: true
                        },
                        jedi_hover: { enabled: true },
                        jedi_references: { enabled: true },
                        jedi_signature_help: { enabled: true },
                        jedi_symbols: {
                            enabled: true,
                            all_scopes: true
                        },
                        // Deshabilitar linters ruidosos
                        pylint: { enabled: false },
                        pycodestyle: { enabled: false },
                        mccabe: { enabled: false },
                        pyflakes: { enabled: true },
                        flake8: { enabled: false }
                    }
                }
            }
        });

        this.initialized = true;
        if (process.env.NODE_ENV !== 'production') console.log('🔤 LSP: Inicializado con workspace y stubs DOCX', {
            rootUri: workspaceRoot,
            stubsPath,
            capabilities: result?.capabilities
        });
        return result;
    }

    /** Obtiene la URI raíz del workspace (absoluta). */
    get workspaceRootUri() {
        return this._workspaceRootUri;
    }

    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket no conectado'));
                return;
            }

            const id = ++this._requestIdCounter;
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            // Timeout de 10s para requests
            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`LSP request timeout: ${method}`));
                }
            }, 10000);

            this.pendingRequests.set(id, {
                resolve: (result) => { clearTimeout(timeout); resolve(result); },
                reject: (err) => { clearTimeout(timeout); reject(err); }
            });
            this.ws.send(JSON.stringify(message));
        });
    }

    sendNotification(method, params) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const message = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.ws.send(JSON.stringify(message));
    }

    handleMessage(message) {
        // Respuesta a request
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(message.error);
            } else {
                resolve(message.result);
            }
            return;
        }

        // Notificación del servidor
        if (message.method) {
            switch (message.method) {
                case 'textDocument/publishDiagnostics': {
                    const uri = message.params?.uri;
                    const listeners = this._diagnosticsListeners.get(uri);
                    if (listeners) {
                        for (const cb of listeners) {
                            try { cb(message.params); } catch (e) { /* noop */ }
                        }
                    }
                    break;
                }
                default:
                    break;
            }
        }
    }

    /** Registra un listener de diagnósticos para una URI específica. */
    addDiagnosticsListener(uri, callback) {
        if (!this._diagnosticsListeners.has(uri)) {
            this._diagnosticsListeners.set(uri, new Set());
        }
        this._diagnosticsListeners.get(uri).add(callback);
    }

    /** Elimina un listener de diagnósticos. */
    removeDiagnosticsListener(uri, callback) {
        if (!callback) {
            this._diagnosticsListeners.delete(uri);
            return;
        }
        const listeners = this._diagnosticsListeners.get(uri);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) {
                this._diagnosticsListeners.delete(uri);
            }
        }
    }

    // Notificar apertura de documento
    didOpen(uri, languageId, version, text) {
        if (this._openDocuments.has(uri)) {
            // Documento ya abierto, enviar didChange en su lugar
            this.didChange(uri, version, text);
            return;
        }
        this._openDocuments.add(uri);
        this.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId,
                version,
                text
            }
        });
    }

    // Notificar cierre de documento
    didClose(uri) {
        if (!this._openDocuments.has(uri)) return;
        this._openDocuments.delete(uri);
        // Remove any model -> docUri mappings that point to this URI
        for (const [modelUri, docUri] of this._modelToDocUri) {
            if (docUri === uri) {
                this._modelToDocUri.delete(modelUri);
            }
        }
        this.sendNotification('textDocument/didClose', {
            textDocument: { uri }
        });
    }

    // Notificar cambio en documento
    didChange(uri, version, text) {
        this.sendNotification('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text }]
        });
    }

    // Solicitar completions
    async getCompletions(uri, line, character) {
        if (!this.initialized) return null;

        try {
            const result = await this.sendRequest('textDocument/completion', {
                textDocument: { uri },
                position: { line, character }
            });
            return result;
        } catch (e) {
            console.error('🔤 LSP: Error obteniendo completions', e);
            return null;
        }
    }

    // Solicitar hover
    async getHover(uri, line, character) {
        if (!this.initialized) return null;

        try {
            const result = await this.sendRequest('textDocument/hover', {
                textDocument: { uri },
                position: { line, character }
            });
            return result;
        } catch (e) {
            console.error('🔤 LSP: Error obteniendo hover', e);
            return null;
        }
    }

    disconnect() {
        if (this.ws) {
            try {
                // P6 fix: shutdown es un request, luego exit es notification
                if (this.initialized) {
                    this.sendRequest('shutdown', null)
                        .then(() => {
                            this.sendNotification('exit', null);
                        })
                        .catch(() => {
                            // Si el shutdown falla, igual intentar cerrar
                            this.sendNotification('exit', null);
                        });
                }
            } catch (e) {
                // Ignorar errores al cerrar
            }
            // Dar un pequeño delay para que los mensajes se envíen
            const oldWs = this.ws;
            this.ws = null;
            setTimeout(() => {
                if (oldWs && oldWs.readyState <= WebSocket.OPEN) {
                    oldWs.close();
                }
            }, 200);
        }
        this.initialized = false;
        this._openDocuments.clear();
        this._diagnosticsListeners.clear();
        this._modelToDocUri.clear();
    }
}

// Singleton global del cliente LSP compartido
let _sharedLSPClient = null;

/**
 * Obtiene el cliente LSP compartido. Crea uno nuevo si no existe.
 * Cada componente que lo usa debe llamar acquire() y release().
 */
const getSharedLSPClient = () => {
    if (!_sharedLSPClient) {
        _sharedLSPClient = new SharedLSPClient(LSP_WS_URL);
    }
    return _sharedLSPClient;
};


const MonacoEditorLSP = ({
    value,
    onChange,
    language = 'python',
    height = '100%',
    minHeight = 0,
    lspEnabled = true,
    notebookContext = null,  // { precedingCells, notebookPath, cellIndex }
    highlightLine = null,    // Línea a resaltar (navegación desde grafo de dependencias)
    highlightColumn = null,  // Columna a resaltar (0-based)
    onShowDependencyTree = null,  // Callback para mostrar árbol de dependencias
    onExecute = null  // Callback para ejecutar celda (Ctrl+Enter)
}) => {
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const lspClientRef = useRef(null);
    const [, setLspStatus] = useState('disconnected'); // disconnected, connecting, connected, error
    const documentVersionRef = useRef(0);
    const highlightDecorationsRef = useRef([]); // Decoraciones de línea resaltada
    const unitDecorationsRef = useRef([]); // Decoraciones de unidades de ingeniería
    const contextMenuDependencyTargetRef = useRef(null);
    const contextMenuDisposableRef = useRef(null);

    // Efecto para manejar resaltado de línea desde navegación de grafo
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const editor = editorRef.current;
        const monaco = monacoRef.current;

        // Limpiar decoraciones previas
        if (highlightDecorationsRef.current.length > 0) {
            editor.deltaDecorations(highlightDecorationsRef.current, []);
            highlightDecorationsRef.current = [];
        }

        if (highlightLine && highlightLine > 0) {
            // Revelar línea en el centro del editor
            editor.revealLineInCenter(highlightLine);

            // Posicionar cursor en la línea
            const column = Number.isFinite(highlightColumn) ? Math.max(1, highlightColumn + 1) : 1;
            editor.setPosition({ lineNumber: highlightLine, column });

            // Enfocar el editor
            editor.focus();

            // Añadir decoración de resaltado
            const newDecorations = editor.deltaDecorations([], [{
                range: new monaco.Range(highlightLine, 1, highlightLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'highlighted-code-line',
                    glyphMarginClassName: 'highlighted-line-glyph',
                    overviewRuler: {
                        color: 'gold',
                        position: monaco.editor.OverviewRulerLane.Full
                    }
                }
            }]);
            highlightDecorationsRef.current = newDecorations;
        }
    }, [highlightLine, highlightColumn]);

    // Generar URI absoluta basado en contexto de notebook o archivo individual
    const generateDocumentUri = useCallback((client) => {
        // Usar la URI raíz del workspace del cliente LSP (siempre absoluta)
        const rootUri = client?.workspaceRootUri;
        if (!rootUri) return null;

        if (notebookContext?.notebookPath) {
            // Para notebooks: construir URI virtual ABSOLUTA bajo el workspace
            const safeId = notebookContext.notebookPath.replace(/[^a-zA-Z0-9]/g, '_');
            return joinFileUri(rootUri, `_lsp_virtual/${safeId}_cell${notebookContext.cellIndex || 0}.py`);
        }
        // Para archivos individuales: URI virtual absoluta
        return joinFileUri(rootUri, `_lsp_virtual/editor_${Date.now()}.py`);
    }, [notebookContext]);

    const documentUriRef = useRef(null);

    /**
     * Genera un documento virtual que incluye el contexto de celdas anteriores.
     * Esto permite al LSP conocer variables, imports y definiciones de celdas previas.
     */
    const generateVirtualDocument = useCallback((currentCellSource) => {
        if (!notebookContext?.precedingCells || notebookContext.precedingCells.length === 0) {
            return currentCellSource;
        }

        // Concatenar código de celdas anteriores (solo celdas de código)
        const precedingCode = notebookContext.precedingCells
            .filter(cell => isPythonNotebookCell(cell))
            .map(cell => {
                return normalizeCellSource(cell.source);
            })
            .filter(code => code.trim().length > 0)
            .join('\n\n');

        if (!precedingCode.trim()) {
            return currentCellSource;
        }

        // Concatenar con separador para que el LSP tenga contexto completo
        // El separador ayuda a identificar dónde termina el contexto previo
        return `${precedingCode}\n\n# --- Celda Actual (línea ${precedingCode.split('\n').length + 3}) ---\n${currentCellSource}`;
    }, [notebookContext]);

    // Calcular offset de líneas para diagnósticos (ajustar posiciones)
    const calculateLineOffset = useCallback(() => {
        if (!notebookContext?.precedingCells) return 0;

        let offset = 0;
        for (const cell of notebookContext.precedingCells) {
            if (isPythonNotebookCell(cell)) {
                const source = normalizeCellSource(cell.source);
                if (source.trim()) {
                    offset += source.split('\n').length + 2; // +2 for separators
                }
            }
        }
        return offset + 2; // +2 for "# --- Celda Actual ---" marker
    }, [notebookContext]);

    const applyUnitDecorations = useCallback(() => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || language !== 'python') return;

        const model = editor.getModel();
        if (!model) return;

        const matches = findUnitTokens(model.getValue());
        const decorations = matches.map((match) => ({
            range: new monaco.Range(
                match.lineNumber,
                match.startColumn,
                match.lineNumber,
                match.endColumn
            ),
            options: {
                inlineClassName: 'monaco-unit-token',
                hoverMessage: [
                    {
                        value: `**${match.unit}** - ${getUnitDescription(match.unit)}`
                    }
                ],
                stickiness: 1 /* NeverGrowsWhenTypingAtEdges */,
            }
        }));

        unitDecorationsRef.current = editor.deltaDecorations(
            unitDecorationsRef.current,
            decorations
        );
    }, [language]);

    const resolveDependencyTargetAtPosition = useCallback((editor, position, mode) => {
        const model = editor?.getModel?.();
        if (!model || !position) return null;

        const target = resolveDependencyTargetFromModel(model, position, {
            mode,
            selection: editor?.getSelection?.() || null,
        });
        if (!target) return null;

        return {
            symbol: target.symbol,
            line: target.line,
            column: target.column,
            mode,
            modelUri: model.uri?.toString?.() || null,
        };
    }, []);

    const resolveDependencyActionTarget = useCallback((editor, mode) => {
        const modelUri = editor?.getModel?.()?.uri?.toString?.() || null;
        const contextTarget = contextMenuDependencyTargetRef.current;
        const contextAgeMs = contextTarget?.createdAt ? Date.now() - contextTarget.createdAt : Infinity;

        if (
            contextTarget
            && contextAgeMs < 5000
            && (!contextTarget.modelUri || !modelUri || contextTarget.modelUri === modelUri)
        ) {
            return {
                symbol: contextTarget.symbol,
                line: contextTarget.line,
                column: contextTarget.column,
                mode,
            };
        }

        return resolveDependencyTargetAtPosition(editor, editor?.getPosition?.(), mode);
    }, [resolveDependencyTargetAtPosition]);

    // Manejar diagnósticos del LSP
    const handleDiagnostics = useCallback((params) => {
        if (!monacoRef.current || !editorRef.current) return;

        const monaco = monacoRef.current;
        const model = editorRef.current.getModel();
        if (!model) return;

        // Calcular offset de líneas si hay contexto de notebook
        const lineOffset = calculateLineOffset();

        // Filtrar diagnósticos que pertenecen a la celda actual (después del offset)
        // y ajustar las posiciones de línea
        const filteredDiagnostics = (params.diagnostics || [])
            .filter(diag => {
                // Solo mostrar diagnósticos que están en la celda actual (después del offset)
                const diagLine = diag.range.start.line;
                return diagLine >= lineOffset;
            })
            .map(diag => ({
                severity: diag.severity === 1 ? monaco.MarkerSeverity.Error :
                    diag.severity === 2 ? monaco.MarkerSeverity.Warning :
                        diag.severity === 3 ? monaco.MarkerSeverity.Info :
                            monaco.MarkerSeverity.Hint,
                // Ajustar números de línea restando el offset
                startLineNumber: diag.range.start.line + 1 - lineOffset,
                startColumn: diag.range.start.character + 1,
                endLineNumber: diag.range.end.line + 1 - lineOffset,
                endColumn: diag.range.end.character + 1,
                message: diag.message,
                source: diag.source || 'pylsp'
            }))
            .filter(marker => marker.startLineNumber > 0); // Asegurar líneas positivas

        monaco.editor.setModelMarkers(model, 'lsp', filteredDiagnostics);
    }, [calculateLineOffset]);

    // Conectar al LSP compartido
    // P1 fix: no depende de `value` para evitar recrear la referencia en cada keystroke
    const connectLSP = useCallback(async () => {
        if (!lspEnabled || lspClientRef.current) return;

        setLspStatus('connecting');

        try {
            // P5 fix: usar cliente compartido en vez de crear uno nuevo
            const client = getSharedLSPClient();
            await client.acquire();
            lspClientRef.current = client;
            setLspStatus('connected');

            // Generar URI usando el workspace root del cliente (siempre absoluto)
            const uri = generateDocumentUri(client);
            documentUriRef.current = uri;

            if (uri) {
                // Registrar listener de diagnósticos para esta URI
                client.addDiagnosticsListener(uri, handleDiagnostics);

                // Abrir documento con el contenido actual
                const currentValue = editorRef.current?.getModel()?.getValue() || '';
                if (currentValue) {
                    documentVersionRef.current++;
                    const virtualDoc = generateVirtualDocument(currentValue);
                    client.didOpen(
                        uri,
                        'python',
                        documentVersionRef.current,
                        virtualDoc
                    );
                    // Register mapping from Monaco model URI to LSP document URI
                    const modelUri = editorRef.current?.getModel()?.uri?.toString();
                    if (modelUri) {
                        client._modelToDocUri.set(modelUri, uri);
                    }
                }
            }
        } catch (error) {
            console.warn('🔤 LSP: No se pudo conectar, usando modo básico', error);
            setLspStatus('error');
        }
    }, [lspEnabled, handleDiagnostics, generateVirtualDocument, generateDocumentUri]);

    // Registrar providers de Monaco para LSP
    // P7 fix: los providers usan getSharedLSPClient() en vez de una ref local
    // que puede quedar stale si el componente original se desmonta
    const registerLSPProviders = useCallback((monaco) => {
        // Evitar registrar providers múltiples veces
        if (window.__inspyro_lsp_providers_registered) {
            return;
        }
        window.__inspyro_lsp_providers_registered = true;

        // Completion provider que usa LSP
        monaco.languages.registerCompletionItemProvider('python', {
            triggerCharacters: ['.', '(', ',', '['],
            provideCompletionItems: async (model, position) => {
                // P7 fix: acceder al singleton directamente, no a una ref local
                const client = _sharedLSPClient;
                if (!client || !client.initialized) {
                    // Fallback a sugerencias básicas
                    return { suggestions: getBasicSuggestions(monaco) };
                }

                // Encontrar la URI LSP del modelo actual via mapping
                const modelUri = model.uri?.toString();
                const docUri = modelUri ? client._modelToDocUri.get(modelUri) : null;
                if (!docUri) return { suggestions: getBasicSuggestions(monaco) };

                try {
                    const result = await client.getCompletions(
                        docUri,
                        position.lineNumber - 1,
                        position.column - 1
                    );

                    if (!result) return { suggestions: [] };

                    const items = Array.isArray(result) ? result : (result.items || []);

                    const suggestions = items.map(item => ({
                        label: item.label,
                        kind: mapCompletionKind(monaco, item.kind),
                        insertText: item.insertText || item.label,
                        insertTextRules: item.insertTextFormat === 2
                            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                            : undefined,
                        detail: item.detail,
                        documentation: item.documentation?.value || item.documentation,
                        sortText: item.sortText
                    }));

                    return { suggestions };
                } catch (e) {
                    console.error('🔤 LSP: Error en completions', e);
                    return { suggestions: [] };
                }
            }
        });

        // Hover provider que usa LSP
        monaco.languages.registerHoverProvider('python', {
            provideHover: async (model, position) => {
                const client = _sharedLSPClient;
                if (!client || !client.initialized) return null;

                // Encontrar la URI LSP del modelo actual via mapping
                const modelUri = model.uri?.toString();
                const docUri = modelUri ? client._modelToDocUri.get(modelUri) : null;
                if (!docUri) return null;

                try {
                    const result = await client.getHover(
                        docUri,
                        position.lineNumber - 1,
                        position.column - 1
                    );

                    if (!result || !result.contents) return null;

                    let contents = [];
                    if (typeof result.contents === 'string') {
                        contents = [{ value: result.contents }];
                    } else if (Array.isArray(result.contents)) {
                        contents = result.contents.map(c =>
                            typeof c === 'string' ? { value: c } : { value: c.value || '' }
                        );
                    } else if (result.contents.value) {
                        contents = [{ value: result.contents.value }];
                    }

                    return {
                        contents,
                        range: result.range ? {
                            startLineNumber: result.range.start.line + 1,
                            startColumn: result.range.start.character + 1,
                            endLineNumber: result.range.end.line + 1,
                            endColumn: result.range.end.character + 1
                        } : undefined
                    };
                } catch (e) {
                    console.error('🔤 LSP: Error en hover', e);
                    return null;
                }
            }
        });
    }, []);

    const handleEditorDidMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Tema Gemini Dark (Inspirado en Google AI Studio/Canvas)
        monaco.editor.defineTheme('gemini-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '9AA0A6', fontStyle: 'italic' }, // Grey 500
                { token: 'keyword', foreground: 'C58AF9', fontStyle: 'bold' },   // Purple 300
                { token: 'string', foreground: '81C995' },                       // Green 300
                { token: 'number', foreground: 'FDD663' },                       // Yellow 300
                { token: 'identifier', foreground: 'E2E2E2' },                   // White/Grey
                { token: 'type.identifier', foreground: '8AB4F8' },              // Blue 300
                { token: 'function', foreground: '8AB4F8' },                     // Blue 300
                { token: 'method', foreground: '8AB4F8' },                       // Blue 300
                { token: 'decorator', foreground: 'F28B82' },                    // Red 300
                { token: 'delimiter', foreground: 'E2E2E2' },
                { token: 'operator', foreground: 'E2E2E2' }
            ],
            colors: {
                'editor.background': '#131314', // Gemini Dark Background (Deep Grey)
                'editor.foreground': '#E2E2E2',
                'editor.lineHighlightBackground': '#1F1F1F',
                'editorCursor.foreground': '#8AB4F8',
                'editorWhitespace.foreground': '#3B3B3B',
                'editorIndentGuide.background': '#3B3B3B',
                'editorIndentGuide.activeBackground': '#767676'
            }
        });
        monaco.editor.setTheme('gemini-dark');

        // Opciones del editor
        editor.updateOptions({
            fontSize: 14,
            minimap: { enabled: true },
            lineNumbers: 'on',
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            lineHeight: 20,
            fontFamily: "'Source Code Pro', 'Roboto Mono', 'JetBrains Mono', monospace",
            fontLigatures: true,
        });

        // Registrar providers LSP
        registerLSPProviders(monaco);

        // Aplicar decoraciones iniciales de unidades
        applyUnitDecorations();

        if (contextMenuDisposableRef.current?.dispose) {
            contextMenuDisposableRef.current.dispose();
        }
        contextMenuDisposableRef.current = editor.onContextMenu((event) => {
            const targetPosition = event?.target?.position;
            const nextTarget = resolveDependencyTargetAtPosition(editor, targetPosition, 'dependencies');
            contextMenuDependencyTargetRef.current = nextTarget
                ? { ...nextTarget, createdAt: Date.now() }
                : null;
        });

        // Registrar acción de menú contextual para árbol de dependencias
        editor.addAction({
            id: 'show-dependency-tree',
            label: '🌳 Ver Árbol de Dependencias',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD
            ],
            run: (ed) => {
                const target = resolveDependencyActionTarget(ed, 'dependencies');
                if (target && onShowDependencyTree) {
                    onShowDependencyTree({
                        symbol: target.symbol,
                        line: target.line,
                        column: target.column,
                        mode: 'dependencies',
                    });
                }
            }
        });

        // Registrar acción para análisis de impacto
        editor.addAction({
            id: 'show-impact-tree',
            label: '📈 Ver Impacto (¿qué depende de esto?)',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.6,
            run: (ed) => {
                const target = resolveDependencyActionTarget(ed, 'impact');
                if (target && onShowDependencyTree) {
                    onShowDependencyTree({
                        symbol: target.symbol,
                        line: target.line,
                        column: target.column,
                        mode: 'impact',
                    });
                }
            }
        });

        // Registrar keybinding para ejecutar celda (Ctrl+Enter)
        if (onExecute) {
            editor.addAction({
                id: 'execute-cell',
                label: '▶ Ejecutar Celda',
                keybindings: [
                    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter
                ],
                run: () => {
                    onExecute();
                }
            });
        }

        // Conectar al LSP
        connectLSP();
    }, [
        registerLSPProviders,
        applyUnitDecorations,
        resolveDependencyTargetAtPosition,
        resolveDependencyActionTarget,
        connectLSP,
        onShowDependencyTree,
        onExecute,
    ]);

    // Manejar cambios de contenido
    const handleEditorChange = useCallback((newValue) => {
        if (onChange) {
            onChange(newValue);
        }

        // Notificar al LSP con documento virtual (incluye contexto de celdas anteriores)
        const client = lspClientRef.current;
        if (client && client.initialized) {
            documentVersionRef.current++;
            const virtualDoc = generateVirtualDocument(newValue);
            client.didChange(
                documentUriRef.current,
                documentVersionRef.current,
                virtualDoc
            );
        }

        applyUnitDecorations();
    }, [onChange, generateVirtualDocument, applyUnitDecorations]);

    useEffect(() => {
        applyUnitDecorations();
    }, [value, applyUnitDecorations]);

    // Cleanup al desmontar
    useEffect(() => {
        return () => {
            if (editorRef.current && unitDecorationsRef.current.length > 0) {
                editorRef.current.deltaDecorations(unitDecorationsRef.current, []);
                unitDecorationsRef.current = [];
            }
            if (contextMenuDisposableRef.current?.dispose) {
                contextMenuDisposableRef.current.dispose();
                contextMenuDisposableRef.current = null;
            }
            // Limpiar: cerrar documento virtual y liberar ref al cliente compartido
            const client = lspClientRef.current;
            const uri = documentUriRef.current;
            if (client && uri) {
                // Unregister model URI mapping before closing the document
                const modelUri = editorRef.current?.getModel()?.uri?.toString();
                if (modelUri) {
                    client._modelToDocUri.delete(modelUri);
                }
                // Si queremos limpiar el listener tenemos que removerlo. 
                // Dado que handleDiagnostics puede cambiar, simplemente eliminamos el listener actual.
                // Como esto es en unmount, está bien hacerlo a pesar de no estar en los dependencias.
                client.removeDiagnosticsListener(uri);
                client.didClose(uri);
                client.release();
                lspClientRef.current = null;
            } else if (client) {
                client.release();
                lspClientRef.current = null;
            }
        };
    }, []);

    // Normalizar tamaños
    const normalizeSize = (val) => {
        if (typeof val === 'number') return `${val}px`;
        if (typeof val === 'string') return val;
        return '100%';
    };

    return (
        <div className="monaco-scroll-shell" style={{
            height: normalizeSize(height),
            minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
            position: 'relative'
        }}>
            <Editor
                height="100%"
                defaultLanguage={language}
                value={value}
                onMount={handleEditorDidMount}
                onChange={handleEditorChange}
                options={{
                    selectOnLineNumbers: true,
                    mouseWheelZoom: true,
                    contextmenu: true,
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    acceptSuggestionOnEnter: 'on',
                    snippetSuggestions: 'inline',
                    wordBasedSuggestions: 'currentDocument',
                    parameterHints: { enabled: true },
                    hover: { enabled: true },
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false },
                    scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto',
                        useShadows: false,
                        verticalScrollbarSize: 16,
                        horizontalScrollbarSize: 16,
                        alwaysConsumeMouseWheel: false // Permite propagar scroll al padre cuando llega al límite
                    }
                }}
            />
        </div>
    );
};

// Mapear tipos de completion LSP a Monaco
function mapCompletionKind(monaco, kind) {
    const map = {
        1: monaco.languages.CompletionItemKind.Text,
        2: monaco.languages.CompletionItemKind.Method,
        3: monaco.languages.CompletionItemKind.Function,
        4: monaco.languages.CompletionItemKind.Constructor,
        5: monaco.languages.CompletionItemKind.Field,
        6: monaco.languages.CompletionItemKind.Variable,
        7: monaco.languages.CompletionItemKind.Class,
        8: monaco.languages.CompletionItemKind.Interface,
        9: monaco.languages.CompletionItemKind.Module,
        10: monaco.languages.CompletionItemKind.Property,
        11: monaco.languages.CompletionItemKind.Unit,
        12: monaco.languages.CompletionItemKind.Value,
        13: monaco.languages.CompletionItemKind.Enum,
        14: monaco.languages.CompletionItemKind.Keyword,
        15: monaco.languages.CompletionItemKind.Snippet,
        16: monaco.languages.CompletionItemKind.Color,
        17: monaco.languages.CompletionItemKind.File,
        18: monaco.languages.CompletionItemKind.Reference,
        19: monaco.languages.CompletionItemKind.Folder,
        20: monaco.languages.CompletionItemKind.EnumMember,
        21: monaco.languages.CompletionItemKind.Constant,
        22: monaco.languages.CompletionItemKind.Struct,
        23: monaco.languages.CompletionItemKind.Event,
        24: monaco.languages.CompletionItemKind.Operator,
        25: monaco.languages.CompletionItemKind.TypeParameter
    };
    return map[kind] || monaco.languages.CompletionItemKind.Text;
}

// Sugerencias básicas de fallback
/* eslint-disable no-template-curly-in-string */
function getBasicSuggestions(monaco) {
    return [
        {
            label: 'print',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: 'print(${1:value})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Imprime un valor en la consola'
        },
        {
            label: 'def',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'def ${1:function_name}(${2:parameters}):\n\t${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define una función'
        },
        {
            label: 'class',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'class ${1:ClassName}:\n\tdef __init__(self${2:, parameters}):\n\t\t${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Define una clase'
        },
        {
            label: 'for',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Bucle for'
        },
        {
            label: 'if',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'if ${1:condition}:\n\t${2:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Condicional if'
        },
        {
            label: 'import',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'import ${1:module}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Importar módulo'
        },
        {
            label: 'try',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Bloque try/except'
        },
        {
            label: 'with',
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: 'with ${1:context} as ${2:var}:\n\t${3:pass}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Context manager'
        }
    ];
}
/* eslint-enable no-template-curly-in-string */

export default MonacoEditorLSP;
