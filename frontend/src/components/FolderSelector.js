import React, { useState, useEffect } from 'react';
import './FolderSelector.css';
import { API_BASE } from '../config/endpoints';

const FolderSelector = ({ isOpen, onClose, onSelect, onCreateWorkspace, initialPath }) => {
    const [currentPath, setCurrentPath] = useState(initialPath || '');
    const [contents, setContents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [drives, setDrives] = useState([]);
    const [isRoot, setIsRoot] = useState(!initialPath);
    const [selectedItem, setSelectedItem] = useState(null);
    const [suggestedWorkspaceRoot, setSuggestedWorkspaceRoot] = useState('');
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [actionError, setActionError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch drives on mount
    useEffect(() => {
        if (isOpen) {
            fetch(`${API_BASE}/api/system/info`)
                .then(res => res.json())
                .then(data => {
                    if (data.available_drives) {
                        setDrives(data.available_drives);
                        setSuggestedWorkspaceRoot(data.suggested_workspace_root || data.workspace_root || '');
                        // If no initial path, start at root (drives list)
                        if (!initialPath && !currentPath) {
                            setIsRoot(true);
                        } else if (!currentPath && data.workspace_root) {
                            setCurrentPath(data.workspace_root);
                            setIsRoot(false);
                        }
                    }
                })
                .catch(err => console.error("Error fetching drives:", err));
        }
    }, [isOpen, initialPath, currentPath]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleEscClose = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscClose);
        return () => window.removeEventListener('keydown', handleEscClose);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!isOpen) {
            setActionError(null);
            setNewWorkspaceName('');
            setIsSubmitting(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setCurrentPath(initialPath || '');
        setIsRoot(!initialPath);
        setSelectedItem(null);
    }, [initialPath, isOpen]);

    // Fetch folders content
    useEffect(() => {
        if (!isOpen) return;

        if (isRoot) {
            // Show drives as folder items
            const driveItems = drives.map(d => ({
                name: d,
                path: d,
                isDirectory: true,
                type: 'drive'
            }));
            setContents(driveItems);
            setLoading(false);
            return;
        }

        if (!currentPath) return;

        setLoading(true);
        setError(null);
        setSelectedItem(null); // Deselect on nav

        fetch(`${API_BASE}/api/files/tree?path=${encodeURIComponent(currentPath)}&depth=1`)
            .then(res => {
                if (!res.ok) throw new Error(`Error ${res.status}`);
                return res.json();
            })
            .then(data => {
                // data matches "tree" structure. data.children has items.
                // We only want directories for the picker
                if (data.children) {
                    const folders = data.children.filter(c => c.isDirectory);
                    setContents(folders);
                } else {
                    setContents([]);
                }
            })
            .catch(err => {
                setError(err.message);
                setContents([]);
            })
            .finally(() => setLoading(false));

    }, [currentPath, isOpen, isRoot, drives]);

    const handleNavigate = (path) => {
        setCurrentPath(path);
        setIsRoot(false);
    };

    const handleUp = () => {
        if (!currentPath || isRoot) return;

        // Check if we are at a drive root (e.g. C:\)
        // Logic: if parent is same or empty, go to drives
        // Simple parsing

        // On Windows C:\ parent is C:\ if using os.path.dirname logic sometimes
        // But typically we want to go to "Computer" view if we go up from Drive root
        if (drives.includes(currentPath) || drives.includes(currentPath + '\\') || drives.includes(currentPath + '/')) {
            setIsRoot(true);
            setCurrentPath('');
            return;
        }

        // Hacky parent resolution for now, better to assume generic usage
        // We can use the logic provided by drives list to detect if we are at root
        // Or just try to strip last segment
        let parent = '';
        if (currentPath.includes('/') || currentPath.includes('\\')) {
            // Normalized separator handling
            const sep = currentPath.includes('\\') ? '\\' : '/';
            const parts = currentPath.split(sep).filter(p => p);
            if (parts.length <= 1) { // e.g. ["C:"]
                setIsRoot(true);
                setCurrentPath('');
                return;
            }
            parts.pop();
            parent = parts.join(sep);
            // Restore drive separator if needed (e.g. C: -> C:\)
            if (parent.endsWith(':')) parent += sep;
            // If generic unix /path -> /
            if (parent === '' && currentPath.startsWith('/')) parent = '/';
        }

        if (!parent && !isRoot) {
            setIsRoot(true);
            setCurrentPath('');
        } else {
            setCurrentPath(parent);
        }
    };

    const handleConfirm = () => {
        const target = selectedItem ? selectedItem.path : currentPath;
        if (!target || !onSelect) return;

        setActionError(null);
        setIsSubmitting(true);
        Promise.resolve(onSelect(target))
            .catch(err => setActionError(err?.message || 'No se pudo abrir el workspace'))
            .finally(() => setIsSubmitting(false));
    };

    const handleCreateWorkspace = () => {
        if (!onCreateWorkspace) return;
        const trimmedName = newWorkspaceName.trim();
        if (!trimmedName) {
            setActionError('Escribe un nombre para el nuevo workspace');
            return;
        }

        const parentPath = selectedItem?.path || currentPath || suggestedWorkspaceRoot;
        if (!parentPath) {
            setActionError('Selecciona primero una carpeta padre');
            return;
        }

        setActionError(null);
        setIsSubmitting(true);
        Promise.resolve(onCreateWorkspace({ parentPath, name: trimmedName }))
            .catch(err => setActionError(err?.message || 'No se pudo crear el workspace'))
            .finally(() => setIsSubmitting(false));
    };

    const moveFolderFocus = (currentTarget, direction) => {
        const listRoot = currentTarget.closest('.folder-list');
        if (!listRoot) return;
        const items = Array.from(listRoot.querySelectorAll('.folder-item[role="option"]'));
        const currentIndex = items.indexOf(currentTarget);
        if (currentIndex < 0) return;
        const nextIndex = currentIndex + direction;
        if (nextIndex >= 0 && nextIndex < items.length) {
            items[nextIndex].focus();
        }
    };

    const handleFolderItemKeyDown = (event, item) => {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                handleNavigate(item.path);
                break;
            case ' ':
                event.preventDefault();
                setSelectedItem(item);
                break;
            case 'ArrowDown':
                event.preventDefault();
                moveFolderFocus(event.currentTarget, 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveFolderFocus(event.currentTarget, -1);
                break;
            default:
                break;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="folder-selector-overlay" onClick={onClose}>
            <div
                className="folder-selector-modal"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Selector de carpeta"
                data-testid="folder-selector-dialog"
            >
                <div className="folder-selector-header">
                    <span className="folder-selector-title">Seleccionar Carpeta</span>
                    <button className="folder-selector-close" onClick={onClose} aria-label="Cerrar selector de carpeta">✕</button>
                </div>

                <div className="folder-path-bar">
                    <button
                        className="folder-up-btn"
                        onClick={handleUp}
                        disabled={isRoot}
                        title="Subir nivel"
                        data-testid="folder-selector-up"
                    >
                        ⬆
                    </button>
                    <div className="folder-current-path" data-testid="folder-selector-current-path">
                        {isRoot ? 'Este Equipo' : currentPath}
                    </div>
                </div>

                <div className="folder-selector-body">
                    <div className="workspace-create-panel">
                        <div className="workspace-create-copy">
                            <span className="workspace-create-title">Nuevo workspace</span>
                            <span className="workspace-create-target">
                                Destino: {selectedItem?.path || currentPath || suggestedWorkspaceRoot || 'Selecciona una carpeta'}
                            </span>
                        </div>
                        <div className="workspace-create-form">
                            <input
                                type="text"
                                value={newWorkspaceName}
                                onChange={(event) => setNewWorkspaceName(event.target.value)}
                                placeholder="Nombre del workspace"
                                className="workspace-create-input"
                                disabled={isSubmitting}
                                data-testid="folder-selector-workspace-name"
                            />
                            <button
                                className="folder-btn create"
                                onClick={handleCreateWorkspace}
                                disabled={isSubmitting}
                                data-testid="folder-selector-create-workspace"
                            >
                                Crear y abrir
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="folder-loading">Cargando...</div>
                    ) : error ? (
                        <div className="folder-error">
                            <span>{error}</span>
                            <button onClick={() => setIsRoot(true)} style={{ marginTop: 10 }}>Ir a Inicio</button>
                        </div>
                    ) : (
                        <div className="folder-list scroll-surface" role="listbox" aria-label="Lista de carpetas disponibles">
                            {contents.length === 0 && (
                                <div className="folder-loading">Carpeta vacía</div>
                            )}
                            {contents.map(item => (
                                <div
                                    key={item.path}
                                    className={`folder-item ${selectedItem?.path === item.path ? 'selected' : ''}`}
                                    onClick={() => setSelectedItem(item)}
                                    onDoubleClick={() => handleNavigate(item.path)}
                                    onKeyDown={(event) => handleFolderItemKeyDown(event, item)}
                                    role="option"
                                    tabIndex={0}
                                    aria-selected={selectedItem?.path === item.path}
                                    data-testid="folder-selector-item"
                                >
                                    <span className="folder-icon">
                                        {item.type === 'drive' ? '💾' : '📁'}
                                    </span>
                                    <span className="folder-item-name">{item.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="folder-selector-footer">
                    {actionError && <div className="folder-action-error">{actionError}</div>}
                    <button className="folder-btn cancel" onClick={onClose}>Cancelar</button>
                    <button
                        className="folder-btn select"
                        onClick={handleConfirm}
                        disabled={isSubmitting || (!currentPath && !selectedItem && !isRoot)}
                        data-testid="folder-selector-open-workspace"
                    >
                        Abrir workspace
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FolderSelector;
