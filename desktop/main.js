const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const devFrontendUrl = process.env.INSPYRO_DESKTOP_DEV_URL || 'http://127.0.0.1:3000';
const devBackendUrl = process.env.INSPYRO_DESKTOP_DEV_BACKEND_URL || 'http://127.0.0.1:8000';
const packagedBackendHost = process.env.INSPYRO_DESKTOP_BACKEND_HOST || '127.0.0.1';
const maxBackendLogLines = 200;
const maxRecentWorkspaces = 8;
const titleBarHeight = 40;
const nativeOpenExtensions = new Set(['.ipynb', '.py', '.inspyro']);
const defaultWindowBounds = {
  width: 1600,
  height: 1000,
};

const backendLogs = [];
const titleBarOverlay = process.platform === 'win32'
  ? {
    color: '#161b22',
    symbolColor: '#e6edf3',
    height: titleBarHeight,
  }
  : undefined;
const resolveWindowIconPath = () => {
  const preferred = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(__dirname, 'assets', preferred),
    path.join(__dirname, 'assets', 'icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
};

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendUrl = devBackendUrl;
let appUrl = devFrontendUrl;
let isShuttingDown = false;
let stateWriteTimer = null;
let rendererAppReady = false;
let mainWindowReady = false;
let rendererPhase = 'idle';
let rendererBootstrapTimeout = null;
let rendererAppReadyTimeout = null;
let rendererLastError = null;
let rendererEventQueue = [];
let pendingNativeOpenTargets = [];
let bootState = {
  stage: 'Initializing shell',
  detail: 'Preparing Inspyro...',
  status: 'loading',
  diagnostic: '',
  actions: {
    canRetry: false,
    canQuit: false,
  },
};
let shellState = {
  windowBounds: defaultWindowBounds,
  isMaximized: false,
  recentWorkspaces: [],
  lastWorkspace: null,
};

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.inspyro.desktop');
}

const getShellStatePath = () => path.join(app.getPath('userData'), 'desktop-shell-state.json');

const sanitizeWorkspacePath = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? path.normalize(trimmed) : null;
};

const appendBackendLog = (prefix, chunk) => {
  String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .forEach((line) => {
      backendLogs.push(`[${prefix}] ${line}`);
      if (backendLogs.length > maxBackendLogLines) {
        backendLogs.shift();
      }
    });
};

const summarizeBackendLogs = () => {
  if (!backendLogs.length) {
    return 'Sin logs del backend.';
  }
  return backendLogs.slice(-25).join('\n');
};

const waitForUrl = (targetUrl, timeoutMs = 45000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;

  const attempt = () => {
    const request = http.get(targetUrl, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timeout esperando ${targetUrl} (status ${response.statusCode || 'sin respuesta'})`));
        return;
      }
      setTimeout(attempt, 500);
    });

    request.on('error', () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timeout esperando ${targetUrl}`));
        return;
      }
      setTimeout(attempt, 500);
    });
  };

  attempt();
});

const findAvailablePort = (preferredPort = 18000) => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on('error', reject);
  server.listen(preferredPort, packagedBackendHost, () => {
    const address = server.address();
    server.close((closeError) => {
      if (closeError) {
        reject(closeError);
        return;
      }
      resolve(address.port);
    });
  });
});

