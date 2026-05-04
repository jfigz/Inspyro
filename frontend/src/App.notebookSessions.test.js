import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { isPythonNotebookCell } from './utils/notebookCellTypes';

const NOTEBOOK_PATH = 'C:\\workspace\\report.ipynb';
const KERNEL_ID = 'kernel-1';
const LOWERCASE_NOTEBOOK_PATH = NOTEBOOK_PATH.toLowerCase();
const SECOND_NOTEBOOK_PATH = 'C:\\workspace\\other-report.ipynb';
const LOWERCASE_SECOND_NOTEBOOK_PATH = SECOND_NOTEBOOK_PATH.toLowerCase();
const SECOND_KERNEL_ID = 'kernel-2';
const THIRD_NOTEBOOK_PATH = 'C:\\workspace\\third-report.ipynb';
const LOWERCASE_THIRD_NOTEBOOK_PATH = THIRD_NOTEBOOK_PATH.toLowerCase();
const THIRD_KERNEL_ID = 'kernel-3';

const INITIAL_NOTEBOOK = {
  cells: [
    {
      id: 'cell-1',
      cell_type: 'code',
      source: ['print("hello")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

const SECOND_NOTEBOOK = {
  cells: [
    {
      id: 'cell-2',
      cell_type: 'code',
      source: ['print("second")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

const THIRD_NOTEBOOK = {
  cells: [
    {
      id: 'cell-3',
      cell_type: 'code',
      source: ['print("third")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

const MULTI_CELL_NOTEBOOK = {
  cells: [
    {
      id: 'cell-a1',
      cell_type: 'code',
      source: ['print("alpha-1")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
    {
      id: 'cell-a2',
      cell_type: 'code',
      source: ['print("alpha-2")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

const SECOND_MULTI_CELL_NOTEBOOK = {
  cells: [
    {
      id: 'cell-b1',
      cell_type: 'code',
      source: ['print("beta-1")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
    {
      id: 'cell-b2',
      cell_type: 'code',
      source: ['print("beta-2")'],
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

const cloneNotebook = (notebook) => (
  notebook ? JSON.parse(JSON.stringify(notebook)) : null
);

const patchNotebookCell = (notebook, cellId, updater) => {
  if (!notebook || !Array.isArray(notebook.cells) || !cellId || typeof updater !== 'function') {
    return notebook;
  }
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => (
      cell?.id === cellId ? updater(cell) : cell
    )),
  };
};

const appendNotebookStream = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    outputs: [
      ...(Array.isArray(cell.outputs) ? cell.outputs : []),
      {
        output_type: 'stream',
        name: message?.content?.name || 'stdout',
        text: Array.isArray(message?.content?.text)
          ? message.content.text.join('')
          : (message?.content?.text || ''),
      },
    ],
  }),
);

const updateNotebookExecutionCount = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    execution_count: message?.content?.execution_count ?? cell.execution_count,
  }),
);

const clearNotebookOutputs = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    outputs: [],
  }),
);

const resolveTestDisplayId = (content = {}) => (
  content?.transient?.display_id
  || content?.display_id
  || content?.metadata?.display_id
  || null
);

const buildTestRichOutput = (message = {}) => {
  const output = {
    output_type: message.type === 'notebook_display_data' ? 'display_data' : 'execute_result',
    data: message?.content?.data || {},
    metadata: message?.content?.metadata || {},
    execution_count: message?.content?.execution_count ?? null,
  };
  const displayId = resolveTestDisplayId(message?.content || {});
  if (displayId) {
    output.transient = { display_id: displayId };
  }
  return output;
};

const appendNotebookRichOutput = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    outputs: [
      ...(Array.isArray(cell.outputs) ? cell.outputs : []),
      buildTestRichOutput(message),
    ],
  }),
);

const updateNotebookDisplayDataOutput = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => {
    const displayId = resolveTestDisplayId(message?.content || {});
    const previousOutputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    const nextOutput = buildTestRichOutput({ ...message, type: 'notebook_display_data' });
    if (!displayId) {
      return { ...cell, outputs: [...previousOutputs, nextOutput] };
    }
    let replaced = false;
    const outputs = previousOutputs.map((output) => {
      const outputDisplayId = output?.transient?.display_id || output?.metadata?.display_id || null;
      if (outputDisplayId === displayId) {
        replaced = true;
        return nextOutput;
      }
      return output;
    });
    return { ...cell, outputs: replaced ? outputs : [...previousOutputs, nextOutput] };
  },
);

const appendNotebookErrorOutput = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    outputs: [
      ...(Array.isArray(cell.outputs) ? cell.outputs : []),
      {
        output_type: 'error',
        ename: message?.details?.ename || message?.error_code || 'NotebookError',
        evalue: message?.details?.evalue || message?.error || message?.message || 'Error ejecutando celda',
        traceback: Array.isArray(message?.details?.traceback)
          ? message.details.traceback
          : [String(message?.error || message?.message || '')],
      },
    ],
  }),
);

const applyNotebookExecutionResult = (notebook, message = {}) => patchNotebookCell(
  notebook,
  message.cell_id,
  (cell) => ({
    ...cell,
    outputs: Array.isArray(message.outputs) ? message.outputs : (cell.outputs || []),
    execution_count: message.execution_count ?? cell.execution_count,
  }),
);

const stripNotebookRuntime = (notebook) => {
  if (!notebook || !Array.isArray(notebook.cells)) {
    return notebook;
  }
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => (
      isPythonNotebookCell(cell)
        ? {
          ...cell,
          outputs: [],
          execution_count: null,
        }
        : cell
    )),
  };
};

const applyMockNotebookRuntimeMessage = (notebook, message = {}) => {
  switch (message?.type) {
    case 'notebook_created':
    case 'notebook_loaded':
    case 'notebook_attached':
      return cloneNotebook(message.notebook || notebook);
    case 'notebook_stream':
      return appendNotebookStream(notebook, message);
    case 'notebook_execute_input':
      return updateNotebookExecutionCount(notebook, message);
    case 'notebook_clear_output':
      return clearNotebookOutputs(notebook, message);
    case 'notebook_update_display_data':
      return updateNotebookDisplayDataOutput(notebook, message);
    case 'notebook_display_data':
    case 'notebook_execute_result':
      return appendNotebookRichOutput(notebook, message);
    case 'notebook_cell_error':
    case 'notebook_error':
      return appendNotebookErrorOutput(notebook, message);
    case 'notebook_cell_executed':
      return applyNotebookExecutionResult(notebook, message);
    case 'notebook_kernel_reset':
      return stripNotebookRuntime(notebook);
    default:
      return notebook;
  }
};

const mockToFileTestId = (path) => String(path || 'unknown').replace(/[^a-zA-Z0-9]+/g, '-');

let latestDesktopTitleBarProps = null;
let latestNotebookEditorProps = null;
let sendMessageSpy = null;
let pushLastMessage = null;
let mockPushNotebookMessages = null;
let mockPushNotebookQueueEntries = null;
let mockLatestVisualizationProps = null;
let latestWorkspaceHomeProps = null;
let mockEmitKernelStateOnMount = true;
let mockEmitKernelStateOnEveryRender = false;
let mockOpenNotebookPath = NOTEBOOK_PATH;
let mockActiveNotebookPath = NOTEBOOK_PATH;
let mockInitialNotebookData = INITIAL_NOTEBOOK;
let mockNotebookDataByPath = null;
let mockVisibleNotebookPath = null;
let mockVisibleNotebookPathOverrides = {};
let mockOpenFiles = [{ path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' }];
let mockActiveFile = { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' };
let mockNotebookConnectionStatusByPath = {};
const ORIGINAL_FRONTEND_DEBUG_FLAG = process.env.REACT_APP_INSPYRO_DEBUG;

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
  default: ({ openFiles = [], onFileSelect, onFileClose }) => (
    <div data-testid="file-tabs">
      {openFiles.map((file) => {
        const fileId = mockToFileTestId(file?.path || file?.name);
        return (
          <div key={file?.path || fileId}>
            <button
              type="button"
              data-testid={`select-file-${fileId}`}
              onClick={() => onFileSelect?.(file)}
            >
              {file?.name || file?.path}
            </button>
            <button
              type="button"
              data-testid={`close-file-${fileId}`}
              onClick={() => onFileClose?.(file)}
            >
              close {file?.name || file?.path}
            </button>
          </div>
        );
      })}
    </div>
  ),
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

jest.mock('./components/ProjectLauncher', () => ({
  __esModule: true,
  default: () => <div data-testid="project-launcher" />,
}));

jest.mock('./components/AgentWorkspaceHome', () => ({
  __esModule: true,
  default: (props) => {
    latestWorkspaceHomeProps = props;
    return <div data-testid="workspace-home" />;
  },
}));

jest.mock('./components/MonacoEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="monaco-editor" />,
}));

jest.mock('./components/VisualizationPanel', () => ({
  __esModule: true,
  default: (props) => {
    mockLatestVisualizationProps = props;
    return <div data-testid="visualization-panel" />;
  },
}));

jest.mock('./components/NotebookEditor', () => ({
  __esModule: true,
  default: (props) => {
    const ReactLocal = require('react');
    latestNotebookEditorProps = props;
    const [renderNotebook, setRenderNotebook] = ReactLocal.useState(() => cloneNotebook(props.initialNotebook));
    const lastHydrationRef = ReactLocal.useRef({
      filePath: props.filePath || null,
      token: props.initialNotebookToken ?? null,
    });

    ReactLocal.useEffect(() => {
      const nextFilePath = props.filePath || null;
      const nextToken = props.initialNotebookToken ?? null;
      const isNewFile = nextFilePath !== lastHydrationRef.current.filePath;
      const shouldHydrate = Boolean(props.initialNotebook) && (
        isNewFile
        || nextToken !== lastHydrationRef.current.token
        || !renderNotebook
      );

      if (shouldHydrate) {
        setRenderNotebook(cloneNotebook(props.initialNotebook));
        lastHydrationRef.current = {
          filePath: nextFilePath,
          token: nextToken,
        };
        return;
      }

      if (!props.initialNotebook && isNewFile) {
        setRenderNotebook(null);
        lastHydrationRef.current = {
          filePath: nextFilePath,
          token: nextToken,
        };
      }
    }, [props.filePath, props.initialNotebook, props.initialNotebookToken, renderNotebook]);

    ReactLocal.useEffect(() => {
      if (!props.actionsRef) {
        return undefined;
      }
      props.actionsRef.current = {
        consumeRemoteNotebookMessage: (message) => {
          setRenderNotebook((current) => applyMockNotebookRuntimeMessage(current, message));
          return true;
        },
        navigateToCode: () => true,
      };
      return () => {
        if (props.actionsRef.current) {
          props.actionsRef.current = null;
        }
      };
    }, [props.actionsRef]);

    ReactLocal.useEffect(() => {
      if (mockEmitKernelStateOnMount || mockEmitKernelStateOnEveryRender) {
        props.onKernelStateChange?.({
          kernelId: KERNEL_ID,
          kernelInterrupted: false,
          isExecuting: false,
          hasNotebook: true,
        });
      }
    }, [props.initialKernelId, props.onKernelStateChange, props.shellBatchRunState]);

    return (
      <div data-testid="notebook-editor">
        <div data-testid="notebook-kernel">{props.initialKernelId || ''}</div>
        {props.shellBatchRunState && (
          <div data-testid="notebook-shell-batch">
            {props.shellBatchRunState.status}:{props.shellBatchRunState.message}
          </div>
        )}
        {(renderNotebook?.cells || []).map((cell) => (
          <div key={cell.id} data-testid={`notebook-cell-${cell.id}`}>
            {(cell.outputs || []).map((output, index) => (
              <span key={`${cell.id}-${index}`}>
                {output?.data?.['text/plain']
                  || output?.evalue
                  || (Array.isArray(output?.text) ? output.text.join('') : (output?.text || ''))}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  },
}));

describe('App notebook sessions', () => {
  beforeEach(() => {
    delete process.env.REACT_APP_INSPYRO_DEBUG;
    latestDesktopTitleBarProps = null;
    latestNotebookEditorProps = null;
    sendMessageSpy = jest.fn();
    pushLastMessage = null;
    mockPushNotebookMessages = null;
    mockPushNotebookQueueEntries = null;
    mockLatestVisualizationProps = null;
    latestWorkspaceHomeProps = null;
    mockEmitKernelStateOnMount = true;
    mockEmitKernelStateOnEveryRender = false;
    mockOpenNotebookPath = NOTEBOOK_PATH;
    mockActiveNotebookPath = NOTEBOOK_PATH;
    mockInitialNotebookData = INITIAL_NOTEBOOK;
    mockNotebookDataByPath = null;
    mockVisibleNotebookPath = null;
    mockVisibleNotebookPathOverrides = {};
    mockOpenFiles = [{ path: mockOpenNotebookPath, name: 'report.ipynb', type: 'file' }];
    mockActiveFile = { path: mockActiveNotebookPath, name: 'report.ipynb', type: 'file' };
    mockNotebookConnectionStatusByPath = {};

    global.fetch = jest.fn((url) => {
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

    const useFileSystem = require('./hooks/useFileSystem').default;
    const useAppWebSocket = require('./hooks/useAppWebSocket').default;
    const useMcpActivity = require('./hooks/useMcpActivity').default;
    const useMcpShellControls = require('./hooks/useMcpShellControls').default;
    const useMcpMirror = require('./hooks/useMcpMirror').default;
    const useTemplateMessageHandler = require('./hooks/useTemplateMessageHandler').default;

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
      mcpStatus: null,
      setMcpStatus: jest.fn(),
      refreshMcpStatus: jest.fn(),
      handleMcpQuickAction: jest.fn(),
    });
    useMcpMirror.mockImplementation(() => {});
    useTemplateMessageHandler.mockImplementation(() => {});

    useFileSystem.mockImplementation(() => {
      const ReactLocal = require('react');
      const initialNotebookDataByPath = {
        ...(mockNotebookDataByPath || {}),
      };
      if (
        mockInitialNotebookData
        && mockActiveNotebookPath
        && !Object.prototype.hasOwnProperty.call(initialNotebookDataByPath, mockActiveNotebookPath)
      ) {
        initialNotebookDataByPath[mockActiveNotebookPath] = mockInitialNotebookData;
      }

      const initialSyncStateByPath = {};
      [
        ...(mockOpenFiles || []).map((file) => file?.path).filter(Boolean),
        ...Object.keys(initialNotebookDataByPath),
      ].forEach((path) => {
        if (!path || initialSyncStateByPath[path]) {
          return;
        }
        initialSyncStateByPath[path] = {
          origin: 'runtime',
          path,
          token: 1,
        };
      });

      const [openFilesState, setOpenFilesState] = ReactLocal.useState(mockOpenFiles);
      const [activeFileState, setActiveFileState] = ReactLocal.useState(mockActiveFile);
      const [notebookDataByPath, setNotebookDataByPath] = ReactLocal.useState(initialNotebookDataByPath);
      const [notebookSyncStateByPath, setNotebookSyncStateByPath] = ReactLocal.useState(initialSyncStateByPath);
      const [visibleNotebookPath, setVisibleNotebookPath] = ReactLocal.useState(
        mockVisibleNotebookPath || mockActiveNotebookPath || NOTEBOOK_PATH,
      );
      const activeFileRef = ReactLocal.useRef(activeFileState);
      ReactLocal.useEffect(() => {
        activeFileRef.current = activeFileState;
      }, [activeFileState]);

      const activeNotebookPath = activeFileState?.path || mockActiveNotebookPath || NOTEBOOK_PATH;
      const notebookDataPath = visibleNotebookPath || activeNotebookPath;
      const notebookData = notebookDataByPath[notebookDataPath] ?? null;
      const notebookSyncState = notebookSyncStateByPath[notebookDataPath] || {
        origin: 'runtime',
        path: notebookDataPath,
        token: 1,
      };

      const setNotebookData = ReactLocal.useCallback((next, options = {}) => {
        const targetPath = options.path || activeFileRef.current?.path || NOTEBOOK_PATH;
        setNotebookDataByPath((current) => ({
          ...current,
          [targetPath]: next,
        }));
        setNotebookSyncStateByPath((current) => ({
          ...current,
          [targetPath]: {
            origin: options.origin || 'runtime',
            path: targetPath,
            token: (current[targetPath]?.token || 0) + 1,
          },
        }));
        if (targetPath === activeFileRef.current?.path) {
          setVisibleNotebookPath(targetPath);
        }
      }, []);

      const handleFileOpen = ReactLocal.useCallback(async (file) => {
        if (!file?.path) {
          return file;
        }
        setOpenFilesState((current) => (
          current.some((entry) => entry?.path === file.path) ? current : [...current, file]
        ));
        setActiveFileState(file);
        setVisibleNotebookPath(mockVisibleNotebookPathOverrides[file.path] || file.path);
        mockActiveFile = file;
        return file;
      }, []);

      const handleFileSelect = ReactLocal.useCallback(async (file) => {
        if (!file?.path) {
          return null;
        }
        setActiveFileState(file);
        setVisibleNotebookPath(mockVisibleNotebookPathOverrides[file.path] || file.path);
        mockActiveFile = file;
        return file;
      }, []);

      const removeOpenFile = ReactLocal.useCallback((path) => {
        if (!path) {
          return false;
        }
        const nextOpenFiles = openFilesState.filter((file) => file?.path !== path);
        if (nextOpenFiles.length === openFilesState.length) {
          return false;
        }
        setOpenFilesState(nextOpenFiles);
        if (activeFileRef.current?.path === path) {
          const nextActiveFile = nextOpenFiles[0] || null;
          setActiveFileState(nextActiveFile);
          setVisibleNotebookPath(nextActiveFile?.path || null);
          mockActiveFile = nextActiveFile;
        }
        return true;
      }, [openFilesState]);

      return {
        currentWorkspace: 'C:\\workspace',
        openFiles: openFilesState,
        activeFile: activeFileState,
        modifiedFiles: new Set(),
        externalStaleFiles: new Set(),
        externalConflictFiles: new Set(),
        code: '',
        notebookData,
        notebookSyncState,
        autoSaveEnabled: false,
        setCode: jest.fn(),
        setNotebookData,
        setAutoSaveEnabled: jest.fn(),
        handleFileOpen,
        handleFileSelect,
        handleFileClose: jest.fn(),
        handleFileDrop: jest.fn(),
        handleWorkspaceChange: jest.fn(),
        saveFile: jest.fn(),
        reloadFile: jest.fn(),
        reloadFileByPath: jest.fn(),
        renameOpenFile: jest.fn(),
        removeOpenFile,
        applyExternalWorkspaceEvents: jest.fn(async () => null),
      };
    });

    useAppWebSocket.mockImplementation(() => {
      const ReactLocal = require('react');
      const [lastMessage, setLastMessage] = ReactLocal.useState(null);
      const [messageQueue, setMessageQueue] = ReactLocal.useState([]);
      const [notebookMessageQueue, setNotebookMessageQueue] = ReactLocal.useState([]);
      const getMockNotebookConnectionStatus = ReactLocal.useCallback((path) => {
        const normalizedPath = String(path || '').toLowerCase();
        return mockNotebookConnectionStatusByPath[path]
          || mockNotebookConnectionStatusByPath[normalizedPath]
          || 'connected';
      }, []);
      const pushMessages = ReactLocal.useCallback((messages) => {
        const normalizedMessages = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
        if (normalizedMessages.length === 0) {
          return;
        }
        setMessageQueue((current) => {
          const lastId = current[current.length - 1]?.id || 0;
          return [
            ...current,
            ...normalizedMessages.map((message, index) => ({
              id: lastId + index + 1,
              message,
            })),
          ];
        });
        setLastMessage(normalizedMessages[normalizedMessages.length - 1]);
      }, []);
      const pushNotebookEntries = ReactLocal.useCallback((entries) => {
        const normalizedEntries = (Array.isArray(entries) ? entries : [entries])
          .filter(Boolean)
          .map((entry) => {
            if (entry?.message) {
              return {
                path: entry.path || null,
                socketKey: entry.socketKey || null,
                message: entry.message,
              };
            }
            return {
              path: entry?.path || entry?.source_path || entry?.notebook_path || null,
              socketKey: entry?.socketKey || null,
              message: entry,
            };
          });
        if (normalizedEntries.length === 0) {
          return;
        }
        setNotebookMessageQueue((current) => {
          const lastId = current[current.length - 1]?.id || 0;
          return [
            ...current,
            ...normalizedEntries.map((entry, index) => ({
              ...entry,
              id: lastId + index + 1,
            })),
          ];
        });
      }, []);
      pushLastMessage = (message) => pushMessages([message]);
      mockPushNotebookMessages = pushMessages;
      mockPushNotebookQueueEntries = pushNotebookEntries;

      return {
        connectionStatus: 'connected',
        sendMessage: sendMessageSpy,
        lastMessage,
        messageQueue,
        notebookMessageQueue,
        sendNotebookMessage: (path, message) => {
          sendMessageSpy(message);
          return getMockNotebookConnectionStatus(path) === 'connected';
        },
        getNotebookConnectionStatus: getMockNotebookConnectionStatus,
        getNotebookLastMessage: () => null,
        output: '',
        isExecuting: false,
        editorExecutionData: {},
        notebookExecutionData: {},
        setNotebookExecutionData: jest.fn(),
        handleExecuteCode: jest.fn(),
        cancelCodeExecution: jest.fn(),
        clearCodeExecutionState: jest.fn(),
        codeExecutionStateByPath: {},
      };
    });
  });

  afterEach(() => {
    if (typeof ORIGINAL_FRONTEND_DEBUG_FLAG === 'string') {
      process.env.REACT_APP_INSPYRO_DEBUG = ORIGINAL_FRONTEND_DEBUG_FLAG;
    } else {
      delete process.env.REACT_APP_INSPYRO_DEBUG;
    }
    jest.clearAllMocks();
    delete global.fetch;
  });

  it('starts notebooks with a wider split without changing the code editor split', async () => {
    const App = require('./App').default;

    const { unmount } = render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });
    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    expect(mockLatestVisualizationProps?.style?.width).toBe('calc(42% - var(--split-panel-offset))');

    unmount();
    mockLatestVisualizationProps = null;
    const codeFile = { path: 'C:\\workspace\\calc.py', name: 'calc.py', type: 'file' };
    mockOpenFiles = [codeFile];
    mockActiveFile = codeFile;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });
    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeTruthy());
    expect(mockLatestVisualizationProps?.style?.width).toBe('calc(55% - var(--split-panel-offset))');
  });

  it('keeps runtime notebook state in App while the editor is hidden without sending attach during normal home/file navigation', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);

    act(() => {
      latestDesktopTitleBarProps?.onGoHome?.();
    });

    await waitFor(() => expect(screen.getByTestId('workspace-home')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_executed',
        notebook_path: NOTEBOOK_PATH,
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        execution_count: 1,
        outputs: [
          {
            output_type: 'stream',
            name: 'stdout',
            text: 'after-home\n',
          },
        ],
      });
    });

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('after-home'));
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);
  });

  it('reattaches a persisted template without crashing when the last attach marker is still null', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    expect(mockLatestVisualizationProps?.onTemplateUpload).toEqual(expect.any(Function));

    act(() => {
      mockLatestVisualizationProps.onTemplateUpload({ templateToken: 'template-123' });
    });

    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_attach',
      kernel_id: KERNEL_ID,
      template_token: 'template-123',
      path: NOTEBOOK_PATH,
    })));
    expect(screen.getByTestId('notebook-editor')).toBeTruthy();
  });

  it('routes hidden notebook stream messages by execution_id while another notebook is running', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
      latestNotebookEditorProps?.onPendingExecutionRequestChange?.({
        kind: 'single_cell',
        filePath: NOTEBOOK_PATH,
        cellId: 'cell-1',
        executionId: 'exec-first-hidden',
        detached: false,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: SECOND_NOTEBOOK_PATH,
        source_path: SECOND_NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: SECOND_KERNEL_ID,
        notebook: SECOND_NOTEBOOK,
      });
      latestNotebookEditorProps?.onPendingExecutionRequestChange?.({
        kind: 'single_cell',
        filePath: SECOND_NOTEBOOK_PATH,
        cellId: 'cell-2',
        executionId: 'exec-second-visible',
        detached: false,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(SECOND_KERNEL_ID));

    act(() => {
      pushLastMessage?.({
        type: 'notebook_stream',
        execution_id: 'exec-first-hidden',
        cell_id: 'cell-1',
        content: {
          name: 'stdout',
          text: 'hidden-stream\n',
        },
      });
    });

    expect(screen.queryByText('hidden-stream')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('hidden-stream'));
    expect(screen.queryByText('cell-2')).toBeNull();
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);
  });

  it('routes hidden notebook messages by notebook queue path when the payload omits source_path and kernel_id', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: SECOND_NOTEBOOK_PATH,
        source_path: SECOND_NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: SECOND_KERNEL_ID,
        notebook: SECOND_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(SECOND_KERNEL_ID));

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: NOTEBOOK_PATH,
        message: {
          type: 'notebook_stream',
          cell_id: 'cell-1',
          execution_id: 'exec-hidden-without-path',
          content: {
            name: 'stdout',
            text: 'path-routed\n',
          },
        },
      });
    });

    expect(screen.queryByText('path-routed')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('path-routed'));
    expect(screen.queryByText('cell-2')).toBeNull();
  });

  it('relays visible notebook runtime messages through App and preserves the runtime snapshot across tab switches', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: NOTEBOOK_PATH,
        socketKey: LOWERCASE_NOTEBOOK_PATH,
        message: {
          type: 'notebook_loaded',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          notebook: INITIAL_NOTEBOOK,
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    const initialHydrationToken = latestNotebookEditorProps?.initialNotebookToken;

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: NOTEBOOK_PATH,
        socketKey: LOWERCASE_NOTEBOOK_PATH,
        message: {
          type: 'notebook_cell_executed',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          cell_id: 'cell-1',
          execution_id: 'visible-exec-1',
          execution_count: 1,
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'visible-relay\n',
            },
          ],
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('visible-relay'));
    expect(latestNotebookEditorProps?.initialNotebookToken).toBe(initialHydrationToken);

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('visible-relay'));
  });

  it('keeps the visible editor hydration token stable for runtime-only shell updates', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: NOTEBOOK_PATH,
        socketKey: LOWERCASE_NOTEBOOK_PATH,
        message: {
          type: 'notebook_loaded',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          notebook: INITIAL_NOTEBOOK,
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    const initialHydrationToken = latestNotebookEditorProps?.initialNotebookToken;

    act(() => {
      mockPushNotebookQueueEntries?.([
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_execute_input',
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            cell_id: 'cell-1',
            execution_id: 'visible-token-exec-1',
            content: { execution_count: 1 },
          },
        },
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_stream',
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            cell_id: 'cell-1',
            execution_id: 'visible-token-exec-1',
            content: {
              name: 'stdout',
              text: 'token-stable\n',
            },
          },
        },
      ]);
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('token-stable'));
    expect(latestNotebookEditorProps?.initialNotebookToken).toBe(initialHydrationToken);
  });

  it('keeps two live notebook sessions isolated while switching tabs', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: SECOND_NOTEBOOK_PATH,
        source_path: SECOND_NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: SECOND_KERNEL_ID,
        notebook: SECOND_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(SECOND_KERNEL_ID));

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_executed',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        execution_count: 1,
        outputs: [
          {
            output_type: 'stream',
            name: 'stdout',
            text: 'report-hidden\n',
          },
        ],
      });
    });

    expect(screen.queryByText('report-hidden')).toBeNull();

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: SECOND_NOTEBOOK_PATH,
        socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
        message: {
          type: 'notebook_cell_executed',
          notebook_path: SECOND_NOTEBOOK_PATH,
          source_path: SECOND_NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: SECOND_KERNEL_ID,
          cell_id: 'cell-2',
          execution_id: 'second-visible-exec',
          execution_count: 1,
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'second-visible\n',
            },
          ],
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2').textContent).toContain('second-visible'));
    expect(screen.queryByText('report-hidden')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('report-hidden'));
    expect(screen.queryByText('second-visible')).toBeNull();
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_shutdown_kernel')).toBe(false);
  });

  it('advances two shell-owned Run All sessions in parallel beyond the first cell without cross-contamination', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: MULTI_CELL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_MULTI_CELL_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let firstLoadRequestId = null;
    await waitFor(() => {
      const loadMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_load' && message.path === NOTEBOOK_PATH);
      expect(loadMessage).toBeTruthy();
      firstLoadRequestId = loadMessage.request_id;
    });

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: NOTEBOOK_PATH,
        socketKey: LOWERCASE_NOTEBOOK_PATH,
        message: {
          type: 'notebook_loaded',
          request_id: firstLoadRequestId,
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          notebook: MULTI_CELL_NOTEBOOK,
        },
      });
    });

    let firstNotebookFirstExecutionId = null;
    await waitFor(() => {
      const executeMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => (
          message.type === 'notebook_execute_cell'
          && message.path === NOTEBOOK_PATH
          && message.cell_id === 'cell-a1'
        ));
      expect(executeMessage).toBeTruthy();
      firstNotebookFirstExecutionId = executeMessage.execution_id;
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-b1')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let secondLoadRequestId = null;
    await waitFor(() => {
      const loadMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_load' && message.path === SECOND_NOTEBOOK_PATH);
      expect(loadMessage).toBeTruthy();
      secondLoadRequestId = loadMessage.request_id;
    });

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: SECOND_NOTEBOOK_PATH,
        socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
        message: {
          type: 'notebook_loaded',
          request_id: secondLoadRequestId,
          notebook_path: SECOND_NOTEBOOK_PATH,
          source_path: SECOND_NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: SECOND_KERNEL_ID,
          notebook: SECOND_MULTI_CELL_NOTEBOOK,
        },
      });
    });

    let secondNotebookFirstExecutionId = null;
    await waitFor(() => {
      const executeMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => (
          message.type === 'notebook_execute_cell'
          && message.path === SECOND_NOTEBOOK_PATH
          && message.cell_id === 'cell-b1'
        ));
      expect(executeMessage).toBeTruthy();
      secondNotebookFirstExecutionId = executeMessage.execution_id;
    });

    act(() => {
      mockPushNotebookQueueEntries?.([
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            cell_id: 'cell-a1',
            execution_id: firstNotebookFirstExecutionId,
            execution_count: 1,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'A-first-done\n',
              },
            ],
          },
        },
        {
          path: SECOND_NOTEBOOK_PATH,
          socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: SECOND_NOTEBOOK_PATH,
            source_path: SECOND_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: SECOND_KERNEL_ID,
            cell_id: 'cell-b1',
            execution_id: secondNotebookFirstExecutionId,
            execution_count: 1,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'B-first-done\n',
              },
            ],
          },
        },
      ]);
    });

    let firstNotebookSecondExecutionId = null;
    let secondNotebookSecondExecutionId = null;
    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      const nextA = executeMessages.find((message) => (
        message.path === NOTEBOOK_PATH && message.cell_id === 'cell-a2'
      ));
      const nextB = executeMessages.find((message) => (
        message.path === SECOND_NOTEBOOK_PATH && message.cell_id === 'cell-b2'
      ));
      expect(nextA).toBeTruthy();
      expect(nextB).toBeTruthy();
      firstNotebookSecondExecutionId = nextA.execution_id;
      secondNotebookSecondExecutionId = nextB.execution_id;
    });

    act(() => {
      mockPushNotebookQueueEntries?.([
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            cell_id: 'cell-a2',
            execution_id: firstNotebookSecondExecutionId,
            execution_count: 2,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'A-second-done\n',
              },
            ],
          },
        },
        {
          path: SECOND_NOTEBOOK_PATH,
          socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: SECOND_NOTEBOOK_PATH,
            source_path: SECOND_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: SECOND_KERNEL_ID,
            cell_id: 'cell-b2',
            execution_id: secondNotebookSecondExecutionId,
            execution_count: 2,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'B-second-done\n',
              },
            ],
          },
        },
      ]);
    });

    await waitFor(() => {
      const completionNotifications = (latestDesktopTitleBarProps?.notifications || []).filter((notification) => (
        notification?.title === 'Notebook completado'
      ));
      expect(completionNotifications).toHaveLength(2);
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-a2').textContent).toContain('A-second-done'));
    expect(screen.queryByText('B-second-done')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-b2').textContent).toContain('B-second-done'));
    expect(screen.queryByText('A-second-done')).toBeNull();
  });

  it('queues three shell-owned Run All starts while notebook sockets are still connecting', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
      [THIRD_NOTEBOOK_PATH]: THIRD_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
      { path: THIRD_NOTEBOOK_PATH, name: 'third-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;
    mockNotebookConnectionStatusByPath = {
      [LOWERCASE_NOTEBOOK_PATH]: 'connecting',
      [LOWERCASE_SECOND_NOTEBOOK_PATH]: 'connecting',
      [LOWERCASE_THIRD_NOTEBOOK_PATH]: 'connecting',
    };

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(THIRD_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-3')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let loadMessageByPath = {};
    await waitFor(() => {
      const loadMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_load');
      loadMessageByPath = Object.fromEntries(loadMessages.map((message) => [message.path, message]));
      expect(Object.keys(loadMessageByPath)).toEqual(expect.arrayContaining([
        NOTEBOOK_PATH,
        SECOND_NOTEBOOK_PATH,
        THIRD_NOTEBOOK_PATH,
      ]));
      expect(loadMessageByPath[NOTEBOOK_PATH].request_id).toBeTruthy();
      expect(loadMessageByPath[SECOND_NOTEBOOK_PATH].request_id).toBeTruthy();
      expect(loadMessageByPath[THIRD_NOTEBOOK_PATH].request_id).toBeTruthy();
    });

    mockNotebookConnectionStatusByPath = {
      [LOWERCASE_NOTEBOOK_PATH]: 'connected',
      [LOWERCASE_SECOND_NOTEBOOK_PATH]: 'connected',
      [LOWERCASE_THIRD_NOTEBOOK_PATH]: 'connected',
    };

    act(() => {
      mockPushNotebookQueueEntries?.([
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_loaded',
            request_id: loadMessageByPath[NOTEBOOK_PATH].request_id,
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            notebook: INITIAL_NOTEBOOK,
          },
        },
        {
          path: SECOND_NOTEBOOK_PATH,
          socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
          message: {
            type: 'notebook_loaded',
            request_id: loadMessageByPath[SECOND_NOTEBOOK_PATH].request_id,
            notebook_path: SECOND_NOTEBOOK_PATH,
            source_path: SECOND_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: SECOND_KERNEL_ID,
            notebook: SECOND_NOTEBOOK,
          },
        },
        {
          path: THIRD_NOTEBOOK_PATH,
          socketKey: LOWERCASE_THIRD_NOTEBOOK_PATH,
          message: {
            type: 'notebook_loaded',
            request_id: loadMessageByPath[THIRD_NOTEBOOK_PATH].request_id,
            notebook_path: THIRD_NOTEBOOK_PATH,
            source_path: THIRD_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: THIRD_KERNEL_ID,
            notebook: THIRD_NOTEBOOK,
          },
        },
      ]);
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: NOTEBOOK_PATH,
          kernel_id: KERNEL_ID,
          cell_id: 'cell-1',
        }),
        expect.objectContaining({
          path: SECOND_NOTEBOOK_PATH,
          kernel_id: SECOND_KERNEL_ID,
          cell_id: 'cell-2',
        }),
        expect.objectContaining({
          path: THIRD_NOTEBOOK_PATH,
          kernel_id: THIRD_KERNEL_ID,
          cell_id: 'cell-3',
        }),
      ]));
    });

    act(() => {
      latestDesktopTitleBarProps?.onGoHome?.();
    });

    await waitFor(() => expect(screen.getByTestId('workspace-home')).toBeTruthy());
    await waitFor(() => {
      const workspaceData = latestWorkspaceHomeProps?.workspaceData;
      expect(workspaceData?.meta).toEqual(expect.arrayContaining(['3 notebooks', '3 activos']));

      const notebookRows = workspaceData?.cards?.notebooks?.rows || [];
      const shellRows = notebookRows.filter((row) => [
        NOTEBOOK_PATH,
        SECOND_NOTEBOOK_PATH,
        THIRD_NOTEBOOK_PATH,
      ].includes(row?.target?.payload?.path));

      expect(shellRows).toHaveLength(3);
      expect(shellRows.map((row) => row.title)).toEqual(expect.arrayContaining([
        'report.ipynb',
        'other-report.ipynb',
        'third-report.ipynb',
      ]));
      expect(shellRows.every((row) => row.progress?.value > 0 && row.progress?.label)).toBe(true);
      expect(shellRows.every((row) => row.badges?.some((badge) => badge.label === 'Ejecutando'))).toBe(true);

      const runStage = workspaceData?.journey?.stages?.find((stage) => stage.id === 'run');
      expect(runStage?.badge?.label).toBe('3 activos');
    });
  });

  it('shuts down only the closed notebook tab runtime and leaves the other notebook session alive', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: SECOND_NOTEBOOK_PATH,
        source_path: SECOND_NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: SECOND_KERNEL_ID,
        notebook: SECOND_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(SECOND_KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`close-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => {
      const shutdownMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_shutdown_kernel');
      expect(shutdownMessages).toHaveLength(1);
      expect(shutdownMessages[0]).toEqual(expect.objectContaining({
        kernel_id: KERNEL_ID,
        path: NOTEBOOK_PATH,
      }));
    });

    expect(screen.getByTestId('notebook-kernel').textContent).toBe(SECOND_KERNEL_ID);

    act(() => {
      mockPushNotebookQueueEntries?.({
        path: SECOND_NOTEBOOK_PATH,
        socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
        message: {
          type: 'notebook_cell_executed',
          notebook_path: SECOND_NOTEBOOK_PATH,
          source_path: SECOND_NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: SECOND_KERNEL_ID,
          cell_id: 'cell-2',
          execution_id: 'second-after-close-exec',
          execution_count: 1,
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'second-after-close\n',
            },
          ],
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2').textContent).toContain('second-after-close'));
    const shutdownMessages = sendMessageSpy.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'notebook_shutdown_kernel');
    expect(shutdownMessages.some((message) => message.kernel_id === SECOND_KERNEL_ID)).toBe(false);
  });

  it('reuses the active notebook session key when the active file path casing differs', async () => {
    mockEmitKernelStateOnMount = false;
    mockOpenNotebookPath = NOTEBOOK_PATH;
    mockActiveNotebookPath = LOWERCASE_NOTEBOOK_PATH;
    mockInitialNotebookData = null;
    mockOpenFiles = [{ path: mockOpenNotebookPath, name: 'report.ipynb', type: 'file' }];
    mockActiveFile = { path: mockActiveNotebookPath, name: 'report.ipynb', type: 'file' };

    const App = require('./App').default;

    render(<App />);

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
    });

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());
    expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID);
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);
  });

  it('routes a delayed kernel-state sync by reported notebook path instead of the active tab', async () => {
    mockEmitKernelStateOnMount = false;
    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(latestNotebookEditorProps?.filePath).toBe(SECOND_NOTEBOOK_PATH));
    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(''));

    act(() => {
      latestNotebookEditorProps?.onKernelStateChange?.({
        filePath: NOTEBOOK_PATH,
        kernelId: KERNEL_ID,
        kernelInterrupted: false,
        isExecuting: false,
        hasNotebook: true,
      });
    });

    expect(screen.getByTestId('notebook-kernel').textContent).toBe('');

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-kernel').textContent).toBe(KERNEL_ID));
  });

  it('dispatches the first Run All cell exactly once when the kernel is already active', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      expect(executeMessages[0]).toEqual(expect.objectContaining({
        kernel_id: KERNEL_ID,
        path: NOTEBOOK_PATH,
        cell_id: 'cell-1',
        skip_pdf: false,
      }));
    });
    expect(sendMessageSpy.mock.calls.some(([message]) => message.type === 'notebook_attach_kernel')).toBe(false);
  });

  it('keeps Run All tracing silent by default', async () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
    });

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it('emits Run All tracing only when REACT_APP_INSPYRO_DEBUG=1', async () => {
    process.env.REACT_APP_INSPYRO_DEBUG = '1';
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[App][Run All]',
        'handleExecuteNotebookBatch start',
        expect.any(Object),
      );
    });
  });

  it('starts Run All from waiting_kernel and dispatches the first cell after notebook_loaded arrives', async () => {
    mockEmitKernelStateOnMount = false;
    mockInitialNotebookData = {
      ...INITIAL_NOTEBOOK,
      cells: [
        {
          ...INITIAL_NOTEBOOK.cells[0],
          outputs: [{ output_type: 'stream', text: 'stale\n' }],
          execution_count: 7,
          metadata: {
            execution_duration: 1234,
          },
        },
      ],
    };
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      const loadMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_load');
      expect(loadMessages).toHaveLength(1);
      expect(typeof loadMessages[0].content).toBe('string');
      const strippedNotebook = JSON.parse(loadMessages[0].content);
      expect(strippedNotebook.cells).toHaveLength(1);
      expect(strippedNotebook.cells[0]).toEqual(expect.objectContaining({
        id: 'cell-1',
        outputs: [],
        execution_count: null,
        metadata: {
          inspyro_id: 'cell-1',
        },
      }));
      expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(true);
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('waiting_kernel');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: 'kernel-2',
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      expect(executeMessages[0]).toEqual(expect.objectContaining({
        kernel_id: 'kernel-2',
        path: NOTEBOOK_PATH,
        cell_id: 'cell-1',
      }));
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
    });
  });

  it('matches notebook_loaded by request_id even when notebook_path does not match the active session', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let requestId = null;
    await waitFor(() => {
      const loadMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_load');
      expect(loadMessage).toBeTruthy();
      requestId = loadMessage.request_id;
      expect(typeof requestId).toBe('string');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        request_id: requestId,
        notebook_path: 'D:\\mismatch\\other-notebook.ipynb',
        source_path: 'D:\\mismatch\\other-notebook.ipynb',
        source_kind: 'notebook',
        kernel_id: 'kernel-2',
        notebook: INITIAL_NOTEBOOK,
      });
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      expect(executeMessages[0]).toEqual(expect.objectContaining({
        kernel_id: 'kernel-2',
        path: NOTEBOOK_PATH,
        cell_id: 'cell-1',
      }));
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
    });
  });

  it('promotes waiting_kernel from onKernelStateChange when the editor reports a kernelId', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('waiting_kernel');
    });

    act(() => {
      latestNotebookEditorProps?.onKernelStateChange?.({
        kernelId: 'kernel-2',
        kernelInterrupted: false,
        isExecuting: false,
        hasNotebook: true,
      });
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      expect(executeMessages[0]).toEqual(expect.objectContaining({
        kernel_id: 'kernel-2',
        path: NOTEBOOK_PATH,
        cell_id: 'cell-1',
      }));
      expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(true);
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
    });
  });

  it('promotes waiting_kernel from notebook_execute_input without notebook_loaded', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('waiting_kernel');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_execute_input',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: 'kernel-2',
        cell_id: 'cell-1',
        execution_id: 'backend-exec-1',
        content: {
          execution_count: 1,
        },
      });
    });

    await waitFor(() => {
      expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(true);
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(0);
    });
  });

  it('promotes waiting_kernel from notebook_stream without notebook_loaded', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('waiting_kernel');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_stream',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: 'kernel-2',
        cell_id: 'cell-1',
        execution_id: 'backend-exec-stream-1',
        content: {
          name: 'stdout',
          text: 'booting\n',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(0);
    });
  });

  it('fails Run All when waiting_kernel times out without ack or kernelId', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;
    const nativeSetTimeout = global.setTimeout;
    const capturedTimeouts = [];

    try {
      render(<App />);

      act(() => {
        latestDesktopTitleBarProps?.onGoToFileSurface?.();
      });

      await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

      global.setTimeout = ((callback, delay, ...args) => {
        if (Number(delay) >= 19000) {
          capturedTimeouts.push(() => callback(...args));
          return 1;
        }
        return nativeSetTimeout(callback, delay, ...args);
      });

      act(() => {
        latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
      });

      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('waiting_kernel');

      expect(capturedTimeouts.length).toBeGreaterThan(0);

      act(() => {
        capturedTimeouts[0]();
      });

      await waitFor(() => {
        expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(false);
        expect(screen.queryByTestId('notebook-shell-batch')).toBeNull();
      });
      const failureNotification = latestDesktopTitleBarProps?.notifications?.find((notification) => (
        notification?.title === 'Notebook interrumpido'
      ));
      expect(failureNotification).toEqual(expect.objectContaining({
        message: 'Timeout iniciando kernel para Run All',
      }));
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(0);
    } finally {
      global.setTimeout = nativeSetTimeout;
    }
  });

  it('does not double-dispatch the first cell when lifecycle ack and editor fallback arrive together', async () => {
    mockEmitKernelStateOnMount = false;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let requestId = null;
    await waitFor(() => {
      const loadMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_load');
      expect(loadMessage).toBeTruthy();
      requestId = loadMessage.request_id;
      expect(typeof requestId).toBe('string');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_loaded',
        request_id: requestId,
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: 'kernel-2',
        notebook: INITIAL_NOTEBOOK,
      });
      latestNotebookEditorProps?.onKernelStateChange?.({
        kernelId: 'kernel-2',
        kernelInterrupted: false,
        isExecuting: false,
        hasNotebook: true,
      });
    });

    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      expect(executeMessages[0]).toEqual(expect.objectContaining({
        kernel_id: 'kernel-2',
        path: NOTEBOOK_PATH,
        cell_id: 'cell-1',
      }));
      expect(screen.getByTestId('notebook-shell-batch').textContent).toContain('running');
    });
  });

  it('does not leave Run All marked as running when the first execute dispatch throws', async () => {
    sendMessageSpy.mockImplementation((message) => {
      if (message?.type === 'notebook_execute_cell') {
        throw new Error('ws_send_failed');
      }
    });
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(false);
      const failureNotification = latestDesktopTitleBarProps?.notifications?.find((notification) => (
        notification?.title === 'Notebook interrumpido'
      ));
      expect(failureNotification).toEqual(expect.objectContaining({
        message: 'No se pudo iniciar Run All. Reintenta.',
        target: expect.objectContaining({
          kind: 'file',
          path: NOTEBOOK_PATH,
        }),
      }));
    });
  });

  it('ignores a child kernel-state sync that tries to clear shell-owned Run All execution state', async () => {
    mockEmitKernelStateOnEveryRender = true;
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    await waitFor(() => {
      expect(latestDesktopTitleBarProps?.notebookToolbarProps?.isExecuting).toBe(true);
      expect(latestNotebookEditorProps?.shellBatchRunState).toEqual(expect.objectContaining({
        status: 'running',
        currentCellId: 'cell-1',
      }));
    });
  });

  it('emits the completion notification from App when the shell-owned batch finishes', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let executionId = null;
    await waitFor(() => {
      const executeMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_execute_cell');
      expect(executeMessage).toBeTruthy();
      executionId = executeMessage.execution_id;
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_executed',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        execution_id: executionId,
        outputs: [],
        execution_count: 1,
      });
    });

    await waitFor(() => {
      const completionNotification = latestDesktopTitleBarProps?.notifications?.find((notification) => (
        notification?.title === 'Notebook completado'
      ));
      expect(completionNotification).toEqual(expect.objectContaining({
        message: 'Run All completado (1/1 celdas).',
        target: expect.objectContaining({
          kind: 'document',
          sourcePath: NOTEBOOK_PATH,
          sourceKind: 'notebook',
        }),
      }));
    });
  });

  it('emits the failure notification from App when the shell-owned batch errors', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let executionId = null;
    await waitFor(() => {
      const executeMessage = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .find((message) => message.type === 'notebook_execute_cell');
      expect(executeMessage).toBeTruthy();
      executionId = executeMessage.execution_id;
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_error',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        execution_id: executionId,
        error_code: 'notebook_execute_cell_failed',
        error: 'boom',
        message: 'boom',
      });
    });

    await waitFor(() => {
      const failureNotification = latestDesktopTitleBarProps?.notifications?.find((notification) => (
        notification?.title === 'Notebook interrumpido'
      ));
      expect(failureNotification).toEqual(expect.objectContaining({
        message: 'boom',
        target: expect.objectContaining({
          kind: 'file',
          path: NOTEBOOK_PATH,
        }),
      }));
    });
  });

  it('recovers Run All by reloading the notebook when the current kernel is stale', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.notebookToolbarProps?.onExecuteAll?.();
    });

    let firstExecutionId = null;
    await waitFor(() => {
      const executeMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_execute_cell');
      expect(executeMessages).toHaveLength(1);
      firstExecutionId = executeMessages[0].execution_id;
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_error',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        execution_id: firstExecutionId,
        error_code: 'notebook_execute_cell_failed',
        error: `Kernel ${KERNEL_ID} no encontrado`,
        message: `Kernel ${KERNEL_ID} no encontrado`,
      });
    });

    await waitFor(() => {
      const loadMessages = sendMessageSpy.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'notebook_load');
      expect(loadMessages).toHaveLength(1);
      expect(loadMessages[0]).toEqual(expect.objectContaining({
        path: NOTEBOOK_PATH,
      }));
      expect(typeof loadMessages[0].content).toBe('string');
    });
  });

  it('processes notebook message bursts from messageQueue while the editor is hidden', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      latestDesktopTitleBarProps?.onGoHome?.();
    });

    await waitFor(() => expect(screen.getByTestId('workspace-home')).toBeTruthy());

    act(() => {
      mockPushNotebookMessages?.([
        {
          type: 'notebook_cell_executed',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          cell_id: 'cell-1',
          execution_id: 'batch_1',
          execution_count: 1,
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'burst-output\n',
            },
          ],
        },
        {
          type: 'notebook_docx_update',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          execution_id: 'batch_1',
          docx_hash: 'docx-hash-1',
          docx_artifact_id: 'artifact-1',
          docx_download_url: '/api/docx/download?artifact_id=artifact-1',
        },
        {
          type: 'notebook_pdf_ready',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          execution_id: 'batch_1',
          pdf_file_b64: 'JVBERi0xLjQ=',
          pdf_hash: 'pdf-hash-1',
        },
      ]);
    });

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('burst-output'));
    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('docx-hash-1');
      expect(mockLatestVisualizationProps?.documentState?.pdfBase64).toBe('JVBERi0xLjQ=');
      expect(mockLatestVisualizationProps?.documentState?.conversionStatus).toBeNull();
      expect(mockLatestVisualizationProps?.documentState?.documentPipelineStatus).toBeNull();
    });

    act(() => {
      mockPushNotebookQueueEntries({
        path: NOTEBOOK_PATH,
        socketKey: LOWERCASE_NOTEBOOK_PATH,
        message: {
          type: 'notebook_progress_update',
          notebook_path: NOTEBOOK_PATH,
          source_path: NOTEBOOK_PATH,
          source_kind: 'notebook',
          kernel_id: KERNEL_ID,
          execution_id: 'batch_1',
          progress_scope: 'document',
          progress_stage: 'pdf_convert',
          progress_status: 'completed',
          progress_percent: 100,
          message: 'PDF listo en Documento.',
        },
      });
    });

    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.conversionStatus).toBeNull();
      expect(mockLatestVisualizationProps?.documentState?.documentPipelineStatus).toBeNull();
    });
  });

  it('keeps live display updates and IOPub errors visible inline through App-owned notebook runtime', async () => {
    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      pushLastMessage?.({
        type: 'notebook_display_data',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        content: {
          transient: { display_id: 'progress-1' },
          data: { 'text/plain': '10%' },
          metadata: {},
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('10%'));

    act(() => {
      pushLastMessage?.({
        type: 'notebook_update_display_data',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        content: {
          transient: { display_id: 'progress-1' },
          data: { 'text/plain': '80%' },
          metadata: {},
        },
      });
    });

    await waitFor(() => {
      const renderedText = screen.getByTestId('notebook-cell-cell-1').textContent;
      expect(renderedText).toContain('80%');
      expect(renderedText).not.toContain('10%');
    });

    act(() => {
      pushLastMessage?.({
        type: 'notebook_cell_error',
        notebook_path: NOTEBOOK_PATH,
        source_path: NOTEBOOK_PATH,
        source_kind: 'notebook',
        kernel_id: KERNEL_ID,
        cell_id: 'cell-1',
        error_code: 'kernel_iopub_error',
        error: 'boom',
        details: {
          ename: 'RuntimeError',
          evalue: 'boom',
          traceback: ['RuntimeError: boom'],
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('boom'));
  });

  it('keeps three hidden notebook runtimes and document payloads isolated across dedicated notebook queue bursts', async () => {
    const App = require('./App').default;

    mockNotebookDataByPath = {
      [NOTEBOOK_PATH]: INITIAL_NOTEBOOK,
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
      [THIRD_NOTEBOOK_PATH]: THIRD_NOTEBOOK,
    };
    mockOpenFiles = [
      { path: NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
      { path: THIRD_NOTEBOOK_PATH, name: 'third-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = NOTEBOOK_PATH;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-editor')).toBeTruthy());

    act(() => {
      mockPushNotebookQueueEntries?.([
        {
          path: NOTEBOOK_PATH,
          socketKey: LOWERCASE_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: NOTEBOOK_PATH,
            source_path: NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: KERNEL_ID,
            cell_id: 'cell-1',
            execution_id: 'exec-a',
            execution_count: 1,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'alpha-visible\n',
              },
            ],
          },
        },
        {
          path: SECOND_NOTEBOOK_PATH,
          socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: SECOND_NOTEBOOK_PATH,
            source_path: SECOND_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: SECOND_KERNEL_ID,
            cell_id: 'cell-2',
            execution_id: 'exec-b',
            execution_count: 1,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'beta-hidden\n',
              },
            ],
          },
        },
        {
          path: SECOND_NOTEBOOK_PATH,
          socketKey: LOWERCASE_SECOND_NOTEBOOK_PATH,
          message: {
            type: 'notebook_docx_update',
            notebook_path: SECOND_NOTEBOOK_PATH,
            source_path: SECOND_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: SECOND_KERNEL_ID,
            execution_id: 'exec-b',
            docx_hash: 'docx-hash-b',
            docx_artifact_id: 'artifact-b',
            docx_download_url: '/api/docx/download?artifact_id=artifact-b',
          },
        },
        {
          path: THIRD_NOTEBOOK_PATH,
          socketKey: LOWERCASE_THIRD_NOTEBOOK_PATH,
          message: {
            type: 'notebook_cell_executed',
            notebook_path: THIRD_NOTEBOOK_PATH,
            source_path: THIRD_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: THIRD_KERNEL_ID,
            cell_id: 'cell-3',
            execution_id: 'exec-c',
            execution_count: 1,
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'gamma-hidden\n',
              },
            ],
          },
        },
        {
          path: THIRD_NOTEBOOK_PATH,
          socketKey: LOWERCASE_THIRD_NOTEBOOK_PATH,
          message: {
            type: 'notebook_pdf_ready',
            notebook_path: THIRD_NOTEBOOK_PATH,
            source_path: THIRD_NOTEBOOK_PATH,
            source_kind: 'notebook',
            kernel_id: THIRD_KERNEL_ID,
            execution_id: 'exec-c',
            docx_hash: 'docx-hash-c',
            docx_artifact_id: 'artifact-c',
            pdf_file_b64: 'JVBERi0xLjQ=',
            pdf_hash: 'pdf-hash-c',
          },
        },
      ]);
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('alpha-visible'));

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(SECOND_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());
    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('docx-hash-b');
      expect(mockLatestVisualizationProps?.documentState?.pdfHash).toBeNull();
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(THIRD_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-3')).toBeTruthy());
    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBe('docx-hash-c');
      expect(mockLatestVisualizationProps?.documentState?.pdfHash).toBe('pdf-hash-c');
    });

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-1').textContent).toContain('alpha-visible'));
    await waitFor(() => {
      expect(mockLatestVisualizationProps?.documentState?.docxHash).toBeNull();
      expect(mockLatestVisualizationProps?.documentState?.pdfHash).toBeNull();
    });
  });

  it('does not hydrate a newly active notebook from stale notebook data owned by another path', async () => {
    mockOpenFiles = [
      { path: SECOND_NOTEBOOK_PATH, name: 'other-report.ipynb', type: 'file' },
      { path: THIRD_NOTEBOOK_PATH, name: 'third-report.ipynb', type: 'file' },
    ];
    mockActiveFile = mockOpenFiles[0];
    mockActiveNotebookPath = SECOND_NOTEBOOK_PATH;
    mockInitialNotebookData = SECOND_NOTEBOOK;
    mockNotebookDataByPath = {
      [SECOND_NOTEBOOK_PATH]: SECOND_NOTEBOOK,
      [THIRD_NOTEBOOK_PATH]: THIRD_NOTEBOOK,
    };
    mockVisibleNotebookPath = SECOND_NOTEBOOK_PATH;
    mockVisibleNotebookPathOverrides = {
      [THIRD_NOTEBOOK_PATH]: SECOND_NOTEBOOK_PATH,
    };

    const App = require('./App').default;

    render(<App />);

    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('notebook-cell-cell-2')).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByTestId(`select-file-${mockToFileTestId(THIRD_NOTEBOOK_PATH)}`));
    });

    await waitFor(() => expect(latestNotebookEditorProps?.filePath).toBe(THIRD_NOTEBOOK_PATH));
    expect(latestNotebookEditorProps?.initialNotebook).toBeNull();
    expect(screen.queryByTestId('notebook-cell-cell-2')).toBeNull();
    expect(screen.queryByTestId('notebook-cell-cell-3')).toBeNull();
  });
});
