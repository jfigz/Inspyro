import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { API_BASE } from './config/endpoints';

jest.setTimeout(15000);

const CURRENT_NOTEBOOK_PATH = 'C:\\workspace\\current.ipynb';
const TARGET_NOTEBOOK_PATH = 'C:\\workspace\\report.ipynb';

const buildNotebook = (cells) => ({
  cells,
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

const buildCodeCell = (id, source) => ({
  id,
  cell_type: 'code',
  source: Array.isArray(source) ? source : [source],
  outputs: [],
  execution_count: null,
  metadata: {},
});

const CURRENT_NOTEBOOK = buildNotebook([
  buildCodeCell('current-cell-a', 'print("current")'),
]);

const TARGET_NOTEBOOK = buildNotebook([
  buildCodeCell('target-cell-a', 'print("short")'),
  buildCodeCell('target-cell-b', ['line 1', 'line 2', 'line 3']),
]);

const PDF_READY_MESSAGE = {
  type: 'notebook_pdf_ready',
  execution_id: 'exec-pdf-1',
  pdf_ref: '/api/pdf/download?token=pdf-1',
  pdf_hash: 'pdf-hash-1',
  docx_artifact_id: 'docx-1',
  docx_provenance_available: true,
  docx_provenance_ref: '/api/docx/provenance?artifact_id=docx-1',
  source_path: TARGET_NOTEBOOK_PATH,
  source_kind: 'notebook',
  converter_used: 'word',
};

let mockPdfViewerState = null;
let handleFileOpenSpy = null;
let sendMessageSpy = null;
let latestDesktopTitleBarProps = null;

const resetMockPdfViewerState = () => {
  mockPdfViewerState = {
    currentPage: 1,
    numPages: 1,
    hasOutline: false,
    outline: [],
    provenanceLinkUrl: '/api/docx/provenance/open?provenance_id=prov-1',
    provenanceId: 'prov-1',
  };
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
  default: () => <div data-testid="monaco-editor" />,
}));

jest.mock('./components/DependencyGraph', () => ({
  __esModule: true,
  default: () => <div data-testid="dependency-graph" />,
}));

jest.mock('./components/TemplateEditor', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./components/notebook/NotebookCell', () => function MockNotebookCell({
  cell,
  isSelected = false,
  highlightLine = null,
  highlightColumn = null,
}) {
  return (
    <div
      data-testid={`cell-row-${cell.id}`}
      data-cell-id={cell.id}
      data-selected={isSelected ? 'true' : 'false'}
      data-highlight-line={highlightLine ?? ''}
      data-highlight-column={highlightColumn ?? ''}
    >
      <div data-testid={`cell-source-${cell.id}`}>
        {Array.isArray(cell.source) ? cell.source.join('\n') : cell.source}
      </div>
    </div>
  );
});

jest.mock('./components/PdfViewer', () => {
  const React = require('react');

  return function MockPdfViewer(props) {
    React.useEffect(() => {
      props.onDocumentMetaChange?.({
        numPages: mockPdfViewerState.numPages,
        outline: mockPdfViewerState.outline,
        hasOutline: mockPdfViewerState.hasOutline,
      });
      props.onCurrentPageChange?.(mockPdfViewerState.currentPage);
    }, [props.onCurrentPageChange, props.onDocumentMetaChange, props.pdfUrl]);

    return (
      <div data-testid="mock-pdf-viewer">
        <button
          type="button"
          data-testid="mock-pdf-summary"
          onClick={() => props.onProvenanceSummaryChange?.({ totalLinkCount: 1, provenanceCount: 1 })}
        >
          summary
        </button>
        <button
          type="button"
          data-testid="mock-pdf-provenance-link"
          onClick={() => props.onLinkActivate?.({
            url: mockPdfViewerState.provenanceLinkUrl,
            provenanceId: mockPdfViewerState.provenanceId,
          })}
        >
          provenance-link
        </button>
      </div>
    );
  };
});

