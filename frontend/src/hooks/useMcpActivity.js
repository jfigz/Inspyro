import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../config/endpoints';
import { WS_MSG } from '../contracts/wsMessageTypes.generated';

const MCP_MIRROR_STORAGE_KEY = 'inspyro_mcp_mirror_enabled';
const HISTORY_LIMIT = 120;
const GRANULAR_MIRROR_GROUPS = new Set(['notebook', 'templates', 'files', 'documents']);

const normalizePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
};

const isNotebookPath = (value) => (
  typeof value === 'string'
  && value.trim().toLowerCase().endsWith('.ipynb')
);

const toDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
};

const withReflectedFlag = (event, uiReflected = false) => ({
  ...event,
  ui_reflected: Boolean(uiReflected || event?.ui_reflected),
});

const mergeEvents = (current, nextEvent) => {
  const next = current.filter((item) => item.event_id !== nextEvent.event_id);
  next.unshift(nextEvent);
  return next.slice(0, HISTORY_LIMIT);
};

const mergeRuns = (current, nextEvent) => {
  const next = current.filter((item) => item.run_id !== nextEvent.run_id);
  if (nextEvent.status === 'running') {
    next.unshift(nextEvent);
  }
  return next.slice(0, HISTORY_LIMIT);
};

const shouldNotifyForEvent = (event) => {
  if (event.phase === 'failed') return true;
  const hints = event.ui_hints || {};
  if (event.phase !== 'completed') return false;
  if (hints.refresh_workspace || hints.reload_path || hints.refresh_preview || hints.show_agent_execution) {
    return true;
  }
  return false;
};

const createFileTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  return {
    kind: 'file',
    path,
    ...extra,
  };
};

const createCodeTarget = (path, extra = {}) => {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  const line = Number.isInteger(extra.line) && extra.line > 0 ? extra.line : null;
  const column = Number.isInteger(extra.column) && extra.column >= 0 ? extra.column : null;
  const cellId = typeof extra.cellId === 'string' && extra.cellId.trim() ? extra.cellId : null;
  if (!cellId && line === null && column === null) {
    return createFileTarget(path, extra);
  }
  return {
    kind: 'code',
    filePath: path,
    ...(cellId ? { cellId } : {}),
    ...(line !== null ? { line } : {}),
    ...(column !== null ? { column } : {}),
    ...extra,
  };
};

const resolveEventPath = (event) => (
  event?.resource?.notebook_path
  || event?.resource?.path
  || event?.ui_hints?.reload_path
  || event?.ui_hints?.artifact?.source_path
  || event?.ui_hints?.artifact?.notebook_path
  || null
);

const buildNotificationTarget = (event) => {
  const hints = event?.ui_hints || {};
  const artifact = hints.artifact || null;
  const resolvedPath = artifact?.source_path
    || artifact?.notebook_path
    || resolveEventPath(event);

  if (hints.refresh_preview || artifact) {
    if (resolvedPath) {
      return {
        kind: 'document',
        sourcePath: resolvedPath,
        sourceKind: artifact?.source_kind || (isNotebookPath(resolvedPath) ? 'notebook' : 'code'),
      };
    }
    return null;
  }

  if (resolvedPath) {
    return createCodeTarget(resolvedPath, {
      cellId: event?.resource?.cell_id || hints?.cell_id || null,
      line: Number.isInteger(event?.resource?.line) ? event.resource.line : null,
      column: Number.isInteger(event?.resource?.column) ? event.resource.column : null,
    });
  }

  return null;
};

const buildNotification = (event, reflected) => {
  const target = buildNotificationTarget(event);

  if (event.phase === 'failed') {
    return {
      id: event.event_id,
      type: 'error',
      title: `Agents: ${event.tool_name}`,
      message: event.error || event.summary,
      timestamp: toDate(event.ts),
      read: false,
      dismissible: true,
      target,
    };
  }

  const successMessage = reflected
    ? `${event.summary} visible in the workspace`
    : event.summary;

  return {
    id: event.event_id,
    type: 'success',
    title: `Agents: ${event.tool_name}`,
    message: successMessage,
    timestamp: toDate(event.ts),
    read: false,
    dismissible: true,
    target,
  };
};

