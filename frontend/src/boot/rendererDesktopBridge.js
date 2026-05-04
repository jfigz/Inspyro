const nowIso = () => new Date().toISOString();

const truncate = (value, maxLength = 6000) => {
  if (typeof value !== 'string') {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

export const serializeRendererError = (error, extra = {}) => ({
  name: error?.name || 'Error',
  message: error?.message || String(error || 'Unknown renderer error'),
  stack: truncate(error?.stack || null),
  timestamp: nowIso(),
  ...extra,
});

export const reportRendererPhase = (phase, payload = {}) => {
  if (!phase) {
    return false;
  }

  try {
    window.inspyroDesktop?.reportRendererPhase?.(phase, {
      timestamp: nowIso(),
      ...payload,
    });
    return true;
  } catch {
    return false;
  }
};

let installedGlobalErrorHandlers = false;

export const installRendererErrorHandlers = () => {
  if (installedGlobalErrorHandlers || typeof window === 'undefined') {
    return () => {};
  }

  const handleWindowError = (event) => {
    reportRendererPhase('renderer_unhandled_error', serializeRendererError(
      event?.error || new Error(event?.message || 'Unhandled renderer error'),
      {
        phase: 'window.onerror',
        source: event?.filename || null,
        line: event?.lineno ?? null,
        column: event?.colno ?? null,
      },
    ));
  };

  const handleUnhandledRejection = (event) => {
    const reason = event?.reason;
    const error = reason instanceof Error
      ? reason
      : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');

    reportRendererPhase('renderer_unhandled_error', serializeRendererError(error, {
      phase: 'unhandledrejection',
    }));
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  installedGlobalErrorHandlers = true;

  return () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    installedGlobalErrorHandlers = false;
  };
};
