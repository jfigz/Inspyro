import { useEffect, useRef } from 'react';
import { WS_MESSAGE_TYPES as WS_MSG } from '../contracts/wsMessageTypes.generated';

const normalizeComparablePath = (value) => (
  typeof value === 'string' && value.trim()
    ? value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
    : null
);

const isSamePath = (left, right) => {
  const normalizedLeft = normalizeComparablePath(left);
  const normalizedRight = normalizeComparablePath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const isTemplateMessageType = (messageType) => (
  messageType === WS_MSG.TEMPLATE_UPLOADED
  || messageType === WS_MSG.TEMPLATE_INFO
  || messageType === WS_MSG.TEMPLATE_DELETED
  || messageType === WS_MSG.TEMPLATE_STYLE_UPDATED
  || messageType === WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED
  || messageType === WS_MSG.TEMPLATE_SEMANTIC_SLOTS_UPDATED
  || messageType === WS_MSG.TEMPLATE_STYLE_CREATED
  || messageType === WS_MSG.TEMPLATE_FORMAT_APPLIED
  || messageType === WS_MSG.TEMPLATE_ERROR
  || messageType === 'error'
);

const buildTemplateAttachState = (message, previous = {}) => {
  const kernelId = message?.kernel_id || previous?.lastTemplateAttach?.kernelId || previous?.kernelState?.kernelId || null;
  const token = message?.template_token || previous?.templateBlob?.templateToken || null;
  if (!kernelId || !token) {
    return previous?.lastTemplateAttach || null;
  }
  return {
    kernelId,
    attachKey: `token:${token}`,
    status: 'attached',
    requestId: message?.request_id || null,
  };
};

const templateBindingPatch = (message) => (
  Object.prototype.hasOwnProperty.call(message || {}, 'template_binding')
    ? { templateBinding: message.template_binding || null }
    : {}
);

const applyLegacyTemplateMessage = ({
  lastMessage,
  setTemplateInfo,
  setTemplateBlob,
  onStatusMessage,
}) => {
  if (!lastMessage) return;
  const isCorrelatedRequest = Boolean(lastMessage.request_id);

  switch (lastMessage.type) {
    case WS_MSG.TEMPLATE_UPLOADED:
      setTemplateInfo?.(lastMessage.template);
      if (lastMessage.template_token) {
        setTemplateBlob?.((prev) => {
          if (prev?.templateToken === lastMessage.template_token) {
            return prev;
          }
          return {
            templateToken: lastMessage.template_token,
          };
        });
      }
      if (!isCorrelatedRequest) {
        onStatusMessage?.('Plantilla cargada exitosamente', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_INFO:
      setTemplateInfo?.(lastMessage.template);
      break;
    case WS_MSG.TEMPLATE_DELETED:
      setTemplateInfo?.(null);
      setTemplateBlob?.(null);
      if (!isCorrelatedRequest) {
        onStatusMessage?.('Plantilla eliminada', 'info');
      }
      break;
    case WS_MSG.TEMPLATE_STYLE_UPDATED:
      setTemplateInfo?.(lastMessage.template);
      if (!isCorrelatedRequest) {
        onStatusMessage?.(`Estilo "${lastMessage.style_name}" actualizado`, 'success');
      }
      break;
    case WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED:
      setTemplateInfo?.(lastMessage.template);
      if (!isCorrelatedRequest) {
        onStatusMessage?.('Configuración global del documento actualizada', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_SEMANTIC_SLOTS_UPDATED:
      setTemplateInfo?.(lastMessage.template);
      if (!isCorrelatedRequest) {
        onStatusMessage?.('Slots semánticos actualizados', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_STYLE_CREATED:
      if (lastMessage.template) {
        setTemplateInfo?.(lastMessage.template);
      }
      if (!isCorrelatedRequest) {
        onStatusMessage?.(`Estilo "${lastMessage.style_name || 'tabla'}" creado`, 'success');
      }
      break;
    case WS_MSG.TEMPLATE_FORMAT_APPLIED:
      if (lastMessage.template) {
        setTemplateInfo?.(lastMessage.template);
      }
      if (!isCorrelatedRequest) {
        onStatusMessage?.(lastMessage.message || 'Formato de tabla aplicado', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_ERROR:
      if (!isCorrelatedRequest) {
        onStatusMessage?.(
          `Error de plantilla: ${lastMessage.error || lastMessage.message || 'Error desconocido'}`,
          'error',
        );
      }
      break;
    case 'error':
      onStatusMessage?.(lastMessage.message || 'Error de comunicación WebSocket', 'error');
      break;
    default:
      break;
  }
};

const applySessionTemplateMessage = ({
  message,
  targetPath,
  activeNotebookPath,
  updateNotebookSession,
  onStatusMessage,
}) => {
  if (!message || !targetPath || typeof updateNotebookSession !== 'function') {
    return;
  }
  const isActiveTarget = isSamePath(targetPath, activeNotebookPath);
  const isCorrelatedRequest = Boolean(message.request_id);

  switch (message.type) {
    case WS_MSG.TEMPLATE_UPLOADED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || null,
        templateBlob: message.template_token
          ? {
            ...(previous.templateBlob || {}),
            templateToken: message.template_token,
          }
          : previous.templateBlob,
        lastTemplateAttach: buildTemplateAttachState(message, previous),
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.('Plantilla cargada exitosamente', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_INFO:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || null,
      }));
      break;
    case WS_MSG.TEMPLATE_DELETED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: null,
        templateBlob: null,
        templateOpenRequest: null,
        lastTemplateAttach: null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.('Plantilla eliminada', 'info');
      }
      break;
    case WS_MSG.TEMPLATE_STYLE_UPDATED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.(`Estilo "${message.style_name}" actualizado`, 'success');
      }
      break;
    case WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.('Configuración global del documento actualizada', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_SEMANTIC_SLOTS_UPDATED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.('Slots semánticos actualizados', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_STYLE_CREATED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || previous.templateInfo || null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.(`Estilo "${message.style_name || 'tabla'}" creado`, 'success');
      }
      break;
    case WS_MSG.TEMPLATE_FORMAT_APPLIED:
      updateNotebookSession(targetPath, (previous) => ({
        ...previous,
        ...templateBindingPatch(message),
        templateInfo: message.template || previous.templateInfo || null,
      }));
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.(message.message || 'Formato de tabla aplicado', 'success');
      }
      break;
    case WS_MSG.TEMPLATE_ERROR:
      updateNotebookSession(targetPath, (previous) => {
        const lastAttach = previous.lastTemplateAttach;
        const requestMatches = message.request_id
          ? lastAttach?.requestId === message.request_id
          : true;
        if (lastAttach?.status === 'pending' && requestMatches) {
          return {
            ...previous,
            lastTemplateAttach: null,
          };
        }
        return previous;
      });
      if (!isCorrelatedRequest && isActiveTarget) {
        onStatusMessage?.(
          `Error de plantilla: ${message.error || message.message || 'Error desconocido'}`,
          'error',
        );
      }
      break;
    case 'error':
      updateNotebookSession(targetPath, (previous) => {
        const lastAttach = previous.lastTemplateAttach;
        const requestMatches = message.request_id
          ? lastAttach?.requestId === message.request_id
          : true;
        if (lastAttach?.status === 'pending' && requestMatches) {
          return {
            ...previous,
            lastTemplateAttach: null,
          };
        }
        return previous;
      });
      if (isActiveTarget) {
        onStatusMessage?.(message.message || 'Error de comunicación WebSocket', 'error');
      }
      break;
    default:
      break;
  }
};

export default function useTemplateMessageHandler({
  lastMessage,
  messageQueue,
  resolveMessagePath,
  updateNotebookSession,
  activeNotebookPath = null,
  setTemplateInfo,
  setTemplateBlob,
  onStatusMessage,
}) {
  const lastProcessedIdRef = useRef(0);

  useEffect(() => {
    if (
      typeof updateNotebookSession !== 'function'
      || typeof resolveMessagePath !== 'function'
      || !Array.isArray(messageQueue)
    ) {
      return;
    }

    const nextEntries = messageQueue.filter((entry) => (
      Number.isFinite(entry?.id)
      && entry.id > lastProcessedIdRef.current
      && isTemplateMessageType(entry?.message?.type)
    ));

    if (nextEntries.length === 0) {
      return;
    }

    nextEntries.forEach((entry) => {
      const message = entry.message;
      const targetPath = resolveMessagePath(message) || entry.path || null;
      if (targetPath) {
        applySessionTemplateMessage({
          message,
          targetPath,
          activeNotebookPath,
          updateNotebookSession,
          onStatusMessage,
        });
      }
      lastProcessedIdRef.current = entry.id;
    });
  }, [
    activeNotebookPath,
    messageQueue,
    onStatusMessage,
    resolveMessagePath,
    updateNotebookSession,
  ]);

  useEffect(() => {
    if (typeof updateNotebookSession === 'function' && typeof resolveMessagePath === 'function') {
      return;
    }
    applyLegacyTemplateMessage({
      lastMessage,
      setTemplateInfo,
      setTemplateBlob,
      onStatusMessage,
    });
  }, [
    lastMessage,
    onStatusMessage,
    resolveMessagePath,
    setTemplateBlob,
    setTemplateInfo,
    updateNotebookSession,
  ]);
}
