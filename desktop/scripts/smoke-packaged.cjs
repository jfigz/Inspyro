const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const desktopRoot = path.resolve(__dirname, '..');
const unpackedRoot = path.join(desktopRoot, 'dist', 'win-unpacked');
const packagedExe = path.join(unpackedRoot, process.platform === 'win32' ? 'Inspyro.exe' : 'Inspyro');
const resourcesRoot = path.join(unpackedRoot, 'resources');
const pythonExecutable = path.join(resourcesRoot, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python');

const requiredPythonImports = [
  'fastapi',
  'uvicorn',
  'jupyter_client',
  'ipykernel',
  'docx',
  'fitz',
  'watchdog',
  'pylsp',
  'fastmcp',
  'mcp',
];

function resolvePlaywrightElectron() {
  return require(path.join(repoRoot, 'frontend', 'node_modules', 'playwright'));
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`No se encontro ${label}: ${targetPath}`);
  }
}

function verifyPackagedResources() {
  assertExists(packagedExe, 'ejecutable empaquetado');
  assertExists(path.join(resourcesRoot, 'backend', 'main.py'), 'backend staged');
  assertExists(path.join(resourcesRoot, 'frontend-build', 'index.html'), 'frontend build staged');
  assertExists(pythonExecutable, 'runtime Python staged');
}

function verifyPythonImports() {
  const source = [
    'import importlib, json',
    `imports = ${JSON.stringify(requiredPythonImports)}`,
    'missing = []',
    'for name in imports:',
    '    try:',
    '        importlib.import_module(name)',
    '    except Exception as exc:',
    '        missing.append({"module": name, "error": f"{type(exc).__name__}: {exc}"})',
    'print(json.dumps({"missing": missing}))',
  ].join('\n');
  const result = spawnSync(pythonExecutable, ['-c', source], {
    cwd: resourcesRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONNOUSERSITE: '1',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`No se pudo verificar Python staged:\n${result.stderr || result.stdout}`);
  }
  const payload = JSON.parse((result.stdout || '').trim() || '{"missing": []}');
  if (payload.missing?.length) {
    throw new Error(
      [
        'Runtime Python staged incompleto:',
        ...payload.missing.map((item) => `- ${item.module}: ${item.error}`),
      ].join('\n'),
    );
  }
}

async function waitForMainWindow(electronApp, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const windows = electronApp.windows();
    const mainWindow = windows.find((windowHandle) => {
      const windowUrl = windowHandle.url();
      return /^https?:\/\/(127\.0\.0\.1|localhost):\d+\//.test(windowUrl);
    });

    if (mainWindow) {
      return mainWindow;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('No aparecio la ventana principal empaquetada dentro del timeout.');
}

async function verifyRenderer(mainWindow) {
  await mainWindow.waitForLoadState('domcontentloaded');
  await mainWindow.waitForTimeout(2500);

  const hasFatalScreen = await mainWindow.locator('[data-testid="renderer-fatal-screen"]').count();
  const hasVisibleShell = await mainWindow.locator('.desktop-titlebar, .main-layout, [data-testid="project-launcher"]').count();
  const rootHtml = await mainWindow.locator('#root').innerHTML().catch(() => '');
  const bodyText = await mainWindow.locator('body').innerText().catch(() => '');

  if (hasFatalScreen > 0) {
    throw new Error(`Renderer fatal fallback visible:\n${bodyText.slice(0, 800)}`);
  }

  if (hasVisibleShell === 0) {
    throw new Error(
      [
        'Smoke packaged fallido: la ventana principal no mostro shell visible.',
        `bodyText=${bodyText.slice(0, 300)}`,
        `rootHtml=${rootHtml.slice(0, 600)}`,
      ].join('\n'),
    );
  }
}

async function verifyBackendHealth(mainWindow) {
  const health = await mainWindow.evaluate(async () => {
    const response = await fetch(new URL('/health', window.location.href).toString());
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null),
    };
  });
  if (!health.ok) {
    throw new Error(`Health empaquetado fallo: HTTP ${health.status}`);
  }
}

async function verifyLspSocket(mainWindow) {
  const result = await mainWindow.evaluate(async () => {
    const wsUrl = new URL('/ws/lsp', window.location.href);
    wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    return new Promise((resolve) => {
      const socket = new WebSocket(wsUrl.toString());
      let opened = false;
      let messageReceived = false;
      const timer = window.setTimeout(() => {
        socket.close();
        resolve({ ok: opened, opened, messageReceived, closeCode: socket.readyState === WebSocket.CLOSED ? socket.closeCode : null });
      }, 2500);

      socket.onopen = () => {
        opened = true;
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            processId: null,
            rootUri: null,
            capabilities: {},
          },
        }));
      };
      socket.onmessage = () => {
        messageReceived = true;
        window.clearTimeout(timer);
        socket.close();
        resolve({ ok: true, opened, messageReceived, closeCode: null });
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        resolve({ ok: false, opened, messageReceived, closeCode: null });
      };
      socket.onclose = (event) => {
        if (messageReceived) {
          return;
        }
        window.clearTimeout(timer);
        resolve({ ok: opened && event.code !== 1011, opened, messageReceived, closeCode: event.code, reason: event.reason });
      };
    });
  });

  if (!result.ok) {
    throw new Error(`LSP packaged smoke fallo: ${JSON.stringify(result)}`);
  }
}

async function verifyMcpLifecycle(mainWindow) {
  const result = await mainWindow.evaluate(async () => {
    const startResponse = await fetch(new URL('/api/mcp/start', window.location.href).toString(), { method: 'POST' });
    const startPayload = await startResponse.json().catch(() => null);
    const stopResponse = await fetch(new URL('/api/mcp/stop', window.location.href).toString(), { method: 'POST' });
    const stopPayload = await stopResponse.json().catch(() => null);
    return {
      startStatus: startResponse.status,
      startPayload,
      stopStatus: stopResponse.status,
      stopPayload,
    };
  });

  if (!['started', 'already_running'].includes(result.startPayload?.status)) {
    throw new Error(`MCP packaged smoke fallo: ${JSON.stringify(result)}`);
  }
}

async function main() {
  verifyPackagedResources();
  verifyPythonImports();

  const { _electron: electron } = resolvePlaywrightElectron();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspyro-packaged-smoke-'));
  const electronApp = await electron.launch({
    executablePath: packagedExe,
    args: [`--user-data-dir=${userDataDir}`],
    cwd: unpackedRoot,
    env: {
      ...process.env,
      INSPYRO_MCP_PORT: process.env.INSPYRO_MCP_PORT || '8100',
    },
  });

  try {
    const mainWindow = await waitForMainWindow(electronApp);
    await verifyRenderer(mainWindow);
    await verifyBackendHealth(mainWindow);
    await verifyLspSocket(mainWindow);
    await verifyMcpLifecycle(mainWindow);

    const hasDesktopBridge = await mainWindow.evaluate(() => (
      Boolean(window.inspyroDesktop?.isDesktop)
      && typeof window.inspyroDesktop.openPath === 'function'
      && typeof window.inspyroDesktop.onMenuAction === 'function'
    ));
    if (!hasDesktopBridge) {
      throw new Error('Bridge desktop window.inspyroDesktop incompleto en build empaquetado.');
    }

    process.stdout.write('Packaged desktop smoke OK\n');
  } finally {
    await electronApp.close().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
