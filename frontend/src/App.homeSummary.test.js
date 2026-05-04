import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFileSystemState = {
  currentWorkspace: 'C:\\workspace\\demo',
  openFiles: [],
  activeFile: null,
  modifiedFiles: new Set(),
  externalStaleFiles: new Set(),
  externalConflictFiles: new Set(),
  code: '',
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
  connectionStatus: 'disconnected',
  sendMessage: jest.fn(),
  lastMessage: null,
  messageQueue: [],
  notebookConnectionStatusByPath: {},
  notebookMessageQueue: [],
  sendNotebookMessage: jest.fn(),
  getNotebookConnectionStatus: jest.fn(() => 'disconnected'),
  getNotebookLastMessage: jest.fn(() => null),
  output: '',
  isExecuting: false,
  editorExecutionData: {},
  notebookExecutionData: {},
  setNotebookExecutionData: jest.fn(),
  handleExecuteCode: jest.fn(),
  cancelCodeExecution: jest.fn(),
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

jest.mock('./components/DesktopTitleBar', () => ({
  __esModule: true,
  default: () => <div data-testid="desktop-titlebar">titlebar</div>,
}));

jest.mock('./components/McpPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="mcp-panel">mcp panel</div>,
}));

jest.mock('./components/FolderSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="folder-selector">folder selector</div>,
}));

jest.mock('./components/ProjectLauncher', () => ({
  __esModule: true,
  default: () => <div data-testid="project-launcher">launcher</div>,
}));

jest.mock('./components/MonacoEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="monaco-editor">monaco</div>,
}));

jest.mock('./components/VisualizationPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="visualization-panel">viz</div>,
}));

jest.mock('./components/NotebookEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="notebook-editor">notebook</div>,
}));

jest.mock('./components/FileExplorer', () => ({
  __esModule: true,
  default: () => <div data-testid="file-explorer">explorer</div>,
}));

jest.mock('./components/FileTabs', () => ({
  __esModule: true,
  default: () => <div data-testid="file-tabs">tabs</div>,
}));

jest.mock('./components/NotebookIndexPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="notebook-index">index</div>,
}));

jest.mock('./components/Resizer', () => ({
  __esModule: true,
  default: () => <div data-testid="resizer">resizer</div>,
}));

const originalSetInterval = window.setInterval;
const originalClearInterval = window.clearInterval;
const originalGlobalSetInterval = global.setInterval;
const originalGlobalClearInterval = global.clearInterval;

const buildHomeSummaryPayload = (callIndex, overrides = {}) => {
  const base = {
    workspace_path: 'C:\\workspace\\demo',
    updated_at: `2026-04-20T10:00:${String(callIndex).padStart(2, '0')}Z`,
    overview: {
      workspace_notebook_count: callIndex,
      template_attached_count: 0,
      runtime_notebook_count: 0,
      runtime_code_count: 0,
      runtime_total_count: 0,
      runtime_active_count: 0,
      mcp_client_count: callIndex >= 2 ? 1 : 0,
      mcp_client_active_count: callIndex >= 2 ? 1 : 0,
      mcp_active_run_count: callIndex >= 3 ? 1 : 0,
      recent_docx_count: 0,
    },
    notebook_runtime_items: [],
    code_runtime_items: [],
    runtime_items: [],
    recent_docx_items: [],
    mcp_clients: callIndex >= 2 ? [{
      client_id: `client-${callIndex}`,
      client_label: `Client ${callIndex}`,
      status: 'active',
      transport: 'streamable-http',
      last_seen_at: '2026-04-20T10:00:00Z',
      active_run_count: callIndex >= 3 ? 1 : 0,
      recent_activity: callIndex >= 3 ? [{
        tool_name: 'execute_all_cells',
        summary: `Activity ${callIndex}`,
        ts: '2026-04-20T10:00:00Z',
      }] : [],
    }] : [],
    mcp_service: {
      status: 'running',
      port: 8100,
      activity: {
        active_count: callIndex >= 3 ? 1 : 0,
        active_runs: [],
        events: [],
        tool_summary: [],
      },
    },
    template_inventory: [],
  };

  return {
    ...base,
    ...overrides,
    overview: {
      ...base.overview,
      ...(overrides.overview || {}),
    },
    mcp_service: {
      ...base.mcp_service,
      ...(overrides.mcp_service || {}),
      activity: {
        ...base.mcp_service.activity,
        ...(overrides.mcp_service?.activity || {}),
      },
    },
    mcp_clients: overrides.mcp_clients || base.mcp_clients,
    template_inventory: overrides.template_inventory || base.template_inventory,
    notebook_runtime_items: overrides.notebook_runtime_items || base.notebook_runtime_items,
    code_runtime_items: overrides.code_runtime_items || base.code_runtime_items,
    runtime_items: overrides.runtime_items || base.runtime_items,
    recent_docx_items: overrides.recent_docx_items || base.recent_docx_items,
  };
};

