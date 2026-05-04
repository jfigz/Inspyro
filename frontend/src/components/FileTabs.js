import React, { useRef, useEffect } from 'react';
import { IconSave } from './Icons';
import { ExplorerFileIcon, ExplorerIconClose } from './ExplorerIcons';
import './FileTabs.css';

const getFileExtension = (file) => {
  if (file?.extension) {
    return file.extension;
  }

  const sourceName = file?.name || file?.path || '';
  const basename = sourceName.split(/[\\/]/).pop() || '';
  if (basename === '.env') {
    return '.env';
  }

  const dotIndex = basename.lastIndexOf('.');
  return dotIndex > 0 ? basename.slice(dotIndex).toLowerCase() : '';
};

const FileTabs = ({
  openFiles = [],
  activeFile,
  onFileSelect,
  onFileClose,
  onFileSave,
  modifiedFiles = new Set(),
  onDrop
}) => {
  const tabsContainerRef = useRef(null);
  const activeTabRef = useRef(null);

  // Scroll al tab activo cuando cambia.
  useEffect(() => {
    if (activeTabRef.current && tabsContainerRef.current) {
      const container = tabsContainerRef.current;
      const tab = activeTabRef.current;

      const containerRect = container.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();

      if (tabRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - tabRect.left + 20;
      } else if (tabRect.right > containerRect.right) {
        container.scrollLeft += tabRect.right - containerRect.right + 20;
      }
    }
  }, [activeFile]);

  // Manejar scroll con rueda del mouse.
  const handleWheel = (e) => {
    if (tabsContainerRef.current) {
      e.preventDefault();
      tabsContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && data.path) {
        onDrop && onDrop(data);
      }
    } catch (err) {
      // No es un archivo valido del explorador.
    }
  };

  const handleClose = (e, file) => {
    e.stopPropagation();

    if (modifiedFiles.has(file.path)) {
      const shouldClose = window.confirm(
        `El archivo "${file.name}" tiene cambios sin guardar. Deseas cerrarlo de todos modos?`
      );
      if (!shouldClose) return;
    }

    onFileClose && onFileClose(file);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    // Aqui se podria implementar un menu contextual.
  };

  const handleDoubleClick = (file) => {
    if (modifiedFiles.has(file.path)) {
      onFileSave && onFileSave(file);
    }
  };

  const handleKeyDown = (e, file) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'w') {
        e.preventDefault();
        handleClose(e, file);
      } else if (e.key === 's') {
        e.preventDefault();
        onFileSave && onFileSave(file);
      }
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFileSelect && onFileSelect(file);
    }
  };

  if (openFiles.length === 0) {
    return (
      <div className="file-tabs empty">
        <div className="empty-message">
          <span>No hay archivos abiertos</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="file-tabs"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className="tabs-scroll-container"
        ref={tabsContainerRef}
        onWheel={handleWheel}
      >
        <div className="tabs-list" role="tablist" aria-label="Archivos abiertos">
          {openFiles.map((file) => {
            const isActive = activeFile?.path === file.path;
            const isModified = modifiedFiles.has(file.path);
            const extension = getFileExtension(file);

            return (
              <div
                key={file.path}
                ref={isActive ? activeTabRef : null}
                className={`file-tab ${isActive ? 'active' : ''} ${isModified ? 'modified' : ''}`}
                onClick={() => onFileSelect && onFileSelect(file)}
                onContextMenu={handleContextMenu}
                onDoubleClick={() => handleDoubleClick(file)}
                onKeyDown={(e) => handleKeyDown(e, file)}
                role="tab"
                aria-selected={isActive}
                aria-label={`${file.name}${isModified ? ' modificado' : ''}`}
                tabIndex={0}
                title={`${file.path}${isModified ? ' (modificado)' : ''}`}
              >
                <span className="tab-icon">
                  <ExplorerFileIcon extension={extension} />
                </span>
                <span className="tab-name">{file.name}</span>

                {isModified && (
                  <span
                    className="modified-indicator"
                    title="Cambios sin guardar"
                    aria-label="Cambios sin guardar"
                  >
                    <span className="modified-indicator-dot" />
                  </span>
                )}

                <button
                  type="button"
                  className="tab-close"
                  onClick={(e) => handleClose(e, file)}
                  title="Cerrar"
                  aria-label={`Cerrar ${file.name}`}
                >
                  <ExplorerIconClose />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tabs-actions">
        {modifiedFiles.size > 0 && (
          <button
            type="button"
            className="save-all-btn"
            onClick={() => {
              openFiles.forEach(file => {
                if (modifiedFiles.has(file.path)) {
                  onFileSave && onFileSave(file);
                }
              });
            }}
            title="Guardar todos"
            aria-label="Guardar todos"
          >
            <IconSave />
          </button>
        )}
      </div>
    </div>
  );
};

export default FileTabs;
