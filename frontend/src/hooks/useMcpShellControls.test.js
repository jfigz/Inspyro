import { act, renderHook, waitFor } from '@testing-library/react';
import useMcpShellControls, { shouldAutoEnableMirrorAfterMcpAction } from './useMcpShellControls';

describe('useMcpShellControls', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete global.fetch;
  });

  it('auto-enables mirror only for successful MCP start and restart actions', () => {
    expect(shouldAutoEnableMirrorAfterMcpAction('start', true)).toBe(true);
    expect(shouldAutoEnableMirrorAfterMcpAction('restart', true)).toBe(true);
    expect(shouldAutoEnableMirrorAfterMcpAction('stop', true)).toBe(false);
    expect(shouldAutoEnableMirrorAfterMcpAction('start', false)).toBe(false);
  });

  it('forces mirror ON after successful start and restart actions', async () => {
    const setMirrorEnabled = jest.fn();
    const emitDesktopNotification = jest.fn();
    const handleStatusMessage = jest.fn();

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'running', port: 8100 }),
    });

    const { result } = renderHook(() => useMcpShellControls({
      emitDesktopNotification,
      handleStatusMessage,
      setMirrorEnabled,
    }));

    await act(async () => {
      await result.current.handleMcpQuickAction('start');
    });

    expect(setMirrorEnabled).toHaveBeenCalledWith(true);

    await act(async () => {
      await result.current.handleMcpQuickAction('restart');
    });

    expect(setMirrorEnabled).toHaveBeenCalledWith(true);
  });

  it('does not touch mirror preference on stop', async () => {
    const setMirrorEnabled = jest.fn();

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'stopped', port: 8100 }),
    });

    const { result } = renderHook(() => useMcpShellControls({
      emitDesktopNotification: jest.fn(),
      handleStatusMessage: jest.fn(),
      setMirrorEnabled,
    }));

    await act(async () => {
      await result.current.handleMcpQuickAction('stop');
    });

    expect(setMirrorEnabled).not.toHaveBeenCalled();
  });

  it('refreshes MCP status and updates local state', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'running', port: 8100 }),
    });

    const { result } = renderHook(() => useMcpShellControls({
      emitDesktopNotification: jest.fn(),
      handleStatusMessage: jest.fn(),
      setMirrorEnabled: jest.fn(),
    }));

    await act(async () => {
      await result.current.refreshMcpStatus();
    });

    await waitFor(() => expect(result.current.mcpStatus).toEqual({ status: 'running', port: 8100 }));
  });
});