const resolvePackagedPythonExecutable = () => {
  const explicit = process.env.INSPYRO_DESKTOP_PYTHON;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    path.join(process.resourcesPath, 'python', 'python.exe'),
    path.join(process.resourcesPath, 'python', 'bin', 'python3'),
    path.join(process.resourcesPath, 'python', 'bin', 'python'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
};

const getPrimaryWorkArea = () => screen.getPrimaryDisplay().workArea;

const rectIntersects = (left, right) => {
  const horizontal = left.x < (right.x + right.width) && (left.x + left.width) > right.x;
  const vertical = left.y < (right.y + right.height) && (left.y + left.height) > right.y;
  return horizontal && vertical;
};

const sanitizeWindowBounds = (rawBounds = {}) => {
  const primaryWorkArea = getPrimaryWorkArea();
  const candidate = {
    width: Math.max(1200, Math.min(Number(rawBounds.width) || defaultWindowBounds.width, primaryWorkArea.width)),
    height: Math.max(780, Math.min(Number(rawBounds.height) || defaultWindowBounds.height, primaryWorkArea.height)),
    x: Number.isFinite(Number(rawBounds.x)) ? Number(rawBounds.x) : primaryWorkArea.x + Math.round((primaryWorkArea.width - defaultWindowBounds.width) / 2),
    y: Number.isFinite(Number(rawBounds.y)) ? Number(rawBounds.y) : primaryWorkArea.y + Math.round((primaryWorkArea.height - defaultWindowBounds.height) / 2),
  };

  const displays = screen.getAllDisplays();
  const matchingDisplay = displays.find((display) => rectIntersects(candidate, display.workArea));
  const workArea = matchingDisplay ? matchingDisplay.workArea : primaryWorkArea;

  if (!matchingDisplay) {
    candidate.x = workArea.x + Math.max(0, Math.round((workArea.width - candidate.width) / 2));
    candidate.y = workArea.y + Math.max(0, Math.round((workArea.height - candidate.height) / 2));
  }

  candidate.x = Math.max(workArea.x, Math.min(candidate.x, workArea.x + workArea.width - candidate.width));
  candidate.y = Math.max(workArea.y, Math.min(candidate.y, workArea.y + workArea.height - candidate.height));
  return candidate;
};

const loadShellState = () => {
  try {
    const filePath = getShellStatePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    shellState = {
      windowBounds: sanitizeWindowBounds(parsed?.windowBounds),
      isMaximized: Boolean(parsed?.isMaximized),
      recentWorkspaces: Array.isArray(parsed?.recentWorkspaces)
        ? parsed.recentWorkspaces.map(sanitizeWorkspacePath).filter(Boolean).slice(0, maxRecentWorkspaces)
        : [],
      lastWorkspace: sanitizeWorkspacePath(parsed?.lastWorkspace),
    };
  } catch (error) {
    shellState = {
      windowBounds: defaultWindowBounds,
      isMaximized: false,
      recentWorkspaces: [],
      lastWorkspace: null,
    };
  }
};

const writeShellState = () => {
  try {
    const filePath = getShellStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(shellState, null, 2), 'utf8');
  } catch (error) {
    appendBackendLog('desktop', `No se pudo persistir desktop-shell-state.json: ${error.message}`);
  }
};

const scheduleShellStateWrite = () => {
  clearTimeout(stateWriteTimer);
  stateWriteTimer = setTimeout(() => {
    stateWriteTimer = null;
    writeShellState();
  }, 150);
};

const rememberWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  shellState.isMaximized = mainWindow.isMaximized();
  if (!shellState.isMaximized && !mainWindow.isMinimized()) {
    shellState.windowBounds = mainWindow.getBounds();
  }
  scheduleShellStateWrite();
};

const updateMainWindowTitle = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const workspacePath = shellState.lastWorkspace;
  if (!workspacePath) {
    mainWindow.setTitle('Inspyro');
    return;
  }

  mainWindow.setTitle(`Inspyro - ${path.basename(workspacePath)}`);
};

const sendRendererAction = (type, payload = {}) => {
  const action = { type, payload };
  if (!mainWindow || mainWindow.isDestroyed()) {
    rendererEventQueue.push(action);
    return;
  }
  if (!rendererAppReady) {
    rendererEventQueue.push(action);
    return;
  }
  mainWindow.webContents.send('desktop:menu-action', action);
};

