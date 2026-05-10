import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../config/endpoints';
import { IconPlay, IconStop, IconRefresh } from './Icons';
import './McpPanel.css';

const formatUptime = (seconds) => {
  if (!seconds) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const formatTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString();
};

const formatDuration = (value) => {
  if (typeof value !== 'number') return null;
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
};

const getEventStatusLabel = (event) => {
  if (event.phase === 'failed') return 'Error';
  if (event.phase === 'completed') return 'Completado';
  return 'En ejecución';
};

const jsonSnippet = (value) => JSON.stringify(value, null, 2);

const buildMcpConfiguration = (mcpStatus, port) => {
  const configuration = mcpStatus?.configuration || {};
  const httpEndpoint = configuration.http_endpoint
    || configuration.streamable_http?.url
    || mcpStatus?.url
    || `http://127.0.0.1:${port}/mcp`;
  const backend = configuration.backend || {};
  const backendUrl = backend.url || API_BASE || 'http://127.0.0.1:8000';
  const backendWsUrl = backend.ws_url || backendUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  const notebookWsUrl = backend.notebook_ws_url || backendWsUrl.replace(/\/ws$/, '/ws/notebook');
  const stdio = configuration.stdio || {};

  return {
    ...configuration,
    httpEndpoint,
    defaultProfile: configuration.default_profile || 'authoring',
    recommendedMode: configuration.recommended_mode || 'stateful-http',
    localOnly: configuration.local_only !== false,
    backend: {
      url: backendUrl,
      ws_url: backendWsUrl,
      notebook_ws_url: notebookWsUrl,
    },
    stdio: {
      command: stdio.command || 'python',
      args: Array.isArray(stdio.args) && stdio.args.length > 0 ? stdio.args : ['-m', 'mcp_server', '--stdio'],
      cwd: stdio.cwd || 'C:\\Inspyro\\Workspace\\backend',
    },
    streamableHttp: {
      stateful: configuration.streamable_http?.stateful !== false,
      stateless_http: configuration.streamable_http?.stateless_http === true,
      json_response: configuration.streamable_http?.json_response === true,
    },
    warnings: Array.isArray(configuration.warnings) ? configuration.warnings : [],
  };
};

const buildClientPresets = (mcpConfig) => {
  const env = {
    INSPYRO_BACKEND_URL: mcpConfig.backend.url,
    INSPYRO_BACKEND_WS_URL: mcpConfig.backend.ws_url,
    INSPYRO_BACKEND_NOTEBOOK_WS_URL: mcpConfig.backend.notebook_ws_url,
  };
  const stdioServer = {
    mcpServers: {
      inspyro: {
        command: mcpConfig.stdio.command,
        args: mcpConfig.stdio.args,
        cwd: mcpConfig.stdio.cwd,
        env,
      },
    },
  };

  return [
    {
      key: 'codex',
      title: 'Codex',
      description: 'HTTP stateful. Úsalo cuando el servicio local esté iniciado desde Inspyro.',
      body: `[mcp_servers.inspyro]\nurl = "${mcpConfig.httpEndpoint}"`,
    },
    {
      key: 'claude-code',
      title: 'Claude Code',
      description: 'HTTP stateful con el cliente CLI de Claude.',
      body: `claude mcp add-json inspyro '{"type":"http","url":"${mcpConfig.httpEndpoint}"}'`,
    },
    {
      key: 'claude-desktop',
      title: 'Claude Desktop',
      description: 'stdio. Claude Desktop lanza su propio proceso MCP con estas variables.',
      body: jsonSnippet(stdioServer),
    },
    {
      key: 'vscode',
      title: 'VS Code',
      description: 'Archivo .vscode/mcp.json o configuración equivalente de MCP.',
      body: jsonSnippet({
        servers: {
          inspyro: {
            type: 'http',
            url: mcpConfig.httpEndpoint,
          },
        },
      }),
    },
    {
      key: 'cursor',
      title: 'Cursor',
      description: 'Archivo mcp.json de Cursor con servidor HTTP local.',
      body: jsonSnippet({
        mcpServers: {
          inspyro: {
            url: mcpConfig.httpEndpoint,
          },
        },
      }),
    },
    {
      key: 'generic-http',
      title: 'HTTP genérico',
      description: 'Para clientes propios o integraciones MCP compatibles con Streamable HTTP.',
      body: [
        `Endpoint: ${mcpConfig.httpEndpoint}`,
        'Transporte: Streamable HTTP',
        `Modo: ${mcpConfig.recommendedMode}`,
        `Perfil inicial: ${mcpConfig.defaultProfile}`,
        'Sesión: reutilizar Mcp-Session-Id cuando el cliente lo exponga',
      ].join('\n'),
    },
  ];
};

