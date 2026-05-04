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
});
