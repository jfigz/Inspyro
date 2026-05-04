import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

let latestMonacoProps = null;
let latestVisualizationProps = null;
let latestNotebookEditorProps = null;
let latestDesktopTitleBarProps = null;
const mockNotebookNavigate = jest.fn(() => true);

const mockFileSystemState = {
  currentWorkspace: 'C:\\workspace',
  openFiles: [{ path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' }],
  activeFile: { path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' },
  modifiedFiles: new Set(),
  externalStaleFiles: new Set(),
  externalConflictFiles: new Set(),
  code: 'import helpers as h\nC = h.B + 1\n',
  notebookData: null,
  notebookSyncState: { origin: 'runtime', path: null, token: 0 },
  autoSaveEnabled: false,
  setCode: jest.fn(),
  setNotebookData: jest.fn(),
  setAutoSaveEnabled: jest.fn(),
  handleFileOpen: jest.fn(),
  handleFileSelect: jest.fn(),
  handleFileClose: jest.fn(),
  handleFileDrop: jest.fn(),
  handleWorkspaceChange: jest.fn(),
  saveFile: jest.fn(),
  reloadFile: jest.fn(),
  reloadFileByPath: jest.fn(),
  renameOpenFile: jest.fn(),
  removeOpenFile: jest.fn(),
  applyExternalWorkspaceEvents: jest.fn(async () => null),
};

const mockWebSocketState = {
  connectionStatus: 'connected',
  sendMessage: jest.fn(),
  lastMessage: null,
  messageQueue: [],
  output: '',
  isExecuting: false,
  editorExecutionData: {},
  notebookExecutionData: {},
  setNotebookExecutionData: jest.fn(),
  handleExecuteCode: jest.fn(),
};

jest.mock('./hooks/useFileSystem', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./hooks/useAppWebSocket', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./hooks/useMcpActivity', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./hooks/useMcpShellControls', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./hooks/useMcpMirror', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./hooks/useTemplateMessageHandler', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('./components/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('./components/Resizer', () => ({
  __esModule: true,
  default: () => <div data-testid="resizer" />,
}));

jest.mock('./components/FileTabs', () => ({
  __esModule: true,
  default: () => <div data-testid="file-tabs" />,
}));

jest.mock('./components/FolderSelector', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./components/McpPanel', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./components/DesktopTitleBar', () => ({
  __esModule: true,
  default: (props) => {
    latestDesktopTitleBarProps = props;
    return <div data-testid="desktop-titlebar" />;
  },
}));

jest.mock('./components/NotebookEditor', () => ({
  __esModule: true,
  default: (props) => {
    latestNotebookEditorProps = props;
    if (props.actionsRef) {
      props.actionsRef.current = {
        navigateToCode: mockNotebookNavigate,
      };
    }
    return <div data-testid="notebook-editor" />;
  },
}));

jest.mock('./components/FileExplorer', () => ({
  __esModule: true,
  default: () => <div data-testid="file-explorer" />,
}));

jest.mock('./components/ProjectLauncher', () => ({
  __esModule: true,
  default: () => <div data-testid="project-launcher" />,
}));

jest.mock('./components/MonacoEditor', () => ({
  __esModule: true,
  default: (props) => {
    latestMonacoProps = props;
    return (
      <div data-testid="monaco-editor">
        <span data-testid="monaco-highlight-line">{props.highlightLine ?? ''}</span>
        <span data-testid="monaco-highlight-column">{props.highlightColumn ?? ''}</span>
      </div>
    );
  },
}));

jest.mock('./components/VisualizationPanel', () => ({
  __esModule: true,
  default: (props) => {
    latestVisualizationProps = props;
    return (
      <div data-testid="visualization-panel">
        <span data-testid="viz-has-dependency-props">{props.dependencyProps ? 'yes' : 'no'}</span>
      </div>
    );
  },
}));

describe('App dependency graph wiring for .py files', () => {
  beforeEach(() => {
    latestMonacoProps = null;
    latestVisualizationProps = null;
    latestNotebookEditorProps = null;
    latestDesktopTitleBarProps = null;
    mockNotebookNavigate.mockReset();

    const useFileSystem = require('./hooks/useFileSystem').default;
    const useAppWebSocket = require('./hooks/useAppWebSocket').default;
    const useMcpActivity = require('./hooks/useMcpActivity').default;
    const useMcpShellControls = require('./hooks/useMcpShellControls').default;
    const useMcpMirror = require('./hooks/useMcpMirror').default;

    Object.assign(mockFileSystemState, {
      currentWorkspace: 'C:\\workspace',
      openFiles: [{ path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' }],
      activeFile: { path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' },
      modifiedFiles: new Set(),
      externalStaleFiles: new Set(),
      externalConflictFiles: new Set(),
      code: 'import helpers as h\nC = h.B + 1\n',
      notebookData: null,
      notebookSyncState: { origin: 'runtime', path: null, token: 0 },
      autoSaveEnabled: false,
      setCode: jest.fn(),
      setNotebookData: jest.fn(),
      setAutoSaveEnabled: jest.fn(),
      handleFileOpen: jest.fn(async (file) => {
        const isNotebook = file.path.endsWith('.ipynb');
        const opened = {
          path: file.path,
          name: file.name || (isNotebook ? 'report.ipynb' : 'helpers.py'),
          type: isNotebook ? 'notebook' : 'file',
        };
        mockFileSystemState.activeFile = opened;
        mockFileSystemState.openFiles = [
          { path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' },
          opened,
        ];
        mockFileSystemState.notebookData = isNotebook
          ? {
            cells: [
              { id: 'cell-target', cell_type: 'code', source: ['Heading("hola")'] },
            ],
          }
          : null;
        return opened;
      }),
      handleFileSelect: jest.fn(),
      handleFileClose: jest.fn(),
      handleFileDrop: jest.fn(),
      handleWorkspaceChange: jest.fn(),
      saveFile: jest.fn(),
      reloadFile: jest.fn(),
      reloadFileByPath: jest.fn(),
      renameOpenFile: jest.fn(),
      removeOpenFile: jest.fn(),
      applyExternalWorkspaceEvents: jest.fn(async () => null),
    });

    Object.assign(mockWebSocketState, {
      connectionStatus: 'connected',
      sendMessage: jest.fn(),
      lastMessage: null,
      messageQueue: [],
      output: '',
      isExecuting: false,
      editorExecutionData: {},
      notebookExecutionData: {},
      setNotebookExecutionData: jest.fn(),
      handleExecuteCode: jest.fn(),
    });

    useFileSystem.mockReturnValue(mockFileSystemState);
    useAppWebSocket.mockReturnValue(mockWebSocketState);
    useMcpActivity.mockReturnValue({
      activity: [],
      activeRuns: [],
      runningCount: 0,
      mirrorEnabled: false,
      setMirrorEnabled: jest.fn(),
      toggleMirrorEnabled: jest.fn(),
      agentExecutionState: null,
    });
    useMcpShellControls.mockReturnValue({
      mcpStatus: { status: 'stopped', port: 8100 },
      setMcpStatus: jest.fn(),
      refreshMcpStatus: jest.fn(async () => ({ status: 'stopped', port: 8100 })),
      handleMcpQuickAction: jest.fn(async () => true),
    });
    useMcpMirror.mockReturnValue({
      emitMirrorEvent: jest.fn(),
      mirrorEnabled: false,
      setMirrorEnabled: jest.fn(),
      toggleMirrorEnabled: jest.fn(),
    });

    window.inspyroDesktop = {
      isDesktop: true,
      emitDesktopNotification: jest.fn(),
      reportWorkspace: jest.fn(),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active_workspace: 'C:\\workspace',
        workspace_root: 'C:\\workspace',
        workspace_path: 'C:\\workspace',
        suggested_workspace_root: 'C:\\workspace',
        recent_workspaces: [],
        workspace_source: 'active',
      }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete window.inspyroDesktop;
  });

  it('propaga solicitudes de dependencias desde Monaco al VisualizationPanel en modo code', async () => {
    const App = require('./App').default;

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());
    expect(typeof latestMonacoProps?.onShowDependencyTree).toBe('function');
    expect(screen.getByTestId('viz-has-dependency-props').textContent).toBe('no');

    act(() => {
      latestMonacoProps.onShowDependencyTree({
        symbol: 'h.B',
        line: 2,
        column: 4,
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(screen.getByTestId('viz-has-dependency-props').textContent).toBe('yes'));
    expect(latestVisualizationProps.dependencyProps).toEqual(expect.objectContaining({
      filePath: 'C:\\workspace\\main.py',
      sendMessage: mockWebSocketState.sendMessage,
      lastMessage: null,
    }));
    expect(latestVisualizationProps.dependencyProps.dependencyTarget).toEqual(expect.objectContaining({
      symbol: 'h.B',
      line: 2,
      column: 4,
      mode: 'dependencies',
      sourceCode: mockFileSystemState.code,
    }));
    expect(latestVisualizationProps.dependencyProps.dependencyTarget.requestToken).toEqual(expect.any(String));
  });

  it('resuelve ubicacion cuando el panel pide analizar un simbolo escrito en modo code', async () => {
    const App = require('./App').default;
    Object.assign(mockFileSystemState, {
      code: 'class BeamModel:\n    def capacity_ratio(self):\n        return self.demand / self.capacity\n',
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());

    act(() => {
      latestVisualizationProps.onRequestDependencyAnalysis({
        symbol: 'capacity_ratio',
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(latestVisualizationProps.dependencyProps).toBeTruthy());
    expect(latestVisualizationProps.dependencyProps.dependencyTarget).toEqual(expect.objectContaining({
      symbol: 'capacity_ratio',
      line: 2,
      column: 8,
      mode: 'dependencies',
      sourceCode: mockFileSystemState.code,
    }));
  });

  it('propaga solicitudes de dependencias desde notebooks usando el transporte global de análisis', async () => {
    const notebookPath = 'C:\\workspace\\report.ipynb';
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: notebookPath, name: 'report.ipynb', type: 'notebook' }],
      activeFile: { path: notebookPath, name: 'report.ipynb', type: 'notebook' },
      notebookData: {
        cells: [
          { id: 'cell-a', cell_type: 'code', source: ['w = 12'] },
          { id: 'cell-b', cell_type: 'code', source: ['M_max = w * 2'] },
        ],
      },
      notebookSyncState: { origin: 'runtime', path: notebookPath, token: 5 },
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestNotebookEditorProps.onDependencyTargetChange({
        requestToken: 'notebook-target-1',
        symbol: 'M_max',
        line: 1,
        column: 0,
        mode: 'dependencies',
        sourceCode: 'M_max = w * 2',
        notebookContext: ['w = 12'],
        contextCellIds: ['cell-a'],
        cellId: 'cell-b',
      });
    });

    await waitFor(() => expect(screen.getByTestId('viz-has-dependency-props').textContent).toBe('yes'));
    expect(latestVisualizationProps.dependencyProps).toEqual(expect.objectContaining({
      filePath: notebookPath,
      sendMessage: mockWebSocketState.sendMessage,
      lastMessage: null,
    }));
    expect(latestVisualizationProps.dependencyProps.dependencyTarget).toEqual(expect.objectContaining({
      requestToken: 'notebook-target-1',
      symbol: 'M_max',
      sourceCode: 'M_max = w * 2',
      notebookContext: ['w = 12'],
      contextCellIds: ['cell-a'],
      cellId: 'cell-b',
    }));
  });

  it('permite analizar un simbolo escrito desde el panel en notebooks', async () => {
    const notebookPath = 'C:\\workspace\\report.ipynb';
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: notebookPath, name: 'report.ipynb', type: 'notebook' }],
      activeFile: { path: notebookPath, name: 'report.ipynb', type: 'notebook' },
      notebookData: {
        cells: [
          { id: 'cell-a', cell_type: 'code', source: ['w = 12'] },
          { id: 'cell-b', cell_type: 'code', source: ['M_max = w * 2'] },
          { id: 'cell-c', cell_type: 'code', source: ['final_utilization = M_max / 30'] },
        ],
      },
      notebookSyncState: { origin: 'runtime', path: notebookPath, token: 6 },
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestNotebookEditorProps.onSelectedCellChange('cell-a');
    });

    await waitFor(() => expect(latestVisualizationProps).toBeTruthy());

    act(() => {
      latestVisualizationProps.onRequestDependencyAnalysis({
        symbol: 'final_utilization',
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(latestVisualizationProps.dependencyProps).toBeTruthy());
    expect(latestVisualizationProps.dependencyProps).toEqual(expect.objectContaining({
      filePath: notebookPath,
      sendMessage: mockWebSocketState.sendMessage,
    }));
    expect(latestVisualizationProps.dependencyProps.dependencyTarget).toEqual(expect.objectContaining({
      symbol: 'final_utilization',
      line: 1,
      column: 0,
      mode: 'dependencies',
      sourceCode: 'final_utilization = M_max / 30',
      notebookContext: ['w = 12', 'M_max = w * 2'],
      contextCellIds: ['cell-a', 'cell-b'],
      cellId: 'cell-c',
    }));
  });

  it('evita strings y resuelve atributos cuando el panel analiza simbolos dotted en notebooks', async () => {
    const notebookPath = 'C:\\workspace\\report.ipynb';
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: notebookPath, name: 'report.ipynb', type: 'notebook' }],
      activeFile: { path: notebookPath, name: 'report.ipynb', type: 'notebook' },
      notebookData: {
        cells: [
          { id: 'cell-string', cell_type: 'code', source: ['print("Section.area")'] },
          { id: 'cell-attr', cell_type: 'code', source: ['section = model.section\nsection_area = section.area'] },
        ],
      },
      notebookSyncState: { origin: 'runtime', path: notebookPath, token: 7 },
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestNotebookEditorProps.onSelectedCellChange('cell-string');
    });

    await waitFor(() => expect(latestVisualizationProps).toBeTruthy());

    act(() => {
      latestVisualizationProps.onRequestDependencyAnalysis({
        symbol: 'Section.area',
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(latestVisualizationProps.dependencyProps).toBeTruthy());
    expect(latestVisualizationProps.dependencyProps.dependencyTarget).toEqual(expect.objectContaining({
      symbol: 'Section.area',
      line: 2,
      column: 8,
      mode: 'dependencies',
      sourceCode: 'section = model.section\nsection_area = section.area',
      notebookContext: ['print("Section.area")'],
      contextCellIds: ['cell-string'],
      cellId: 'cell-attr',
    }));
  });

  it('abre un archivo externo y reinyecta highlight cuando la navegación viene desde el grafo', async () => {
    const App = require('./App').default;
    const view = render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());

    act(() => {
      latestMonacoProps.onShowDependencyTree({
        symbol: 'h.B',
        line: 2,
        column: 4,
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(latestVisualizationProps.dependencyProps).toBeTruthy());

    await act(async () => {
      await latestVisualizationProps.dependencyProps.onNavigateToCode({
        filePath: 'C:\\workspace\\helpers.py',
        line: 7,
        column: 2,
        symbol: 'B',
      });
    });

    expect(mockFileSystemState.handleFileOpen).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:\\workspace\\helpers.py',
    }));

    view.rerender(<App />);

    await waitFor(() => expect(screen.getByTestId('monaco-highlight-line').textContent).toBe('7'));
    expect(screen.getByTestId('monaco-highlight-column').textContent).toBe('2');
  });

  it('devuelve false cuando no existe un destino navegable', async () => {
    const App = require('./App').default;

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());

    act(() => {
      latestMonacoProps.onShowDependencyTree({
        symbol: 'h.B',
        line: 2,
        column: 4,
        mode: 'dependencies',
      });
    });

    await waitFor(() => expect(latestVisualizationProps.dependencyProps).toBeTruthy());

    let result = null;
    await act(async () => {
      result = await latestVisualizationProps.dependencyProps.onNavigateToCode({
        symbol: 'B',
      });
    });

    expect(result).toBe(false);
    expect(mockFileSystemState.handleFileOpen).not.toHaveBeenCalled();
  });

  it('abre un notebook externo y navega a la celda cuando el destino incluye filePath + cellId', async () => {
    const App = require('./App').default;
    const view = render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());

    await act(async () => {
      await latestVisualizationProps.onNavigateToCode({
        filePath: 'C:\\workspace\\report.ipynb',
        cellId: 'cell-target',
        line: 12,
      });
    });

    expect(mockFileSystemState.handleFileOpen).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:\\workspace\\report.ipynb',
    }));

    view.rerender(<App />);

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    await waitFor(() => expect(mockNotebookNavigate).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\workspace\\report.ipynb',
      cellId: 'cell-target',
      line: 12,
    })));
  });

  it('preserva target metadata en las notificaciones y agrega una accion navegable', async () => {
    const notebookPath = 'C:\\workspace\\report.ipynb';
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: notebookPath, name: 'report.ipynb', type: 'notebook' }],
      activeFile: { path: notebookPath, name: 'report.ipynb', type: 'notebook' },
      notebookData: {
        cells: [
          { id: 'cell-target', cell_type: 'code', source: ['print("demo")'] },
        ],
      },
      notebookSyncState: { origin: 'runtime', path: notebookPath, token: 3 },
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestNotebookEditorProps.onStatusMessage('No se pudo ubicar la celda de destino solicitada', 'warning', {
        target: {
          kind: 'code',
          filePath: notebookPath,
          cellId: 'cell-target',
          line: 12,
        },
      });
    });

    await waitFor(() => expect(latestDesktopTitleBarProps.notifications.length).toBeGreaterThanOrEqual(1));
    const targetNotification = latestDesktopTitleBarProps.notifications.find((notification) => notification?.target?.kind === 'code');
    expect(targetNotification).toEqual(expect.objectContaining({
      target: expect.objectContaining({
        kind: 'code',
        filePath: notebookPath,
        cellId: 'cell-target',
        line: 12,
      }),
    }));
  });

  it('enriquece las notificaciones batch creadas por App con un destino documental', async () => {
    const notebookPath = 'C:\\workspace\\report.ipynb';
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: notebookPath, name: 'report.ipynb', type: 'notebook' }],
      activeFile: { path: notebookPath, name: 'report.ipynb', type: 'notebook' },
      notebookData: {
        cells: [
          { id: 'cell-target', cell_type: 'code', source: ['print("demo")'] },
        ],
      },
      notebookSyncState: { origin: 'runtime', path: notebookPath, token: 4 },
    });

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestNotebookEditorProps.onBatchExecutionEvent({
        status: 'completed',
        executed: 2,
        total: 2,
        runId: 'batch-1',
      });
    });

    await waitFor(() => expect(latestDesktopTitleBarProps.notifications.length).toBeGreaterThanOrEqual(1));
    const batchNotification = latestDesktopTitleBarProps.notifications.find((notification) => notification?.title === 'Notebook completado');
    expect(batchNotification).toEqual(expect.objectContaining({
      title: 'Notebook completado',
      target: expect.objectContaining({
        kind: 'document',
        sourcePath: notebookPath,
        sourceKind: 'notebook',
      }),
    }));
  });

  it('expone la navegación de notificaciones al title bar y abre recursos exactos', async () => {
    const App = require('./App').default;

    render(<App />);

    await waitFor(() => expect(latestDesktopTitleBarProps?.onNavigate).toBeInstanceOf(Function));

    let result = null;
    await act(async () => {
      result = await latestDesktopTitleBarProps.onNavigate({
        kind: 'file',
        path: 'C:\\workspace\\helpers.py',
      });
    });

    expect(result).toBe(true);
    expect(mockFileSystemState.handleFileOpen).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:\\workspace\\helpers.py',
    }));
  });

  it('muestra un estado central para archivos no soportados y los abre via Desktop', async () => {
    const App = require('./App').default;
    const unsupportedPath = 'C:\\workspace\\diagram.pdf';
    const openPath = jest.fn().mockResolvedValue(unsupportedPath);
    window.inspyroDesktop = {
      isDesktop: true,
      openPath,
      emitDesktopNotification: jest.fn(),
      reportWorkspace: jest.fn(),
    };
    mockFileSystemState.handleFileOpen = jest.fn(async (file) => ({
      path: file.path,
      name: file.name,
      type: 'open_error',
      unsupported: true,
      error: 'No se puede leer este tipo de archivo (binario)',
    }));

    render(<App />);

    await waitFor(() => expect(latestDesktopTitleBarProps?.onNavigate).toBeInstanceOf(Function));
    await act(async () => {
      await latestDesktopTitleBarProps.onNavigate({
        kind: 'file',
        path: unsupportedPath,
      });
    });

    expect(screen.getByText('diagram.pdf')).toBeTruthy();
    expect(screen.getByText('Inspyro no puede abrir este archivo en el editor interno.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir con aplicacion por defecto' }));

    await waitFor(() => expect(openPath).toHaveBeenCalledWith(unsupportedPath));
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/files/open-default'), expect.anything());
  });

  it('abre archivos no soportados via REST cuando no corre en Desktop', async () => {
    const App = require('./App').default;
    const unsupportedPath = 'C:\\workspace\\archive.bin';
    delete window.inspyroDesktop;
    mockFileSystemState.handleFileOpen = jest.fn(async (file) => ({
      path: file.path,
      name: file.name,
      type: 'open_error',
      unsupported: true,
      error: 'No se puede leer este tipo de archivo (binario)',
    }));
    global.fetch = jest.fn().mockImplementation((url, options) => {
      if (String(url).includes('/api/files/open-default')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, path: unsupportedPath, method: 'system_default' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          active_workspace: 'C:\\workspace',
          workspace_root: 'C:\\workspace',
          workspace_path: 'C:\\workspace',
          suggested_workspace_root: 'C:\\workspace',
          recent_workspaces: [],
          workspace_source: 'active',
          options,
        }),
      });
    });

    render(<App />);

    await waitFor(() => expect(latestDesktopTitleBarProps?.onNavigate).toBeInstanceOf(Function));
    await act(async () => {
      await latestDesktopTitleBarProps.onNavigate({
        kind: 'file',
        path: unsupportedPath,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir con aplicacion por defecto' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/files/open-default',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: unsupportedPath }),
      }),
    ));
  });
});
