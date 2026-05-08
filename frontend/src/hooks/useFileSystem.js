import { useState, useEffect, useCallback, useRef } from 'react';
import { createFrontendLogger } from '../utils/frontendLogger';

const logger = createFrontendLogger('useFileSystem');

const AUTO_SAVE_DELAY = 2000;

const normalizePath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const getFileNameFromPath = (value) => {
    if (typeof value !== 'string' || !value.trim()) return '';
    const normalized = value.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    return segments[segments.length - 1] || value;
};

const getPathSeparator = (value) => (typeof value === 'string' && value.includes('\\') ? '\\' : '/');

const splitPathParts = (value) => {
    if (typeof value !== 'string' || !value.trim()) return [];
    return value.replace(/\\/g, '/').split('/').filter(Boolean);
};

const isSameOrDescendantPath = (candidate, target) => {
    const normalizedCandidate = normalizePath(candidate);
    const normalizedTarget = normalizePath(target);
    if (!normalizedCandidate || !normalizedTarget) return false;
    return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
};

const pathSetHas = (source, path) => {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) return false;
    return Array.from(source || []).some((candidate) => normalizePath(candidate) === normalizedPath);
};

const replacePathPrefix = (value, oldBase, newBase) => {
    if (!isSameOrDescendantPath(value, oldBase)) return value;

    const valueParts = splitPathParts(value);
    const oldParts = splitPathParts(oldBase);
    const suffixParts = valueParts.slice(oldParts.length);
    const separator = getPathSeparator(newBase || value);
    const trimmedBase = String(newBase || '').replace(/[\\/]+$/, '');

    if (suffixParts.length === 0) {
        return newBase;
    }
    if (!trimmedBase) {
        return suffixParts.join(separator);
    }
    return `${trimmedBase}${separator}${suffixParts.join(separator)}`;
};

const mapPathSet = (source, mapper) => {
    const next = new Set();
    source.forEach((value) => {
        const mapped = mapper(value);
        if (mapped) next.add(mapped);
    });
    return next;
};

