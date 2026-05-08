import { act, renderHook } from '@testing-library/react';
import useWebSocket from './useWebSocket';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.send = jest.fn();
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(event = { code: 1006, reason: 'test-close' }) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(event);
  }

  close() {
    this.emitClose({ code: 1000, reason: 'manual-close' });
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    delete global.WebSocket;
  });

  test('keeps retrying reconnects beyond the previous retry ceiling', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://test'));

    expect(MockWebSocket.instances).toHaveLength(1);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const socket = MockWebSocket.instances.at(-1);
      act(() => {
        socket.emitClose({ code: 1006, reason: `drop-${attempt}` });
      });

      const delay = Math.min(1000 * (2 ** attempt), 10000);
      act(() => {
        jest.advanceTimersByTime(delay);
      });

      expect(MockWebSocket.instances).toHaveLength(attempt + 2);
    }

    unmount();
  });

  test('reconnects immediately when the window regains focus', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://test'));

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      MockWebSocket.instances[0].emitClose({ code: 1006, reason: 'lost-focus' });
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(MockWebSocket.instances).toHaveLength(2);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);

    unmount();
  });

  test('ignores stale close events once a newer socket is active', () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://test'));

    const firstSocket = MockWebSocket.instances[0];

    act(() => {
      firstSocket.emitOpen();
    });

    expect(result.current.connectionStatus).toBe('connected');

    act(() => {
      firstSocket.emitClose({ code: 1006, reason: 'drop-0' });
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1];

    act(() => {
      secondSocket.emitOpen();
    });

    expect(result.current.connectionStatus).toBe('connected');

    act(() => {
      firstSocket.emitClose({ code: 1006, reason: 'stale-close' });
    });

    expect(result.current.connectionStatus).toBe('connected');

    act(() => {
      result.current.sendMessage({ type: 'ping' });
    });

    expect(secondSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    expect(MockWebSocket.instances).toHaveLength(2);

    unmount();
  });

  test('queues template attach while disconnected and flushes it after reconnect', () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://test'));

    act(() => {
      MockWebSocket.instances[0].emitClose({ code: 1006, reason: 'offline' });
    });

    let queued;
    act(() => {
      queued = result.current.sendMessage({
        type: 'template_attach',
        kernel_id: 'kernel-template',
        template_token: 'token-a',
      });
    });

    expect(queued).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const secondSocket = MockWebSocket.instances[1];
    act(() => {
      secondSocket.emitOpen();
    });

    expect(secondSocket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'template_attach',
      kernel_id: 'kernel-template',
      template_token: 'token-a',
    }));

    unmount();
  });

  test('deduplicates queued template attach messages by kernel and token', () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://test'));

    act(() => {
      MockWebSocket.instances[0].emitClose({ code: 1006, reason: 'offline' });
    });

    act(() => {
      result.current.sendMessage({
        type: 'template_attach',
        kernel_id: 'kernel-template',
        template_token: 'token-a',
        path: 'C:\\workspace\\report.ipynb',
      });
      result.current.sendMessage({
        type: 'template_attach',
        kernel_id: 'kernel-template',
        template_token: 'token-a',
        path: 'C:\\workspace\\report.ipynb',
      });
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const secondSocket = MockWebSocket.instances[1];
    act(() => {
      secondSocket.emitOpen();
    });

    expect(secondSocket.send).toHaveBeenCalledTimes(1);

    unmount();
  });

  test('queues a critical template message if an open socket send throws', () => {
    const { result, unmount } = renderHook(() => useWebSocket('ws://test'));
    const firstSocket = MockWebSocket.instances[0];
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      firstSocket.emitOpen();
    });
    firstSocket.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    let accepted;
    act(() => {
      accepted = result.current.sendMessage({
        type: 'template_attach',
        kernel_id: 'kernel-template',
        template_token: 'token-a',
      });
    });

    expect(accepted).toBe(true);

    act(() => {
      firstSocket.emitClose({ code: 1006, reason: 'send-failed' });
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    const secondSocket = MockWebSocket.instances[1];
    act(() => {
      secondSocket.emitOpen();
    });

    expect(secondSocket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'template_attach',
      kernel_id: 'kernel-template',
      template_token: 'token-a',
    }));

    consoleErrorSpy.mockRestore();
    unmount();
  });
});
