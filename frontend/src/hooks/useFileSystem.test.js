import { act, renderHook, waitFor } from '@testing-library/react';
import { API_BASE } from '../config/endpoints';
import useFileSystem from './useFileSystem';

const NOTEBOOK_PATH = 'C:\\workspace\\mirror-demo.ipynb';
const CODE_PATH = 'C:\\workspace\\demo.py';
const RENAMED_CODE_PATH = 'C:\\workspace\\demo-renamed.py';
const NOTEBOOK_PAYLOAD = {
  cells: [],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

describe('useFileSystem', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    delete global.fetch;
  });

  const mockReadResponses = () => {
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes(encodeURIComponent(NOTEBOOK_PATH))) {
        return {
          json: async () => ({
            type: 'notebook',
            content: NOTEBOOK_PAYLOAD,
          }),
        };
      }
      return {
        json: async () => ({
          type: 'file',
          content: 'print("demo")\n',
        }),
      };
    });
  };

  it('dedupes concurrent opens for the same notebook path', async () => {
    let resolveFetch;
    global.fetch.mockImplementation(() => new Promise((resolve) => {
      resolveFetch = () => resolve({
        json: async () => ({
          type: 'notebook',
          content: NOTEBOOK_PAYLOAD,
        }),
      });
    }));

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));
    const file = { path: NOTEBOOK_PATH };

    const firstOpen = result.current.handleFileOpen(file);
    const secondOpen = result.current.handleFileOpen(file);

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch();
      await Promise.all([firstOpen, secondOpen]);
    });

    await waitFor(() => expect(result.current.openFiles).toHaveLength(1));
    expect(result.current.openFiles[0].path).toBe(NOTEBOOK_PATH);
    expect(result.current.activeFile?.path).toBe(NOTEBOOK_PATH);
  });

  it('reuses cached content when reopening an already open file', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
      await result.current.handleFileOpen({ path: NOTEBOOK_PATH });
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.activeFile?.path).toBe(CODE_PATH);
  });

  it('returns unsupported read details without opening a tab', async () => {
    const binaryPath = 'C:\\workspace\\diagram.pdf';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        detail: 'No se puede leer este tipo de archivo (binario)',
      }),
    });

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));
    let openResult = null;

    await act(async () => {
      openResult = await result.current.handleFileOpen({ path: binaryPath, name: 'diagram.pdf' });
    });

    expect(openResult).toEqual(expect.objectContaining({
      path: binaryPath,
      name: 'diagram.pdf',
      unsupported: true,
      error: 'No se puede leer este tipo de archivo (binario)',
    }));
    expect(result.current.openFiles).toHaveLength(0);
    expect(result.current.activeFile).toBeNull();
  });

  it('selects an already open tab without refetching file content', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
      await result.current.handleFileOpen({ path: NOTEBOOK_PATH });
    });

    const cachedCodeFile = result.current.openFiles.find((file) => file.path === CODE_PATH);
    expect(cachedCodeFile).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.handleFileSelect(cachedCodeFile);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.activeFile?.path).toBe(CODE_PATH);
  });

  it('reloadFile forces a real refetch for the active file', async () => {
    let codeReads = 0;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes(encodeURIComponent(CODE_PATH))) {
        codeReads += 1;
        return {
          json: async () => ({
            type: 'file',
            content: `print("demo-${codeReads}")\n`,
          }),
        };
      }
      return {
        json: async () => ({
          type: 'notebook',
          content: NOTEBOOK_PAYLOAD,
        }),
      };
    });

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    expect(codeReads).toBe(1);

    await act(async () => {
      await result.current.reloadFile(result.current.activeFile);
    });

    expect(codeReads).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('reloadFileByPath refetches inactive open files without changing focus', async () => {
    let codeReads = 0;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes(encodeURIComponent(CODE_PATH))) {
        codeReads += 1;
        return {
          json: async () => ({
            type: 'file',
            content: `print("demo-${codeReads}")\n`,
          }),
        };
      }
      return {
        json: async () => ({
          type: 'notebook',
          content: NOTEBOOK_PAYLOAD,
        }),
      };
    });

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
      await result.current.handleFileOpen({ path: NOTEBOOK_PATH });
    });

    expect(codeReads).toBe(1);
    expect(result.current.activeFile?.path).toBe(NOTEBOOK_PATH);

    await act(async () => {
      await result.current.reloadFileByPath(CODE_PATH);
    });

    expect(codeReads).toBe(2);
    expect(result.current.activeFile?.path).toBe(NOTEBOOK_PATH);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('tracks runtime and persistable notebook updates with explicit origin metadata', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: NOTEBOOK_PATH });
    });

    expect(result.current.notebookSyncState.origin).toBe('runtime');
    expect(result.current.notebookSyncState.path).toBe(NOTEBOOK_PATH);

    await act(async () => {
      result.current.setNotebookData(
        {
          ...NOTEBOOK_PAYLOAD,
          cells: [{ id: 'cell-a', cell_type: 'code', source: ['print("dirty")'], outputs: [], execution_count: null, metadata: {} }],
        },
        { origin: 'persistable', path: NOTEBOOK_PATH },
      );
    });

    await waitFor(() => {
      expect(result.current.notebookSyncState.origin).toBe('persistable');
      expect(result.current.modifiedFiles.has(NOTEBOOK_PATH)).toBe(true);
    });
  });

  it('renames the active open file by path without requiring focus changes', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    act(() => {
      result.current.renameOpenFile(CODE_PATH, RENAMED_CODE_PATH);
    });

    await waitFor(() => expect(result.current.activeFile?.path).toBe(RENAMED_CODE_PATH));
    expect(result.current.openFiles).toHaveLength(1);
    expect(result.current.openFiles[0].path).toBe(RENAMED_CODE_PATH);
  });

  it('removes the active open file by path', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    act(() => {
      result.current.removeOpenFile(CODE_PATH);
    });

    await waitFor(() => expect(result.current.openFiles).toHaveLength(0));
    expect(result.current.activeFile).toBeNull();
  });

  it('applies external modified events by reloading clean files and flagging dirty files as conflicts', async () => {
    let cleanReads = 0;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes(encodeURIComponent(CODE_PATH))) {
        cleanReads += 1;
        return {
          json: async () => ({
            type: 'file',
            content: cleanReads > 1 ? 'print("updated")\n' : 'print("demo")\n',
          }),
        };
      }
      return {
        json: async () => ({
          type: 'file',
          content: 'print("other")\n',
        }),
      };
    });

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    await act(async () => {
      await result.current.applyExternalWorkspaceEvents([
        { action: 'modified', path: CODE_PATH },
      ]);
    });

    expect(result.current.externalConflictFiles.size).toBe(0);
    expect(result.current.externalStaleFiles.size).toBe(0);

    act(() => {
      result.current.setCode('print("dirty")\n');
    });

    act(() => {
      result.current.setCode('print("dirty-again")\n');
    });

    await waitFor(() => {
      expect(result.current.modifiedFiles.has(CODE_PATH)).toBe(true);
    });

    await act(async () => {
      await result.current.applyExternalWorkspaceEvents([
        { action: 'modified', path: CODE_PATH },
      ]);
    });

    expect(result.current.externalConflictFiles.has(CODE_PATH)).toBe(true);
    expect(result.current.externalStaleFiles.has(CODE_PATH)).toBe(true);
  });

  it('renames open descendants when an external directory move affects clean files', async () => {
    mockReadResponses();

    const notebookActionsRef = { current: null };
    const { result } = renderHook(() => useFileSystem(API_BASE, '# default', notebookActionsRef));

    await act(async () => {
      await result.current.handleFileOpen({ path: CODE_PATH });
    });

    await act(async () => {
      await result.current.applyExternalWorkspaceEvents([
        { action: 'moved', oldPath: 'C:\\workspace', path: 'C:\\workspace-renamed' },
      ]);
    });

    expect(result.current.openFiles).toHaveLength(1);
    expect(result.current.openFiles[0].path).toBe('C:\\workspace-renamed\\demo.py');
    expect(result.current.activeFile?.path).toBe('C:\\workspace-renamed\\demo.py');
  });
});
