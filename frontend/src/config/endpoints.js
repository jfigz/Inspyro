const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const getDefaultApiBase = () => {
  if (process.env.NODE_ENV === 'test') {
    return 'http://localhost:8000';
  }

  if (typeof window !== 'undefined') {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:8000';
    }

    const { hostname = 'localhost', origin, port, protocol } = window.location;
    const normalizedProtocol = protocol === 'https:' ? 'https:' : 'http:';
    if (port === '3000') {
      return `${normalizedProtocol}//${hostname}:8000`;
    }
    if (origin && origin !== 'null') {
      return trimTrailingSlash(origin);
    }
    return `${normalizedProtocol}//${hostname}:8000`;
  }
  return 'http://localhost:8000';
};

const normalizeBaseUrl = (value, fallback) => {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimTrailingSlash(trimmed);
};

const buildWsUrl = (baseUrl, path) => {
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return trimTrailingSlash(url.toString());
  } catch (error) {
    return null;
  }
};

const fallbackApiBase = normalizeBaseUrl(getDefaultApiBase(), 'http://localhost:8000');

export const API_BASE = normalizeBaseUrl(process.env.REACT_APP_API_BASE, fallbackApiBase);
export const buildApiUrl = (pathname) => {
  try {
    return new URL(pathname, `${API_BASE}/`).toString();
  } catch (error) {
    return `${API_BASE}${pathname}`;
  }
};
export const WS_URL = normalizeBaseUrl(
  process.env.REACT_APP_WS_URL,
  buildWsUrl(API_BASE, '/ws') || 'ws://localhost:8000/ws'
);
export const NOTEBOOK_WS_URL = normalizeBaseUrl(
  process.env.REACT_APP_NOTEBOOK_WS_URL,
  buildWsUrl(API_BASE, '/ws/notebook') || 'ws://localhost:8000/ws/notebook'
);
export const LSP_WS_URL = normalizeBaseUrl(
  process.env.REACT_APP_LSP_WS_URL,
  buildWsUrl(API_BASE, '/ws/lsp') || 'ws://localhost:8000/ws/lsp'
);
