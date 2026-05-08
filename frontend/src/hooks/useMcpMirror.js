import { useCallback, useEffect, useRef } from 'react';
import { WS_MSG } from '../contracts/wsMessageTypes.generated';

const normalizePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const HISTORY_LIMIT = 200;

const createConflictTarget = (path) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  return {
    kind: 'file',
    path,
  };
};

const buildMirrorConflictNotification = (event, exactPath = null) => {
  const target = createConflictTarget(exactPath);
  return {
    id: `mcp_mirror_conflict_${event.step_id}`,
    type: 'warning',
    title: 'MCP no reflejado',
    message: 'Hay cambios locales sin guardar en el recurso objetivo; la UI no aplico el espejo remoto.',
    timestamp: new Date(),
    read: false,
    dismissible: true,
    ...(target ? { target } : {}),
  };
};

const normalizeMirrorEvent = (message) => ({
  step_id: message.step_id,
  run_id: message.run_id,
  tool_name: message.tool_name,
  tool_group: message.tool_group,
  action: message.action,
  resource: message.resource || {},
  payload: message.payload || {},
  ts: message.ts,
});

const resolveTargetPath = (event) => {
  const payload = event?.payload || {};
  const resource = event?.resource || {};
  return (
    payload.path
    || payload.notebook_path
    || resource.notebook_path
    || resource.path
    || null
  );
};

