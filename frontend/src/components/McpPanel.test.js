import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpPanel from './McpPanel';

const statusConfiguration = {
  http_endpoint: 'http://127.0.0.1:8100/mcp',
  default_profile: 'authoring',
  recommended_mode: 'stateful-http',
  local_only: true,
  backend: {
    url: 'http://127.0.0.1:8000',
    ws_url: 'ws://127.0.0.1:8000/ws',
    notebook_ws_url: 'ws://127.0.0.1:8000/ws/notebook',
  },
  stdio: {
    command: 'C:\\Python312\\python.exe',
    args: ['-m', 'mcp_server', '--stdio'],
    cwd: 'C:\\Inspyro\\Workspace\\backend',
  },
  streamable_http: {
    stateful: true,
    stateless_http: false,
    json_response: false,
  },
};

describe('McpPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/mcp/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'stopped', port: 8100, configuration: statusConfiguration }),
        });
      }
      if (String(url).includes('/api/mcp/logs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ lines: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete global.fetch;
    delete navigator.clipboard;
  });

  it('delegates MCP start from the panel to the shared quick action handler', async () => {
    const onQuickAction = jest.fn().mockResolvedValue(true);

    render(
      <McpPanel
        isOpen
        onClose={jest.fn()}
        mcpStatus={{ status: 'stopped', port: 8100, configuration: statusConfiguration }}
        onStatusChange={jest.fn()}
        onToggleMirror={jest.fn()}
        onQuickAction={onQuickAction}
      />
    );

    fireEvent.click(screen.getByTestId('mcp-start'));

    await waitFor(() => expect(onQuickAction).toHaveBeenCalledWith('start'));
  });

  it('delegates MCP restart and stop from the panel to the shared quick action handler', async () => {
    const onQuickAction = jest.fn().mockResolvedValue(true);

    render(
      <McpPanel
        isOpen
        onClose={jest.fn()}
        mcpStatus={{ status: 'running', port: 8100, configuration: statusConfiguration }}
        onStatusChange={jest.fn()}
        onToggleMirror={jest.fn()}
        onQuickAction={onQuickAction}
      />
    );

    fireEvent.click(screen.getByTestId('mcp-restart'));
    await waitFor(() => expect(onQuickAction).toHaveBeenCalledWith('restart'));

    fireEvent.click(screen.getByTestId('mcp-stop'));
    await waitFor(() => expect(onQuickAction).toHaveBeenCalledWith('stop'));
  });

  it('exposes named controls for icon-only agent actions', async () => {
    const onStatusChange = jest.fn();
    render(
      <McpPanel
        isOpen
        onClose={jest.fn()}
        mcpStatus={{ status: 'running', port: 8100, configuration: statusConfiguration }}
        onStatusChange={onStatusChange}
        onToggleMirror={jest.fn()}
        onQuickAction={jest.fn()}
      />
    );

    await waitFor(() => expect(onStatusChange).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Reiniciar agentes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Detener agentes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar panel de agentes' })).toBeTruthy();
  });

  it('shows universal MCP client presets and copies snippets from configuration', async () => {
    render(
      <McpPanel
        isOpen
        onClose={jest.fn()}
        mcpStatus={{ status: 'running', port: 8100, configuration: statusConfiguration }}
        onStatusChange={jest.fn()}
        onToggleMirror={jest.fn()}
        onQuickAction={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('mcp-tab-config'));

    expect(screen.getByTestId('mcp-config-http-status').textContent).toContain('Servicio HTTP iniciado');
    expect(screen.getByTestId('mcp-config-endpoint').textContent).toContain('http://127.0.0.1:8100/mcp');
    expect(screen.getByTestId('mcp-client-preset-codex').textContent).toContain('[mcp_servers.inspyro]');
    expect(screen.getByTestId('mcp-client-preset-claude-code').textContent).toContain('claude mcp add-json inspyro');
    expect(screen.getByTestId('mcp-client-preset-claude-desktop').textContent).toContain('INSPYRO_BACKEND_NOTEBOOK_WS_URL');
    expect(screen.getByTestId('mcp-client-preset-vscode').textContent).toContain('"servers"');
    expect(screen.getByTestId('mcp-client-preset-cursor').textContent).toContain('"mcpServers"');
    expect(screen.getByTestId('mcp-client-preset-generic-http').textContent).toContain('stateful-http');

    fireEvent.click(screen.getByTestId('mcp-copy-codex'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:8100')));
  });
});
