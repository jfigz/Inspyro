import { useCallback, useState } from 'react';
import { API_BASE } from '../config/endpoints';

const readErrorMessage = async (response, fallbackMessage) => {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export const shouldAutoEnableMirrorAfterMcpAction = (action, succeeded) => (
  Boolean(succeeded && (action === 'start' || action === 'restart'))
);

export default function useMcpShellControls({
  emitDesktopNotification,
  handleStatusMessage,
  setMirrorEnabled,
}) {
  const [mcpStatus, setMcpStatus] = useState(null);

  const refreshMcpStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/mcp/status`);
      if (!response.ok) return null;
      const status = await response.json();
      setMcpStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  const handleMcpQuickAction = useCallback(async (action) => {
    const verbMap = {
      start: 'start',
      stop: 'stop',
      restart: 'restart',
    };
    const actionVerb = verbMap[action] || action;

    try {
      const response = await fetch(`${API_BASE}/api/mcp/${action}`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, `Could not ${actionVerb} agents`));
      }

      if (shouldAutoEnableMirrorAfterMcpAction(action, true)) {
        setMirrorEnabled(true);
      }

      window.setTimeout(() => {
        refreshMcpStatus().catch(() => {});
      }, 1500);
      return true;
    } catch (error) {
      const message = error?.message || `Could not ${actionVerb} agents`;
      handleStatusMessage(message, 'warning');
      emitDesktopNotification(
        { title: 'Agents error', body: message, level: 'error' },
        `mcp:${action}:${message}`,
      );
      return false;
    }
  }, [
    emitDesktopNotification,
    handleStatusMessage,
    refreshMcpStatus,
    setMirrorEnabled,
  ]);

  return {
    mcpStatus,
    setMcpStatus,
    refreshMcpStatus,
    handleMcpQuickAction,
  };
}
