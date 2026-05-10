import { useCallback, useEffect, useRef, useState } from 'react';

const PREVIEW_DEBOUNCE_MS = 1000;
const PREVIEW_TIMEOUT_MS = 45000;
const PREVIEW_CACHE_MAX = 48;

export const useStylePreviewPipeline = ({
  sendMessage,
  kernelId,
  normalizePreviewProps,
  buildPreviewKey,
}) => {
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageKey, setPreviewImageKey] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewCacheRef = useRef(new Map());
  const previewRequestSeqRef = useRef(0);
  const previewPendingRef = useRef(null);
  const previewTimeoutRef = useRef(null);
  const previewInFlightRef = useRef({ requestId: null, previewKey: null });

  const cancelInFlightPreview = useCallback(() => {
    const inFlight = previewInFlightRef.current;
    if (sendMessage && kernelId && inFlight?.requestId) {
      sendMessage({
        type: 'template_preview_cancel',
        kernel_id: kernelId,
        preview_key: inFlight.previewKey || undefined,
        request_id: inFlight.requestId,
      });
    }

    previewInFlightRef.current = { requestId: null, previewKey: null };
  }, [sendMessage, kernelId]);

  const resetStylePreviewPipeline = useCallback(({ clearCache = false, clearImage = false } = {}) => {
    cancelInFlightPreview();

    if (previewPendingRef.current?.timerId) {
      clearTimeout(previewPendingRef.current.timerId);
    }
    previewPendingRef.current = null;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }

    setIsPreviewLoading(false);

    if (clearCache) {
      previewCacheRef.current.clear();
    }
    if (clearImage) {
      setPreviewImage(null);
      setPreviewImageKey(null);
    }
  }, [cancelInFlightPreview]);

  const setPreviewImageForKey = useCallback((previewKey, previewB64) => {
    setPreviewImage(previewB64 || null);
    setPreviewImageKey(previewB64 ? (previewKey || null) : null);
  }, []);

  const cachePreview = useCallback((previewKey, previewB64) => {
    if (!previewKey || !previewB64) return;
    const cache = previewCacheRef.current;
    cache.delete(previewKey);
    cache.set(previewKey, previewB64);
    if (cache.size > PREVIEW_CACHE_MAX) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
  }, []);

  const getCachedPreview = useCallback((previewKey) => {
    if (!previewKey) return null;
    const cache = previewCacheRef.current;
    const cached = cache.get(previewKey);
    if (!cached) return null;
    cache.delete(previewKey);
    cache.set(previewKey, cached);
    return cached;
  }, []);

  const sendPreviewRequest = useCallback((previewKey, previewPayload, options = {}) => {
    if (!sendMessage || !kernelId) return;

    const previous = previewInFlightRef.current;
    if (previous?.requestId && previous.previewKey && previous.previewKey !== previewKey) {
      sendMessage({
        type: 'template_preview_cancel',
        kernel_id: kernelId,
        preview_key: previous.previewKey,
        request_id: previous.requestId,
      });
    }

    previewRequestSeqRef.current += 1;
    const requestId = `tpl_prev_${Date.now()}_${previewRequestSeqRef.current}`;
    setIsPreviewLoading(true);
    previewInFlightRef.current = { requestId, previewKey };

    const payload = {
      ...previewPayload,
      preview_key: previewPayload?.preview_key || previewKey,
    };
    const previewEngine = options.previewEngine || previewPayload?.preview_engine || null;

    const message = {
      type: 'template_preview_style',
      request_id: requestId,
      kernel_id: kernelId,
      ...payload,
    };
    if (previewEngine) {
      message.preview_engine = previewEngine;
      message.native_word_preview = previewEngine === 'word_native';
    }
    sendMessage(message);

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
    previewTimeoutRef.current = setTimeout(() => {
      if (previewInFlightRef.current?.requestId === requestId) {
        cancelInFlightPreview();
        setIsPreviewLoading(false);
      }
    }, PREVIEW_TIMEOUT_MS);
  }, [cancelInFlightPreview, sendMessage, kernelId]);

  const handleRequestPreview = useCallback((styleName, props, options = {}) => {
    if (!sendMessage || !kernelId || !styleName) return;

    const normalizedProps = normalizePreviewProps(props);
    const previewKey = buildPreviewKey(styleName, normalizedProps);
    const { immediate = false, force = false } = options;

    if (force) {
      previewCacheRef.current.delete(previewKey);
      if (previewPendingRef.current?.timerId) {
        clearTimeout(previewPendingRef.current.timerId);
      }
      previewPendingRef.current = null;
      if (previewInFlightRef.current.previewKey === previewKey) {
        const active = previewInFlightRef.current;
        if (active?.requestId && sendMessage && kernelId) {
          cancelInFlightPreview();
        }
        if (previewTimeoutRef.current) {
          clearTimeout(previewTimeoutRef.current);
          previewTimeoutRef.current = null;
        }
      }
    }

    if (!force) {
      const cached = getCachedPreview(previewKey);
      if (cached) {
        setPreviewImageForKey(previewKey, cached);
        setIsPreviewLoading(false);
        return;
      }
    }

    if (previewPendingRef.current?.previewKey === previewKey) return;
    if (previewInFlightRef.current.previewKey === previewKey) {
      setIsPreviewLoading(true);
      return;
    }

    if (previewPendingRef.current?.timerId) {
      clearTimeout(previewPendingRef.current.timerId);
    }

    setIsPreviewLoading(true);
    previewPendingRef.current = { previewKey };

    const sendPreview = () => {
      if (!sendMessage || !kernelId) return;
      if (previewPendingRef.current?.previewKey !== previewKey) return;

      previewPendingRef.current = null;
      sendPreviewRequest(previewKey, {
        style_name: styleName,
        style_props: normalizedProps,
        preview_key: previewKey,
        force_refresh: force,
      }, options);
    };

    previewPendingRef.current.timerId = setTimeout(
      sendPreview,
      immediate ? 0 : PREVIEW_DEBOUNCE_MS
    );
  }, [cancelInFlightPreview, sendMessage, kernelId, normalizePreviewProps, buildPreviewKey, getCachedPreview, sendPreviewRequest, setPreviewImageForKey]);

  useEffect(() => () => {
    cancelInFlightPreview();
    if (previewPendingRef.current?.timerId) {
      clearTimeout(previewPendingRef.current.timerId);
    }
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
  }, [cancelInFlightPreview]);

  return {
    previewImage,
    previewImageKey,
    setPreviewImage,
    setPreviewImageForKey,
    isPreviewLoading,
    setIsPreviewLoading,
    previewInFlightRef,
    previewTimeoutRef,
    resetStylePreviewPipeline,
    cachePreview,
    getCachedPreview,
    handleRequestPreview,
  };
};

export default useStylePreviewPipeline;
