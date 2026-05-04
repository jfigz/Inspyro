import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpPanel from './McpPanel';

describe('McpPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/mcp/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'stopped', port: 8100 }),
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
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete global.fetch;
  });

  it('delegates MCP start from the panel to the shared quick action handler', async () => {
    const onQuickAction = jest.fn().mockResolvedValue(true);

    render(
      <McpPanel
        isOpen
        onClose={jest.fn()}
        mcpStatus={{ status: 'stopped', port: 8100 }}
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
        mcpStatus={{ status: 'running', port: 8100 }}
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
        mcpStatus={{ status: 'running', port: 8100 }}
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
});
