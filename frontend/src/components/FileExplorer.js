import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './FileExplorer.css';
import FolderSelector from './FolderSelector';
import FileActionDialog from './FileActionDialog';
import { API_BASE } from '../config/endpoints';
import {
  ExplorerFileIcon,
  ExplorerIconChevronRight,
  ExplorerIconClose,
  ExplorerIconEdit,
  ExplorerIconEye,
  ExplorerIconEyeOff,
  ExplorerIconFilePlus,
  ExplorerIconFolderPlus,
  ExplorerIconRefresh,
  ExplorerIconReveal,
  ExplorerIconSidebar,
  ExplorerIconTrash,
} from './ExplorerIcons';

const SHOW_HIDDEN_KEY = 'inspyro_explorer_show_hidden';
const SEARCH_MIN = 2;
const SEARCH_DELAY_MS = 180;
const SHOW_EXPLORER_LABEL = 'Mostrar explorador de archivos';
const HIDE_EXPLORER_LABEL = 'Ocultar explorador de archivos';

const normalizePath = (value) => (typeof value === 'string' && value.trim()
  ? value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  : null);

const isSameOrDescendant = (candidate, target) => {
  const a = normalizePath(candidate);
  const b = normalizePath(target);
  return Boolean(a && b && (a === b || a.startsWith(`${b}/`)));
};

const splitParts = (value) => (typeof value === 'string' && value.trim()
  ? value.replace(/\\/g, '/').split('/').filter(Boolean)
  : []);

const separatorOf = (value) => (typeof value === 'string' && value.includes('\\') ? '\\' : '/');

const joinPath = (parent, name) => `${String(parent || '').replace(/[\\/]+$/, '')}${separatorOf(parent)}${name}`;

const parentPathOf = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  if (parts.length <= 1) return value;
  const separator = separatorOf(trimmed);
  parts.pop();
  let parent = parts.join(separator);
  if (/^[A-Za-z]:$/.test(parent)) parent += separator;
  if (!parent && trimmed.startsWith('/')) parent = '/';
  return parent;
};

const displayParentPathOf = (value) => {
  const parent = parentPathOf(value);
  if (!parent || parent === value) return '';
  return parent;
};

const replacePrefix = (value, oldBase, newBase) => {
  if (!isSameOrDescendant(value, oldBase)) return value;
  const suffix = splitParts(value).slice(splitParts(oldBase).length);
  if (!suffix.length) return newBase;
  return `${String(newBase).replace(/[\\/]+$/, '')}${separatorOf(newBase)}${suffix.join(separatorOf(newBase))}`;
};

const readErrorMessage = async (response, fallback) => {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || fallback;
  } catch {
    return fallback;
  }
};

const collectTree = (node, nodes = {}, children = {}) => {
  if (!node?.path) return { nodes, children };
  nodes[node.path] = { ...node, children: undefined };
  if (node.isDirectory) {
    const childList = Array.isArray(node.children) ? node.children : [];
    children[node.path] = childList.map((child) => child.path);
    childList.forEach((child) => collectTree(child, nodes, children));
  }
  return { nodes, children };
};