const normalizeNativeOpenTarget = (rawValue) => {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }
  const value = rawValue.trim();
  if (/^inspyro:\/\//i.test(value)) {
    return { type: 'open-native-url', payload: { url: value } };
  }
  if (!path.isAbsolute(value)) {
    return null;
  }
  const extension = path.extname(value).toLowerCase();
  if (!nativeOpenExtensions.has(extension)) {
    return null;
  }
  return {
    type: 'open-native-file',
    payload: {
      path: path.normalize(value),
      extension,
    },
  };
};

const rememberNativeOpenTargets = (argv = []) => {
  const nextTargets = argv
    .map(normalizeNativeOpenTarget)
    .filter(Boolean);
  if (!nextTargets.length) {
    return;
  }
  pendingNativeOpenTargets.push(...nextTargets);
  flushNativeOpenTargets();
};

const flushNativeOpenTargets = () => {
  if (!rendererAppReady || !pendingNativeOpenTargets.length) {
    return;
  }
  const targets = pendingNativeOpenTargets;
  pendingNativeOpenTargets = [];
  targets.forEach((target) => sendRendererAction(target.type, target.payload));
};

const rebuildApplicationMenu = () => {
  const recentWorkspaceItems = shellState.recentWorkspaces.length > 0
    ? shellState.recentWorkspaces.map((workspacePath) => ({
      label: workspacePath,
      click: () => sendRendererAction('open-recent-workspace', { path: workspacePath }),
    }))
    : [{ label: 'Sin recientes', enabled: false }];

  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir workspace',
          accelerator: 'Ctrl+O',
          click: () => sendRendererAction('open-workspace'),
        },
        {
          label: 'Abrir reciente',
          submenu: recentWorkspaceItems,
        },
        { type: 'separator' },
        {
          label: 'Cerrar archivo actual',
          accelerator: 'Ctrl+W',
          click: () => sendRendererAction('close-active-file'),
        },
        {
          label: 'Guardar',
          accelerator: 'Ctrl+S',
          click: () => sendRendererAction('save-active'),
        },
        { type: 'separator' },
        {
          role: 'quit',
          label: 'Salir',
        },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Notebook',
      submenu: [
        {
          label: 'Ejecutar celda',
          accelerator: 'Ctrl+Enter',
          click: () => sendRendererAction('run-active-cell'),
        },
        {
          label: 'Interrumpir kernel',
          click: () => sendRendererAction('interrupt-kernel'),
        },
        {
          label: 'Reset kernel',
          click: () => sendRendererAction('reset-kernel'),
        },
        {
          label: 'Limpiar outputs',
          click: () => sendRendererAction('clear-outputs'),
        },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        {
          label: 'Toggle explorer',
          accelerator: 'Ctrl+B',
          click: () => sendRendererAction('toggle-explorer'),
        },
        {
          label: 'Toggle visualización',
          accelerator: 'Ctrl+Shift+V',
          click: () => sendRendererAction('toggle-visualization'),
        },
        {
          label: 'Toggle Agents panel',
          accelerator: 'Ctrl+Shift+M',
          click: () => sendRendererAction('toggle-mcp-panel'),
        },
        { type: 'separator' },
        {
          label: 'Reload shell',
          accelerator: 'F5',
          click: () => reloadRenderer('Reloading interface...'),
        },
        ...(isDev ? [{
          label: 'Toggle DevTools',
          accelerator: 'Ctrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        }] : []),
      ],
    },
    {
      label: 'Agents',
      submenu: [
        {
          label: 'Start Agents',
          click: () => sendRendererAction('mcp-start'),
        },
        {
          label: 'Stop Agents',
          click: () => sendRendererAction('mcp-stop'),
        },
        {
          label: 'Restart Agents',
          click: () => sendRendererAction('mcp-restart'),
        },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'About Inspyro',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Inspyro',
              message: `Inspyro Desktop ${app.getVersion()}`,
              detail: [
                'AI-native engineering workspace for calculations, notebooks and report generation.',
                'Agents can inspect a project, edit notebooks, run calculations and deliver DOCX/PDF reports.',
                `Backend: ${backendUrl || 'unavailable'}`,
                `Recent workspace: ${shellState.lastWorkspace || 'none'}`,
              ].join('\n'),
            });
          },
        },
        {
          label: 'Abrir API Docs',
          click: () => {
            if (!backendUrl) {
              return;
            }
            void openSafeExternal(`${backendUrl}/docs`).catch(() => {});
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const rememberWorkspace = (rawWorkspacePath) => {
  const workspacePath = sanitizeWorkspacePath(rawWorkspacePath);
  if (!workspacePath) {
    return;
  }

  shellState.lastWorkspace = workspacePath;
  shellState.recentWorkspaces = [
    workspacePath,
    ...shellState.recentWorkspaces.filter((entry) => entry !== workspacePath),
  ].slice(0, maxRecentWorkspaces);
  updateMainWindowTitle();
  scheduleShellStateWrite();
  rebuildApplicationMenu();
};

const closeSplashWindow = () => {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.destroy();
  splashWindow = null;
};

const clearRendererBootstrapTimeout = () => {
  if (!rendererBootstrapTimeout) {
    return;
  }
  clearTimeout(rendererBootstrapTimeout);
  rendererBootstrapTimeout = null;
};

const clearRendererAppReadyTimeout = () => {
  if (!rendererAppReadyTimeout) {
    return;
  }
  clearTimeout(rendererAppReadyTimeout);
  rendererAppReadyTimeout = null;
};

const clearRendererTimers = () => {
  clearRendererBootstrapTimeout();
  clearRendererAppReadyTimeout();
};

const resetRendererLifecycle = () => {
  rendererAppReady = false;
  mainWindowReady = false;
  rendererPhase = 'idle';
  rendererLastError = null;
  rendererEventQueue = [];
  clearRendererTimers();
};

const summarizeRendererFailure = (payload = rendererLastError) => {
  const lines = [
    `rendererPhase=${rendererPhase}`,
    `mainWindowReady=${mainWindowReady}`,
  ];

  if (payload?.phase) {
    lines.push(`phase=${payload.phase}`);
  }
  if (payload?.name) {
    lines.push(`name=${payload.name}`);
  }
  if (payload?.message) {
    lines.push(`message=${payload.message}`);
  }
  if (payload?.status) {
    lines.push(`status=${payload.status}`);
  }
  if (payload?.stack) {
    lines.push('');
    lines.push(String(payload.stack).split('\n').slice(0, 10).join('\n'));
  }

  return lines.join('\n');
};

const sendBootState = (stage, detail = '', extra = {}) => {
  bootState = {
    ...bootState,
    stage,
    detail,
    status: extra.status || 'loading',
    diagnostic: extra.diagnostic || '',
    actions: {
      canRetry: Boolean(extra.actions?.canRetry),
      canQuit: Boolean(extra.actions?.canQuit),
    },
  };
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  if (splashWindow.webContents.isLoadingMainFrame()) {
    return;
  }
  splashWindow.webContents.send('desktop:boot-stage', bootState);
};

const revealMainWindow = (detail = 'Inspyro ready') => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearRendererTimers();
  sendBootState('Ready', detail, {
    status: 'ready',
    diagnostic: '',
    actions: {
      canRetry: false,
      canQuit: false,
    },
  });
  updateMainWindowTitle();
  if (shellState.isMaximized) {
    mainWindow.maximize();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  setTimeout(closeSplashWindow, 250);
};

const flushRendererEventQueue = () => {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererAppReady) {
    return;
  }

  while (rendererEventQueue.length > 0) {
    const action = rendererEventQueue.shift();
    mainWindow.webContents.send('desktop:menu-action', action);
  }
};

const showSplashError = (stage, detail, diagnostic = '') => {
  sendBootState(stage, detail, {
    status: 'error',
    diagnostic,
    actions: {
      canRetry: true,
      canQuit: true,
    },
  });
};

const startRendererBootstrapWatch = () => {
  clearRendererBootstrapTimeout();
  rendererBootstrapTimeout = setTimeout(() => {
    rendererBootstrapTimeout = null;
    if (
      rendererPhase === 'renderer_bootstrap_ready'
      || rendererPhase === 'renderer_app_ready'
      || rendererPhase === 'renderer_app_failed'
    ) {
      return;
    }

    appendBackendLog('desktop', 'Timeout waiting for renderer_bootstrap_ready');
    showSplashError(
      'Renderer did not start',
      'The bundle loaded, but the renderer never confirmed startup.',
      summarizeRendererFailure({
        phase: 'renderer_bootstrap_timeout',
        message: 'renderer_bootstrap_ready did not arrive before the timeout.',
      }),
    );
  }, 8000);
};

const startRendererAppReadyWatch = () => {
  clearRendererAppReadyTimeout();
  rendererAppReadyTimeout = setTimeout(() => {
    rendererAppReadyTimeout = null;
    if (rendererPhase === 'renderer_app_ready' || rendererPhase === 'renderer_app_failed') {
      return;
    }

    appendBackendLog('desktop', 'Timeout waiting for renderer_app_ready');
    showSplashError(
      'Renderer failed to start',
      'The renderer executed JavaScript, but the application never mounted.',
      summarizeRendererFailure({
        phase: 'renderer_app_ready_timeout',
        message: 'renderer_app_ready or renderer_app_failed did not arrive before the timeout.',
      }),
    );
  }, 10000);
};

const handleRendererPhaseReport = (phase, payload = {}) => {
  rendererPhase = phase || 'unknown';

  if (phase === 'renderer_unhandled_error') {
    rendererLastError = payload;
    appendBackendLog('renderer', `Unhandled error: ${payload?.message || 'sin detalle'}`);
    return;
  }

  if (phase === 'renderer_bootstrap_ready') {
    clearRendererBootstrapTimeout();
    appendBackendLog('desktop', 'Renderer reporto bootstrap_ready');
    sendBootState('Mounting interface', 'The renderer loaded JavaScript and is mounting React...');
    startRendererAppReadyWatch();
    return;
  }

  if (phase === 'renderer_app_failed') {
    rendererLastError = payload;
    clearRendererAppReadyTimeout();
    appendBackendLog('desktop', `Renderer reporto app_failed: ${payload?.message || 'sin detalle'}`);
    showSplashError(
      'Renderer failed to start',
      payload?.message || 'The main interface could not mount.',
      summarizeRendererFailure(payload),
    );
    revealMainWindow('Renderer failed to start');
    return;
  }

  if (phase === 'renderer_app_ready') {
    clearRendererAppReadyTimeout();
    rendererAppReady = true;
    appendBackendLog('desktop', 'Renderer reporto app_ready');
    flushRendererEventQueue();
    flushNativeOpenTargets();
    revealMainWindow('Inspyro ready');
  }
};

const reloadRenderer = (detail = 'Reloading interface...') => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  resetRendererLifecycle();
  sendBootState('Starting renderer', detail, {
    status: 'loading',
    diagnostic: '',
    actions: {
      canRetry: false,
      canQuit: true,
    },
  });
  mainWindow.reload();
};