export default function useFileSystem(API_BASE, DEFAULT_CODE, notebookActionsRef) {
    const [currentWorkspace, setCurrentWorkspace] = useState('');
    const [openFiles, setOpenFiles] = useState([]);
    const [activeFile, setActiveFile] = useState(null);
    const [modifiedFiles, setModifiedFiles] = useState(new Set());
    const [externalStaleFiles, setExternalStaleFiles] = useState(new Set());
    const [externalConflictFiles, setExternalConflictFiles] = useState(new Set());

    const [code, _setCode] = useState(DEFAULT_CODE);
    const [notebookData, _setNotebookData] = useState(null);
    const [notebookSyncState, setNotebookSyncState] = useState({
        origin: 'runtime',
        path: null,
        token: 0,
    });
    const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);

    const autoSaveTimerRef = useRef(null);
    const fileContentsRef = useRef(new Map());
    const codeDraftsRef = useRef(new Map());
    const notebookDraftsRef = useRef(new Map());
    const notebookSyncStateByPathRef = useRef(new Map());
    const fileSavedRevisionRef = useRef(new Map());
    const contentRevisionRef = useRef(0);
    const programmaticSyncPathRef = useRef(null);
    const openFilesRef = useRef([]);
    const activeFileRef = useRef(null);
    const modifiedFilesRef = useRef(modifiedFiles);
    const pendingOpenPromisesRef = useRef(new Map());

    modifiedFilesRef.current = modifiedFiles;

    const setCode = useCallback((next, options = {}) => {
        const path = options.path || activeFileRef.current?.path || null;
        if (path) {
            codeDraftsRef.current.set(path, next);
        }
        _setCode(next);
    }, []);

    const setNotebookData = useCallback((next, options = {}) => {
        const {
            origin = 'persistable',
            path = activeFileRef.current?.path || null,
            markProgrammatic = origin !== 'persistable',
        } = options;

        if (markProgrammatic && path) {
            programmaticSyncPathRef.current = path;
        }

        if (path) {
            if (next == null) {
                notebookDraftsRef.current.delete(path);
                notebookSyncStateByPathRef.current.delete(path);
            } else {
                notebookDraftsRef.current.set(path, next);
                const previousState = notebookSyncStateByPathRef.current.get(path) || {
                    origin: 'runtime',
                    path,
                    token: 0,
                };
                notebookSyncStateByPathRef.current.set(path, {
                    origin,
                    path,
                    token: previousState.token + 1,
                });
            }
        }

        _setNotebookData(next);
        setNotebookSyncState(() => {
            if (path) {
                return notebookSyncStateByPathRef.current.get(path) || {
                    origin,
                    path,
                    token: 0,
                };
            }
            return {
                origin,
                path,
                token: 0,
            };
        });
    }, []);

    useEffect(() => {
        openFilesRef.current = openFiles;
    }, [openFiles]);

    useEffect(() => {
        activeFileRef.current = activeFile;
    }, [activeFile]);

    const clearExternalFlagsForPath = useCallback((path) => {
        if (!path) return;
        setExternalStaleFiles((prev) => {
            if (!prev.has(path)) return prev;
            const next = new Set(prev);
            next.delete(path);
            return next;
        });
        setExternalConflictFiles((prev) => {
            if (!prev.has(path)) return prev;
            const next = new Set(prev);
            next.delete(path);
            return next;
        });
    }, []);

    const _markFileClean = useCallback((path) => {
        setModifiedFiles((prev) => {
            const next = new Set(prev);
            next.delete(path);
            modifiedFilesRef.current = next;
            return next;
        });
    }, []);

    const _markFileDirty = useCallback((path) => {
        setModifiedFiles((prev) => {
            const next = new Set(prev);
            next.add(path);
            modifiedFilesRef.current = next;
            return next;
        });
    }, []);

    const _setFileBaselineRevision = useCallback((path) => {
        contentRevisionRef.current += 1;
        const revision = contentRevisionRef.current;
        fileSavedRevisionRef.current.set(path, revision);
        return revision;
    }, []);

    const fetchFilePayload = useCallback(async (path) => {
        const response = await fetch(`${API_BASE}/api/files/read?path=${encodeURIComponent(path)}`);
        let data = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }
        if (response.ok === false || data.error) {
            const message = data.error || data.detail || `No se pudo leer ${path}`;
            const error = new Error(message);
            error.status = response.status;
            error.path = path;
            error.unsupported = response.status === 400;
            throw error;
        }
        return data;
    }, [API_BASE]);

    const applyFilePayload = useCallback((file, data, { activate = true } = {}) => {
        fileContentsRef.current.set(file.path, data.content);
        if (data.type === 'notebook') {
            notebookDraftsRef.current.set(file.path, data.content);
            const previousState = notebookSyncStateByPathRef.current.get(file.path) || {
                origin: 'runtime',
                path: file.path,
                token: 0,
            };
            notebookSyncStateByPathRef.current.set(file.path, {
                origin: 'runtime',
                path: file.path,
                token: previousState.token + 1,
            });
            codeDraftsRef.current.delete(file.path);
        } else {
            codeDraftsRef.current.set(file.path, data.content);
            notebookDraftsRef.current.delete(file.path);
            notebookSyncStateByPathRef.current.delete(file.path);
        }
        _setFileBaselineRevision(file.path);
        _markFileClean(file.path);
        clearExternalFlagsForPath(file.path);

        if (!activate) {
            return data;
        }

        programmaticSyncPathRef.current = file.path;
        if (data.type === 'notebook') {
            setNotebookData(data.content, { origin: 'runtime', path: file.path, markProgrammatic: false });
            _setCode('');
        } else {
            setCode(data.content, { path: file.path });
            setNotebookData(null, { origin: 'runtime', path: file.path, markProgrammatic: false });
        }

        return data;
    }, [clearExternalFlagsForPath, _markFileClean, _setFileBaselineRevision, setCode, setNotebookData]);

    const loadFileContent = useCallback(async (file) => {
        logger.warn('[FS] loadFileContent:', file.path);
        try {
            const data = await fetchFilePayload(file.path);
            return applyFilePayload(file, data, { activate: true });
        } catch (err) {
            logger.error('Error cargando archivo:', err);
            programmaticSyncPathRef.current = null;
            return {
                error: err.message,
                errorStatus: err.status,
                path: file.path,
                name: file.name || getFileNameFromPath(file.path),
                unsupported: Boolean(err.unsupported),
                type: 'open_error',
            };
        }
    }, [applyFilePayload, fetchFilePayload]);

    const activateCachedFile = useCallback(async (file) => {
        if (!file?.path) return null;

        if (!fileContentsRef.current.has(file.path)) {
            return loadFileContent(file);
        }

        const fileType = file.type || (file.path.endsWith('.ipynb') ? 'notebook' : 'file');
        const cachedContent = fileType === 'notebook'
            ? (notebookDraftsRef.current.get(file.path) ?? fileContentsRef.current.get(file.path))
            : (codeDraftsRef.current.get(file.path) ?? fileContentsRef.current.get(file.path));

        programmaticSyncPathRef.current = file.path;
        if (fileType === 'notebook') {
            setNotebookData(cachedContent, { origin: 'runtime', path: file.path, markProgrammatic: false });
            _setCode('');
        } else {
            setCode(cachedContent, { path: file.path });
            setNotebookData(null, { origin: 'runtime', path: file.path, markProgrammatic: false });
        }

        return {
            type: fileType,
            content: cachedContent,
        };
    }, [loadFileContent, setCode, setNotebookData]);

    const backgroundReloadFileByPath = useCallback(async (path) => {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) return null;
        const openFile = openFilesRef.current.find(
            (candidate) => normalizePath(candidate?.path) === normalizedPath,
        );
        if (!openFile) return null;

        try {
            const data = await fetchFilePayload(openFile.path);
            const shouldActivate = normalizePath(activeFileRef.current?.path) === normalizedPath;
            return applyFilePayload(openFile, data, { activate: shouldActivate });
        } catch (err) {
            logger.error('Error recargando archivo en background:', err);
            return { error: err.message };
        }
    }, [applyFilePayload, fetchFilePayload]);

    const saveFile = useCallback(async (file, content = null) => {
        if (!file || !file.path) return false;

        try {
            let contentToSave;
            if (content !== null) {
                contentToSave = content;
            } else if (file.path.endsWith('.ipynb')) {
                const isActiveNotebook = normalizePath(activeFileRef.current?.path) === normalizePath(file.path);
                const persistableNotebook = isActiveNotebook ? notebookActionsRef.current?.getPersistableNotebook?.() : null;
                const directNotebook = isActiveNotebook ? notebookActionsRef.current?.getNotebook?.() : null;
                contentToSave = persistableNotebook ?? directNotebook ?? notebookData;
                if (!persistableNotebook && !directNotebook) {
                    contentToSave = notebookDraftsRef.current.get(file.path) ?? notebookData ?? fileContentsRef.current.get(file.path);
                    logger.warn('[FS] SAVE fallback to notebook draft cache');
                }
            } else {
                const isActiveCodeFile = normalizePath(activeFileRef.current?.path) === normalizePath(file.path);
                contentToSave = isActiveCodeFile
                    ? code
                    : (codeDraftsRef.current.get(file.path) ?? fileContentsRef.current.get(file.path) ?? '');
            }

            const response = await fetch(`${API_BASE}/api/files/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: file.path,
                    content: contentToSave,
                }),
            });

            const data = await response.json();
            if (response.ok === false || data.error) {
                throw new Error(data.error || data.detail || 'No se pudo guardar el archivo');
            }

            fileContentsRef.current.set(file.path, contentToSave);
            if (file.path.endsWith('.ipynb')) {
                notebookDraftsRef.current.set(file.path, contentToSave);
            } else {
                codeDraftsRef.current.set(file.path, contentToSave);
            }
            fileSavedRevisionRef.current.set(file.path, contentRevisionRef.current);
            _markFileClean(file.path);
            clearExternalFlagsForPath(file.path);

            logger.log('Archivo guardado:', file.path);
            return true;
        } catch (err) {
            logger.error('Error guardando archivo:', err);
            throw err;
        }
    }, [API_BASE, code, notebookData, notebookActionsRef, clearExternalFlagsForPath, _markFileClean]);

    const handleFileOpen = useCallback(async (file) => {
        if (!file?.path) return null;

        const normalizedPath = normalizePath(file.path) || file.path;
        const pendingOpen = pendingOpenPromisesRef.current.get(normalizedPath);
        if (pendingOpen) {
            return pendingOpen;
        }

        const openPromise = (async () => {
            const existingFile = openFilesRef.current.find(
                (candidate) => normalizePath(candidate?.path) === normalizedPath,
            );

            if (existingFile) {
                await activateCachedFile(existingFile);
                setActiveFile(existingFile);
                return existingFile;
            }

            const data = await loadFileContent(file);
            if (!data || data.error) return data || null;

            const newFile = {
                ...file,
                name: file.name || getFileNameFromPath(file.path),
                type: data.type,
            };

            let resolvedFile = newFile;
            setOpenFiles((prev) => {
                const alreadyOpen = prev.find(
                    (candidate) => normalizePath(candidate?.path) === normalizedPath,
                );
                if (alreadyOpen) {
                    resolvedFile = alreadyOpen;
                    return prev;
                }
                return [...prev, newFile];
            });
            setActiveFile(resolvedFile);
            return resolvedFile;
        })();

        pendingOpenPromisesRef.current.set(normalizedPath, openPromise);
        try {
            return await openPromise;
        } finally {
            if (pendingOpenPromisesRef.current.get(normalizedPath) === openPromise) {
                pendingOpenPromisesRef.current.delete(normalizedPath);
            }
        }
    }, [activateCachedFile, loadFileContent]);

    const handleFileSelect = useCallback(async (file) => {
        if (normalizePath(activeFileRef.current?.path) === normalizePath(file?.path)) return;
        const existingFile = openFilesRef.current.find(
            (candidate) => normalizePath(candidate?.path) === normalizePath(file?.path),
        ) || file;
        await activateCachedFile(existingFile);
        setActiveFile(existingFile);
    }, [activateCachedFile]);

    const remapPathState = useCallback((oldPath, newPath) => {
        setModifiedFiles((prev) => {
            const next = mapPathSet(prev, (value) => (
                isSameOrDescendantPath(value, oldPath) ? replacePathPrefix(value, oldPath, newPath) : value
            ));
            modifiedFilesRef.current = next;
            return next;
        });
        setExternalStaleFiles((prev) => mapPathSet(prev, (value) => (
            isSameOrDescendantPath(value, oldPath) ? replacePathPrefix(value, oldPath, newPath) : value
        )));
        setExternalConflictFiles((prev) => mapPathSet(prev, (value) => (
            isSameOrDescendantPath(value, oldPath) ? replacePathPrefix(value, oldPath, newPath) : value
        )));
    }, []);

    const renameOpenFile = useCallback((oldPath, newPath) => {
        const normalizedOldPath = normalizePath(oldPath);
        const normalizedNewPath = normalizePath(newPath);
        if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) return false;

        const currentOpenFiles = openFilesRef.current;
        const affectedFiles = currentOpenFiles.filter((candidate) => isSameOrDescendantPath(candidate?.path, oldPath));
        if (affectedFiles.length === 0) return false;

        const nextOpenFiles = [];
        const seen = new Set();
        currentOpenFiles.forEach((candidate) => {
            const updatedCandidate = isSameOrDescendantPath(candidate?.path, oldPath)
                ? {
                    ...candidate,
                    path: replacePathPrefix(candidate.path, oldPath, newPath),
                    name: getFileNameFromPath(replacePathPrefix(candidate.path, oldPath, newPath)) || candidate.name,
                }
                : candidate;
            const normalizedCandidatePath = normalizePath(updatedCandidate?.path);
            if (!normalizedCandidatePath || seen.has(normalizedCandidatePath)) {
                return;
            }
            seen.add(normalizedCandidatePath);
            nextOpenFiles.push(updatedCandidate);
        });

        openFilesRef.current = nextOpenFiles;
        setOpenFiles(nextOpenFiles);

        const currentActive = activeFileRef.current;
        if (isSameOrDescendantPath(currentActive?.path, oldPath)) {
            const updatedActivePath = replacePathPrefix(currentActive.path, oldPath, newPath);
            const updatedActive = nextOpenFiles.find(
                (candidate) => normalizePath(candidate?.path) === normalizePath(updatedActivePath),
            ) || null;
            activeFileRef.current = updatedActive;
            setActiveFile(updatedActive);
        }

        const cachedEntries = Array.from(fileContentsRef.current.entries());
        cachedEntries.forEach(([path, value]) => {
            if (!isSameOrDescendantPath(path, oldPath)) return;
            const nextPath = replacePathPrefix(path, oldPath, newPath);
            fileContentsRef.current.set(nextPath, value);
            fileContentsRef.current.delete(path);
        });

        const codeDraftEntries = Array.from(codeDraftsRef.current.entries());
        codeDraftEntries.forEach(([path, value]) => {
            if (!isSameOrDescendantPath(path, oldPath)) return;
            const nextPath = replacePathPrefix(path, oldPath, newPath);
            codeDraftsRef.current.set(nextPath, value);
            codeDraftsRef.current.delete(path);
        });

        const notebookDraftEntries = Array.from(notebookDraftsRef.current.entries());
        notebookDraftEntries.forEach(([path, value]) => {
            if (!isSameOrDescendantPath(path, oldPath)) return;
            const nextPath = replacePathPrefix(path, oldPath, newPath);
            notebookDraftsRef.current.set(nextPath, value);
            notebookDraftsRef.current.delete(path);
        });

        const notebookSyncEntries = Array.from(notebookSyncStateByPathRef.current.entries());
        notebookSyncEntries.forEach(([path, value]) => {
            if (!isSameOrDescendantPath(path, oldPath)) return;
            const nextPath = replacePathPrefix(path, oldPath, newPath);
            notebookSyncStateByPathRef.current.set(nextPath, {
                ...value,
                path: nextPath,
            });
            notebookSyncStateByPathRef.current.delete(path);
        });

        const savedEntries = Array.from(fileSavedRevisionRef.current.entries());
        savedEntries.forEach(([path, value]) => {
            if (!isSameOrDescendantPath(path, oldPath)) return;
            const nextPath = replacePathPrefix(path, oldPath, newPath);
            fileSavedRevisionRef.current.set(nextPath, value);
            fileSavedRevisionRef.current.delete(path);
        });

        remapPathState(oldPath, newPath);
        return true;
    }, [remapPathState]);

    const removeOpenFile = useCallback((path) => {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) return false;

        const currentOpenFiles = openFilesRef.current;
        const removedFiles = currentOpenFiles.filter((candidate) => isSameOrDescendantPath(candidate?.path, path));
        if (removedFiles.length === 0) return false;

        const nextOpenFiles = currentOpenFiles.filter((candidate) => !isSameOrDescendantPath(candidate?.path, path));
        openFilesRef.current = nextOpenFiles;
        setOpenFiles(nextOpenFiles);

        const wasActiveRemoved = isSameOrDescendantPath(activeFileRef.current?.path, path);
            if (wasActiveRemoved) {
                const currentIndex = currentOpenFiles.findIndex((candidate) => normalizePath(candidate?.path) === normalizePath(activeFileRef.current?.path));
                const fallbackIndex = Math.min(currentIndex, nextOpenFiles.length - 1);
                const nextActive = nextOpenFiles[fallbackIndex] || null;
                activeFileRef.current = nextActive;
                setActiveFile(nextActive);
                if (nextActive) {
                    void activateCachedFile(nextActive);
                } else {
                    programmaticSyncPathRef.current = null;
                    _setCode(DEFAULT_CODE);
                    setNotebookData(null, { origin: 'runtime', path: null, markProgrammatic: false });
                }
            }

        removedFiles.forEach((file) => {
            fileContentsRef.current.delete(file.path);
            codeDraftsRef.current.delete(file.path);
            notebookDraftsRef.current.delete(file.path);
            notebookSyncStateByPathRef.current.delete(file.path);
            fileSavedRevisionRef.current.delete(file.path);
        });

        setModifiedFiles((prev) => {
            const next = mapPathSet(prev, (value) => (isSameOrDescendantPath(value, path) ? null : value));
            modifiedFilesRef.current = next;
            return next;
        });
        setExternalStaleFiles((prev) => mapPathSet(prev, (value) => (isSameOrDescendantPath(value, path) ? null : value)));
        setExternalConflictFiles((prev) => mapPathSet(prev, (value) => (isSameOrDescendantPath(value, path) ? null : value)));
        return true;
    }, [DEFAULT_CODE, activateCachedFile, setNotebookData]);

    const handleFileClose = useCallback((file) => {
        removeOpenFile(file?.path);
    }, [removeOpenFile]);

    const handleFileDrop = useCallback(async (file) => {
        await handleFileOpen(file);
    }, [handleFileOpen]);

    const reloadFile = useCallback(async (file) => {
        if (!file?.path) return null;
        return loadFileContent(file);
    }, [loadFileContent]);

    const reloadFileByPath = useCallback(async (path) => {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) return null;
        const openFile = openFilesRef.current.find(
            (candidate) => normalizePath(candidate?.path) === normalizedPath,
        );
        if (!openFile) return null;

        return backgroundReloadFileByPath(openFile.path);
    }, [backgroundReloadFileByPath]);

    const markExternalConflict = useCallback((path) => {
        if (!path) return;
        setExternalConflictFiles((prev) => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
        });
        setExternalStaleFiles((prev) => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
        });
    }, []);

    const clearExternalState = useCallback((path) => {
        clearExternalFlagsForPath(path);
    }, [clearExternalFlagsForPath]);

    const applyExternalWorkspaceEvents = useCallback(async (events = []) => {
        if (!Array.isArray(events) || events.length === 0) {
            return { conflictedPaths: [], refreshedPaths: [], renamedPaths: [], removedPaths: [] };
        }

        const conflictedPaths = new Set();
        const refreshedPaths = new Set();
        const renamedPaths = [];
        const removedPaths = [];

        const currentOpenFiles = [...openFilesRef.current];

        for (const event of events) {
            const action = event?.action;
            const targetPath = event?.path || null;
            const oldPath = event?.oldPath || null;

            if (action === 'modified' && targetPath) {
                const affectedFiles = currentOpenFiles.filter((candidate) => normalizePath(candidate?.path) === normalizePath(targetPath));
                for (const file of affectedFiles) {
                    if (pathSetHas(modifiedFilesRef.current, file.path)) {
                        markExternalConflict(file.path);
                        conflictedPaths.add(file.path);
                        continue;
                    }
                    await backgroundReloadFileByPath(file.path);
                    refreshedPaths.add(file.path);
                }
                continue;
            }

            if (action === 'moved' && targetPath && oldPath) {
                const affectedFiles = currentOpenFiles.filter((candidate) => isSameOrDescendantPath(candidate?.path, oldPath));
                const dirtyTargets = affectedFiles.filter((candidate) => pathSetHas(modifiedFilesRef.current, candidate.path));
                dirtyTargets.forEach((candidate) => {
                    markExternalConflict(candidate.path);
                    conflictedPaths.add(candidate.path);
                });

                if (affectedFiles.some((candidate) => !pathSetHas(modifiedFilesRef.current, candidate.path))) {
                    renameOpenFile(oldPath, targetPath);
                    renamedPaths.push([oldPath, targetPath]);
                }
                continue;
            }

            if (action === 'deleted' && targetPath) {
                const affectedFiles = currentOpenFiles.filter((candidate) => isSameOrDescendantPath(candidate?.path, targetPath));
                const dirtyTargets = affectedFiles.filter((candidate) => pathSetHas(modifiedFilesRef.current, candidate.path));
                dirtyTargets.forEach((candidate) => {
                    markExternalConflict(candidate.path);
                    conflictedPaths.add(candidate.path);
                });

                if (affectedFiles.some((candidate) => !pathSetHas(modifiedFilesRef.current, candidate.path))) {
                    removeOpenFile(targetPath);
                    removedPaths.push(targetPath);
                }
                continue;
            }

            if (action === 'created') {
                continue;
            }
        }

        return {
            conflictedPaths: Array.from(conflictedPaths),
            refreshedPaths: Array.from(refreshedPaths),
            renamedPaths,
            removedPaths,
        };
    }, [
        backgroundReloadFileByPath,
        markExternalConflict,
        removeOpenFile,
        renameOpenFile,
    ]);

    const handleWorkspaceChange = useCallback((path) => {
        const nextPath = typeof path === 'string' ? path : '';
        setCurrentWorkspace(nextPath);
        if (nextPath) {
            localStorage.setItem('inspyro_lastWorkspace', nextPath);
        } else {
            localStorage.removeItem('inspyro_lastWorkspace');
        }
    }, []);

    const markAsModified = useCallback(() => {
        if (!activeFile?.path) return;
        if (programmaticSyncPathRef.current) {
            if (normalizePath(programmaticSyncPathRef.current) !== normalizePath(activeFile.path)) {
                return;
            }
            programmaticSyncPathRef.current = null;
            return;
        }

        contentRevisionRef.current += 1;
        const currentRevision = contentRevisionRef.current;
        const lastSavedRevision = fileSavedRevisionRef.current.get(activeFile.path) ?? 0;
        const isModified = currentRevision !== lastSavedRevision;

        if (isModified) {
            _markFileDirty(activeFile.path);
        } else {
            _markFileClean(activeFile.path);
        }

        if (isModified && autoSaveEnabled) {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = setTimeout(() => {
                saveFile(activeFile).catch((error) => logger.error('Auto-save failed:', error));
            }, AUTO_SAVE_DELAY);
        } else if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
    }, [activeFile, autoSaveEnabled, saveFile, _markFileDirty, _markFileClean]);

    useEffect(() => {
        if (activeFile) {
            markAsModified();
        }
        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [code, notebookData, activeFile, markAsModified]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeFile && modifiedFiles.has(activeFile.path)) {
                    saveFile(activeFile).catch((error) => logger.error('Save shortcut failed:', error));
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeFile, modifiedFiles, saveFile]);

    useEffect(() => {
        if (!autoSaveEnabled) return;
        if (activeFile && modifiedFiles.has(activeFile.path)) {
            saveFile(activeFile).catch((error) => logger.error('Auto-save flush failed:', error));
        }
    }, [autoSaveEnabled, activeFile, modifiedFiles, saveFile]);

    return {
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
        handleFileClose,
        handleFileDrop,
        handleWorkspaceChange,
        saveFile,
        reloadFile,
        reloadFileByPath,
        renameOpenFile,
        removeOpenFile,
        applyExternalWorkspaceEvents,
        clearExternalState,
    };
}
