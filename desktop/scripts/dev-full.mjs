import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const resolveNpmInvocation = () => {
  const npmExecPath = process.env.npm_execpath;
  if (process.platform === 'win32' && npmExecPath && existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    };
  }

  return {
    command: npmCommand,
    args: [],
  };
};

const resolveElectronCommand = () => {
  if (process.platform === 'win32') {
    const windowsBinary = path.join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (existsSync(windowsBinary)) {
      return windowsBinary;
    }
  }

  return path.join(
    desktopDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );
};

const spawnInherited = (command, args, options = {}) => {
  return spawn(command, args, {
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
    ...options,
  });
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
        reject(new Error(`Timeout esperando ${targetUrl}`));
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

const resolveBackendPython = () => {
  const explicit = process.env.INSPYRO_DESKTOP_DEV_PYTHON;
  if (explicit) {
    return explicit;
  }

  const candidates = [
    path.join(repoRoot, 'venv_inspyro', 'Scripts', 'python.exe'),
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    'python',
  ];

  return candidates.find((candidate) => candidate === 'python' || existsSync(candidate)) || 'python';
};

const killProcessTree = (child) => new Promise((resolve) => {
  if (!child || child.exitCode !== null) {
    resolve();
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => resolve(), 1000);
});

const npmInvocation = resolveNpmInvocation();
const backendProcess = spawnInherited(resolveBackendPython(), ['main.py'], {
  cwd: path.join(repoRoot, 'backend'),
  env: {
    ...process.env,
    INSPYRO_BACKEND_PORT: '8000',
    INSPYRO_DEV_RELOAD: '1',
  },
});

const frontendProcess = spawnInherited(npmInvocation.command, [...npmInvocation.args, 'start'], {
  cwd: path.join(repoRoot, 'frontend'),
  env: {
    ...process.env,
    BROWSER: 'none',
  },
});

let electronProcess = null;

const shutdown = async (exitCode = 0) => {
  await Promise.all([
    killProcessTree(electronProcess),
    killProcessTree(frontendProcess),
    killProcessTree(backendProcess),
  ]);
  process.exit(exitCode);
};

process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});

Promise.all([
  waitForUrl('http://127.0.0.1:8000/health', 45000),
  waitForUrl('http://127.0.0.1:3000', 45000),
]).then(() => {
  electronProcess = spawnInherited(resolveElectronCommand(), ['.'], {
    cwd: desktopDir,
    env: {
      ...process.env,
      INSPYRO_DESKTOP_DEV_URL: 'http://127.0.0.1:3000',
      INSPYRO_DESKTOP_DEV_BACKEND_URL: 'http://127.0.0.1:8000',
    },
  });

  electronProcess.once('exit', (code) => {
    void shutdown(code ?? 0);
  });
}).catch(async (error) => {
  console.error(error.message);
  await shutdown(1);
});