const TreeNode = ({
  path,
  depth,
  rootPath,
  nodesByPath,
  childrenByPath,
  expanded,
  selectedPath,
  activeFilePath,
  modifiedFiles,
  stalePaths,
  conflictPaths,
  loadingPaths,
  pendingPaths,
  dragOverPath,
  onToggle,
  onSelect,
  onOpen,
  onContext,
  onDragOver,
  onDrop,
}) => {
  const node = nodesByPath[path];
  if (!node) return null;
  const children = childrenByPath[path] || [];
  const selected = normalizePath(selectedPath) === normalizePath(node.path);
  const active = normalizePath(activeFilePath) === normalizePath(node.path);
  const dirty = Array.from(modifiedFiles || []).some((candidate) => isSameOrDescendant(candidate, node.path));
  const stale = Array.from(stalePaths || []).some((candidate) => isSameOrDescendant(candidate, node.path));
  const conflict = Array.from(conflictPaths || []).some((candidate) => isSameOrDescendant(candidate, node.path));
  const expandedNode = expanded.has(node.path);
  const isRoot = normalizePath(rootPath) === normalizePath(node.path);

  return (
    <div className="tree-node-container" data-testid={node.isDirectory ? 'file-tree-folder' : 'file-tree-file'}>
      <div
        className={[
          'tree-node',
          node.isDirectory ? 'directory' : 'file',
          selected ? 'selected' : '',
          active ? 'active' : '',
          dirty ? 'dirty' : '',
          stale ? 'stale' : '',
          conflict ? 'conflict' : '',
          normalizePath(dragOverPath) === normalizePath(node.path) ? 'drop-target' : '',
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => {
          onSelect(node.path);
          if (node.isDirectory) onToggle(node.path);
          else onOpen(node);
        }}
        onContextMenu={(event) => onContext(event, node)}
        onDragStart={(event) => {
          if (isRoot) return;
          event.dataTransfer.setData('application/inspyro-node', JSON.stringify({
            path: node.path,
            name: node.name,
            isDirectory: node.isDirectory,
          }));
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        onDragOver={(event) => {
          if (!node.isDirectory) return;
          event.preventDefault();
          onDragOver(node.path);
        }}
        onDrop={(event) => {
          if (!node.isDirectory) return;
          event.preventDefault();
          onDrop(event, node.path, event.ctrlKey ? 'copy' : 'move');
        }}
        draggable={!isRoot}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={node.isDirectory ? expandedNode : undefined}
      >
        <span className={`tree-arrow ${expandedNode ? 'expanded' : ''} ${node.isDirectory ? '' : 'placeholder'}`}>
          {node.isDirectory ? <ExplorerIconChevronRight /> : null}
        </span>
        <span className="tree-icon">
          <ExplorerFileIcon
            extension={node.extension || (node.name?.includes('.') ? `.${node.name.split('.').pop().toLowerCase()}` : '')}
            isDirectory={node.isDirectory}
            isOpen={expandedNode}
          />
        </span>
        <span className="tree-name">{node.name}</span>
        {node.writable === false && <span className="tree-badge">RO</span>}
        {dirty && <span className="tree-badge">DIRTY</span>}
        {conflict && <span className="tree-badge">CONFLICT</span>}
        {stale && <span className="tree-badge">STALE</span>}
        {(loadingPaths.has(node.path) || pendingPaths.has(node.path)) && <span className="tree-pending">...</span>}
      </div>
      {node.isDirectory && expandedNode && children.length > 0 && (
        <div className="tree-children" role="group">
          {children.map((childPath) => (
            <TreeNode
              key={childPath}
              path={childPath}
              depth={depth + 1}
              rootPath={rootPath}
              nodesByPath={nodesByPath}
              childrenByPath={childrenByPath}
              expanded={expanded}
              selectedPath={selectedPath}
              activeFilePath={activeFilePath}
              modifiedFiles={modifiedFiles}
              stalePaths={stalePaths}
              conflictPaths={conflictPaths}
              loadingPaths={loadingPaths}
              pendingPaths={pendingPaths}
              dragOverPath={dragOverPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpen={onOpen}
              onContext={onContext}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function FileExplorer({
  onFileOpen,
  onOpenDefaultApplication = null,
  onWorkspaceChange,
  onWorkspaceInfoChange = null,
  onPathRenamed = null,
  onPathDeleted = null,
  onStatusMessage = null,
  currentWorkspace,
  activeFilePath = null,
  modifiedFiles = new Set(),
  externalStalePaths = new Set(),
  externalConflictPaths = new Set(),
  lastWorkspaceEvent = null,
  widthPx = 260,
  onWidthChange = null,
  refreshToken = 0,
  isCollapsed,
  onToggleCollapse,
}) {
  const [rootPath, setRootPath] = useState(null);
  const [nodesByPath, setNodesByPath] = useState({});
  const [childrenByPath, setChildrenByPath] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [loaded, setLoaded] = useState(new Set());
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [pendingPaths, setPendingPaths] = useState(new Set());
  const [selectedPath, setSelectedPath] = useState(null);
  const [dragOverPath, setDragOverPath] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem(SHOW_HIDDEN_KEY) === '1');
  const [showFolderSelector, setShowFolderSelector] = useState(false);
  const [error, setError] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [fileActionDialog, setFileActionDialog] = useState({ mode: null, error: null, isSubmitting: false, parentPath: null });

  const loadedRef = useRef(loaded);
  const expandedRef = useRef(expanded);
  const nodesRef = useRef(nodesByPath);
  const rootPathRef = useRef(rootPath);
  const inflightLoadsRef = useRef(new Map());

  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { nodesRef.current = nodesByPath; }, [nodesByPath]);
  useEffect(() => { rootPathRef.current = rootPath; }, [rootPath]);
  useEffect(() => { localStorage.setItem(SHOW_HIDDEN_KEY, showHidden ? '1' : '0'); }, [showHidden]);
  useEffect(() => {
    const clamped = Math.max(220, Math.min(420, Number(widthPx) || 260));
    if (onWidthChange && widthPx !== clamped) onWidthChange(clamped);
  }, [onWidthChange, widthPx]);

  const loadFolder = useCallback(async (path, force = false) => {
    const normalizedPath = normalizePath(path);
    if (!path || !normalizedPath) return null;

    const inflightLoad = inflightLoadsRef.current.get(normalizedPath);
    if (inflightLoad) {
      return inflightLoad;
    }

    const knownNodePath = Object.keys(nodesRef.current).find(
      (candidate) => normalizePath(candidate) === normalizedPath,
    );
    const alreadyLoaded = Array.from(loadedRef.current).some(
      (candidate) => normalizePath(candidate) === normalizedPath,
    );
    if (!force && alreadyLoaded) {
      return nodesRef.current[knownNodePath || path] || null;
    }

    setLoadingPaths((prev) => {
      if (prev.has(path)) return prev;
      return new Set(prev).add(path);
    });

    const loadPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/files/tree?path=${encodeURIComponent(path)}&depth=1&show_hidden=${showHidden ? '1' : '0'}`);
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo cargar la carpeta'));
        const payload = await response.json();
        const { nodes, children } = collectTree(payload);
        setNodesByPath((prev) => ({ ...prev, ...nodes }));
        setChildrenByPath((prev) => ({ ...prev, ...children }));
        setLoaded((prev) => new Set(prev).add(payload.path || path));

        const shouldPromoteRootPath = !rootPathRef.current || normalizePath(path) === normalizePath(currentWorkspace);
        if (shouldPromoteRootPath && normalizePath(payload.path) !== normalizePath(rootPathRef.current)) {
          rootPathRef.current = payload.path;
          setRootPath(payload.path);
        }

        setError(null);
        return payload;
      } catch (err) {
        setError(err.message || 'No se pudo cargar el explorador');
        return null;
      } finally {
        inflightLoadsRef.current.delete(normalizedPath);
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    })();

    inflightLoadsRef.current.set(normalizedPath, loadPromise);
    return loadPromise;
  }, [currentWorkspace, showHidden]);

  const refreshFolders = useCallback(async (paths) => {
    const nextPaths = Array.from(new Set((paths || []).filter(Boolean))).filter((path) => (
      loadedRef.current.has(path) || normalizePath(path) === normalizePath(currentWorkspace)
    ));
    for (const path of nextPaths) await loadFolder(path, true);
  }, [currentWorkspace, loadFolder]);

  const remapUiPaths = useCallback((oldPath, newPath) => {
    setExpanded((prev) => new Set(Array.from(prev).map((value) => (isSameOrDescendant(value, oldPath) ? replacePrefix(value, oldPath, newPath) : value))));
    setLoaded((prev) => new Set(Array.from(prev).map((value) => (isSameOrDescendant(value, oldPath) ? replacePrefix(value, oldPath, newPath) : value))));
    setPendingPaths((prev) => new Set(Array.from(prev).map((value) => (isSameOrDescendant(value, oldPath) ? replacePrefix(value, oldPath, newPath) : value))));
    setSelectedPath((prev) => (isSameOrDescendant(prev, oldPath) ? replacePrefix(prev, oldPath, newPath) : prev));
  }, []);

  const revealPath = useCallback(async (path, openFile = false) => {
    if (!path || !currentWorkspace || !isSameOrDescendant(path, currentWorkspace)) return;
    await loadFolder(currentWorkspace, false);
    setExpanded((prev) => new Set(prev).add(currentWorkspace));
    let currentPath = currentWorkspace;
    const workspaceLen = splitParts(currentWorkspace).length;
    const parts = splitParts(path);
    for (let index = workspaceLen; index < parts.length - 1; index += 1) {
      const nextPath = joinPath(currentPath, parts[index]);
      currentPath = nextPath;
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(nextPath);
        return next;
      });
      await loadFolder(nextPath, false);
    }
    setSelectedPath(path);
    if (openFile) {
      const fallbackNode = { path, name: parts[parts.length - 1] || path, isDirectory: false };
      onFileOpen?.(nodesRef.current[path] || fallbackNode);
    }
  }, [currentWorkspace, loadFolder, onFileOpen]);

  const refreshExplorer = useCallback(async () => {
    if (!currentWorkspace) return;
    const expandedSnapshot = Array.from(expandedRef.current);
    await loadFolder(currentWorkspace, true);
    for (const path of expandedSnapshot) {
      if (normalizePath(path) !== normalizePath(currentWorkspace)) await loadFolder(path, true);
    }
  }, [currentWorkspace, loadFolder]);

  useEffect(() => {
    let cancelled = false;
    const syncWorkspace = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/system/info`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && onWorkspaceInfoChange) onWorkspaceInfoChange(data);
        const backendWorkspace = data.active_workspace || '';
        if (!cancelled && normalizePath(backendWorkspace) !== normalizePath(currentWorkspace)) {
          onWorkspaceChange(backendWorkspace || '');
        }
      } catch (err) {
        console.error('Error fetching system info:', err);
      }
    };
    syncWorkspace();
    return () => { cancelled = true; };
  }, [currentWorkspace, onWorkspaceChange, onWorkspaceInfoChange]);

  useEffect(() => {
    if (!currentWorkspace) {
      setRootPath(null);
      setNodesByPath({});
      setChildrenByPath({});
      setExpanded(new Set());
      setLoaded(new Set());
      setSelectedPath(null);
      setSearchResults([]);
      return;
    }
    const workspaceChanged = normalizePath(rootPath) !== normalizePath(currentWorkspace);
    if (workspaceChanged) {
      setNodesByPath({});
      setChildrenByPath({});
      setLoaded(new Set());
      setExpanded(new Set([currentWorkspace]));
      setSelectedPath(activeFilePath || currentWorkspace);
      setRootPath(currentWorkspace);
    }
  }, [activeFilePath, currentWorkspace, rootPath]);

  useEffect(() => {
    if (!currentWorkspace) return;
    void refreshExplorer();
  }, [currentWorkspace, refreshExplorer, refreshToken, showHidden]);

  useEffect(() => {
    if (activeFilePath) setSelectedPath(activeFilePath);
  }, [activeFilePath]);

  useEffect(() => {
    if (!lastWorkspaceEvent?.id || !currentWorkspace) return;
    if (
      normalizePath(lastWorkspaceEvent.workspace_path)
      && normalizePath(lastWorkspaceEvent.workspace_path) !== normalizePath(currentWorkspace)
    ) {
      return;
    }
    const refreshTargets = new Set();
    (lastWorkspaceEvent.events || []).forEach((event) => {
      if (event.action === 'modified' && !event.isDirectory) {
        return;
      }
      if (event.parentPath) refreshTargets.add(event.parentPath);
      if (event.oldPath) refreshTargets.add(parentPathOf(event.oldPath));
      if (event.action === 'moved' && event.oldPath && event.path) remapUiPaths(event.oldPath, event.path);
    });
    if (refreshTargets.size > 0) {
      void refreshFolders(Array.from(refreshTargets));
    }
  }, [currentWorkspace, lastWorkspaceEvent, refreshFolders, remapUiPaths]);

  useEffect(() => {
    if (!currentWorkspace || searchQuery.trim().length < SEARCH_MIN) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/files/search?path=${encodeURIComponent(currentWorkspace)}&query=${encodeURIComponent(searchQuery.trim())}&limit=50&show_hidden=${showHidden ? '1' : '0'}`);
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo buscar'));
        const payload = await response.json();
        if (!cancelled) setSearchResults(payload.results || []);
      } catch (err) {
        if (!cancelled) {
          setOperationError({ title: 'Busqueda no completada', message: err.message || 'No se pudo buscar.' });
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentWorkspace, searchQuery, showHidden]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const selectedNode = nodesByPath[selectedPath] || nodesByPath[rootPath] || null;
  const canMutateSelection = Boolean(selectedNode?.path) && normalizePath(selectedNode.path) !== normalizePath(currentWorkspace);
  const resolveCreateParentPath = () => fileActionDialog.parentPath || (selectedNode?.isDirectory ? selectedNode.path : (selectedNode?.path ? parentPathOf(selectedNode.path) : currentWorkspace));
  const openActionDialog = (mode, parentPath = null) => {
    if (!currentWorkspace) {
      setShowFolderSelector(true);
      return;
    }
    setContextMenu(null);
    setFileActionDialog({ mode, error: null, isSubmitting: false, parentPath });
  };
  const closeActionDialog = () => setFileActionDialog({ mode: null, error: null, isSubmitting: false, parentPath: null });
  const markPending = (path) => setPendingPaths((prev) => new Set(prev).add(path));
  const clearPending = (path) => setPendingPaths((prev) => {
    const next = new Set(prev);
    next.delete(path);
    return next;
  });

  const performPaste = useCallback(async (targetDirectory, clip, modeOverride = null) => {
    if (!targetDirectory || !clip?.sourcePath) return;
    const destinationPath = joinPath(targetDirectory, clip.name || clip.sourcePath.split(/[\\/]/).pop());
    if (normalizePath(destinationPath) === normalizePath(clip.sourcePath)) return;
    const mode = modeOverride || clip.mode;
    markPending(clip.sourcePath);
    markPending(targetDirectory);
    const response = await fetch(`${API_BASE}/api/files/${mode === 'copy' ? 'copy' : 'move'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: clip.sourcePath, destinationPath }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, `No se pudo ${mode === 'copy' ? 'copiar' : 'mover'} el elemento`));
    const payload = await response.json();
    clearPending(clip.sourcePath);
    clearPending(targetDirectory);
    if (mode === 'move') {
      remapUiPaths(clip.sourcePath, payload.newPath || destinationPath);
      onPathRenamed?.(clip.sourcePath, payload.newPath || destinationPath);
      setClipboard(null);
    }
    await refreshFolders([parentPathOf(clip.sourcePath), targetDirectory, currentWorkspace]);
    onStatusMessage?.(mode === 'copy' ? `Copiado en ${targetDirectory}` : `Movido a ${targetDirectory}`, 'success');
  }, [currentWorkspace, onPathRenamed, onStatusMessage, refreshFolders, remapUiPaths]);

  const contextNode = contextMenu?.path ? nodesByPath[contextMenu.path] : selectedNode;
  const contextActions = useMemo(() => {
    if (!contextNode) return [];
    const items = [];
    if (contextNode.isDirectory) items.push(['new-file', 'Nuevo archivo'], ['new-folder', 'Nueva carpeta']);
    if (!contextNode.isDirectory) items.push(['open-default', 'Abrir con aplicacion por defecto']);
    if (canMutateSelection) items.push(['rename', 'Renombrar'], ['duplicate', 'Duplicar'], ['copy', 'Copiar'], ['cut', 'Cortar']);
    if (clipboard?.sourcePath) items.push(['paste', `Pegar ${clipboard.mode === 'copy' ? 'copia' : 'movido'} aqui`]);
    if (canMutateSelection) items.push(['delete', 'Eliminar']);
    if (activeFilePath) items.push(['reveal-active', 'Revelar archivo activo']);
    items.push(['refresh', 'Refrescar']);
    return items;
  }, [activeFilePath, canMutateSelection, clipboard?.mode, clipboard?.sourcePath, contextNode]);

  const onContextAction = async (action) => {
    setContextMenu(null);
    try {
      if (action === 'new-file') return openActionDialog('create_file', contextNode.isDirectory ? contextNode.path : parentPathOf(contextNode.path));
      if (action === 'new-folder') return openActionDialog('create_folder', contextNode.isDirectory ? contextNode.path : parentPathOf(contextNode.path));
      if (action === 'open-default') {
        if (typeof onOpenDefaultApplication !== 'function') {
          throw new Error('Apertura con aplicacion por defecto no disponible');
        }
        const opened = await onOpenDefaultApplication(contextNode);
        if (opened === false) {
          throw new Error('No se pudo abrir con la aplicacion por defecto');
        }
        return opened;
      }
      if (action === 'rename') return openActionDialog('rename');
      if (action === 'delete') return openActionDialog('delete');
      if (action === 'copy') return setClipboard({ mode: 'copy', sourcePath: contextNode.path, name: contextNode.name, isDirectory: contextNode.isDirectory });
      if (action === 'cut') return setClipboard({ mode: 'move', sourcePath: contextNode.path, name: contextNode.name, isDirectory: contextNode.isDirectory });
      if (action === 'paste') return performPaste(contextNode.isDirectory ? contextNode.path : parentPathOf(contextNode.path), clipboard);
      if (action === 'duplicate') {
        markPending(contextNode.path);
        const response = await fetch(`${API_BASE}/api/files/duplicate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: contextNode.path }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo duplicar el elemento'));
        const payload = await response.json();
        clearPending(contextNode.path);
        await refreshFolders([parentPathOf(contextNode.path), currentWorkspace]);
        setSelectedPath(payload.path);
        return;
      }
      if (action === 'reveal-active' && activeFilePath) return revealPath(activeFilePath, false);
      if (action === 'refresh') return refreshExplorer();
    } catch (err) {
      setOperationError({ title: 'Operacion no completada', message: err.message || 'No se pudo completar la operacion.' });
    }
  };

  const onSubmitAction = async (rawName) => {
    if (!fileActionDialog.mode) return;
    const targetNode = nodesByPath[selectedPath];
    setFileActionDialog((prev) => ({ ...prev, isSubmitting: true, error: null }));
    try {
      if (fileActionDialog.mode === 'create_file' || fileActionDialog.mode === 'create_folder') {
        const parentPath = resolveCreateParentPath();
        markPending(parentPath);
        const response = await fetch(`${API_BASE}/api/files/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: parentPath, name: rawName?.trim(), type: fileActionDialog.mode === 'create_folder' ? 'folder' : 'file' }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo crear el elemento'));
        const payload = await response.json();
        clearPending(parentPath);
        setExpanded((prev) => new Set(prev).add(parentPath));
        await refreshFolders([parentPath, currentWorkspace]);
        setSelectedPath(payload.path);
        if (fileActionDialog.mode === 'create_file') onFileOpen?.({ path: payload.path, name: rawName?.trim(), isDirectory: false });
      } else if (fileActionDialog.mode === 'rename' && targetNode?.path) {
        markPending(targetNode.path);
        const response = await fetch(`${API_BASE}/api/files/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: targetNode.path, newName: rawName?.trim() }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo renombrar el elemento'));
        const payload = await response.json();
        clearPending(targetNode.path);
        remapUiPaths(targetNode.path, payload.newPath);
        onPathRenamed?.(targetNode.path, payload.newPath);
        await refreshFolders([parentPathOf(targetNode.path), parentPathOf(payload.newPath), currentWorkspace]);
        setSelectedPath(payload.newPath);
      } else if (fileActionDialog.mode === 'delete' && targetNode?.path) {
        markPending(targetNode.path);
        const response = await fetch(`${API_BASE}/api/files/delete?path=${encodeURIComponent(targetNode.path)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo eliminar el elemento'));
        clearPending(targetNode.path);
        onPathDeleted?.(targetNode.path);
        await refreshFolders([parentPathOf(targetNode.path), currentWorkspace]);
        setSelectedPath(currentWorkspace);
      }
      closeActionDialog();
    } catch (err) {
      setFileActionDialog((prev) => ({ ...prev, isSubmitting: false, error: err.message || 'No se pudo completar la accion' }));
      clearPending(targetNode?.path);
    }
  };

  const searchMode = searchQuery.trim().length >= SEARCH_MIN;
  const clampedWidth = Math.max(220, Math.min(420, Number(widthPx) || 260));
  const workspaceName = currentWorkspace ? currentWorkspace.replace(/\\/g, '/').split('/').pop() || currentWorkspace : 'Abrir carpeta...';

  if (isCollapsed) {
    return (
      <div className="file-explorer collapsed has-toggle">
        <button
          className="collapse-toggle explorer-toggle-btn"
          onClick={onToggleCollapse}
          title={SHOW_EXPLORER_LABEL}
          aria-label={SHOW_EXPLORER_LABEL}
        >
          <ExplorerIconSidebar />
        </button>
      </div>
    );
  }

  return (
    <div className="file-explorer" style={{ width: `${clampedWidth}px` }}>
      <div className="explorer-header">
        <button
          type="button"
          className="explorer-title explorer-title-toggle"
          onClick={onToggleCollapse}
          title={HIDE_EXPLORER_LABEL}
          aria-label={HIDE_EXPLORER_LABEL}
        >
          <span className="explorer-icon"><ExplorerIconSidebar /></span>
          <span>EXPLORADOR</span>
        </button>
        <div className="explorer-actions">
          <button onClick={() => openActionDialog('create_file')} className="action-btn" data-testid="explorer-new-file" title="Nuevo archivo" aria-label="Nuevo archivo"><ExplorerIconFilePlus /></button>
          <button onClick={() => openActionDialog('create_folder')} className="action-btn" data-testid="explorer-new-folder" title="Nueva carpeta" aria-label="Nueva carpeta"><ExplorerIconFolderPlus /></button>
          <button onClick={() => openActionDialog('rename')} className="action-btn" data-testid="explorer-rename" title={'Renombrar selecci\u00F3n'} aria-label={'Renombrar selecci\u00F3n'} disabled={!canMutateSelection}><ExplorerIconEdit /></button>
          <button onClick={() => openActionDialog('delete')} className="action-btn" data-testid="explorer-delete" title={'Eliminar selecci\u00F3n'} aria-label={'Eliminar selecci\u00F3n'} disabled={!canMutateSelection}><ExplorerIconTrash /></button>
          <button onClick={() => revealPath(activeFilePath, false)} className="action-btn" data-testid="explorer-reveal-active" title="Revelar archivo activo" aria-label="Revelar archivo activo" disabled={!activeFilePath}><ExplorerIconReveal /></button>
          <button onClick={() => setShowHidden((prev) => !prev)} className={`action-btn ${showHidden ? 'active' : ''}`} data-testid="explorer-show-hidden" title="Mostrar ocultos" aria-label="Mostrar ocultos">{showHidden ? <ExplorerIconEyeOff /> : <ExplorerIconEye />}</button>
          <button onClick={() => refreshExplorer()} className="action-btn" data-testid="explorer-refresh" title="Refrescar" aria-label="Refrescar"><ExplorerIconRefresh /></button>
        </div>
      </div>

      <div className="workspace-selector">
        <button onClick={() => setShowFolderSelector(true)} className="select-folder-btn" data-testid="explorer-workspace-button">
          <span className="folder-icon"><ExplorerFileIcon isDirectory isOpen /></span>
          <span className="folder-name">{workspaceName}</span>
        </button>
      </div>

      <div className="explorer-search">
        <input type="text" placeholder="Quick open por nombre..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="search-input" data-testid="explorer-search" />
        {searchQuery && <button className="clear-search" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda"><ExplorerIconClose /></button>}
      </div>

      <div className="explorer-selection-bar" data-testid="explorer-selection-bar">
        <span className="explorer-selection-bar__label">{searchMode ? 'Quick Open' : 'Seleccion'}</span>
        <span className="explorer-selection-bar__name">{searchMode ? (searchLoading ? 'Buscando...' : `${searchResults.length} resultado(s)`) : (selectedNode?.name || 'Sin seleccion')}</span>
        {clipboard?.sourcePath && <span className="explorer-selection-bar__meta">{clipboard.mode === 'copy' ? 'Copiado' : 'Mover'}: {clipboard.name}</span>}
      </div>

      <div
        className="explorer-content scroll-surface"
        onDragOver={(event) => {
          if (!currentWorkspace) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
          setDragOverPath(currentWorkspace);
        }}
        onDrop={async (event) => {
          if (!currentWorkspace) return;
          event.preventDefault();
          try {
            const payload = JSON.parse(event.dataTransfer.getData('application/inspyro-node'));
            if (payload?.path) {
              await performPaste(currentWorkspace, {
                mode: event.ctrlKey ? 'copy' : 'move',
                sourcePath: payload.path,
                name: payload.name,
                isDirectory: payload.isDirectory,
              }, event.ctrlKey ? 'copy' : 'move');
            }
          } catch (err) {
            setOperationError({ title: 'Drop no completado', message: err.message || 'No se pudo completar la operacion.' });
          } finally {
            setDragOverPath(null);
          }
        }}
      >
        {error && <div className="explorer-error"><span>{error}</span><button onClick={() => refreshExplorer()} className="retry-btn">Reintentar</button></div>}
        {!error && !currentWorkspace && <div className="explorer-empty"><p>No hay carpeta abierta</p><button onClick={() => setShowFolderSelector(true)} className="open-folder-btn">Abrir carpeta</button></div>}
        {!error && currentWorkspace && searchMode && (
          <div className="search-results" data-testid="explorer-search-results">
            {searchLoading && <div className="explorer-loading compact">Buscando...</div>}
            {!searchLoading && !searchResults.length && <div className="explorer-empty compact">Sin resultados</div>}
            {searchResults.map((result) => (
              <div key={`${result.path}:${result.score}`} className="search-result-row">
                <button
                  type="button"
                  className="search-result-main"
                  onClick={async () => { await revealPath(result.path, false); if (!result.isDirectory) onFileOpen?.(result); }}
                  title={result.path || result.relativePath || result.name}
                >
                  <span className="search-result-name">
                    <ExplorerFileIcon extension={result.extension || (result.name?.includes('.') ? `.${result.name.split('.').pop().toLowerCase()}` : '')} isDirectory={result.isDirectory} isOpen={false} />
                    <span title={result.name}>{result.name}</span>
                  </span>
                  <span className="search-result-path" title={result.path || result.relativePath}>
                    {displayParentPathOf(result.relativePath || result.path) || result.relativePath || result.path}
                  </span>
                </button>
                <button
                  type="button"
                  className="search-result-reveal"
                  onClick={() => revealPath(result.path, false)}
                  aria-label={`Revelar ${result.name}`}
                  title={`Revelar ${result.name}`}
                >
                  <ExplorerIconReveal />
                </button>
              </div>
            ))}
          </div>
        )}
        {!error && currentWorkspace && !searchMode && rootPath && nodesByPath[rootPath] && (
          <div className="file-tree" role="tree" aria-label="Arbol de archivos del workspace">
            <TreeNode
              path={rootPath}
              depth={0}
              rootPath={rootPath}
              nodesByPath={nodesByPath}
              childrenByPath={childrenByPath}
              expanded={expanded}
              selectedPath={selectedPath}
              activeFilePath={activeFilePath}
              modifiedFiles={modifiedFiles}
              stalePaths={externalStalePaths}
              conflictPaths={externalConflictPaths}
              loadingPaths={loadingPaths}
              pendingPaths={pendingPaths}
              dragOverPath={dragOverPath}
              onToggle={async (path) => {
                if (!expandedRef.current.has(path)) {
                  setExpanded((prev) => new Set(prev).add(path));
                  await loadFolder(path, false);
                  return;
                }
                setExpanded((prev) => {
                  const next = new Set(prev);
                  next.delete(path);
                  return next;
                });
              }}
              onSelect={setSelectedPath}
              onOpen={(node) => { setSelectedPath(node.path); onFileOpen?.(node); }}
              onContext={(event, node) => { event.preventDefault(); event.stopPropagation(); setSelectedPath(node.path); setContextMenu({ path: node.path, x: event.clientX, y: event.clientY }); }}
              onDragOver={(path) => setDragOverPath(path)}
              onDrop={async (event, path, mode) => {
                try {
                  const payload = JSON.parse(event.dataTransfer.getData('application/inspyro-node'));
                  if (payload?.path) {
                    await performPaste(path, {
                      mode,
                      sourcePath: payload.path,
                      name: payload.name,
                      isDirectory: payload.isDirectory,
                    }, mode);
                  }
                } catch (err) {
                  setOperationError({ title: 'Drop no completado', message: err.message || 'No se pudo completar la operacion.' });
                } finally {
                  setDragOverPath(null);
                }
              }}
            />
          </div>
        )}
      </div>

      {contextMenu && contextActions.length > 0 && (
        <div className="explorer-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          {contextActions.map(([id, label]) => (
            <button key={id} type="button" className="explorer-context-menu__item" onClick={() => void onContextAction(id)}>{label}</button>
          ))}
        </div>
      )}

      <FolderSelector
        isOpen={showFolderSelector}
        onClose={() => setShowFolderSelector(false)}
        onSelect={async (path) => {
          try {
            const response = await fetch(`${API_BASE}/api/system/workspace`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path }),
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo abrir el workspace'));
            const data = await response.json();
            if (onWorkspaceInfoChange) onWorkspaceInfoChange(data);
            onWorkspaceChange(data.workspace_root || data.workspace_path || path);
            setShowFolderSelector(false);
          } catch (err) {
            setError(err.message);
          }
        }}
        onCreateWorkspace={async ({ parentPath, name }) => {
          const response = await fetch(`${API_BASE}/api/system/workspace/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_path: parentPath, name }),
          });
          if (!response.ok) throw new Error(await readErrorMessage(response, 'No se pudo crear el workspace'));
          const data = await response.json();
          if (onWorkspaceInfoChange) onWorkspaceInfoChange(data);
          onWorkspaceChange(data.workspace_root || data.workspace_path || parentPath);
          setShowFolderSelector(false);
        }}
        initialPath={currentWorkspace}
      />

      <FileActionDialog
        isOpen={Boolean(fileActionDialog.mode)}
        mode={fileActionDialog.mode}
        targetName={selectedNode?.name || ''}
        targetPath={selectedNode?.path || ''}
        parentPath={resolveCreateParentPath()}
        error={fileActionDialog.error}
        isSubmitting={fileActionDialog.isSubmitting}
        onClose={closeActionDialog}
        onSubmit={onSubmitAction}
      />

      {operationError && (
        <div className="explorer-dialog-overlay" onClick={() => setOperationError(null)}>
          <div className="explorer-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="explorer-dialog__header">
              <h3>{operationError.title || 'Operacion no completada'}</h3>
              <button type="button" onClick={() => setOperationError(null)}>X</button>
            </div>
            <div className="explorer-dialog__body"><p>{operationError.message || 'No se pudo completar la operacion.'}</p></div>
            <div className="explorer-dialog__actions"><button type="button" onClick={() => setOperationError(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