describe('App provenance navigation integration', () => {
  beforeEach(() => {
    resetMockPdfViewerState();
    handleFileOpenSpy = jest.fn();
    sendMessageSpy = jest.fn();
    latestDesktopTitleBarProps = null;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn((url) => {
      if (url === `${API_BASE}/api/system/info`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_workspace: 'C:\\workspace',
            workspace_root: 'C:\\workspace',
            workspace_path: 'C:\\workspace',
            recent_workspaces: ['C:\\workspace'],
          }),
        });
      }
      if (url === `${API_BASE}/pdf-status`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            pdf_available: true,
            word_available: true,
          }),
        });
      }
      if (String(url).includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (String(url).includes('/api/docx/provenance?artifact_id=docx-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                file_path: TARGET_NOTEBOOK_PATH,
                notebook_cell_id: 'cell-missing',
                line: 3,
                api_name: 'text',
                element_kind: 'paragraph',
                precision: 'callsite',
                text_preview: 'Fallback notebook navigation',
              },
            ],
          }),
        });
      }
      if (String(url).includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    global.URL.createObjectURL = jest.fn(() => 'blob:pdf-view');
    global.URL.revokeObjectURL = jest.fn();
    window.open = jest.fn();

    const useFileSystem = require('./hooks/useFileSystem').default;
    const useAppWebSocket = require('./hooks/useAppWebSocket').default;
    const useMcpActivity = require('./hooks/useMcpActivity').default;
    const useMcpShellControls = require('./hooks/useMcpShellControls').default;
    const useMcpMirror = require('./hooks/useMcpMirror').default;
    const useTemplateMessageHandler = require('./hooks/useTemplateMessageHandler').default;

    useFileSystem.mockImplementation(() => {
      const React = require('react');
      const [state, setState] = React.useState({
        currentWorkspace: 'C:\\workspace',
        openFiles: [{ path: CURRENT_NOTEBOOK_PATH, name: 'current.ipynb', type: 'file' }],
        activeFile: { path: CURRENT_NOTEBOOK_PATH, name: 'current.ipynb', type: 'file' },
        modifiedFiles: new Set(),
        externalStaleFiles: new Set(),
        externalConflictFiles: new Set(),
        code: '',
        notebookData: CURRENT_NOTEBOOK,
        notebookSyncState: { origin: 'runtime', path: CURRENT_NOTEBOOK_PATH, token: 1 },
        autoSaveEnabled: false,
      });

      const setNotebookData = React.useCallback((data, meta = {}) => {
        setState((prev) => ({
          ...prev,
          notebookData: data,
          notebookSyncState: {
            origin: meta.origin || 'runtime',
            path: meta.path || prev.activeFile?.path || null,
            token: prev.notebookSyncState.token + 1,
          },
        }));
      }, []);

      const handleFileOpen = React.useCallback(async (file) => {
        handleFileOpenSpy(file);
        if (file?.path === TARGET_NOTEBOOK_PATH) {
          setState((prev) => ({
            ...prev,
            openFiles: [{ path: TARGET_NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' }],
            activeFile: { path: TARGET_NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' },
            notebookData: TARGET_NOTEBOOK,
            notebookSyncState: {
              origin: 'runtime',
              path: TARGET_NOTEBOOK_PATH,
              token: prev.notebookSyncState.token + 1,
            },
          }));
          return { path: TARGET_NOTEBOOK_PATH, name: 'report.ipynb', type: 'file' };
        }
        return file || null;
      }, []);

      return {
        ...state,
        setCode: jest.fn(),
        setNotebookData,
        setAutoSaveEnabled: jest.fn(),
        handleFileOpen,
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
    });

    useAppWebSocket.mockImplementation(() => {
      const React = require('react');
      const [notebookExecutionData, setNotebookExecutionData] = React.useState({
        pdfRefUrl: PDF_READY_MESSAGE.pdf_ref,
        pdfHash: PDF_READY_MESSAGE.pdf_hash,
        docxArtifactId: PDF_READY_MESSAGE.docx_artifact_id,
        docxProvenanceAvailable: PDF_READY_MESSAGE.docx_provenance_available,
        docxProvenanceRef: PDF_READY_MESSAGE.docx_provenance_ref,
        docxSourcePath: PDF_READY_MESSAGE.source_path,
        docxSourceKind: PDF_READY_MESSAGE.source_kind,
      });
      return {
        connectionStatus: 'connected',
        sendMessage: sendMessageSpy,
        lastMessage: PDF_READY_MESSAGE,
        messageQueue: [PDF_READY_MESSAGE],
        output: '',
        isExecuting: false,
        editorExecutionData: {},
        notebookExecutionData,
        setNotebookExecutionData,
        handleExecuteCode: jest.fn(),
      };
    });

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
      mcpStatus: 'stopped',
      setMcpStatus: jest.fn(),
      refreshMcpStatus: jest.fn(),
      handleMcpQuickAction: jest.fn(),
    });
    useMcpMirror.mockImplementation(() => {});
    useTemplateMessageHandler.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('opens the target notebook from provenance metadata and falls back to line-based navigation when the cell id is stale', async () => {
    const App = require('./App').default;

    render(<App />);
    act(() => {
      latestDesktopTitleBarProps?.onGoToFileSurface?.();
    });

    await waitFor(() => expect(screen.getByTestId('cell-row-current-cell-a')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy(), { timeout: 3000 });

    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await waitFor(() => expect(screen.getByTestId('docx-source-mode-toggle').disabled).toBe(false), { timeout: 3000 });

    fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));

    await waitFor(() => expect(handleFileOpenSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: TARGET_NOTEBOOK_PATH,
    })), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('cell-row-target-cell-b')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('cell-row-target-cell-b').getAttribute('data-selected')).toBe('true'), { timeout: 3000 });
    expect(screen.getByTestId('cell-row-target-cell-b').getAttribute('data-highlight-line')).toBe('3');
  });
});
