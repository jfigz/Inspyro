/**
 * NotebookToolbar.js - Barra de herramientas compacta para el notebook
 *
 * Diseñado para integrarse en el header principal, reemplazando el toolbar
 * interno del NotebookEditor.
 */

import React, { useRef } from 'react';
import DropdownMenu from './DropdownMenu';
import {
    IconCode,
    IconText,
    IconPlayAll,
    IconStop,
    IconRefresh,
    IconSave,
    IconDocument,
    IconSettings,
    IconUpload,
    IconPower,
    IconTerminal,
    IconCheck,
    IconMenu,
    IconTrash,
} from './Icons';
import './NotebookToolbar.css';

const NotebookToolbar = ({
    kernelId = null,
    kernelInterrupted = false,
    isExecuting = false,
    onAddCode,
    onAddMarkdown,
    onExecuteAll,
    onInterrupt,
    onReset,
    onShutdown,
    onClearOutputs,
    onSave,
    onLoad,
    autoDocEnabled = false,
    onToggleAutoDoc,
    autoSaveEnabled = false,
    onToggleAutoSave,
    trustHtml = false,
    onToggleTrustHtml,
    enableTracing = false,
    onToggleTracing,
    docxValidationEnabled = true,
    onToggleDocxValidation,
    hasNotebook = false
}) => {
    const hasKernel = Boolean(kernelId);
    const loadInputRef = useRef(null);

    const settingsOptions = [
        {
            type: 'toggle',
            id: 'autodoc',
            label: 'DOCX/PDF Auto',
            icon: <IconDocument />,
            checked: autoDocEnabled,
            onChange: onToggleAutoDoc,
            closeOnClick: false
        },
        {
            type: 'toggle',
            id: 'autosave',
            label: 'Autoguardado',
            icon: <IconSave />,
            checked: autoSaveEnabled,
            onChange: onToggleAutoSave,
            closeOnClick: false
        },
        { type: 'separator' },
        {
            type: 'toggle',
            id: 'trusthtml',
            label: 'HTML/JS confiable',
            icon: <IconCheck />,
            checked: trustHtml,
            onChange: onToggleTrustHtml,
            closeOnClick: false
        },
        {
            type: 'toggle',
            id: 'docxvalidation',
            label: 'Validacion DOCX',
            icon: <IconDocument />,
            checked: docxValidationEnabled,
            onChange: onToggleDocxValidation,
            closeOnClick: false
        },
        {
            type: 'toggle',
            id: 'tracing',
            label: 'Tracing',
            icon: <IconTerminal />,
            checked: enableTracing,
            onChange: onToggleTracing,
            closeOnClick: false
        },
        { type: 'separator' },
        {
            id: 'shutdown',
            label: 'Apagar kernel',
            icon: <IconPower />,
            onClick: onShutdown,
            disabled: !hasKernel
        }
    ];

    const utilityOptions = [
        {
            id: 'clear-outputs',
            label: 'Eliminar outputs',
            icon: <IconTrash />,
            onClick: onClearOutputs,
            disabled: !hasNotebook || isExecuting
        }
    ];

    return (
        <div className="notebook-toolbar-compact" data-testid="notebook-toolbar">
            <div className="toolbar-group">
                <button
                    className="toolbar-icon-btn add"
                    onClick={() => onAddCode?.()}
                    disabled={!hasNotebook}
                    title="Agregar celda de código"
                    aria-label="Agregar celda de código"
                    data-testid="notebook-toolbar-add-code"
                >
                    <IconCode />
                </button>
                <button
                    className="toolbar-icon-btn add"
                    onClick={() => onAddMarkdown?.()}
                    disabled={!hasNotebook}
                    title="Agregar celda de texto"
                    aria-label="Agregar celda de texto"
                    data-testid="notebook-toolbar-add-markdown"
                >
                    <IconText />
                </button>
            </div>

            <div className="toolbar-separator" />

            <div className="kernel-indicator" title={kernelId ? `Kernel: ${kernelId}` : 'Sin kernel'}>
                <span className={`kernel-dot ${hasKernel ? (kernelInterrupted ? 'interrupted' : 'active') : 'inactive'}`} />
                <span className="kernel-label">
                    {hasKernel ? kernelId.slice(0, 8) : 'Sin kernel'}
                </span>
            </div>

            <div className="toolbar-separator" />

            <div className="toolbar-group">
                <button
                    className="toolbar-icon-btn primary"
                    onClick={onExecuteAll}
                    disabled={!hasNotebook || isExecuting}
                    title="Ejecutar todas las celdas"
                    aria-label="Ejecutar todas las celdas"
                    data-testid="notebook-toolbar-run-all"
                >
                    <IconPlayAll />
                </button>
                <button
                    className="toolbar-icon-btn kernel danger"
                    onClick={onInterrupt}
                    disabled={!hasKernel}
                    title="Interrumpir ejecución"
                    aria-label="Interrumpir ejecución"
                    data-testid="notebook-toolbar-interrupt"
                >
                    <IconStop />
                </button>
                <button
                    className="toolbar-icon-btn kernel"
                    onClick={onReset}
                    disabled={!hasKernel}
                    title="Reiniciar kernel"
                    aria-label="Reiniciar kernel"
                    data-testid="notebook-toolbar-reset-kernel"
                >
                    <IconRefresh />
                </button>
            </div>

            <div className="toolbar-separator" />

            <div className="toolbar-group">
                <button
                    className="toolbar-icon-btn save"
                    onClick={onSave}
                    disabled={!hasNotebook}
                    title="Guardar notebook"
                    aria-label="Guardar notebook"
                    data-testid="notebook-toolbar-save"
                >
                    <IconSave />
                </button>

                <button
                    type="button"
                    className="toolbar-icon-btn file-input save"
                    title="Cargar notebook"
                    aria-label="Cargar notebook"
                    data-testid="notebook-toolbar-load"
                    onClick={() => loadInputRef.current?.click()}
                >
                    <IconUpload />
                </button>
                <input
                    ref={loadInputRef}
                    type="file"
                    accept=".ipynb"
                    onChange={onLoad}
                    style={{ display: 'none' }}
                    data-testid="notebook-toolbar-load-input"
                />

                <button
                    className={`toolbar-icon-btn doc toggle ${autoDocEnabled ? 'active' : ''}`}
                    onClick={() => onToggleAutoDoc?.(!autoDocEnabled)}
                    title={autoDocEnabled ? 'DOCX/PDF: Activado' : 'DOCX/PDF: Desactivado'}
                    aria-label={autoDocEnabled ? 'Desactivar DOCX/PDF automatico' : 'Activar DOCX/PDF automatico'}
                    data-testid="notebook-toolbar-toggle-docx"
                >
                    <IconDocument />
                </button>
            </div>

            <div className="toolbar-separator" />

            <DropdownMenu
                options={settingsOptions}
                icon={<IconSettings />}
                title="Configuración"
                className="toolbar-dropdown config"
                dataTestId="notebook-toolbar-settings"
            />
            <DropdownMenu
                options={utilityOptions}
                icon={<IconMenu />}
                title="Más acciones"
                className="toolbar-dropdown more-actions"
                dataTestId="notebook-toolbar-more-actions"
            />
        </div>
    );
};

export default NotebookToolbar;
