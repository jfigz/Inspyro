import { useCallback, useEffect, useRef, useState } from 'react';

const TABLE_PREVIEW_TIMEOUT_MS = 60000;
const HANDLED_REQUEST_IDS_MAX = 512;

export const useTablePreviewQueue = ({
  kernelId,
  sendMessage,
  tableGridTab,
  documentTables,
  onStatusMessage,
}) => {
  const [tablePreviewImages, setTablePreviewImages] = useState({});
  const [loadingTablePreviews, setLoadingTablePreviews] = useState({});
  const [loadingAllTablePreviews, setLoadingAllTablePreviews] = useState(false);

  const tablePreviewQueueRef = useRef([]);
  const tablePreviewQueuedRef = useRef(new Set());
  const tablePreviewRequestedRef = useRef(new Set());
  const tablePreviewInFlightRef = useRef(null);
  const tablePreviewRequestRef = useRef({ requestId: null, tableIndex: null });
  const tablePreviewTimeoutRef = useRef(null);
  const tablePreviewRequestSeqRef = useRef(0);
  const tablePreviewImagesRef = useRef({});
  const loadingTablePreviewsRef = useRef({});
  const handledRequestIdsRef = useRef(new Set());

  useEffect(() => {
    tablePreviewImagesRef.current = tablePreviewImages;
  }, [tablePreviewImages]);

  useEffect(() => {
    loadingTablePreviewsRef.current = loadingTablePreviews;
  }, [loadingTablePreviews]);

  const cancelInFlightTablePreview = useCallback(({ notifyBackend = true } = {}) => {
    const { requestId } = tablePreviewRequestRef.current;
    if (notifyBackend && sendMessage && kernelId && requestId) {
      sendMessage({
        type: 'template_preview_cancel',
        kernel_id: kernelId,
        request_id: requestId,
      });
    }
    tablePreviewInFlightRef.current = null;
    tablePreviewRequestRef.current = { requestId: null, tableIndex: null };
    if (tablePreviewTimeoutRef.current) {
      clearTimeout(tablePreviewTimeoutRef.current);
      tablePreviewTimeoutRef.current = null;
    }
  }, [sendMessage, kernelId]);

  const rememberHandledRequestId = useCallback((requestId) => {
    if (!requestId) return;

    const handled = handledRequestIdsRef.current;
    handled.add(requestId);

    if (handled.size <= HANDLED_REQUEST_IDS_MAX) return;

    const oldest = handled.values().next().value;
    if (oldest) {
      handled.delete(oldest);
    }
  }, []);

  const resolveCurrentTableIndex = useCallback((lastMessage) => {
    const fallbackIndex = tablePreviewRequestRef.current.tableIndex ?? tablePreviewInFlightRef.current;
    return Number.isInteger(lastMessage?.table_index) ? lastMessage.table_index : fallbackIndex;
  }, []);

  const isCorrelatedWithInFlight = useCallback((lastMessage) => {
    const responseRequestId = typeof lastMessage?.request_id === 'string' ? lastMessage.request_id : null;
    const inFlightRequestId = tablePreviewRequestRef.current.requestId;
    const inFlightTableIndex = tablePreviewRequestRef.current.tableIndex ?? tablePreviewInFlightRef.current;
    const responseTableIndex = Number.isInteger(lastMessage?.table_index) ? lastMessage.table_index : null;

    if (responseRequestId && handledRequestIdsRef.current.has(responseRequestId)) {
      return { correlated: false, duplicated: true };
    }

    if (inFlightRequestId && responseRequestId) {
      return { correlated: responseRequestId === inFlightRequestId, duplicated: false };
    }

    if (!inFlightRequestId && !responseRequestId) {
      if (Number.isInteger(inFlightTableIndex) && Number.isInteger(responseTableIndex)) {
        return { correlated: inFlightTableIndex === responseTableIndex, duplicated: false };
      }
      return { correlated: false, duplicated: false };
    }

    // Tolerant fallback: some backend paths may omit request_id.
    if (inFlightRequestId && !responseRequestId) {
      if (Number.isInteger(inFlightTableIndex) && Number.isInteger(responseTableIndex)) {
        return { correlated: inFlightTableIndex === responseTableIndex, duplicated: false };
      }
      return { correlated: false, duplicated: false };
    }

    if (!inFlightRequestId && responseRequestId) {
      if (Number.isInteger(inFlightTableIndex) && Number.isInteger(responseTableIndex)) {
        return { correlated: inFlightTableIndex === responseTableIndex, duplicated: false };
      }
      return { correlated: false, duplicated: false };
    }

    return { correlated: false, duplicated: false };
  }, []);

  const pumpTablePreviewQueue = useCallback(() => {
    if (tableGridTab !== 'direct') {
      tablePreviewQueueRef.current = [];
      tablePreviewQueuedRef.current = new Set();
      setLoadingAllTablePreviews(false);
      return;
    }

    if (!kernelId || !sendMessage) return;
    if (tablePreviewInFlightRef.current !== null) return;

    let nextIndex;
    while (tablePreviewQueueRef.current.length > 0) {
      const candidate = tablePreviewQueueRef.current.shift();
      tablePreviewQueuedRef.current.delete(candidate);

      if (!Number.isInteger(candidate) || candidate < 0) continue;
      if (tablePreviewImagesRef.current[candidate]) continue;
      if (loadingTablePreviewsRef.current[candidate]) continue;

      nextIndex = candidate;
      break;
    }

    if (nextIndex === undefined) {
      setLoadingAllTablePreviews(false);
      return;
    }

    tablePreviewInFlightRef.current = nextIndex;
    tablePreviewRequestSeqRef.current += 1;
    const requestId = `tbl_prev_${Date.now()}_${tablePreviewRequestSeqRef.current}_${nextIndex}`;
    tablePreviewRequestRef.current = { requestId, tableIndex: nextIndex };
    setLoadingTablePreviews((prev) => ({ ...prev, [nextIndex]: true }));

    if (tablePreviewTimeoutRef.current) {
      clearTimeout(tablePreviewTimeoutRef.current);
    }

    tablePreviewTimeoutRef.current = setTimeout(() => {
      const stuckIndex = tablePreviewInFlightRef.current;
      if (stuckIndex === null || stuckIndex === undefined) return;

      tablePreviewRequestedRef.current.delete(stuckIndex);
      cancelInFlightTablePreview();
      setLoadingTablePreviews((prev) => ({ ...prev, [stuckIndex]: false }));
      onStatusMessage?.(`La previsualizacion de la tabla ${Number(stuckIndex) + 1} excedio el tiempo de espera.`, 'warning');
      pumpTablePreviewQueue();
    }, TABLE_PREVIEW_TIMEOUT_MS);

    sendMessage({
      type: 'template_table_preview',
      kernel_id: kernelId,
      table_index: nextIndex,
      request_id: requestId,
    });
  }, [tableGridTab, kernelId, sendMessage, onStatusMessage, cancelInFlightTablePreview]);

  const requestTablePreview = useCallback((tableIndex, options = {}) => {
    const { force = false } = options;
    if (!kernelId || !sendMessage) return false;
    if (!Number.isInteger(tableIndex) || tableIndex < 0) return false;

    if (force) {
      tablePreviewRequestedRef.current.delete(tableIndex);
      tablePreviewQueuedRef.current.delete(tableIndex);
      tablePreviewQueueRef.current = tablePreviewQueueRef.current.filter((candidate) => candidate !== tableIndex);
    }

    if (tablePreviewRequestedRef.current.has(tableIndex) || tablePreviewQueuedRef.current.has(tableIndex)) {
      return true;
    }

    if (tablePreviewImagesRef.current[tableIndex] && !force) {
      return true;
    }

    tablePreviewRequestedRef.current.add(tableIndex);
    tablePreviewQueuedRef.current.add(tableIndex);
    tablePreviewQueueRef.current.unshift(tableIndex);
    setLoadingAllTablePreviews(true);
    pumpTablePreviewQueue();
    return true;
  }, [kernelId, pumpTablePreviewQueue, sendMessage]);

  const enqueueMissingTablePreviews = useCallback(() => {
    if (tableGridTab !== 'direct') return;
    if (!kernelId || !sendMessage || documentTables.length === 0) return;

    const toEnqueue = [];
    const queued = tablePreviewQueuedRef.current;

    for (let idx = 0; idx < documentTables.length; idx += 1) {
      if (tablePreviewImagesRef.current[idx]) continue;
      if (loadingTablePreviewsRef.current[idx]) continue;
      if (tablePreviewRequestedRef.current.has(idx)) continue;
      if (queued.has(idx)) continue;

      tablePreviewRequestedRef.current.add(idx);
      queued.add(idx);
      toEnqueue.push(idx);
    }

    if (toEnqueue.length > 0) {
      tablePreviewQueueRef.current.push(...toEnqueue);
      setLoadingAllTablePreviews(true);
    } else if (tablePreviewInFlightRef.current === null && tablePreviewQueueRef.current.length === 0) {
      setLoadingAllTablePreviews(false);
    }

    pumpTablePreviewQueue();
  }, [tableGridTab, kernelId, sendMessage, documentTables.length, pumpTablePreviewQueue]);

  const resetTablePreviewState = useCallback(() => {
    cancelInFlightTablePreview();
    setTablePreviewImages((prev) => (Object.keys(prev || {}).length ? {} : prev));
    setLoadingTablePreviews((prev) => (Object.keys(prev || {}).length ? {} : prev));
    setLoadingAllTablePreviews(false);
    tablePreviewQueueRef.current = [];
    tablePreviewQueuedRef.current = new Set();
    tablePreviewRequestedRef.current = new Set();
    tablePreviewInFlightRef.current = null;
    tablePreviewRequestRef.current = { requestId: null, tableIndex: null };
    handledRequestIdsRef.current = new Set();

  }, [cancelInFlightTablePreview]);

  useEffect(() => {
    if (tableGridTab !== 'direct' || documentTables.length === 0) return;
    enqueueMissingTablePreviews();
  }, [tableGridTab, documentTables.length, enqueueMissingTablePreviews]);

  useEffect(() => {
    if (tableGridTab === 'direct') return;

    const cancelledIndex = tablePreviewRequestRef.current.tableIndex;
    cancelInFlightTablePreview();
    tablePreviewQueueRef.current = [];
    tablePreviewQueuedRef.current = new Set();
    tablePreviewRequestedRef.current = new Set();
    handledRequestIdsRef.current = new Set();

    setLoadingAllTablePreviews(false);
    setLoadingTablePreviews((prev) => {
      const keys = Object.keys(prev || {});
      if (!keys.length) return prev;

      const next = { ...prev };
      keys.forEach((key) => {
        next[key] = false;
      });
      return next;
    });
    if (Number.isInteger(cancelledIndex)) {
      tablePreviewRequestedRef.current.delete(cancelledIndex);
    }
  }, [cancelInFlightTablePreview, tableGridTab]);

  useEffect(() => () => {
    cancelInFlightTablePreview();
  }, [cancelInFlightTablePreview]);

  const handleTablePreviewMessage = useCallback((lastMessage) => {
    if (!lastMessage) return false;

    if (lastMessage.type === 'template_table_preview_ready') {
      const correlation = isCorrelatedWithInFlight(lastMessage);
      if (correlation.duplicated) {
        return true;
      }
      if (!correlation.correlated) {
        return true;
      }

      const responseRequestId = typeof lastMessage.request_id === 'string' ? lastMessage.request_id : null;
      rememberHandledRequestId(responseRequestId);

      const tableIndex = resolveCurrentTableIndex(lastMessage);

      if (typeof tableIndex === 'number' && lastMessage.preview_png_base64) {
        setTablePreviewImages((prev) => ({ ...prev, [tableIndex]: lastMessage.preview_png_base64 }));
      }
      if (typeof tableIndex === 'number') {
        setLoadingTablePreviews((prev) => ({ ...prev, [tableIndex]: false }));
      }

      cancelInFlightTablePreview({ notifyBackend: false });

      setTimeout(() => {
        pumpTablePreviewQueue();
      }, 0);
      return true;
    }

    if (lastMessage.type === 'template_table_preview_error') {
      const correlation = isCorrelatedWithInFlight(lastMessage);
      if (correlation.duplicated) {
        return true;
      }
      if (!correlation.correlated) {
        return true;
      }

      const responseRequestId = typeof lastMessage.request_id === 'string' ? lastMessage.request_id : null;
      rememberHandledRequestId(responseRequestId);

      const tableIndex = resolveCurrentTableIndex(lastMessage);

      if (typeof tableIndex === 'number') {
        tablePreviewRequestedRef.current.delete(tableIndex);
        setLoadingTablePreviews((prev) => ({ ...prev, [tableIndex]: false }));
      }

      cancelInFlightTablePreview({ notifyBackend: false });

      let errorMessage = lastMessage.error || 'No fue posible generar preview de tabla.';
      if (lastMessage.error_detail) {
        errorMessage += `\n\nDetalles tecnicos: ${lastMessage.error_detail}`;
      }
      if (lastMessage.converter_used) {
        errorMessage += `\n\nConversor utilizado: ${lastMessage.converter_used}`;
      }
      onStatusMessage?.(errorMessage, 'error');

      setTimeout(() => {
        pumpTablePreviewQueue();
      }, 0);
      return true;
    }

    return false;
  }, [cancelInFlightTablePreview, isCorrelatedWithInFlight, onStatusMessage, pumpTablePreviewQueue, rememberHandledRequestId, resolveCurrentTableIndex]);

  return {
    tablePreviewImages,
    loadingTablePreviews,
    loadingAllTablePreviews,
    setTablePreviewImages,
    setLoadingTablePreviews,
    setLoadingAllTablePreviews,
    resetTablePreviewState,
    requestTablePreview,
    handleTablePreviewMessage,
  };
};

export default useTablePreviewQueue;