export default function McpPanel({
  isOpen,
  onClose,
  mcpStatus,
  onStatusChange,
  activity = [],
  activeRuns = [],
  runningCount = 0,
  mirrorEnabled = true,
  mirrorToggleDisabled = false,
  mirrorDisabledReason = '',
  onToggleMirror,
  onQuickAction,
  clientFilter = null,
  onClearClientFilter = null,
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('activity');
  const [copiedKey, setCopiedKey] = useState(null);
  const logsEndRef = useRef(null);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/mcp/status`);
      if (!response.ok) return;
      const data = await response.json();
      onStatusChange?.(data);
    } catch {
      // ignore
    }
  }, [onStatusChange]);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/mcp/logs?last=100`);
      if (!response.ok) return;
      const data = await response.json();
      setLogs(data.lines || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    fetchStatus();
    fetchLogs();

    pollRef.current = setInterval(() => {
      fetchStatus();
      if (activeTab === 'logs') {
        fetchLogs();
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [activeTab, fetchLogs, fetchStatus, isOpen]);

  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const runQuickAction = useCallback(async (action) => {
    setLoading(true);
    try {
      const ok = await onQuickAction?.(action);
      if (ok) {
        setTimeout(fetchStatus, 1500);
        setTimeout(fetchLogs, 2000);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [fetchLogs, fetchStatus, onQuickAction]);

  const copySnippet = useCallback(async (key, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  if (!isOpen) return null;

  const isRunning = mcpStatus?.status === 'running';
  const port = mcpStatus?.port || 8100;
  const normalizedClientFilterId = typeof clientFilter?.clientId === 'string' && clientFilter.clientId.trim()
    ? clientFilter.clientId.trim()
    : null;
  const normalizedClientFilterLabel = typeof clientFilter?.clientLabel === 'string' && clientFilter.clientLabel.trim()
    ? clientFilter.clientLabel.trim()
    : null;
  const filteredActiveRuns = normalizedClientFilterId || normalizedClientFilterLabel
    ? activeRuns.filter((event) => {
      if (normalizedClientFilterId && event?.client_id === normalizedClientFilterId) return true;
      if (normalizedClientFilterLabel && event?.client_label === normalizedClientFilterLabel) return true;
      return false;
    })
    : activeRuns;
  const filteredActivity = normalizedClientFilterId || normalizedClientFilterLabel
    ? activity.filter((event) => {
      if (normalizedClientFilterId && event?.client_id === normalizedClientFilterId) return true;
      if (normalizedClientFilterLabel && event?.client_label === normalizedClientFilterLabel) return true;
      return false;
    })
    : activity;
  const effectiveRunningCount = normalizedClientFilterId || normalizedClientFilterLabel
    ? filteredActiveRuns.length
    : runningCount;
  const mcpConfig = buildMcpConfiguration(mcpStatus, port);
  const clientPresets = buildClientPresets(mcpConfig);

  return (
    <div className="mcp-panel-overlay" onClick={onClose}>
      <div className="mcp-panel" onClick={(event) => event.stopPropagation()} data-testid="mcp-panel">
        <div className="mcp-panel-header">
          <div className="mcp-panel-heading">
            <div className="mcp-panel-title">
              <span className={`mcp-panel-dot ${isRunning ? 'running' : 'stopped'}`} />
              Agentes
            </div>
            <div className="mcp-panel-subtitle">Servicio local de agentes impulsado por MCP</div>
          </div>
          <div className="mcp-panel-actions">
            {isRunning ? (
              <>
                <button className="mcp-action-btn restart" onClick={() => void runQuickAction('restart')} disabled={loading} title="Reiniciar agentes" aria-label="Reiniciar agentes" data-testid="mcp-restart">
                  <IconRefresh />
                </button>
                <button className="mcp-action-btn stop" onClick={() => void runQuickAction('stop')} disabled={loading} title="Detener agentes" aria-label="Detener agentes" data-testid="mcp-stop">
                  <IconStop />
                </button>
              </>
            ) : (
              <button className="mcp-action-btn start" onClick={() => void runQuickAction('start')} disabled={loading} title="Iniciar agentes" data-testid="mcp-start">
                <IconPlay />
                <span>Iniciar agentes</span>
              </button>
            )}
            <button className="mcp-close-btn" onClick={onClose} aria-label="Cerrar panel de agentes" title="Cerrar panel de agentes">x</button>
          </div>
        </div>

        <div className="mcp-panel-tabs">
          <button className={`mcp-tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')} data-testid="mcp-tab-activity">
            Actividad
          </button>
          <button className={`mcp-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')} data-testid="mcp-tab-info">
            Información
          </button>
          <button className={`mcp-tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => { setActiveTab('logs'); fetchLogs(); }} data-testid="mcp-tab-logs">
            Registros
          </button>
          <button className={`mcp-tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')} data-testid="mcp-tab-config">
            Configuración
          </button>
        </div>

        <div className="mcp-panel-content scroll-surface">
          {activeTab === 'activity' && (
            <div className="mcp-activity-tab">
              {(normalizedClientFilterId || normalizedClientFilterLabel) && (
                <div className="mcp-activity-empty" data-testid="mcp-client-filter-banner">
                  <strong>Cliente filtrado:</strong>{' '}
                  {normalizedClientFilterLabel || normalizedClientFilterId}
                  {typeof onClearClientFilter === 'function' && (
                    <button
                      type="button"
                      className="mcp-action-btn restart"
                      onClick={onClearClientFilter}
                      style={{ marginLeft: 8 }}
                    >
                      Ver todos
                    </button>
                  )}
                </div>
              )}
              <div className="mcp-activity-toolbar">
                <div className="mcp-activity-stat">
                  <span className="mcp-activity-stat__label">Ejecuciones activas</span>
                  <strong>{effectiveRunningCount}</strong>
                </div>
                <button
                  type="button"
                  className={`mcp-mirror-pill ${mirrorEnabled ? 'is-on' : 'is-off'}`}
                  onClick={onToggleMirror}
                  disabled={mirrorToggleDisabled}
                  title={mirrorToggleDisabled ? mirrorDisabledReason : undefined}
                  aria-pressed={mirrorEnabled}
                  data-state={mirrorEnabled ? 'on' : 'off'}
                  data-testid="mcp-panel-mirror-toggle"
                >
                  Espejo de agentes: {mirrorEnabled ? 'ACTIVO' : 'INACTIVO'}
                </button>
              </div>
              {mirrorToggleDisabled && mirrorDisabledReason && (
                <div className="mcp-activity-empty">{mirrorDisabledReason}</div>
              )}

              {filteredActiveRuns.length > 0 && (
                <div className="mcp-activity-section">
                  <div className="mcp-activity-section__title">En curso</div>
                  <div className="mcp-activity-list">
                    {filteredActiveRuns.map((event) => (
                      <div key={event.run_id} className="mcp-activity-card running">
                        <div className="mcp-activity-card__top">
                          <span className="mcp-activity-card__tool">{event.tool_name}</span>
                          <span className="mcp-activity-card__status">{getEventStatusLabel(event)}</span>
                        </div>
                        <div className="mcp-activity-card__summary">{event.summary}</div>
                        {event.client_label && <div className="mcp-activity-card__detail">{event.client_label}</div>}
                        <div className="mcp-activity-card__meta">
                          <span>{formatTimestamp(event.ts)}</span>
                          {event.ui_reflected && <span className="mcp-activity-reflected">Reflejado</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mcp-activity-section">
                <div className="mcp-activity-section__title">Actividad reciente</div>
                {filteredActivity.length === 0 ? (
                  <div className="mcp-activity-empty">Todavía no hay actividad estructurada de agentes.</div>
                ) : (
                  <div className="mcp-activity-list">
                    {filteredActivity.map((event) => (
                      <div
                        key={event.event_id}
                        className={`mcp-activity-card ${event.phase === 'failed' ? 'error' : event.phase === 'completed' ? 'success' : 'running'}`}
                      >
                        <div className="mcp-activity-card__top">
                          <span className="mcp-activity-card__tool">{event.tool_name}</span>
                          <span className="mcp-activity-card__status">{getEventStatusLabel(event)}</span>
                        </div>
                        <div className="mcp-activity-card__summary">{event.summary}</div>
                        {event.client_label && <div className="mcp-activity-card__detail">{event.client_label}</div>}
                        {event.detail && <div className="mcp-activity-card__detail">{event.detail}</div>}
                        {event.error && <div className="mcp-activity-card__error">{event.error}</div>}
                        <div className="mcp-activity-card__meta">
                          <span>{formatTimestamp(event.ts)}</span>
                          {formatDuration(event.duration_ms) && <span>{formatDuration(event.duration_ms)}</span>}
                          {event.ui_reflected && <span className="mcp-activity-reflected">Reflejado</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'info' && (
            <div className="mcp-info-grid">
              <div className="mcp-info-row">
                <span className="mcp-info-label">Estado</span>
                <span className={`mcp-info-value ${isRunning ? 'text-green' : 'text-dim'}`}>
                  {isRunning ? 'Listo' : 'Sin conexión'}
                </span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">Puerto</span>
                <span className="mcp-info-value">{port}</span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">Punto de acceso</span>
                <span className="mcp-info-value mcp-url">
                  {isRunning ? mcpConfig.httpEndpoint : '-'}
                </span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">Tiempo activo</span>
                <span className="mcp-info-value">{formatUptime(mcpStatus?.uptime_seconds)}</span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">PID</span>
                <span className="mcp-info-value">{mcpStatus?.pid || '-'}</span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">Transporte</span>
                <span className="mcp-info-value">Streamable HTTP + stdio</span>
              </div>
              <div className="mcp-info-row">
                <span className="mcp-info-label">SDK</span>
                <span className="mcp-info-value">FastMCP 3.0</span>
              </div>

              {isRunning && (
                <div className="mcp-connect-hint">
                  <strong>Conecta un cliente MCP:</strong>
                  <code>{mcpConfig.httpEndpoint}</code>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="mcp-logs-container">
              {logs.length === 0 ? (
                <div className="mcp-logs-empty">
                  Todavía no hay registros disponibles. {!isRunning && 'Inicia el servicio de agentes para verlos.'}
                </div>
              ) : (
                <div className="mcp-logs-scroll scroll-surface">
                  {logs.map((line, index) => (
                    <div
                      key={`${line}-${index}`}
                      className={`mcp-log-line ${line.includes('ERROR') ? 'log-error' : line.includes('[system]') ? 'log-system' : ''}`}
                    >
                      {line}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          )}

          {activeTab === 'config' && (
            <div className="mcp-config-grid">
              <div className="mcp-config-summary">
                <div className="mcp-config-status-card" data-testid="mcp-config-http-status">
                  <span className={`mcp-panel-dot ${isRunning ? 'running' : 'stopped'}`} />
                  <div>
                    <strong>{isRunning ? 'Servicio HTTP iniciado' : 'Servicio HTTP detenido'}</strong>
                    <span>{isRunning ? 'Los clientes HTTP pueden conectarse ahora.' : 'Inicia agentes antes de usar presets HTTP.'}</span>
                  </div>
                </div>
                <div className="mcp-config-status-card">
                  <span className="mcp-panel-dot running" />
                  <div>
                    <strong>stdio independiente</strong>
                    <span>El cliente lanza su propio proceso; no depende del botón iniciar.</span>
                  </div>
                </div>
              </div>

              <div className="mcp-config-section">
                <div className="mcp-config-section-title">Parámetros mínimos</div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Endpoint HTTP</span>
                  <span className="mcp-info-value mcp-url" data-testid="mcp-config-endpoint">{mcpConfig.httpEndpoint}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Modo recomendado</span>
                  <span className="mcp-info-value">{mcpConfig.recommendedMode}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Perfil por defecto</span>
                  <span className="mcp-info-value">{mcpConfig.defaultProfile}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Backend REST</span>
                  <span className="mcp-info-value">{mcpConfig.backend.url}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Backend WS notebooks</span>
                  <span className="mcp-info-value">{mcpConfig.backend.notebook_ws_url}</span>
                </div>
              </div>

              <div className="mcp-config-note">
                Para notebooks usa HTTP con sesión o stdio. El modo stateless-http no conserva kernels, notebooks ni artefactos entre llamadas.
                Mantén el host en 127.0.0.1 salvo que tengas controles de red y autenticación propios.
              </div>

              <div className="mcp-config-section">
                <div className="mcp-config-section-title">Presets copiables</div>
                <div className="mcp-preset-list">
                  {clientPresets.map((preset) => (
                    <div className="mcp-preset-card" key={preset.key} data-testid={`mcp-client-preset-${preset.key}`}>
                      <div className="mcp-preset-header">
                        <div>
                          <strong>{preset.title}</strong>
                          <span>{preset.description}</span>
                        </div>
                        <button
                          type="button"
                          className="mcp-copy-btn"
                          onClick={() => void copySnippet(preset.key, preset.body)}
                          data-testid={`mcp-copy-${preset.key}`}
                        >
                          {copiedKey === preset.key ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                      <pre className="mcp-config-snippet">{preset.body}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
