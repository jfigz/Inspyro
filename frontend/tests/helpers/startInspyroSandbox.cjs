const { spawn, spawnSync } = require('child_process');
const process = require('process');
const path = require('path');

const { readHarnessManifest } = require('./inspyroHarness');

const manifestPath = process.argv[2] || process.env.INSPYRO_E2E_MANIFEST;
const manifest = readHarnessManifest(manifestPath);
const children = [];

function log(prefix, message) {
  process.stdout.write(`[${prefix}] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        log(label, `ready ${url}`);
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  throw new Error(`${label} no respondió a tiempo: ${lastError ? lastError.message : 'timeout'}`);
}

function freePort(port) {
  if (process.platform === 'win32') {
    const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    const lines = String(netstat.stdout || '').split(/\r?\n/);
    const pids = new Set();
    lines.forEach((line) => {
      if (!line.includes(`:${port}`) || !line.includes('LISTENING')) return;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && Number(pid) !== process.pid) {
        pids.add(pid);
      }
    });
    [...pids].forEach((pid) => {
      spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
    });
    return;
  }

  const lsof = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
  String(lsof.stdout || '')
    .split(/\s+/)
    .filter(Boolean)
    .forEach((pid) => {
      if (/^\d+$/.test(pid)) {
        spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      }
    });
}

function wireChildLogs(child, prefix) {
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log(prefix, line));
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log(`${prefix}:err`, line));
    });
  }
}

function trackChild(child, label) {
  children.push(child);
  wireChildLogs(child, label);
  child.on('exit', (code, signal) => {
    log(label, `exit code=${code} signal=${signal || 'none'}`);
    if (!shuttingDown && code !== 0) {
      shutdown(1);
    }
  });
  return child;
}

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  children.forEach((child) => {
    if (!child || child.killed) return;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  });

  setTimeout(() => {
    children.forEach((child) => {
      if (!child || child.killed) return;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    });
    process.exit(exitCode);
  }, 4000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  log('harness', `uncaughtException ${error.stack || error.message}`);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  log('harness', `unhandledRejection ${reason && reason.stack ? reason.stack : reason}`);
  shutdown(1);
});

async function main() {
  freePort(manifest.ports.frontend);
  freePort(manifest.ports.backend);
  freePort(manifest.ports.mcp);

  const backendEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    INSPYRO_TEST_MODE: '1',
    INSPYRO_APP_STATE_DIR: manifest.appStateDir,
    INSPYRO_DEFAULT_PROJECTS_ROOT: manifest.projectsDir,
    INSPYRO_MCP_PORT: String(manifest.ports.mcp),
    INSPYRO_MCP_HOST: '127.0.0.1',
    INSPYRO_BACKEND_URL: manifest.urls.backend,
    INSPYRO_BACKEND_WS_URL: `ws://127.0.0.1:${manifest.ports.backend}/ws`,
  };

  const backend = trackChild(
    spawn(
      manifest.pythonExecutable,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(manifest.ports.backend)],
      {
        cwd: path.join(manifest.repoRoot, 'backend'),
        env: backendEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ),
    'backend'
  );

  if (!backend.pid) {
    throw new Error('No se pudo iniciar el backend.');
  }

  await waitForUrl(`${manifest.urls.backend}/health`, 180000, 'backend');

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const frontendEnv = {
    ...process.env,
    BROWSER: 'none',
    PORT: String(manifest.ports.frontend),
    REACT_APP_API_BASE: manifest.urls.backend,
    REACT_APP_WS_URL: `ws://127.0.0.1:${manifest.ports.backend}/ws`,
    REACT_APP_LSP_WS_URL: `ws://127.0.0.1:${manifest.ports.backend}/ws/lsp`,
  };

  const frontend = trackChild(
    spawn(
      npmCommand,
      ['start'],
      {
        cwd: path.join(manifest.repoRoot, 'frontend'),
        env: frontendEnv,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ),
    'frontend'
  );

  if (!frontend.pid) {
    throw new Error('No se pudo iniciar el frontend.');
  }

  await waitForUrl(manifest.urls.frontend, 240000, 'frontend');
  log('harness', `sandbox ready runId=${manifest.runId}`);
}

main().catch((error) => {
  log('harness', `startup failed ${error.stack || error.message}`);
  shutdown(1);
});
