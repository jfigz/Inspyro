import { act, renderHook, waitFor } from '@testing-library/react';
import useMcpMirror from './useMcpMirror';

const TARGET_NOTEBOOK = 'C:\\workspace\\demo.ipynb';
const TARGET_FILE = 'C:\\workspace\\demo.py';
const RENAMED_FILE = 'C:\\workspace\\demo-renamed.py';
const OTHER_NOTEBOOK = 'C:\\workspace\\other.ipynb';

const buildMirrorMessage = (overrides = {}) => ({
  type: 'mcp_mirror_event',
  step_id: overrides.step_id || 'step-1',
  run_id: overrides.run_id || 'run-1',
  tool_name: overrides.tool_name || 'execute_cell',
  tool_group: overrides.tool_group || 'notebook',
  action: overrides.action || 'open_resource',
  resource: overrides.resource || { notebook_path: TARGET_NOTEBOOK, path: TARGET_NOTEBOOK },
  payload: overrides.payload || { path: TARGET_NOTEBOOK, focus_view: 'notebook' },
  ts: overrides.ts || new Date().toISOString(),
});

const buildProps = (overrides = {}) => ({
  mirrorEnabled: true,
  workspaceSurface: 'file',
  lastMessage: null,
  messageQueue: [],
  activeFile: null,
  openFiles: [],
  modifiedFiles: new Set(),
  handleFileOpen: jest.fn().mockResolvedValue(undefined),
  handleFileSelect: jest.fn().mockResolvedValue(undefined),
  notebookActionsRef: { current: null },
  onNotify: jest.fn(),
  onRefreshWorkspace: jest.fn(),
  onTemplateInfoChange: jest.fn(),
  onTemplateBlobChange: jest.fn(),
  onFocusDocx: jest.fn(),
  onApplyArtifact: jest.fn(),
  reloadFileByPath: jest.fn().mockResolvedValue(undefined),
  renameOpenFile: jest.fn(),
  removeOpenFile: jest.fn(),
  ...overrides,
});

