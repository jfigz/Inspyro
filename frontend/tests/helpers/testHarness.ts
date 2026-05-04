import { test as base, expect } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readHarnessManifest } = require('./inspyroHarness');

const IGNORABLE_CONSOLE_ERRORS = [
  /ResizeObserver loop limit exceeded/i,
];

const isIgnorableConsoleError = (text: string) => (
  IGNORABLE_CONSOLE_ERRORS.some((pattern) => pattern.test(text))
);

type HarnessManifest = {
  runId: string;
  repoRoot: string;
  sandboxRoot: string;
  manifestPath: string;
  appStateDir: string;
  stateFile: string;
  projectsDir: string;
  pythonExecutable: string;
  ports: {
    frontend: number;
    backend: number;
    mcp: number;
  };
  urls: {
    frontend: string;
    backend: string;
    mcp: string;
  };
  workspaces: {
    seeded: string;
    alt: string;
    recent: string;
  };
  files: {
    mainPy: string;
    notesMd: string;
    loadsCsv: string;
    reportNotebook: string;
    templateDocx: string;
    altNotes: string;
    recentNotebook: string;
  };
};

export const test = base.extend<{
  harness: HarnessManifest;
  consoleErrors: string[];
}>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      } catch {
        // ignore storage access errors in the sandbox harness
      }
    });

    await use(page);
  },

  harness: async ({}, use) => {
    const manifest = readHarnessManifest(process.env.INSPYRO_E2E_MANIFEST) as HarnessManifest;
    await use(manifest);
  },

  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isIgnorableConsoleError(text)) return;
      errors.push(`console.error: ${text}`);
    });

    page.on('pageerror', (error) => {
      const text = String(error?.message || error || '');
      if (isIgnorableConsoleError(text)) return;
      errors.push(`pageerror: ${text}`);
    });

    await use(errors);

    expect(
      errors,
      errors.length > 0 ? `Console errors detectados:\n${errors.join('\n')}` : undefined,
    ).toEqual([]);
  },
});

export { expect };
