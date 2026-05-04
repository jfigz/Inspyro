const http = require('http');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const desktopRoot = path.resolve(__dirname, '..');

function resolvePlaywrightElectron() {
  return require(path.join(repoRoot, 'frontend', 'node_modules', 'playwright'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(targetUrl, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(targetUrl, (response) => {
          response.resume();
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
            resolve();
            return;
          }
          reject(new Error(`HTTP ${response.statusCode || 'unknown'}`));
        });
        request.on('error', reject);
      });
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Timeout esperando ${targetUrl}`);
}

async function waitForMainWindow(electronApp, timeoutMs = 20000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const windows = electronApp.windows();
    const mainWindow = windows.find((windowHandle) => {
      const windowUrl = windowHandle.url();
      return windowUrl.startsWith('http://127.0.0.1:3000') || windowUrl.startsWith('http://localhost:3000');
    });

    if (mainWindow) {
      return mainWindow;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('No aparecio la ventana principal Electron dentro del timeout.');
}

async function main() {
  await waitForUrl('http://127.0.0.1:3000');
  await waitForUrl('http://127.0.0.1:8000/health');

  const { _electron: electron } = resolvePlaywrightElectron();
  const electronExecutablePath = require(path.join(desktopRoot, 'node_modules', 'electron'));
  const electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: ['.'],
    cwd: desktopRoot,
    env: {
      ...process.env,
      INSPYRO_DESKTOP_DEV_URL: 'http://127.0.0.1:3000',
      INSPYRO_DESKTOP_DEV_BACKEND_URL: 'http://127.0.0.1:8000',
    },
  });

  try {
    const mainWindow = await waitForMainWindow(electronApp);
    await mainWindow.waitForLoadState('domcontentloaded');
    await mainWindow.waitForTimeout(2500);

    const hasFatalScreen = await mainWindow.locator('[data-testid="renderer-fatal-screen"]').count();
    const hasVisibleShell = await mainWindow.locator('.desktop-titlebar, .main-layout, [data-testid="project-launcher"]').count();
    const rootHtml = await mainWindow.locator('#root').innerHTML().catch(() => '');
    const bodyText = await mainWindow.locator('body').innerText().catch(() => '');

    if (hasFatalScreen === 0 && hasVisibleShell === 0) {
      throw new Error(
        [
          'Smoke desktop fallido: la ventana principal no mostro shell ni fallback fatal.',
          `bodyText=${bodyText.slice(0, 300)}`,
          `rootHtml=${rootHtml.slice(0, 600)}`,
        ].join('\n'),
      );
    }

    process.stdout.write(
      `${hasFatalScreen > 0 ? 'Renderer fatal fallback visible' : 'Renderer app visible'}\n`,
    );
  } finally {
    electronApp.close().catch(() => {});
    setTimeout(() => process.exit(0), 150);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