describe('useMcpMirror', () => {
  it('auto-opens a clean notebook targeted by MCP', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage(),
      handleFileOpen,
    })));

    await waitFor(() => expect(handleFileOpen).toHaveBeenCalledWith({ path: TARGET_NOTEBOOK }));
  });

  it('blocks mirror when the target notebook is dirty and warns once', async () => {
    const onNotify = jest.fn();
    const replaceNotebookSnapshot = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        action: 'notebook_snapshot',
        payload: {
          path: TARGET_NOTEBOOK,
          notebook: { cells: [] },
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_NOTEBOOK }],
      modifiedFiles: new Set([TARGET_NOTEBOOK]),
      notebookActionsRef: { current: { replaceNotebookSnapshot } },
      onNotify,
    })));

    await waitFor(() => expect(onNotify).toHaveBeenCalledTimes(1));
    expect(replaceNotebookSnapshot).not.toHaveBeenCalled();
    expect(onNotify.mock.calls[0][0]).toEqual(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'file',
        path: TARGET_NOTEBOOK,
      }),
    }));
  });

  it('does not block a clean target notebook because another file is dirty', async () => {
    const replaceNotebookSnapshot = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        action: 'notebook_snapshot',
        payload: {
          path: TARGET_NOTEBOOK,
          notebook: { cells: [{ id: 'cell-1', cell_type: 'code', source: ['print(1)'] }] },
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_NOTEBOOK }],
      modifiedFiles: new Set([OTHER_NOTEBOOK]),
      notebookActionsRef: { current: { replaceNotebookSnapshot } },
    })));

    await waitFor(() => expect(replaceNotebookSnapshot).toHaveBeenCalledTimes(1));
  });

  it('forwards notebook runtime messages to the imperative notebook API', async () => {
    const consumeRemoteNotebookMessage = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        action: 'notebook_runtime_message',
        payload: {
          type: 'notebook_stream',
          cell_id: 'cell-1',
          content: { name: 'stdout', text: 'hello' },
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_NOTEBOOK }],
      notebookActionsRef: { current: { consumeRemoteNotebookMessage } },
    })));

    await waitFor(() => expect(consumeRemoteNotebookMessage).toHaveBeenCalledWith({
      type: 'notebook_stream',
      cell_id: 'cell-1',
      content: { name: 'stdout', text: 'hello' },
    }));
  });

  it('applies template snapshots and forces the docx view', async () => {
    const onTemplateInfoChange = jest.fn();
    const onTemplateBlobChange = jest.fn();
    const onFocusDocx = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        tool_name: 'upload_template',
        tool_group: 'templates',
        action: 'template_snapshot',
        payload: {
          notebook_path: TARGET_NOTEBOOK,
          template: { styles: ['Normal'] },
          template_token: 'template-123',
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_NOTEBOOK }],
      onTemplateInfoChange,
      onTemplateBlobChange,
      onFocusDocx,
    })));

    await waitFor(() => expect(onTemplateInfoChange).toHaveBeenCalledWith(
      { styles: ['Normal'] },
      expect.objectContaining({
        path: TARGET_NOTEBOOK,
        resourcePath: TARGET_NOTEBOOK,
        notebookPath: TARGET_NOTEBOOK,
        sourcePath: null,
        event: expect.objectContaining({
          action: 'template_snapshot',
          tool_name: 'upload_template',
          tool_group: 'templates',
          step_id: 'step-1',
        }),
      }),
    ));
    expect(onTemplateBlobChange).toHaveBeenCalledWith(
      { templateToken: 'template-123' },
      expect.objectContaining({
        path: TARGET_NOTEBOOK,
        resourcePath: TARGET_NOTEBOOK,
        notebookPath: TARGET_NOTEBOOK,
        sourcePath: null,
        event: expect.objectContaining({
          action: 'template_snapshot',
          tool_name: 'upload_template',
          tool_group: 'templates',
          step_id: 'step-1',
        }),
      }),
    );
    expect(onFocusDocx).toHaveBeenCalled();
  });

  it('does not auto-open notebook targets while on home', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);
    const handleFileSelect = jest.fn().mockResolvedValue(undefined);
    const replaceNotebookSnapshot = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      workspaceSurface: 'home',
      lastMessage: buildMirrorMessage({
        action: 'notebook_snapshot',
        payload: {
          path: TARGET_NOTEBOOK,
          notebook: { cells: [] },
        },
      }),
      handleFileOpen,
      handleFileSelect,
      notebookActionsRef: { current: { replaceNotebookSnapshot } },
    })));

    await act(async () => {
      await Promise.resolve();
    });

    expect(handleFileOpen).not.toHaveBeenCalled();
    expect(handleFileSelect).not.toHaveBeenCalled();
    expect(replaceNotebookSnapshot).not.toHaveBeenCalled();
  });

  it('applies template snapshots on home without stealing focus', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);
    const handleFileSelect = jest.fn().mockResolvedValue(undefined);
    const onTemplateInfoChange = jest.fn();
    const onTemplateBlobChange = jest.fn();
    const onFocusDocx = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      workspaceSurface: 'home',
      lastMessage: buildMirrorMessage({
        tool_name: 'upload_template',
        tool_group: 'templates',
        action: 'template_snapshot',
        payload: {
          notebook_path: TARGET_NOTEBOOK,
          template: { styles: ['Heading 1'] },
          template_token: 'template-home',
        },
      }),
      modifiedFiles: new Set([TARGET_NOTEBOOK]),
      handleFileOpen,
      handleFileSelect,
      onTemplateInfoChange,
      onTemplateBlobChange,
      onFocusDocx,
    })));

    await waitFor(() => expect(onTemplateInfoChange).toHaveBeenCalledWith(
      { styles: ['Heading 1'] },
      expect.objectContaining({
        path: TARGET_NOTEBOOK,
        resourcePath: TARGET_NOTEBOOK,
        notebookPath: TARGET_NOTEBOOK,
        sourcePath: null,
        event: expect.objectContaining({
          action: 'template_snapshot',
          tool_name: 'upload_template',
          tool_group: 'templates',
          step_id: 'step-1',
        }),
      }),
    ));
    expect(onTemplateBlobChange).toHaveBeenCalledWith(
      { templateToken: 'template-home' },
      expect.objectContaining({
        path: TARGET_NOTEBOOK,
        resourcePath: TARGET_NOTEBOOK,
        notebookPath: TARGET_NOTEBOOK,
        sourcePath: null,
        event: expect.objectContaining({
          action: 'template_snapshot',
          tool_name: 'upload_template',
          tool_group: 'templates',
          step_id: 'step-1',
        }),
      }),
    );
    expect(handleFileOpen).not.toHaveBeenCalled();
    expect(handleFileSelect).not.toHaveBeenCalled();
    expect(onFocusDocx).not.toHaveBeenCalled();
  });

  it('applies artifact updates on home without stealing focus', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);
    const handleFileSelect = jest.fn().mockResolvedValue(undefined);
    const onApplyArtifact = jest.fn();
    const onFocusDocx = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      workspaceSurface: 'home',
      lastMessage: buildMirrorMessage({
        tool_name: 'execute_cell',
        tool_group: 'notebook',
        action: 'artifact_update',
        payload: {
          notebook_path: TARGET_NOTEBOOK,
          docx_token: 'docx-home',
          pdf_token: 'pdf-home',
        },
      }),
      modifiedFiles: new Set([TARGET_NOTEBOOK]),
      handleFileOpen,
      handleFileSelect,
      onApplyArtifact,
      onFocusDocx,
    })));

    await waitFor(() => expect(onApplyArtifact).toHaveBeenCalledWith({
      notebook_path: TARGET_NOTEBOOK,
      docx_token: 'docx-home',
      pdf_token: 'pdf-home',
    }, expect.objectContaining({
      action: 'artifact_update',
      step_id: 'step-1',
    })));
    expect(handleFileOpen).not.toHaveBeenCalled();
    expect(handleFileSelect).not.toHaveBeenCalled();
    expect(onFocusDocx).not.toHaveBeenCalled();
  });

  it('ignores granular mirror events when mirror mode is disabled', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);

    renderHook(() => useMcpMirror(buildProps({
      mirrorEnabled: false,
      lastMessage: buildMirrorMessage(),
      handleFileOpen,
    })));

    await act(async () => {
      await Promise.resolve();
    });

    expect(handleFileOpen).not.toHaveBeenCalled();
  });

  it('refreshes workspace and reloads clean files for file write mutations', async () => {
    const onRefreshWorkspace = jest.fn();
    const reloadFileByPath = jest.fn().mockResolvedValue(undefined);

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        tool_name: 'write_file',
        tool_group: 'files',
        action: 'file_mutation',
        resource: { path: TARGET_FILE },
        payload: {
          mutation: 'write',
          path: TARGET_FILE,
          file_kind: 'code',
          is_directory: false,
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_FILE }],
      onRefreshWorkspace,
      reloadFileByPath,
    })));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(reloadFileByPath).toHaveBeenCalledWith(TARGET_FILE);
  });

  it('blocks file write mutations after dirty state changes before the mirror event arrives', async () => {
    const onNotify = jest.fn();
    const onRefreshWorkspace = jest.fn();
    const reloadFileByPath = jest.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(({ lastMessage, modifiedFiles }) => useMcpMirror(buildProps({
      lastMessage,
      activeFile: { path: TARGET_FILE },
      openFiles: [{ path: TARGET_FILE }],
      modifiedFiles,
      onNotify,
      onRefreshWorkspace,
      reloadFileByPath,
    })), {
      initialProps: {
        lastMessage: null,
        modifiedFiles: new Set(),
      },
    });

    rerender({
      lastMessage: null,
      modifiedFiles: new Set([TARGET_FILE]),
    });

    rerender({
      lastMessage: buildMirrorMessage({
        tool_name: 'write_file',
        tool_group: 'files',
        action: 'file_mutation',
        resource: { path: TARGET_FILE },
        payload: {
          mutation: 'write',
          path: TARGET_FILE,
          file_kind: 'code',
          is_directory: false,
        },
      }),
      modifiedFiles: new Set([TARGET_FILE]),
    });

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(reloadFileByPath).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'MCP no reflejado',
      target: expect.objectContaining({
        kind: 'file',
        path: TARGET_FILE,
      }),
    }));
  });

  it('retargets clean tabs on rename mutations', async () => {
    const onRefreshWorkspace = jest.fn();
    const renameOpenFile = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        tool_name: 'rename_file',
        tool_group: 'files',
        action: 'file_mutation',
        resource: { path: RENAMED_FILE },
        payload: {
          mutation: 'rename',
          path: RENAMED_FILE,
          old_path: TARGET_FILE,
          new_path: RENAMED_FILE,
          file_kind: 'code',
          is_directory: false,
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_FILE }],
      onRefreshWorkspace,
      renameOpenFile,
    })));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(renameOpenFile).toHaveBeenCalledWith(TARGET_FILE, RENAMED_FILE);
  });

  it('closes clean tabs on delete mutations', async () => {
    const onRefreshWorkspace = jest.fn();
    const removeOpenFile = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        tool_name: 'delete_file',
        tool_group: 'files',
        action: 'file_mutation',
        resource: { path: TARGET_FILE },
        payload: {
          mutation: 'delete',
          path: TARGET_FILE,
          file_kind: 'code',
          is_directory: false,
        },
      }),
      activeFile: { path: TARGET_NOTEBOOK },
      openFiles: [{ path: TARGET_FILE }],
      onRefreshWorkspace,
      removeOpenFile,
    })));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(removeOpenFile).toHaveBeenCalledWith(TARGET_FILE);
  });

  it('blocks rename mutations when the source file is dirty but still refreshes workspace', async () => {
    const onNotify = jest.fn();
    const onRefreshWorkspace = jest.fn();
    const renameOpenFile = jest.fn();

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: buildMirrorMessage({
        tool_name: 'rename_file',
        tool_group: 'files',
        action: 'file_mutation',
        resource: { path: RENAMED_FILE },
        payload: {
          mutation: 'rename',
          path: RENAMED_FILE,
          old_path: TARGET_FILE,
          new_path: RENAMED_FILE,
          file_kind: 'code',
          is_directory: false,
        },
      }),
      openFiles: [{ path: TARGET_FILE }],
      modifiedFiles: new Set([TARGET_FILE]),
      onNotify,
      onRefreshWorkspace,
      renameOpenFile,
    })));

    await waitFor(() => expect(onRefreshWorkspace).toHaveBeenCalledTimes(1));
    expect(renameOpenFile).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(onNotify.mock.calls[0][0]).toEqual(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'file',
        path: TARGET_FILE,
      }),
    }));
  });

  it('processes queued mirror messages even when lastMessage is a different WS event', async () => {
    const handleFileOpen = jest.fn().mockResolvedValue(undefined);

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: { type: 'mcp_activity_event', event_id: 'evt-1' },
      messageQueue: [
        { id: 1, message: buildMirrorMessage() },
        { id: 2, message: { type: 'mcp_activity_event', event_id: 'evt-1' } },
      ],
      handleFileOpen,
    })));

    await waitFor(() => expect(handleFileOpen).toHaveBeenCalledWith({ path: TARGET_NOTEBOOK }));
  });

  it('does not process the same step twice when it appears in lastMessage and messageQueue', async () => {
    let resolveOpen;
    const handleFileOpen = jest.fn(() => new Promise((resolve) => {
      resolveOpen = resolve;
    }));
    const duplicateMessage = buildMirrorMessage({ step_id: 'step-duplicate' });

    renderHook(() => useMcpMirror(buildProps({
      lastMessage: duplicateMessage,
      messageQueue: [{ id: 1, message: duplicateMessage }],
      handleFileOpen,
    })));

    await waitFor(() => expect(handleFileOpen).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveOpen?.();
    });
  });
});
