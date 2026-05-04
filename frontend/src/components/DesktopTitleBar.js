import React from 'react';
import NotificationCenter from './NotificationCenter';
import NotebookToolbar from './NotebookToolbar';
import McpStatusButton from './McpStatusButton';
import { IconPlay } from './Icons';
import './DesktopTitleBar.css';

export default function DesktopTitleBar({
  isDesktop = false,
  showProjectLauncher = false,
  isWorkspaceHome = false,
  workspaceName = 'Espacio de trabajo',
  mode = 'code',
  hasContextualFile = false,
  hasOpenFiles = false,
  connectionStatus = 'disconnected',
  connectionStatusText = 'Desconocido',
  notifications = [],
  onDismissNotification,
  onDismissAllNotifications,
  onNavigate = null,
  mcpStatus = null,
  mcpRunningCount = 0,
  mirrorEnabled = true,
  mirrorToggleDisabled = false,
  mirrorDisabledReason = '',
  onToggleMirror,
  onToggleMcpPanel,
  onMcpQuickAction,
  onGoHome = null,
  onGoToFileSurface = null,
  notebookToolbarProps = null,
  onExecuteCode = null,
  isCodeExecuting = false,
}) {
  const showNotebookToolbar = !showProjectLauncher && !isWorkspaceHome && mode === 'notebook' && Boolean(notebookToolbarProps);
  const showCodeRunButton = !showProjectLauncher && !isWorkspaceHome && hasContextualFile && mode === 'code';
  const hasContextActions = showNotebookToolbar || showCodeRunButton;
  const showMissionStrip = showProjectLauncher || isWorkspaceHome || !hasContextActions;
  const showWorkspaceNav = !showProjectLauncher && (Boolean(onGoHome) || (hasOpenFiles && Boolean(onGoToFileSurface)));

  return (
    <header
      className={[
        'desktop-titlebar',
        isDesktop ? 'desktop-titlebar--electron' : 'desktop-titlebar--web',
      ].join(' ')}
    >
      <div className="desktop-titlebar__top">
        <div className="desktop-titlebar__identity">
          <div className="desktop-titlebar__brand">
            <div className="desktop-titlebar__logo" role="img" aria-label="Inspyro brand mark">
              <img className="desktop-titlebar__brand-icon" src="/brand/inspyro-mark-light-128.png" alt="" draggable="false" />
            </div>
            <div className="desktop-titlebar__brand-copy">
              <strong>Inspyro</strong>
              <span className="desktop-titlebar__brand-tagline">Espacio de ingeniería nativo para IA</span>
            </div>
          </div>

          {showWorkspaceNav && (
            <div
              className="desktop-titlebar__workspace-nav desktop-no-drag"
              data-testid="desktop-titlebar-workspace-nav"
            >
              <span className="desktop-titlebar__workspace-label" title={workspaceName}>
                {workspaceName}
              </span>
              <button
                type="button"
                className={`desktop-titlebar__workspace-btn ${isWorkspaceHome ? 'is-active' : ''}`}
                onClick={onGoHome}
                aria-pressed={isWorkspaceHome}
                data-testid="desktop-titlebar-go-home"
              >
                Inicio
              </button>
              {hasOpenFiles && (
                <button
                  type="button"
                  className={`desktop-titlebar__workspace-btn ${!isWorkspaceHome ? 'is-active' : ''}`}
                  onClick={onGoToFileSurface}
                  aria-pressed={!isWorkspaceHome}
                  data-testid="desktop-titlebar-go-file"
                >
                  Archivos
                </button>
              )}
            </div>
          )}
        </div>

        <div
          className="desktop-titlebar__context desktop-no-drag"
          data-testid="desktop-titlebar-context"
        >
          {showMissionStrip && (
            <div className="desktop-titlebar__mission" data-testid="desktop-titlebar-mission">
              <span className="desktop-titlebar__mission-pill">Entender el proyecto</span>
              <span className="desktop-titlebar__mission-pill">Ejecutar cálculos</span>
              <span className="desktop-titlebar__mission-pill">Entregar informes</span>
            </div>
          )}

          {hasContextActions && !showMissionStrip && (
            <div
              className="desktop-titlebar__context-actions"
              data-testid="desktop-titlebar-context-actions"
            >
              {showNotebookToolbar ? (
                <div className="desktop-titlebar__toolbar-shell">
                  <NotebookToolbar {...notebookToolbarProps} />
                </div>
              ) : (
                <button
                  className="app-toolbar-icon-btn primary"
                  onClick={onExecuteCode}
                  disabled={isCodeExecuting || connectionStatus !== 'connected'}
                  title="Ejecutar código activo"
                  data-testid="desktop-titlebar-run-code"
                >
                  <IconPlay />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="desktop-titlebar__top-actions desktop-no-drag">
          <NotificationCenter
            notifications={notifications}
            onDismiss={onDismissNotification}
            onDismissAll={onDismissAllNotifications}
            onNavigate={onNavigate}
          />

          <div className={`desktop-status-chip desktop-status-chip--${connectionStatus}`}>
            <span className={`status-indicator status-${connectionStatus}`}></span>
            <span>{connectionStatusText}</span>
          </div>

          <McpStatusButton
            status={mcpStatus?.status || 'stopped'}
            port={mcpStatus?.port}
            runningCount={mcpRunningCount}
            mirrorEnabled={mirrorEnabled}
            mirrorToggleDisabled={mirrorToggleDisabled}
            mirrorDisabledReason={mirrorDisabledReason}
            onTogglePanel={onToggleMcpPanel}
            onToggleMirror={onToggleMirror}
            onQuickAction={onMcpQuickAction}
          />
        </div>
      </div>
    </header>
  );
}
