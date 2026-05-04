import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockFileSystemState = {
  currentWorkspace: '',
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
  output: '',
  isExecuting: false,
  editorExecutionData: {},
  notebookExecutionData: {},
  setNotebookExecutionData: jest.fn(),
  handleExecuteCode: jest.fn(),
};

const mockDesktopTitleBar = jest.fn((props) => (
  <div
    data-testid="desktop-titlebar"
    data-notification-count={props.notifications.length}
  >
    titlebar
  </div>
));

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
  default: (props) => mockDesktopTitleBar(props),
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

describe('App mount smoke', () => {
  beforeEach(() => {
    const useFileSystem = require('./hooks/useFileSystem').default;
    const useAppWebSocket = require('./hooks/useAppWebSocket').default;
    const useMcpActivity = require('./hooks/useMcpActivity').default;
    const useMcpShellControls = require('./hooks/useMcpShellControls').default;
    mockDesktopTitleBar.mockClear();
    Object.assign(mockFileSystemState, {
      currentWorkspace: '',
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
    window.inspyroDesktop = {
      isDesktop: true,
      emitDesktopNotification: jest.fn(),
      reportWorkspace: jest.fn(),
    };
    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: null,
            workspace_root: 'C:\\workspace',
            workspace_path: 'C:\\workspace',
            suggested_workspace_root: 'C:\\workspace',
            recent_workspaces: [],
            workspace_source: 'default',
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
    delete window.inspyroDesktop;
  });

  it('mounts without throwing and renders visible shell content', async () => {
    const App = require('./App').default;

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('project-launcher')).toBeTruthy());
    expect(screen.getByTestId('mcp-panel')).toBeTruthy();
  });

  it('hydrates workspace home from home-summary even when notebooks are only discovered through inventory', async () => {
    const App = require('./App').default;

    Object.assign(mockFileSystemState, {
      currentWorkspace: 'C:\\workspace\\demo',
      openFiles: [],
      activeFile: null,
    });

    global.fetch.mockImplementation((url) => {
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
          json: async () => ({
            workspace_path: 'C:\\workspace\\demo',
            updated_at: '2026-04-19T12:00:00Z',
            overview: {
              workspace_notebook_count: 1,
              template_attached_count: 0,
              runtime_notebook_count: 0,
              runtime_code_count: 0,
              runtime_total_count: 0,
              runtime_active_count: 0,
              mcp_client_count: 0,
              mcp_client_active_count: 0,
              mcp_active_run_count: 0,
              recent_docx_count: 0,
            },
            notebook_runtime_items: [],
            code_runtime_items: [],
            runtime_items: [],
            recent_docx_items: [],
            mcp_clients: [],
            mcp_service: {
              status: 'stopped',
              port: 8100,
              activity: { active_count: 0, active_runs: [], events: [], tool_summary: [] },
            },
            template_inventory: [
              {
                notebook_path: 'C:\\workspace\\demo\\reports\\checks.ipynb',
                notebook_relpath: 'reports\\checks.ipynb',
                template_attached: false,
                runtime_state: null,
                style_count: 0,
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

    render(<App />);

    await waitFor(() => expect(screen.getByText('Centro operativo')).toBeTruthy());
    expect(screen.getByTestId('agent-home-lane-understand')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Entender' })).toBeTruthy();
    expect(screen.getByText('reports\\checks.ipynb')).toBeTruthy();
    expect(screen.queryByText('No hay notebooks visibles')).toBeNull();
  });
});
