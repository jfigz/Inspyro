import React from 'react';
import { IconMcp } from './Icons';
import './McpStatusButton.css';

const STATUS_LABELS = {
  stopped: 'Agentes: sin conexión',
  starting: 'Agentes: iniciando...',
  running: 'Agentes: listos',
  error: 'Agentes: error',
};

const STATUS_CLASSES = {
  stopped: 'mcp-stopped',
  starting: 'mcp-starting',
  running: 'mcp-running',
  error: 'mcp-error',
};

export default function McpStatusButton({
  status,
  port,
  runningCount = 0,
  mirrorEnabled = true,
  mirrorToggleDisabled = false,
  mirrorDisabledReason = '',
  onTogglePanel,
  onQuickAction,
  onToggleMirror,
}) {
  const mcpClass = STATUS_CLASSES[status] || 'mcp-stopped';
  const label = STATUS_LABELS[status] || 'Agentes';
  const mirrorTitle = mirrorToggleDisabled
    ? (mirrorDisabledReason || 'La vista activa de agentes no está disponible temporalmente')
    : (mirrorEnabled ? 'La vista activa de agentes está habilitada' : 'La vista activa de agentes está deshabilitada');

  const handleClick = (event) => {
    if (event.shiftKey && status === 'stopped') {
      onQuickAction?.('start');
    } else if (event.shiftKey && status === 'running') {
      onQuickAction?.('stop');
    } else {
      onTogglePanel?.();
    }
  };

  return (
    <div className={`mcp-status-split ${mcpClass}`} id="mcp-status-button">
      <button
        type="button"
        className={`mcp-status-btn ${mcpClass} mcp-status-btn--main`}
        onClick={handleClick}
        title={`${label}${port ? ` - :${port}` : ''}\nClick: abrir panel de agentes | Shift+Click: iniciar/detener agentes`}
        data-testid="mcp-status-button"
      >
        <span className={`mcp-indicator ${mcpClass}`} />
        <IconMcp className="mcp-icon" />
        <span className="mcp-label">{status === 'running' ? 'Agentes' : label}</span>
        {runningCount > 0 && <span className="mcp-running-count">{runningCount}</span>}
      </button>

      <button
        type="button"
        className={`mcp-mirror-toggle ${mirrorEnabled ? 'mirror-on' : 'mirror-off'}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMirror?.();
        }}
        title={mirrorTitle}
        aria-label="Alternar vista activa de agentes"
        aria-pressed={mirrorEnabled}
        disabled={mirrorToggleDisabled}
        data-testid="mcp-mirror-toggle"
      >
        <span className="mcp-mirror-toggle__label">LIVE</span>
      </button>
    </div>
  );
}
