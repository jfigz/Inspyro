import React, { useEffect, useMemo, useState } from 'react';
import './FileActionDialog.css';

const TITLES = {
  create_file: 'Nuevo archivo',
  create_folder: 'Nueva carpeta',
  rename: 'Renombrar',
  delete: 'Eliminar',
};

const DESCRIPTIONS = {
  create_file: 'Crea un archivo nuevo dentro de la carpeta seleccionada.',
  create_folder: 'Crea una carpeta nueva dentro de la carpeta seleccionada.',
  rename: 'Cambia el nombre del elemento seleccionado sin moverlo de directorio.',
  delete: 'Esta accion elimina el elemento seleccionado del workspace.',
};

const PLACEHOLDERS = {
  create_file: 'ej: calculo.py',
  create_folder: 'ej: resultados',
  rename: 'Nuevo nombre',
};

const CONFIRM_LABELS = {
  create_file: 'Crear archivo',
  create_folder: 'Crear carpeta',
  rename: 'Renombrar',
  delete: 'Eliminar',
};

function FileActionDialog({
  isOpen,
  mode,
  targetName = '',
  targetPath = '',
  parentPath = '',
  isSubmitting = false,
  error = null,
  onClose,
  onSubmit,
}) {
  const getInitialName = (nextMode, nextTargetName) => (
    nextMode === 'rename' ? (nextTargetName || '') : ''
  );

  const [name, setName] = useState(() => getInitialName(mode, targetName));

  useEffect(() => {
    if (isOpen) {
      setName(getInitialName(mode, targetName));
    }
  }, [isOpen, mode, targetName]);

  const title = TITLES[mode] || 'Accion de archivo';
  const description = DESCRIPTIONS[mode] || '';
  const placeholder = PLACEHOLDERS[mode] || '';
  const confirmLabel = CONFIRM_LABELS[mode] || 'Confirmar';
  const requiresName = mode !== 'delete';

  const resolvedTargetPath = useMemo(() => {
    if (mode === 'delete' || mode === 'rename') {
      return targetPath || parentPath || '';
    }
    return parentPath || '';
  }, [mode, parentPath, targetPath]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    onSubmit?.(requiresName ? name : null);
  };

  return (
    <div className="file-action-dialog__overlay" onClick={onClose} data-testid="file-action-dialog-overlay">
      <div
        className="file-action-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="file-action-dialog"
      >
        <div className="file-action-dialog__header">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className="file-action-dialog__close"
            onClick={onClose}
            aria-label="Cerrar dialogo"
            data-testid="file-action-close"
          >
            ×
          </button>
        </div>

        <form className="file-action-dialog__body" onSubmit={handleSubmit}>
          <div className="file-action-dialog__meta">
            <span className="file-action-dialog__meta-label">
              {mode === 'create_file' || mode === 'create_folder' ? 'Destino' : 'Elemento'}
            </span>
            <code className="file-action-dialog__path">{resolvedTargetPath || 'Sin ruta seleccionada'}</code>
          </div>

          {requiresName ? (
            <label className="file-action-dialog__field">
              <span>Nombre</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={placeholder}
                autoFocus
                disabled={isSubmitting}
                data-testid="file-action-name-input"
              />
            </label>
          ) : (
            <div className="file-action-dialog__warning" data-testid="file-action-delete-warning">
              <strong>{targetName}</strong>
              <span>Esta accion no se puede deshacer.</span>
            </div>
          )}

          {error && (
            <div className="file-action-dialog__error" role="alert" data-testid="file-action-error">
              {error}
            </div>
          )}

          <div className="file-action-dialog__actions">
            <button
              type="button"
              className="file-action-dialog__btn secondary"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="file-action-cancel"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`file-action-dialog__btn ${mode === 'delete' ? 'danger' : 'primary'}`}
              disabled={isSubmitting || (requiresName && !name.trim())}
              data-testid="file-action-confirm"
            >
              {isSubmitting ? 'Aplicando...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FileActionDialog;