// Compatibility shims while the last startup listeners still route through
// the previous helper names. They no longer trigger blind reveal paths.
const clearRendererRevealFallback = () => {};

const scheduleRendererRevealFallback = ({ requireRendererReady = true } = {}) => {
  if (requireRendererReady) {
    startRendererAppReadyWatch();
    return;
  }
  startRendererBootstrapWatch();
};

const maybeRevealMainWindow = () => {
  if (rendererAppReady) {
    revealMainWindow('Inspyro ready');
  }
};

const openSafeExternal = async (targetUrl) => {
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error('Protocolo externo no permitido');
  }
  await shell.openExternal(parsed.toString());
};

const openSafePath = async (targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new Error('Ruta vacia o invalida');
  }

  const resolvedPath = path.resolve(targetPath.trim());
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Ruta no encontrada: ${resolvedPath}`);
  }

  const openResult = await shell.openPath(resolvedPath);
  if (typeof openResult === 'string' && openResult.trim()) {
    throw new Error(openResult.trim());
  }
  return resolvedPath;
};

const emitNativeNotification = (payload = {}) => {
  if (!Notification.isSupported()) {
    return false;
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
    return false;
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!title || !body) {
    return false;
  }

  const notification = new Notification({
    title,
    body,
  });
  notification.show();
  return true;
};

const createSplashWindow = async () => {
  const windowIcon = resolveWindowIconPath();
  splashWindow = new BrowserWindow({
    width: 480,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    frame: false,
    show: false,
    backgroundColor: '#0d1117',
    skipTaskbar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.removeMenu();
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });
  await splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  sendBootState(bootState.stage, bootState.detail, bootState);
};

const wireWindowSecurity = (windowInstance, allowedUrls) => {
  const allowedOrigins = allowedUrls.map((url) => new URL(url).origin);
  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedOrigins.some((origin) => url.startsWith(origin))) {
      return { action: 'allow' };
    }
    void openSafeExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  windowInstance.webContents.on('will-navigate', (event, url) => {
    if (allowedOrigins.some((origin) => url.startsWith(origin))) {
      return;
    }
    event.preventDefault();
    void openSafeExternal(url).catch(() => {});
  });
};

const killProcessTree = async (pid) => new Promise((resolve) => {
  if (!pid) {
    resolve();
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    resolve();
    return;
  }

  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      // Ignore if the process already exited.
    }
    resolve();
  }, 1500);
});

const shutdownBackendSidecar = async () => {
  const child = backendProcess;
  backendProcess = null;
  if (!child || child.exitCode !== null) {
    return;
  }
  await killProcessTree(child.pid);
};

const spawnBackendSidecar = async () => {
  const pythonExecutable = resolvePackagedPythonExecutable();
  if (!pythonExecutable) {
    throw new Error(
      'No se encontró el runtime Python empaquetado. Define INSPYRO_DESKTOP_PYTHON_HOME al generar el instalador.'
    );
  }

  const backendRoot = path.join(process.resourcesPath, 'backend');
  const backendEntry = path.join(backendRoot, 'main.py');
  const frontendBuildDir = path.join(process.resourcesPath, 'frontend-build');
  if (!fs.existsSync(backendEntry)) {
    throw new Error(`No se encontró backend/main.py en ${backendRoot}`);
  }
  if (!fs.existsSync(path.join(frontendBuildDir, 'index.html'))) {
    throw new Error(`No se encontró el frontend compilado en ${frontendBuildDir}`);
  }

  const requestedPort = Number(process.env.INSPYRO_BACKEND_PORT || 0);
  const port = Number.isFinite(requestedPort) && requestedPort > 0
    ? requestedPort
    : await findAvailablePort(18000);
  backendUrl = `http://${packagedBackendHost}:${port}`;

  const env = {
    ...process.env,
    INSPYRO_BACKEND_HOST: packagedBackendHost,
    INSPYRO_BACKEND_PORT: String(port),
    INSPYRO_DESKTOP: '1',
    INSPYRO_SERVE_FRONTEND: '1',
    INSPYRO_FRONTEND_BUILD_DIR: frontendBuildDir,
    INSPYRO_DEV_RELOAD: '0',
    PYTHONUNBUFFERED: '1',
  };

  sendBootState('Starting local backend', `Candidate port: ${port}`);
  backendProcess = spawn(pythonExecutable, [backendEntry], {
    cwd: backendRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (chunk) => appendBackendLog('stdout', chunk));
  backendProcess.stderr?.on('data', (chunk) => appendBackendLog('stderr', chunk));
  backendProcess.once('exit', (code, signal) => {
    appendBackendLog('system', `Backend sidecar terminó (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    if (!isShuttingDown) {
      dialog.showErrorBox(
        'Inspyro desktop perdió el backend',
        `El backend local terminó inesperadamente.\n\nEtapa: ${bootState.stage}\n\n${summarizeBackendLogs()}`
      );
      app.quit();
    }
  });

  sendBootState('Waiting for backend health', backendUrl);
  await waitForUrl(`${backendUrl}/health`, 45000);
  return backendUrl;
};

const createMainWindow = async () => {
  const initialBounds = sanitizeWindowBounds(shellState.windowBounds);
  const windowIcon = resolveWindowIconPath();

  resetRendererLifecycle();
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 1200,
    minHeight: 780,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    title: 'Inspyro',
    ...(windowIcon ? { icon: windowIcon } : {}),
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  wireWindowSecurity(mainWindow, [appUrl, backendUrl]);
  mainWindow.on('move', rememberWindowState);
  mainWindow.on('resize', rememberWindowState);
  mainWindow.on('maximize', rememberWindowState);
  mainWindow.on('unmaximize', rememberWindowState);
  mainWindow.on('close', rememberWindowState);
  mainWindow.on('unresponsive', () => {
    appendBackendLog('desktop', 'Main window unresponsive');
    if (!rendererAppReady) {
      showSplashError(
      'Renderer unresponsive',
      'The main window stopped responding before startup completed.',
        summarizeRendererFailure({
          phase: 'renderer_unresponsive',
          message: 'Electron reporto una ventana no responsiva durante el arranque.',
        }),
      );
    }
  });
  mainWindow.on('closed', () => {
    clearRendererTimers();
    mainWindow = null;
  });
  mainWindow.webContents.on('did-start-loading', () => {
    appendBackendLog('desktop', 'Main window did-start-loading');
  });
  mainWindow.webContents.on('dom-ready', () => {
    appendBackendLog('desktop', 'Main window dom-ready');
  });
  mainWindow.webContents.on('console-message', (event) => {
    const details = (event && typeof event === 'object')
      ? event
      : {};
    appendBackendLog(
      'renderer',
      `[console:${details.level ?? 'unknown'}] ${details.sourceId || 'unknown'}:${details.lineNumber || 0} ${details.message || ''}`,
    );
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appendBackendLog('desktop', `Main window did-fail-load code=${errorCode} description=${errorDescription} url=${validatedURL}`);
    if (!isMainFrame) {
      return;
    }

    showSplashError(
      'Renderer could not load',
      errorDescription || 'Electron could not load the main interface.',
      summarizeRendererFailure({
        phase: 'did-fail-load',
        message: errorDescription || 'did-fail-load',
        status: errorCode,
      }),
    );
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendBackendLog('desktop', `Render process gone reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode ?? 'unknown'}`);
    rendererLastError = {
      phase: 'render-process-gone',
      message: details?.reason || 'Renderer process gone',
      status: details?.exitCode ?? null,
    };
    if (!rendererAppReady) {
      showSplashError(
      'Renderer exited unexpectedly',
      'The renderer process exited before startup completed.',
        summarizeRendererFailure(rendererLastError),
      );
    }
  });
  mainWindow.webContents.once('did-finish-load', () => {
    appendBackendLog('desktop', 'Main window did-finish-load');
    sendBootState('Connecting renderer', 'Waiting for the interface to confirm readiness...');
    scheduleRendererRevealFallback({
      delayMs: 5000,
      requireRendererReady: false,
      detail: 'Renderer not confirmed yet; showing the window...',
      logMessage: 'No llegó renderer-ready a tiempo; revelando ventana por fallback',
    });
  });
  mainWindow.webContents.once('did-finish-load', () => {
    rendererPhase = 'document_loaded';
    sendBootState('Starting renderer', 'Waiting for renderer bootstrap confirmation...', {
      status: 'loading',
      diagnostic: '',
      actions: {
        canRetry: false,
        canQuit: true,
      },
    });
    startRendererBootstrapWatch();
  });
  mainWindow.once('ready-to-show', () => {
    appendBackendLog('desktop', 'Main window ready-to-show');
    mainWindowReady = true;
    clearRendererRevealFallback();
    maybeRevealMainWindow();
  });

  await mainWindow.loadURL(appUrl);
};

const bootstrapRuntime = async () => {
  if (isDev) {
    backendUrl = devBackendUrl;
    appUrl = devFrontendUrl;

    sendBootState('Waiting for backend health', backendUrl);
    await waitForUrl(`${backendUrl}/health`, 30000);

    sendBootState('Loading interface', appUrl);
    await waitForUrl(appUrl, 30000);
    return;
  }

  appUrl = await spawnBackendSidecar();
  sendBootState('Loading interface', appUrl);
};

const initializeDesktop = async () => {
  loadShellState();
  rebuildApplicationMenu();
  await createSplashWindow();

  try {
    sendBootState('Initializing shell', isDev ? 'Development mode' : 'Production mode');
    await bootstrapRuntime();
    await createMainWindow();
  } catch (error) {
    await shutdownBackendSidecar();
    closeSplashWindow();
    dialog.showErrorBox(
      'Could not start Inspyro desktop',
      `${error.message}\n\nEtapa: ${bootState.stage}\n\n${summarizeBackendLogs()}`
    );
    app.quit();
  }
};

app.on('second-instance', (_event, commandLine = []) => {
  rememberNativeOpenTargets(commandLine);
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

ipcMain.handle('desktop:openExternal', async (_event, targetUrl) => {
  await openSafeExternal(targetUrl);
  return true;
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  rememberNativeOpenTargets([filePath]);
});

app.on('open-url', (event, targetUrl) => {
  event.preventDefault();
  rememberNativeOpenTargets([targetUrl]);
});

ipcMain.handle('desktop:openPath', async (_event, targetPath) => {
  return openSafePath(targetPath);
});

ipcMain.on('desktop:open-devtools', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.on('desktop:reload-renderer', () => {
  reloadRenderer('Restarting renderer...');
});

ipcMain.on('desktop:renderer-phase', (_event, { phase, payload } = {}) => {
  appendBackendLog('desktop', `Renderer phase -> ${phase || 'unknown'}`);
  handleRendererPhaseReport(phase, payload || {});
});

ipcMain.on('desktop:splash-action', (_event, action) => {
  if (action === 'retry') {
    reloadRenderer('Retrying renderer...');
    return;
  }
  if (action === 'quit') {
    app.quit();
  }
});

ipcMain.on('desktop:renderer-ready', () => {
  appendBackendLog('desktop', 'Renderer reportó ready');
  handleRendererPhaseReport('renderer_app_ready', { legacy: true });
});

ipcMain.on('desktop:report-workspace', (_event, workspacePath) => {
  rememberWorkspace(workspacePath);
});

ipcMain.on('desktop:notify', (_event, payload) => {
  emitNativeNotification(payload);
});

if (singleInstanceLock) {
  app.whenReady().then(async () => {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient('inspyro');
    }
    rememberNativeOpenTargets(process.argv);
    await initializeDesktop();
    flushNativeOpenTargets();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isShuttingDown = true;
  clearTimeout(stateWriteTimer);
  writeShellState();
});

app.on('will-quit', (event) => {
  if (!backendProcess || backendProcess.exitCode !== null) {
    return;
  }

  event.preventDefault();
  shutdownBackendSidecar()
    .catch(() => {})
    .finally(() => {
      backendProcess = null;
      app.exit();
    });
});