export default function useMcpMirror({
  mirrorEnabled = true,
  workspaceSurface = 'file',
  lastMessage,
  messageQueue,
  activeFile,
  openFiles,
  modifiedFiles,
  handleFileOpen,
  handleFileSelect,
  notebookActionsRef,
  onNotify,
  onRefreshWorkspace,
  onTemplateInfoChange,
  onTemplateBlobChange,
  onFocusDocx,
  onApplyArtifact,
  reloadFileByPath,
  renameOpenFile,
  removeOpenFile,
}) {
  const processedStepIdsRef = useRef([]);
  const processedStepIdSetRef = useRef(new Set());
  const processingStepIdSetRef = useRef(new Set());
  const conflictWarnedRef = useRef(new Set());
  const pendingEventsRef = useRef([]);
  const flushTimerRef = useRef(null);
  const lastQueueMessageIdRef = useRef(0);
  const modifiedFilesRef = useRef(modifiedFiles || new Set());

  modifiedFilesRef.current = modifiedFiles || new Set();

  const rememberProcessedStep = useCallback((stepId) => {
    if (!stepId || processedStepIdSetRef.current.has(stepId)) return;
    processedStepIdSetRef.current.add(stepId);
    processedStepIdsRef.current.push(stepId);
    if (processedStepIdsRef.current.length > HISTORY_LIMIT) {
      const expired = processedStepIdsRef.current.shift();
      if (expired) processedStepIdSetRef.current.delete(expired);
    }
  }, []);

  const isTargetDirty = useCallback((path) => {
    const target = normalizePath(path);
    if (!target) return false;
    return Array.from(modifiedFilesRef.current || []).some((candidate) => normalizePath(candidate) === target);
  }, []);

  const findDirtyTargetPath = useCallback((paths) => {
    if (!Array.isArray(paths)) return null;
    return paths.find((candidate) => isTargetDirty(candidate)) || null;
  }, [isTargetDirty]);

  const notifyConflict = useCallback((event, exactPath = null) => {
    if (!event?.step_id || conflictWarnedRef.current.has(event.step_id)) return;
    conflictWarnedRef.current.add(event.step_id);
    onNotify?.(buildMirrorConflictNotification(event, exactPath));
  }, [onNotify]);

  const ensureResourceOpen = useCallback(async (path) => {
    const normalizedTarget = normalizePath(path);
    if (!normalizedTarget) return false;

    const existingFile = (openFiles || []).find((file) => normalizePath(file?.path) === normalizedTarget);
    if (existingFile) {
      if (normalizePath(activeFile?.path) !== normalizedTarget) {
        await handleFileSelect?.(existingFile);
      }
      return true;
    }

    await handleFileOpen?.({ path });
    return true;
  }, [activeFile?.path, handleFileOpen, handleFileSelect, openFiles]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      void flushPendingEventsRef.current();
    }, 80);
  }, []);

  const flushPendingEventsRef = useRef(async () => {});

  const queuePendingEvent = useCallback((event) => {
    if (!event?.step_id) return;
    const alreadyQueued = pendingEventsRef.current.some((candidate) => candidate.step_id === event.step_id);
    if (!alreadyQueued) {
      pendingEventsRef.current.push(event);
      scheduleFlush();
    }
  }, [scheduleFlush]);

  const applyFileMutation = useCallback(async (event) => {
    const payload = event?.payload || {};
    const mutation = typeof payload.mutation === 'string' && payload.mutation.trim()
      ? payload.mutation
      : 'write';
    const targetPath = payload.path || payload.new_path || payload.old_path || null;
    const oldPath = payload.old_path || null;
    const newPath = payload.new_path || targetPath;
    const isDirectory = Boolean(payload.is_directory);
    const relevantPaths = [oldPath, newPath, targetPath].filter(Boolean);

    onRefreshWorkspace?.(event);

    if (isDirectory) {
      const dirtyPath = findDirtyTargetPath(relevantPaths);
      if (dirtyPath) {
        notifyConflict(event, dirtyPath);
      }
      return true;
    }

    switch (mutation) {
      case 'write':
      case 'create': {
        const dirtyPath = findDirtyTargetPath([targetPath]);
        if (dirtyPath) {
          notifyConflict(event, dirtyPath);
          return true;
        }
        await reloadFileByPath?.(targetPath);
        return true;
      }

      case 'rename': {
        const dirtyPath = findDirtyTargetPath([oldPath, newPath]);
        if (dirtyPath) {
          notifyConflict(event, dirtyPath);
          return true;
        }
        renameOpenFile?.(oldPath, newPath);
        return true;
      }

      case 'delete': {
        const dirtyPath = findDirtyTargetPath([targetPath, oldPath]);
        if (dirtyPath) {
          notifyConflict(event, dirtyPath);
          return true;
        }
        removeOpenFile?.(targetPath || oldPath);
        return true;
      }

      default:
        return true;
    }
  }, [
    findDirtyTargetPath,
    notifyConflict,
    onRefreshWorkspace,
    reloadFileByPath,
    removeOpenFile,
    renameOpenFile,
  ]);

  const applyMirrorEvent = useCallback(async (event) => {
    if (!event?.step_id || !event?.action) return true;
    if (!mirrorEnabled) return true;

    if (event.action === 'file_mutation') {
      return applyFileMutation(event);
    }

    const allowResourceFocus = workspaceSurface !== 'home';
    const targetPath = resolveTargetPath(event);
    const canApplyWithoutActiveResource = event.action === 'template_snapshot' || event.action === 'artifact_update';

    if (!canApplyWithoutActiveResource) {
      const dirtyPath = findDirtyTargetPath([targetPath]);
      if (dirtyPath) {
        notifyConflict(event, dirtyPath);
        return true;
      }
    }

    if (targetPath && allowResourceFocus) {
      await ensureResourceOpen(targetPath);
    }

    const normalizedActivePath = normalizePath(activeFile?.path);
    const normalizedTargetPath = normalizePath(targetPath);
    const requiresActiveNotebook = event.action === 'notebook_snapshot' || event.action === 'notebook_runtime_message';

    if (requiresActiveNotebook) {
      const notebookActions = notebookActionsRef?.current;
      if (!notebookActions || !normalizedActivePath || !normalizedTargetPath || normalizedActivePath !== normalizedTargetPath) {
        return false;
      }
    }

    switch (event.action) {
      case 'open_resource':
        if (allowResourceFocus && event.payload?.focus_view === 'docx') {
          onFocusDocx?.();
        }
        return true;

      case 'notebook_snapshot':
        notebookActionsRef.current.replaceNotebookSnapshot?.(
          event.payload?.notebook,
          {
            kernelId: event.payload?.kernel_id || event.resource?.kernel_id,
            focusCellId: event.payload?.focus_cell_id || event.resource?.cell_id,
          },
        );
        return true;

      case 'notebook_runtime_message':
        notebookActionsRef.current.consumeRemoteNotebookMessage?.(event.payload);
        return true;

      case 'template_snapshot':
        onTemplateInfoChange?.(event.payload?.template ?? null, {
          path: targetPath,
          resourcePath: event.resource?.path || null,
          notebookPath: event.resource?.notebook_path || event.payload?.notebook_path || null,
          sourcePath: event.payload?.source_path || null,
          event,
        });
        if (Object.prototype.hasOwnProperty.call(event.payload || {}, 'template_token')) {
          onTemplateBlobChange?.(event.payload?.template_token ? { templateToken: event.payload.template_token } : null, {
            path: targetPath,
            resourcePath: event.resource?.path || null,
            notebookPath: event.resource?.notebook_path || event.payload?.notebook_path || null,
            sourcePath: event.payload?.source_path || null,
            event,
          });
        }
        if (allowResourceFocus && (!normalizedTargetPath || normalizedActivePath === normalizedTargetPath)) {
          onFocusDocx?.();
        }
        return true;

      case 'artifact_update':
        onApplyArtifact?.(event.payload, event);
        if (allowResourceFocus && (!normalizedTargetPath || normalizedActivePath === normalizedTargetPath)) {
          onFocusDocx?.();
        }
        return true;

      case 'mirror_conflict':
        notifyConflict(event);
        return true;

      default:
        return true;
    }
  }, [
    activeFile?.path,
    ensureResourceOpen,
    findDirtyTargetPath,
    mirrorEnabled,
    notebookActionsRef,
    notifyConflict,
    applyFileMutation,
    onApplyArtifact,
    onFocusDocx,
    onTemplateBlobChange,
    onTemplateInfoChange,
    workspaceSurface,
  ]);

  const flushPendingEvents = useCallback(async () => {
    if (pendingEventsRef.current.length === 0) return;

    const nextQueue = [];
    for (const event of pendingEventsRef.current) {
      const applied = await applyMirrorEvent(event);
      if (applied) {
        rememberProcessedStep(event.step_id);
      } else {
        nextQueue.push(event);
      }
    }
    pendingEventsRef.current = nextQueue;
    if (pendingEventsRef.current.length > 0) {
      scheduleFlush();
    }
  }, [applyMirrorEvent, rememberProcessedStep, scheduleFlush]);

  useEffect(() => {
    flushPendingEventsRef.current = flushPendingEvents;
  }, [flushPendingEvents]);

  const processMirrorEvent = useCallback(async (event) => {
    if (!event?.step_id) return;
    if (
      processedStepIdSetRef.current.has(event.step_id)
      || processingStepIdSetRef.current.has(event.step_id)
    ) {
      return;
    }

    processingStepIdSetRef.current.add(event.step_id);
    try {
      const applied = await applyMirrorEvent(event);
      if (applied) {
        rememberProcessedStep(event.step_id);
        return;
      }
      queuePendingEvent(event);
    } finally {
      processingStepIdSetRef.current.delete(event.step_id);
    }
  }, [applyMirrorEvent, queuePendingEvent, rememberProcessedStep]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== WS_MSG.MCP_MIRROR_EVENT) return;
    const event = normalizeMirrorEvent(lastMessage);
    void processMirrorEvent(event);
  }, [lastMessage, processMirrorEvent]);

  useEffect(() => {
    if (!Array.isArray(messageQueue) || messageQueue.length === 0) return undefined;

    const pendingMessages = messageQueue.filter((entry) => entry?.id > lastQueueMessageIdRef.current);
    if (pendingMessages.length === 0) return undefined;

    lastQueueMessageIdRef.current = pendingMessages[pendingMessages.length - 1].id;
    let cancelled = false;

    const run = async () => {
      for (const entry of pendingMessages) {
        if (cancelled) return;
        const message = entry?.message;
        if (!message || message.type !== WS_MSG.MCP_MIRROR_EVENT) continue;
        await processMirrorEvent(normalizeMirrorEvent(message));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [messageQueue, processMirrorEvent]);

  useEffect(() => {
    void flushPendingEvents();
  }, [activeFile, openFiles, flushPendingEvents, workspaceSurface]);

  useEffect(() => {
    if (mirrorEnabled) return;
    pendingEventsRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, [mirrorEnabled]);

  useEffect(() => () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);
}
