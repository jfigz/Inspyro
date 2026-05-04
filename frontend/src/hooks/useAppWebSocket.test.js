import { act, renderHook, waitFor } from '@testing-library/react';
import { WS_MESSAGE_TYPES as WS_MSG } from '../contracts/wsMessageTypes.generated';
import useAppWebSocket from './useAppWebSocket';
import useWebSocket from './useWebSocket';

jest.mock('./useWebSocket', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const buildSocketState = (overrides = {}) => ({
  connectionStatus: 'connected',
  sendMessage: jest.fn(),
  lastMessage: null,
  messageQueue: [],
  ...overrides,
});

class FakeNotebookWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeNotebookWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeNotebookWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = FakeNotebookWebSocket.CLOSED;
    this.onclose?.();
  }

  emitOpen() {
    this.readyState = FakeNotebookWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(message) {
    this.onmessage?.({
      data: JSON.stringify(message),
    });
  }

  static reset() {
    FakeNotebookWebSocket.instances = [];
  }
}

describe('useAppWebSocket', () => {
  let socketState;
  let originalWebSocket;

  beforeEach(() => {
    socketState = buildSocketState();
    useWebSocket.mockImplementation(() => socketState);
    originalWebSocket = global.WebSocket;
    global.WebSocket = FakeNotebookWebSocket;
    FakeNotebookWebSocket.reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.WebSocket = originalWebSocket;
    FakeNotebookWebSocket.reset();
  });

  it('no longer exposes notebook document ownership from the hook API', () => {
    const { result } = renderHook(() => useAppWebSocket({ sourcePath: 'C:\\workspace\\main.py' }));

    expect(result.current.editorExecutionData).toBeDefined();
    expect(result.current.notebookExecutionData).toBeUndefined();
    expect(result.current.setNotebookExecutionData).toBeUndefined();
  });

  it('ignores notebook-only clear events while keeping editor document state intact', async () => {
    socketState = buildSocketState({
      lastMessage: {
        type: WS_MSG.EXECUTION_RESULT,
        variables: { area: 42 },
        docx_file_b64: 'docx-inline',
        docx_hash: 'docx-hash-1',
        docx_file_name: 'report.docx',
        source_path: 'C:\\workspace\\main.py',
      },
    });

    const { result, rerender } = renderHook(
      ({ sourcePath }) => useAppWebSocket({ sourcePath }),
      { initialProps: { sourcePath: 'C:\\workspace\\main.py' } },
    );

    await waitFor(() => {
      expect(result.current.editorExecutionData.docxHash).toBe('docx-hash-1');
    });

    socketState = buildSocketState({
      lastMessage: {
        type: 'notebook_mdoc_cleared',
      },
    });

    rerender({ sourcePath: 'C:\\workspace\\main.py' });

    await waitFor(() => {
      expect(result.current.editorExecutionData.docxHash).toBe('docx-hash-1');
      expect(result.current.editorExecutionData.variables).toEqual({ area: 42 });
    });
  });

  it('clears editor document artifacts while preserving variables on mdoc_cleared', async () => {
    socketState = buildSocketState({
      lastMessage: {
        type: 'execution_completed',
        final_variables: { area: 42 },
        docx_file_b64: 'docx-inline',
        docx_hash: 'docx-hash-1',
        pdf_hash: 'pdf-hash-1',
        source_path: 'C:\\workspace\\main.py',
      },
    });

    const { result, rerender } = renderHook(
      ({ sourcePath }) => useAppWebSocket({ sourcePath }),
      { initialProps: { sourcePath: 'C:\\workspace\\main.py' } },
    );

    await waitFor(() => {
      expect(result.current.editorExecutionData.docxHash).toBe('docx-hash-1');
      expect(result.current.editorExecutionData.variables).toEqual({ area: 42 });
    });

    socketState = buildSocketState({
      lastMessage: {
        type: 'mdoc_cleared',
      },
    });

    rerender({ sourcePath: 'C:\\workspace\\main.py' });

    await waitFor(() => {
      expect(result.current.editorExecutionData.docxHash).toBeNull();
      expect(result.current.editorExecutionData.pdfHash).toBeNull();
      expect(result.current.editorExecutionData.variables).toEqual({ area: 42 });
    });
  });

  it('keeps notebook queue entries isolated per socket so one notebook burst does not evict another', async () => {
    const notebookAPath = 'C:\\workspace\\alpha.ipynb';
    const notebookBPath = 'C:\\workspace\\beta.ipynb';
    const notebookASocketKey = notebookAPath.replace(/\\/g, '/').toLowerCase();
    const notebookBSocketKey = notebookBPath.replace(/\\/g, '/').toLowerCase();

    const { result } = renderHook(() => useAppWebSocket({
      notebookPaths: [notebookAPath, notebookBPath],
    }));

    await waitFor(() => {
      expect(FakeNotebookWebSocket.instances.length).toBe(2);
    });

    const [socketA, socketB] = FakeNotebookWebSocket.instances;
    act(() => {
      socketA.emitOpen();
      socketB.emitOpen();
    });

    act(() => {
      for (let index = 0; index < 251; index += 1) {
        socketA.emitMessage({
          type: WS_MSG.NOTEBOOK_STREAM,
          source_path: notebookAPath,
          content: { text: `alpha-${index}` },
        });
      }
      socketB.emitMessage({
        type: WS_MSG.NOTEBOOK_STREAM,
        source_path: notebookBPath,
        content: { text: 'beta-0' },
      });
      socketB.emitMessage({
        type: WS_MSG.NOTEBOOK_CELL_EXECUTED,
        source_path: notebookBPath,
        cell_id: 'cell-b',
        execution_id: 'exec-b',
        outputs: [],
        execution_count: 1,
      });
    });

    await waitFor(() => {
      const queue = result.current.notebookMessageQueue;
      expect(queue.filter((entry) => entry.socketKey === notebookASocketKey)).toHaveLength(250);
      expect(queue.filter((entry) => entry.socketKey === notebookBSocketKey)).toHaveLength(2);
    });

    const queue = result.current.notebookMessageQueue;
    const alphaEntries = queue.filter((entry) => entry.socketKey === notebookASocketKey);
    const betaEntries = queue.filter((entry) => entry.socketKey === notebookBSocketKey);

    expect(alphaEntries[0].message.content.text).toBe('alpha-1');
    expect(alphaEntries[alphaEntries.length - 1].message.content.text).toBe('alpha-250');
    expect(betaEntries.map((entry) => entry.message.type)).toEqual([
      WS_MSG.NOTEBOOK_STREAM,
      WS_MSG.NOTEBOOK_CELL_EXECUTED,
    ]);
  });
});
