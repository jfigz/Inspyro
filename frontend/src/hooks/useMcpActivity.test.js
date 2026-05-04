import { act, renderHook, waitFor } from '@testing-library/react';
import useMcpActivity from './useMcpActivity';

const STORAGE_KEY = 'inspyro_mcp_mirror_enabled';
const ACTIVE_NOTEBOOK = 'C:\\workspace\\demo.ipynb';

const buildEvent = (overrides = {}) => ({
  type: 'mcp_activity_event',
  event_id: overrides.event_id || 'evt-1',
  run_id: overrides.run_id || 'run-1',
  phase: overrides.phase || 'started',
  status: overrides.status || (overrides.phase === 'completed' ? 'success' : overrides.phase === 'failed' ? 'error' : 'running'),
  tool_name: overrides.tool_name || 'execute_cell',
  tool_group: overrides.tool_group || 'notebook',
  summary: overrides.summary || 'Executing cell cell-1',
  ts: overrides.ts || new Date().toISOString(),
  resource: overrides.resource || { notebook_path: ACTIVE_NOTEBOOK },
  ui_hints: overrides.ui_hints || {
    show_agent_execution: true,
    reload_path: ACTIVE_NOTEBOOK,
  },
  detail: overrides.detail,
  duration_ms: overrides.duration_ms,
  error: overrides.error,
});

describe('useMcpActivity', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [], active_runs: [], active_count: 0 }),
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('persists mirror mode in localStorage', async () => {
    const { result } = renderHook(() => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage: null,
      activeFile: null,
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current.mirrorEnabled).toBe(false);

    act(() => {
      result.current.toggleMirrorEnabled();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('respects the stored mirror preference on startup', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    const { result } = renderHook(() => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage: null,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current.mirrorEnabled).toBe(true);
  });

  it('defaults mirror mode to OFF when there is no stored preference', async () => {
    const { result } = renderHook(() => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage: null,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current.mirrorEnabled).toBe(false);
  });

  it('does not reload dirty active files for groups now handled by granular mirror', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const onNotify = jest.fn();
    const onReloadActiveFile = jest.fn();

    const { rerender } = renderHook(({ lastMessage, modifiedFiles }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles,
      onNotify,
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile,
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: {
        lastMessage: null,
        modifiedFiles: new Set([ACTIVE_NOTEBOOK]),
      },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-dirty-files',
        tool_name: 'write_file',
        tool_group: 'files',
        phase: 'completed',
        status: 'success',
        ui_hints: {
          reload_path: ACTIVE_NOTEBOOK,
        },
      }),
      modifiedFiles: new Set([ACTIVE_NOTEBOOK]),
    });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onReloadActiveFile).not.toHaveBeenCalled();
    expect(onNotify.mock.calls.some(([notification]) => notification.title === 'MCP no reflejado')).toBe(false);
    expect(onNotify.mock.calls[0][0].target).toEqual(expect.objectContaining({
      kind: 'file',
      path: ACTIVE_NOTEBOOK,
    }));
  });

  it('emits an exact file target when a reflected reload is blocked by dirty local changes', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const onNotify = jest.fn();

    const { rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set([ACTIVE_NOTEBOOK]),
      onNotify,
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-dirty-exact',
        tool_name: 'save_notebook',
        tool_group: 'shell',
        phase: 'completed',
        status: 'success',
        ui_hints: {
          reload_path: ACTIVE_NOTEBOOK,
        },
      }),
    });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mcp_skip_evt-dirty-exact',
      title: 'MCP no reflejado',
      target: expect.objectContaining({
        kind: 'file',
        path: ACTIVE_NOTEBOOK,
      }),
    }));
  });

  it('tracks active agent execution for notebook tools without reloading on completion', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const onReloadActiveFile = jest.fn();

    const { result, rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile,
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({ lastMessage: buildEvent({ phase: 'started', status: 'running' }) });
    await waitFor(() => expect(result.current.agentExecutionState?.run_id).toBe('run-1'));

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-2',
        phase: 'completed',
        status: 'success',
        duration_ms: 45,
      }),
    });

    await waitFor(() => expect(result.current.agentExecutionState).toBeNull());
    expect(onReloadActiveFile).not.toHaveBeenCalled();
  });

  it('does not reload files for groups that now use granular mirror', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const onReloadActiveFile = jest.fn();

    const { rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile,
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-files-1',
        tool_name: 'write_file',
        tool_group: 'files',
        phase: 'completed',
        status: 'success',
        ui_hints: {
          refresh_workspace: true,
          reload_path: ACTIVE_NOTEBOOK,
        },
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onReloadActiveFile).not.toHaveBeenCalled();
  });

  it('adds a document target to preview notifications when an artifact is available', async () => {
    const onNotify = jest.fn();

    const { rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify,
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-artifact-preview',
        phase: 'completed',
        status: 'success',
        tool_name: 'execute_cell',
        tool_group: 'documents',
        ui_hints: {
          refresh_preview: true,
          artifact: {
            source_path: ACTIVE_NOTEBOOK,
            source_kind: 'notebook',
          },
        },
      }),
    });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onNotify.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: 'evt-artifact-preview',
      target: expect.objectContaining({
        kind: 'document',
        sourcePath: ACTIVE_NOTEBOOK,
        sourceKind: 'notebook',
      }),
    }));
  });

  it('processes queued activity messages even when lastMessage is not the MCP event', async () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage: { type: 'mcp_mirror_event', step_id: 'step-1' },
      messageQueue: [
        {
          id: 1,
          message: buildEvent({ phase: 'started', status: 'running' }),
        },
        {
          id: 2,
          message: { type: 'mcp_mirror_event', step_id: 'step-1' },
        },
      ],
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify: jest.fn(),
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }));

    await waitFor(() => expect(result.current.agentExecutionState?.run_id).toBe('run-1'));
  });

  it('derives a precise code target when the event points to a notebook cell', async () => {
    const onNotify = jest.fn();

    const { rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify,
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-target-code',
        phase: 'completed',
        status: 'success',
        resource: {
          notebook_path: ACTIVE_NOTEBOOK,
          cell_id: 'cell-9',
        },
        ui_hints: {
          reload_path: ACTIVE_NOTEBOOK,
        },
      }),
    });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onNotify.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'code',
        filePath: ACTIVE_NOTEBOOK,
        cellId: 'cell-9',
      }),
    }));
  });

  it('derives a precise document target when preview refresh hints include an artifact source', async () => {
    const onNotify = jest.fn();

    const { rerender } = renderHook(({ lastMessage }) => useMcpActivity({
      connectionStatus: 'connected',
      lastMessage,
      activeFile: { path: ACTIVE_NOTEBOOK },
      modifiedFiles: new Set(),
      onNotify,
      onRefreshWorkspace: jest.fn(),
      onReloadActiveFile: jest.fn(),
      onApplyArtifact: jest.fn(),
    }), {
      initialProps: { lastMessage: null },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({
      lastMessage: buildEvent({
        event_id: 'evt-target-doc',
        phase: 'completed',
        status: 'success',
        ui_hints: {
          refresh_preview: true,
          artifact: {
            source_path: ACTIVE_NOTEBOOK,
            source_kind: 'notebook',
          },
        },
      }),
    });

    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onNotify.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'document',
        sourcePath: ACTIVE_NOTEBOOK,
        sourceKind: 'notebook',
      }),
    }));
  });
});
