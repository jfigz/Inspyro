import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

let mockCurrentFileSystemState;
let mockCurrentWebSocketState;
let mockLatestVisualizationProps = null;
let latestDesktopTitleBarProps = null;

const buildCodeFileState = () => ({
  currentWorkspace: 'C:\\workspace',
  openFiles: [{ path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' }],
  activeFile: { path: 'C:\\workspace\\main.py', name: 'main.py', type: 'file' },
  modifiedFiles: new Set(),
  externalStaleFiles: new Set(),
  externalConflictFiles: new Set(),
  code: 'print("hello")',
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
});

const buildNotebookFileState = () => ({
  ...buildCodeFileState(),
  openFiles: [{ path: 'C:\\workspace\\report.ipynb', name: 'report.ipynb', type: 'file' }],
  activeFile: { path: 'C:\\workspace\\report.ipynb', name: 'report.ipynb', type: 'file' },
  notebookData: {
    cells: [],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  },
});

const buildWebSocketState = () => ({
  connectionStatus: 'connected',
  sendMessage: jest.fn(),
  lastMessage: null,
  messageQueue: [],
  output: '',
  isExecuting: false,
  editorExecutionData: {
    docxHash: 'editor-docx',
    docxDownloadUrl: '/api/docx/download?artifact_id=editor-artifact',
    docxArtifactId: 'editor-artifact',
    docxSourcePath: 'C:\\workspace\\main.py',
    docxSourceKind: 'code',
    variables: { editor: 1 },
  },
  handleExecuteCode: jest.fn(),
});

jest.mock('./hooks/useFileSystem', () => ({
  __esModule: true,
  default: jest.fn(() => mockCurrentFileSystemState),
}));

jest.mock('./hooks/useAppWebSocket', () => ({
  __esModule: true,
  default: jest.fn(() => mockCurrentWebSocketState),
}));

jest.mock('./hooks/useMcpActivity', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    activity: [],
    activeRuns: [],
    runningCount: 0,
    mirrorEnabled: false,
    setMirrorEnabled: jest.fn(),
    toggleMirrorEnabled: jest.fn(),
    agentExecutionState: null,
  })),
}));

jest.mock('./hooks/useMcpShellControls', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    mcpStatus: null,
    setMcpStatus: jest.fn(),
    refreshMcpStatus: jest.fn(),
    handleMcpQuickAction: jest.fn(),
  })),
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

jest.mock('./components/FileExplorer', () => ({
  __esModule: true,
  default: () => <div data-testid="file-explorer" />,
}));

jest.mock('./components/MonacoEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="monaco-editor" />,
}));

jest.mock('./components/ProjectLauncher', () => ({
  __esModule: true,
  default: () => <div data-testid="project-launcher" />,
}));

jest.mock('./components/VisualizationPanel', () => ({
  __esModule: true,
  default: (props) => {
    mockLatestVisualizationProps = props;
    return <div data-testid="visualization-panel-probe" />;
  },
}));

jest.mock('./components/NotebookEditor', () => ({
  __esModule: true,
  default: (props) => {
    const ReactLocal = require('react');
    const lastEmittedPathRef = ReactLocal.useRef(null);
    ReactLocal.useEffect(() => {
      if (!props.filePath?.endsWith('.ipynb')) {
        lastEmittedPathRef.current = null;
        return;
      }
      if (lastEmittedPathRef.current === props.filePath) {
        return;
      }
      lastEmittedPathRef.current = props.filePath;

      props.onVisualizationData?.({
        docxHash: 'notebook-docx',
        docxArtifactId: 'notebook-artifact',
        docxDownloadUrl: '/api/docx/download?artifact_id=notebook-artifact',
        docxWorkspacePath: 'C:\\workspace\\Docx_Documents\\report.docx',
        docxWorkspaceRelpath: 'Docx_Documents\\report.docx',
        docxWorkspaceWarning: null,
        sourcePath: props.filePath,
        sourceKind: 'notebook',
        variables: { notebook: 1 },
      });
    }, [props.filePath, props.onVisualizationData]);

    return <div data-testid="notebook-editor" />;
  },
}));

describe('App document state ownership', () => {
  beforeEach(() => {
    mockLatestVisualizationProps = null;
    latestDesktopTitleBarProps = null;
    mockCurrentFileSystemState = buildCodeFileState();
    mockCurrentWebSocketState = buildWebSocketState();
    global.fetch = jest.fn().mockImplementation((url) => {
      if (String(url).includes('/api/system/info')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace',
            workspace_root: 'C:\\workspace',
            workspace_path: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace'],
            workspace_source: 'active',
          }),
        });
      }

      if (String(url).includes('/pdf-status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            word_available: true,
            pdf_available: true,
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
  });

  it('keeps editor and notebook document state isolated across view switches', async () => {
    const App = require('./App').default;
    const { rerender } = render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('editor-docx');
      expect(mockLatestVisualizationProps?.documentState?.sourcePath).toBe('C:\\workspace\\main.py');
    });

    mockCurrentFileSystemState = buildNotebookFileState();
    rerender(<App />);

    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('notebook-docx');
      expect(mockLatestVisualizationProps?.documentState?.sourcePath).toBe('C:\\workspace\\report.ipynb');
      expect(mockLatestVisualizationProps?.documentState?.docxWorkspacePath).toBe('C:\\workspace\\Docx_Documents\\report.docx');
      expect(mockLatestVisualizationProps?.documentState?.docxHistory?.[0]?.docxWorkspacePath).toBe('C:\\workspace\\Docx_Documents\\report.docx');
      expect(mockLatestVisualizationProps?.variables).toEqual({ notebook: 1 });
    });

    mockCurrentFileSystemState = buildCodeFileState();
    rerender(<App />);

    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('editor-docx');
      expect(mockLatestVisualizationProps?.documentState?.docxArtifactId).toBe('editor-artifact');
      expect(mockLatestVisualizationProps?.variables).toEqual({ editor: 1 });
    });
  });
});
