import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_URL } from '../config/endpoints';
import { createFrontendLogger } from '../utils/frontendLogger';

const logger = createFrontendLogger('useWebSocket');

const MESSAGE_QUEUE_LIMIT = 250;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;

const useWebSocket = (url = WS_URL) => {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const messageSeqRef = useRef(0);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();
    setConnectionStatus('connecting');

    try {
      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) {
          return;
        }
        logger.log('WebSocket connected');
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
      };

      socket.onmessage = (event) => {
        if (wsRef.current !== socket) {
          return;
        }
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          const messageId = ++messageSeqRef.current;
          setMessageQueue((current) => {
            const next = current.length >= MESSAGE_QUEUE_LIMIT
              ? current.slice(current.length - MESSAGE_QUEUE_LIMIT + 1)
              : [...current];
            next.push({ id: messageId, message });
            return next;
          });
        } catch (error) {
          logger.error('Error parsing websocket message:', error);
        }
      };

      socket.onerror = (error) => {
        if (wsRef.current !== socket) {
          return;
        }
        logger.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
      };

      socket.onclose = (event) => {
        if (wsRef.current !== socket) {
          return;
        }
        logger.log('WebSocket disconnected:', event.code, event.reason);
        setConnectionStatus('disconnected');
        wsRef.current = null;

        if (!shouldReconnectRef.current) return;

        clearReconnectTimer();
        const timeout = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
          MAX_RECONNECT_DELAY_MS
        );
        logger.log(`Retrying websocket in ${timeout / 1000}s (attempt ${reconnectAttemptsRef.current + 1})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          reconnectAttemptsRef.current += 1;
          connect();
        }, timeout);
      };
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      setConnectionStatus('disconnected');
    }
  }, [clearReconnectTimer, url]);

  const reconnectNow = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    connect();
  }, [clearReconnectTimer, connect]);

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Error sending websocket message:', error);
      }
      return;
    }
    logger.warn('WebSocket is not connected. State:', wsRef.current?.readyState);
    reconnectNow();
  }, [reconnectNow]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnectTimer();
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket) {
      socket.close();
    }
  }, [clearReconnectTimer]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket) {
      socket.close();
    }
    connect();
  }, [clearReconnectTimer, connect]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const handleFocusReconnect = () => {
      reconnectNow();
    };
    const handleVisibilityReconnect = () => {
      if (document.visibilityState === 'visible') {
        reconnectNow();
      }
    };

    window.addEventListener('focus', handleFocusReconnect);
    window.addEventListener('online', handleFocusReconnect);
    document.addEventListener('visibilitychange', handleVisibilityReconnect);

    return () => {
      window.removeEventListener('focus', handleFocusReconnect);
      window.removeEventListener('online', handleFocusReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityReconnect);
    };
  }, [reconnectNow]);

  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (connectionStatus === 'connected') {
        sendMessage({ type: 'ping' });
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [connectionStatus, sendMessage]);

  return {
    connectionStatus,
    lastMessage,
    messageQueue,
    sendMessage,
    disconnect,
    reconnect,
  };
};

export default useWebSocket;
