const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  cleanupHarnessSandbox,
  createHarnessManifest,
  ensureHarnessSandbox,
  resolvePythonExecutable,
} = require('./inspyroHarness');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const outputRoot = path.join(repoRoot, 'output', 'playwright', 'harness');
const harnessStdoutPath = path.join(outputRoot, 'playwright-e2e-harness.out.log');
const harnessStderrPath = path.join(outputRoot, 'playwright-e2e-harness.err.log');
const startupTimeoutMs = 6 * 60 * 1000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  throw new Error(`Harness no respondió a tiempo en ${url}: ${lastError ? lastError.message : 'timeout'}`);
}

async function waitForHarnessReady(child, timeoutMs) {
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const onStdout = (chunk) => {
      const text = String(chunk || '');
      if (text.includes('sandbox ready runId=')) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Harness terminó antes de quedar listo (exit=${code ?? 'unknown'}).`));
    };

    const timer = setInterval(() => {
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(new Error('Harness no emitió "sandbox ready" a tiempo.'));
      }
    }, 500);

    const cleanup = () => {
      clearInterval(timer);
      child.off('exit', onExit);
      if (child.stdout) {
        child.stdout.off('data', onStdout);
      }
    };

    if (child.stdout) {
      child.stdout.on('data', onStdout);
    }
    child.on('exit', onExit);
  });
}

function pipeChildOutput(child, stdoutPath, stderrPath) {
  ensureDir(path.dirname(stdoutPath));
  const stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'w' });
  const stderrStream = fs.createWriteStream(stderrPath, { flags: 'w' });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => stdoutStream.write(chunk));
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => stderrStream.write(chunk));
  }

  return () => {
    stdoutStream.end();
    stderrStream.end();
  };
}

function killChild(child) {
  if (!child || child.killed) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

function waitForChildExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve();
    };
    const onExit = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    child.on('exit', onExit);
  });
}

function resolvePlaywrightExecutable() {
  const cliEntry = path.join(frontendRoot, 'node_modules', 'playwright', 'cli.js');
  if (fs.existsSync(cliEntry)) {
    return { file: process.execPath, args: [cliEntry] };
  }

  const candidate = process.platform === 'win32'
    ? path.join(frontendRoot, 'node_modules', '.bin', 'playwright.cmd')
    : path.join(frontendRoot, 'node_modules', '.bin', 'playwright');

  if (fs.existsSync(candidate)) {
    return { file: candidate, args: [] };
  }

  return {
    file: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['playwright'],
  };
}

function parseArgs(argv) {
  const keepHarness = argv.includes('--keep-harness');
  const forwardedArgs = argv.filter((arg) => arg !== '--keep-harness');
  return { keepHarness, forwardedArgs };
}

function showHelp() {
  process.stdout.write(
    [
      'Usage: node tests/helpers/runPlaywrightSuite.cjs [playwright args] [--keep-harness]',
      '',
      'Examples:',
      '  node tests/helpers/runPlaywrightSuite.cjs',
      '  node tests/helpers/runPlaywrightSuite.cjs responsive-smoke.spec.ts',
      '  node tests/helpers/runPlaywrightSuite.cjs --headed',
      '  node tests/helpers/runPlaywrightSuite.cjs --keep-harness responsive-smoke.spec.ts',
      '',
    ].join('\n')
  );
}

async function main() {
  const { keepHarness, forwardedArgs } = parseArgs(process.argv.slice(2));

  if (forwardedArgs.includes('--help') || forwardedArgs.includes('-h')) {
    showHelp();
    return;
  }

  const manifest = ensureHarnessSandbox(createHarnessManifest({
    repoRoot,
    pythonExecutable: resolvePythonExecutable(repoRoot),
  }));

  const harness = spawn(
    process.execPath,
    [path.join(frontendRoot, 'tests', 'helpers', 'startInspyroSandbox.cjs'), manifest.manifestPath],
    {
      cwd: frontendRoot,
      env: {
        ...process.env,
        INSPYRO_E2E_MANIFEST: manifest.manifestPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let closeStreams = () => {};
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    killChild(harness);
    closeStreams();
    if (!keepHarness) {
      cleanupHarnessSandbox(manifest);
    }
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));

  closeStreams = pipeChildOutput(harness, harnessStdoutPath, harnessStderrPath);

  harness.on('exit', (code) => {
    if (shuttingDown) return;
    closeStreams();
    if (!keepHarness) {
      cleanupHarnessSandbox(manifest);
    }
    process.exit(code || 1);
  });

  await waitForHarnessReady(harness, startupTimeoutMs);

  const playwright = resolvePlaywrightExecutable();
  const playwrightArgs = playwright.args.concat(['test', '--project=chromium'], forwardedArgs);
  process.stdout.write(
    `Playwright E2E sandbox listo: ${manifest.urls.frontend} (${manifest.runId})\n`
  );
  process.stdout.write(`Harness logs: ${harnessStdoutPath}\n`);

  const testProcess = spawn(playwright.file, playwrightArgs, {
    cwd: frontendRoot,
    env: {
      ...process.env,
      INSPYRO_E2E_MANIFEST: manifest.manifestPath,
      INSPYRO_E2E_SKIP_WEBSERVER: '1',
    },
    stdio: 'inherit',
  });

  testProcess.on('exit', (code) => {
    void (async () => {
      shuttingDown = true;
      closeStreams();
      killChild(harness);
      await waitForChildExit(harness);
      if (!keepHarness) {
        cleanupHarnessSandbox(manifest);
      }
      process.exit(code || 0);
    })();
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