export default function useMcpActivity({
  connectionStatus,
  lastMessage,
  messageQueue,
  activeFile,
  modifiedFiles,
  onNotify,
  onRefreshWorkspace,
  onReloadActiveFile,
  onApplyArtifact,
}) {
  const [activity, setActivity] = useState([]);
  const [activeRuns, setActiveRuns] = useState([]);
  const [mirrorEnabled, setMirrorEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(MCP_MIRROR_STORAGE_KEY);
      return stored === null ? false : stored === 'true';
    } catch {
      return false;
    }
  });
  const [agentExecutionState, setAgentExecutionState] = useState(null);

  const notifiedEventIdsRef = useRef(new Set());
  const dirtySkipWarnedRef = useRef(new Set());
  const lastWsEventIdRef = useRef(null);
  const lastQueueMessageIdRef = useRef(0);

  const activePath = activeFile?.path || null;
  const normalizedActivePath = normalizePath(activePath);
  const isActiveDirty = Boolean(activePath && modifiedFiles?.has(activePath));

  useEffect(() => {
    try {
      localStorage.setItem(MCP_MIRROR_STORAGE_KEY, String(mirrorEnabled));
    } catch {
      // ignore persistence errors
    }
  }, [mirrorEnabled]);

  useEffect(() => {
    if (!agentExecutionState?.path) return;
    if (normalizePath(agentExecutionState.path) !== normalizedActivePath) {
      setAgentExecutionState(null);
    }
  }, [agentExecutionState, normalizedActivePath]);

  const notifyDirtySkip = useCallback((event) => {
    if (!onNotify) return;
    if (dirtySkipWarnedRef.current.has(event.event_id)) return;
    dirtySkipWarnedRef.current.add(event.event_id);
    const exactDirtyTarget = createFileTarget(resolveEventPath(event));
    onNotify({
      id: `mcp_skip_${event.event_id}`,
      type: 'warning',
      title: 'MCP no reflejado',
      message: 'Hay cambios locales sin guardar; la UI no se recargo para evitar sobrescritura.',
      timestamp: new Date(),
      read: false,
      dismissible: true,
      ...(exactDirtyTarget ? { target: exactDirtyTarget } : {}),
    });
  }, [onNotify]);

  const applyMirror = useCallback(async (event) => {
    const hints = event.ui_hints || {};
    const resource = event.resource || {};
    const usesGranularMirror = GRANULAR_MIRROR_GROUPS.has(event.tool_group);
    const candidatePaths = [
      normalizePath(resource.path),
      normalizePath(resource.notebook_path),
      normalizePath(hints.reload_path),
    ].filter(Boolean);
    const matchesActive = Boolean(
      normalizedActivePath && candidatePaths.some((candidate) => candidate === normalizedActivePath)
    );

    if (event.phase !== 'started' && agentExecutionState?.run_id === event.run_id) {
      setAgentExecutionState(null);
    }

    if (!mirrorEnabled) {
      return false;
    }

    let reflected = false;

    if (hints.refresh_workspace) {
      onRefreshWorkspace?.(event);
      reflected = true;
    }

    if (event.phase === 'started' && hints.show_agent_execution && matchesActive && !isActiveDirty) {
      setAgentExecutionState({
        run_id: event.run_id,
        tool_name: event.tool_name,
        summary: event.summary,
        path: resource.notebook_path || resource.path || hints.reload_path || activePath,
        startedAt: event.ts,
      });
      reflected = true;
    }

    if (event.phase !== 'completed') {
      return reflected;
    }

    if (usesGranularMirror) {
      return reflected;
    }

    if (!matchesActive) {
      return reflected;
    }

    if (isActiveDirty && (hints.reload_path || hints.refresh_preview || hints.show_agent_execution)) {
      notifyDirtySkip(event);
      return reflected;
    }

    if (event.tool_name !== 'delete_file' && hints.reload_path) {
      await onReloadActiveFile?.(event);
      reflected = true;
    }

    if (hints.refresh_preview || hints.artifact) {
      onApplyArtifact?.(event);
      reflected = true;
    }

    return reflected;
  }, [
    activePath,
    agentExecutionState,
    isActiveDirty,
    mirrorEnabled,
    normalizedActivePath,
    notifyDirtySkip,
    onApplyArtifact,
    onRefreshWorkspace,
    onReloadActiveFile,
  ]);

  const processEvent = useCallback(async (event, { notify = true } = {}) => {
    if (!event?.event_id || !event?.run_id) return;

    const reflected = await applyMirror(event);
    const decoratedEvent = withReflectedFlag(event, reflected);

    setActivity((current) => mergeEvents(current, decoratedEvent));
    setActiveRuns((current) => mergeRuns(current, decoratedEvent));

    if (!notify || !onNotify || notifiedEventIdsRef.current.has(event.event_id) || !shouldNotifyForEvent(event)) {
      return;
    }

    notifiedEventIdsRef.current.add(event.event_id);
    onNotify(buildNotification(decoratedEvent, reflected));
  }, [applyMirror, onNotify]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return undefined;

    let cancelled = false;

    const fetchActivity = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/mcp/activity?limit=${HISTORY_LIMIT}`);
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const hydratedEvents = Array.isArray(data.events)
          ? data.events.map((item) => withReflectedFlag(item, false))
          : [];
        const hydratedRuns = Array.isArray(data.active_runs)
          ? data.active_runs.map((item) => withReflectedFlag(item, false))
          : [];
        setActivity(hydratedEvents);
        setActiveRuns(hydratedRuns);
      } catch {
        // ignore
      }
    };

    fetchActivity();
    return () => {
      cancelled = true;
    };
  }, [connectionStatus]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== WS_MSG.MCP_ACTIVITY_EVENT) return;
    if (!lastMessage.event_id || lastWsEventIdRef.current === lastMessage.event_id) return;
    lastWsEventIdRef.current = lastMessage.event_id;
    const event = {
      event_id: lastMessage.event_id,
      run_id: lastMessage.run_id,
      phase: lastMessage.phase,
      status: lastMessage.status,
      tool_name: lastMessage.tool_name,
      tool_group: lastMessage.tool_group,
      client_id: lastMessage.client_id || null,
      client_label: lastMessage.client_label || null,
      transport: lastMessage.transport || null,
      summary: lastMessage.summary,
      detail: lastMessage.detail,
      duration_ms: lastMessage.duration_ms,
      error: lastMessage.error,
      ts: lastMessage.ts,
      resource: lastMessage.resource || {},
      ui_hints: lastMessage.ui_hints || {},
    };
    void processEvent(event);
  }, [lastMessage, processEvent]);

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
        if (!message || message.type !== WS_MSG.MCP_ACTIVITY_EVENT) continue;
        if (!message.event_id || lastWsEventIdRef.current === message.event_id) continue;
        lastWsEventIdRef.current = message.event_id;
        await processEvent({
          event_id: message.event_id,
          run_id: message.run_id,
          phase: message.phase,
          status: message.status,
          tool_name: message.tool_name,
          tool_group: message.tool_group,
          client_id: message.client_id || null,
          client_label: message.client_label || null,
          transport: message.transport || null,
          summary: message.summary,
          detail: message.detail,
          duration_ms: message.duration_ms,
          error: message.error,
          ts: message.ts,
          resource: message.resource || {},
          ui_hints: message.ui_hints || {},
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [messageQueue, processEvent]);

  return {
    activity,
    activeRuns,
    runningCount: activeRuns.length,
    mirrorEnabled,
    setMirrorEnabled,
    toggleMirrorEnabled: () => setMirrorEnabled((value) => !value),
    agentExecutionState,
  };
}