const loadLazyModules = async () => {
  await import('./components/MonacoEditor');
  await import('./components/VisualizationPanel');
  await import('./components/NotebookEditor');
  await import('./components/FileExplorer');
  await import('./components/ProjectLauncher');
};

describe('App home summary refresh', () => {
  let intervalCallbacks = [];
  let setIntervalMock = null;
  let clearIntervalMock = null;

  beforeEach(() => {
    const useFileSystem = require('./hooks/useFileSystem').default;
    const useAppWebSocket = require('./hooks/useAppWebSocket').default;
    const useMcpActivity = require('./hooks/useMcpActivity').default;
    const useMcpShellControls = require('./hooks/useMcpShellControls').default;

    intervalCallbacks = [];
    setIntervalMock = jest.fn((callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    });
    clearIntervalMock = jest.fn();
    window.setInterval = setIntervalMock;
    window.clearInterval = clearIntervalMock;
    global.setInterval = setIntervalMock;
    global.clearInterval = clearIntervalMock;

    Object.assign(mockFileSystemState, {
      currentWorkspace: 'C:\\workspace\\demo',
      openFiles: [],
      activeFile: null,
      modifiedFiles: new Set(),
      externalStaleFiles: new Set(),
      externalConflictFiles: new Set(),
      code: '',
      notebookData: null,
      notebookSyncState: { origin: 'runtime', path: null, token: 0 },
      autoSaveEnabled: false,
      applyExternalWorkspaceEvents: jest.fn(async () => null),
    });

    Object.assign(mockWebSocketState, {
      connectionStatus: 'disconnected',
      sendMessage: jest.fn(),
      lastMessage: null,
      messageQueue: [],
      notebookConnectionStatusByPath: {},
      notebookMessageQueue: [],
      sendNotebookMessage: jest.fn(),
      getNotebookConnectionStatus: jest.fn(() => 'disconnected'),
      getNotebookLastMessage: jest.fn(() => null),
      output: '',
      isExecuting: false,
      editorExecutionData: {},
      notebookExecutionData: {},
      setNotebookExecutionData: jest.fn(),
      handleExecuteCode: jest.fn(),
      cancelCodeExecution: jest.fn(),
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

    window.inspyroDesktop = {
      isDesktop: true,
      emitDesktopNotification: jest.fn(),
      reportWorkspace: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    global.setInterval = originalGlobalSetInterval;
    global.clearInterval = originalGlobalClearInterval;
    delete global.fetch;
    delete window.inspyroDesktop;
    delete document.visibilityState;
  });

  it('hydrates home summary and refreshes it on interval, focus, online, and visibility', async () => {
    const App = require('./App').default;
    let homeSummaryCalls = 0;

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        homeSummaryCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(homeSummaryCalls),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

    expect(homeSummaryCalls).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(`${homeSummaryCalls} inventariados`).length).toBeGreaterThan(0);

    const callsAfterMount = homeSummaryCalls;
    const homeIntervalCallback = intervalCallbacks[intervalCallbacks.length - 1];
    expect(typeof homeIntervalCallback).toBe('function');

    await act(async () => {
      await homeIntervalCallback();
    });
    expect(homeSummaryCalls).toBe(callsAfterMount + 1);
    await waitFor(() => expect(screen.getAllByText(`${homeSummaryCalls} inventariados`).length).toBeGreaterThan(0));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(homeSummaryCalls).toBe(callsAfterMount + 2));

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(homeSummaryCalls).toBe(callsAfterMount + 3));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(homeSummaryCalls).toBe(callsAfterMount + 4));

    await waitFor(() => expect(screen.getAllByText(`${homeSummaryCalls} inventariados`).length).toBeGreaterThan(0));
    expect(screen.getByText(`Client ${homeSummaryCalls}`)).toBeTruthy();
  });

  it('surfaces shared PDF converter status for notebook runtimes in Home', async () => {
    const App = require('./App').default;

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(1, {
            overview: {
              runtime_notebook_count: 1,
              runtime_active_count: 1,
            },
            notebook_runtime_items: [{
              kernel_id: 'kernel-shared',
              notebook_path: 'C:\\workspace\\demo\\report.ipynb',
              notebook_relpath: 'report.ipynb',
              state: 'running',
              progress: {
                scope: 'document',
                stage: 'pdf_convert',
                status: 'running',
                percent: 80,
                message: 'Convirtiendo a PDF...',
                shared_resource: {
                  kind: 'pdf_converter',
                  scope: 'global',
                  status: 'waiting',
                },
              },
              template_attached: true,
            }],
            runtime_items: [{
              kernel_id: 'kernel-shared',
              notebook_path: 'C:\\workspace\\demo\\report.ipynb',
              notebook_relpath: 'report.ipynb',
              state: 'running',
              progress: {
                scope: 'document',
                stage: 'pdf_convert',
                status: 'running',
                percent: 80,
                message: 'Convirtiendo a PDF...',
                shared_resource: {
                  kind: 'pdf_converter',
                  scope: 'global',
                  status: 'waiting',
                },
              },
              template_attached: true,
            }],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

    expect(screen.getAllByText(/Esperando convertidor PDF compartido/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PDF en cola/i).length).toBeGreaterThan(0);
  });

  it('stops refreshing home summary after leaving the home surface', async () => {
    const App = require('./App').default;
    let homeSummaryCalls = 0;

    Object.assign(mockFileSystemState, {
      openFiles: [{ path: 'C:\\workspace\\demo.py', name: 'demo.py' }],
      activeFile: { path: 'C:\\workspace\\demo.py', name: 'demo.py' },
    });

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        homeSummaryCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(homeSummaryCalls),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

    const callsBeforeLeavingHome = homeSummaryCalls;
    const homeIntervalCallback = intervalCallbacks[intervalCallbacks.length - 1];
    expect(typeof homeIntervalCallback).toBe('function');

    fireEvent.click(screen.getAllByRole('button', { name: 'Ir a archivos' })[0]);
    await waitFor(() => expect(screen.queryByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeNull());

    expect(screen.getByTestId('monaco-editor')).toBeTruthy();

    await act(async () => {
      await homeIntervalCallback();
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(homeSummaryCalls).toBe(callsBeforeLeavingHome);
    expect(clearIntervalMock).toHaveBeenCalled();
  });

  it('opens the file surface from Home even when no files are open', async () => {
    const App = require('./App').default;

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(1),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: 'Ir a archivos' })[0]);

    await waitFor(() => expect(screen.queryByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeNull());
    expect(screen.getByTestId('file-tabs')).toBeTruthy();
    expect(screen.getByTestId('monaco-editor')).toBeTruthy();
  });

  it('opens the latest DOCX as a file download instead of opening the source notebook', async () => {
    const App = require('./App').default;
    const originalWindowOpen = window.open;
    window.open = jest.fn();

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(1, {
            overview: {
              workspace_notebook_count: 1,
              recent_docx_count: 1,
            },
            template_inventory: [{
              notebook_path: 'C:\\workspace\\demo\\reports\\beam.ipynb',
              notebook_relpath: 'reports\\beam.ipynb',
              template_attached: false,
            }],
            recent_docx_items: [{
              artifact_id: 'artifact-docx-1',
              docx_file_name: 'beam_report.docx',
              source_path: 'C:\\workspace\\demo\\reports\\beam.ipynb',
              source_kind: 'notebook',
              workspace_path: 'C:\\workspace\\demo\\Docx_Documents\\beam_report.docx',
              docx_size_bytes: 204800,
              updated_at: '2026-04-20T10:00:00Z',
            }],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    try {
      await loadLazyModules();
      render(<App />);
      await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

      fireEvent.click(screen.getAllByRole('button', { name: 'Abrir ultimo DOCX' })[0]);

      await waitFor(() => expect(window.open).toHaveBeenCalledWith(
        'http://localhost:8000/api/docx/download?artifact_id=artifact-docx-1',
        '_blank',
        'noopener,noreferrer',
      ));
      expect(mockFileSystemState.handleFileOpen).not.toHaveBeenCalled();
    } finally {
      window.open = originalWindowOpen;
    }
  });

  it('filters internal notebooks, empty DOCX, and shows attached templates first in Home data', async () => {
    const App = require('./App').default;
    const templatedNotebook = 'C:\\workspace\\demo\\reports\\templated.ipynb';
    const usefulNotebook = 'C:\\workspace\\demo\\reports\\useful.ipynb';
    const internalNotebook = 'C:\\workspace\\demo\\_agent_runs\\run-1\\generated.ipynb';

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => buildHomeSummaryPayload(1, {
            overview: {
              workspace_notebook_count: 99,
              template_attached_count: 3,
              recent_docx_count: 2,
            },
            template_inventory: [
              {
                notebook_path: internalNotebook,
                notebook_relpath: '_agent_runs\\run-1\\generated.ipynb',
                template_attached: true,
                home_rank: 0,
              },
              {
                notebook_path: usefulNotebook,
                notebook_relpath: 'reports\\useful.ipynb',
                template_attached: false,
                home_rank: 20,
              },
              {
                notebook_path: templatedNotebook,
                notebook_relpath: 'reports\\templated.ipynb',
                template_attached: true,
                template_mirror_relpath: '.inspyro/templates/mirrors/templated.docx',
                style_count: 12,
                home_rank: 5,
              },
            ],
            recent_docx_items: [
              {
                artifact_id: 'empty-docx',
                docx_file_name: 'empty.docx',
                source_path: usefulNotebook,
                workspace_path: 'C:\\workspace\\demo\\Docx_Documents\\empty.docx',
                docx_size_bytes: 0,
                docx_is_empty: true,
              },
              {
                artifact_id: 'real-docx',
                docx_file_name: 'real.docx',
                source_path: templatedNotebook,
                workspace_path: 'C:\\workspace\\demo\\Docx_Documents\\real.docx',
                docx_size_bytes: 4096,
              },
            ],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());

    expect(screen.getAllByText('2 inventariados').length).toBeGreaterThan(0);
    expect(screen.queryByText('99 inventariados')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir primer notebook' }));
    await waitFor(() => expect(mockFileSystemState.handleFileOpen).toHaveBeenCalledWith(expect.objectContaining({
      path: templatedNotebook,
    })));
    expect(JSON.stringify(mockFileSystemState.handleFileOpen.mock.calls)).not.toContain('_agent_runs');

    expect(screen.getAllByText('real.docx').length).toBeGreaterThan(0);
    expect(screen.queryByText('empty.docx')).toBeNull();

    expect(screen.getAllByText('reports\\templated.ipynb').length).toBeGreaterThan(0);
    expect(screen.getAllByText('reports\\useful.ipynb').length).toBeGreaterThan(0);
    expect(screen.queryByText('_agent_runs\\run-1\\generated.ipynb')).toBeNull();
  });

  it('keeps the last snapshot and marks home as degraded when refresh fails', async () => {
    const App = require('./App').default;
    let homeSummaryCalls = 0;

    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace\\demo',
            workspace_root: 'C:\\workspace\\demo',
            workspace_path: 'C:\\workspace\\demo',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace\\demo'],
            workspace_source: 'persisted',
          }),
        });
      }

      if (String(url).includes('/api/system/home-summary')) {
        homeSummaryCalls += 1;
        if (homeSummaryCalls <= 2) {
          return Promise.resolve({
            ok: true,
            json: async () => buildHomeSummaryPayload(2, {
              overview: { workspace_notebook_count: 2 },
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: 'backend unavailable' }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    await loadLazyModules();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeTruthy());
    expect(screen.getAllByText('2 inventariados').length).toBeGreaterThan(0);
    const homeIntervalCallback = intervalCallbacks[intervalCallbacks.length - 1];
    expect(typeof homeIntervalCallback).toBe('function');

    await act(async () => {
      await homeIntervalCallback();
    });
    await waitFor(() => expect(screen.getByText(/ultimo snapshot disponible/i)).toBeTruthy());

    expect(homeSummaryCalls).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('2 inventariados').length).toBeGreaterThan(0);
    expect(screen.getByText(/ultimo snapshot disponible/i)).toBeTruthy();
  });
});
