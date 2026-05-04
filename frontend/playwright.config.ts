import path from 'path';
import { defineConfig, devices } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  createHarnessManifest,
  ensureHarnessSandbox,
  readHarnessManifest,
  resolvePythonExecutable,
} = require('./tests/helpers/inspyroHarness');

declare const process: any;

const repoRoot = path.resolve(__dirname, '..');
const manifest = process.env.INSPYRO_E2E_MANIFEST
  ? readHarnessManifest(process.env.INSPYRO_E2E_MANIFEST)
  : ensureHarnessSandbox(createHarnessManifest({
    repoRoot,
    pythonExecutable: resolvePythonExecutable(repoRoot),
  }));

process.env.INSPYRO_E2E_MANIFEST = manifest.manifestPath;
const nodeCommand = `"${process.execPath}"`;
const skipWebServer = process.env.INSPYRO_E2E_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/helpers/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180 * 1000,
  expect: {
    timeout: 20 * 1000,
  },
  outputDir: path.join(repoRoot, 'output', 'playwright', 'artifacts'),
  reporter: [
    ['html', { outputFolder: path.join(repoRoot, 'output', 'playwright', 'report'), open: 'never' }],
    ['list'],
  ],
  globalTeardown: require.resolve('./tests/helpers/globalTeardown.cjs'),
  use: {
    baseURL: manifest.urls.frontend,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
      command: `${nodeCommand} tests/helpers/startInspyroSandbox.cjs "${manifest.manifestPath}"`,
      cwd: __dirname,
      url: manifest.urls.frontend,
      reuseExistingServer: false,
      timeout: 360 * 1000,
      env: {
        ...process.env,
        INSPYRO_E2E_MANIFEST: manifest.manifestPath,
      },
    },
});
