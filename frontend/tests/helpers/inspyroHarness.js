const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { seedWorkspace } = require('./seedWorkspace');

const DEFAULT_PORTS = {
  frontend: 3010,
  backend: 8010,
  mcp: 8110,
};

function resolveRepoRoot(startDir = __dirname) {
  return path.resolve(startDir, '..', '..', '..');
}

function resolvePythonExecutable(repoRoot = resolveRepoRoot()) {
  const candidates = [
    path.join(repoRoot, 'venv_inspyro', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'venv_inspyro', 'bin', 'python'),
    path.join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'backend', '.venv', 'bin', 'python'),
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, '.venv', 'bin', 'python'),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  return match || 'python';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function buildRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `run-${stamp}-${suffix}`;
}

function createHarnessManifest(options = {}) {
  const repoRoot = options.repoRoot || resolveRepoRoot();
  const ports = {
    ...DEFAULT_PORTS,
    ...(options.ports || {}),
  };
  const runId = options.runId || buildRunId();
  const sandboxRoot = path.join(os.tmpdir(), 'inspyro-e2e', runId);
  const appStateDir = path.join(sandboxRoot, 'app-state');
  const projectsDir = path.join(sandboxRoot, 'projects');
  const seededWorkspace = path.join(projectsDir, 'inspyro-e2e');
  const altWorkspace = path.join(projectsDir, 'inspyro-alt');
  const recentWorkspace = path.join(projectsDir, 'inspyro-recent');

  return {
    runId,
    repoRoot,
    sandboxRoot,
    manifestPath: path.join(sandboxRoot, 'harness-manifest.json'),
    appStateDir,
    stateFile: path.join(appStateDir, 'workspace_state.json'),
    projectsDir,
    pythonExecutable: options.pythonExecutable || resolvePythonExecutable(repoRoot),
    ports,
    urls: {
      frontend: `http://127.0.0.1:${ports.frontend}`,
      backend: `http://127.0.0.1:${ports.backend}`,
      mcp: `http://127.0.0.1:${ports.mcp}/mcp`,
    },
    workspaces: {
      seeded: seededWorkspace,
      alt: altWorkspace,
      recent: recentWorkspace,
    },
    files: {
      mainPy: path.join(seededWorkspace, 'main.py'),
      notesMd: path.join(seededWorkspace, 'notes.md'),
      loadsCsv: path.join(seededWorkspace, 'loads.csv'),
      reportNotebook: path.join(seededWorkspace, 'report.ipynb'),
      templateDocx: path.join(seededWorkspace, 'sample-template.docx'),
      altNotes: path.join(altWorkspace, 'alt-notes.md'),
      recentNotebook: path.join(recentWorkspace, 'quickstart.ipynb'),
    },
  };
}

function readHarnessManifest(manifestPath = process.env.INSPYRO_E2E_MANIFEST) {
  if (!manifestPath) {
    throw new Error('INSPYRO_E2E_MANIFEST no está definido.');
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function writeWorkspaceState(manifest, { activeWorkspace = null, recentWorkspaces = [] } = {}) {
  writeJson(manifest.stateFile, {
    active_workspace: activeWorkspace,
    recent_workspaces: recentWorkspaces,
  });
}

function prepareLauncherState(manifest) {
  writeWorkspaceState(manifest, {
    activeWorkspace: null,
    recentWorkspaces: [manifest.workspaces.recent, manifest.workspaces.seeded],
  });
}

function prepareWorkspaceState(manifest, workspacePath, extraRecents = []) {
  writeWorkspaceState(manifest, {
    activeWorkspace: workspacePath,
    recentWorkspaces: [workspacePath, ...extraRecents].filter(Boolean),
  });
}

function ensureHarnessSandbox(manifest) {
  fs.rmSync(manifest.sandboxRoot, { recursive: true, force: true });
  ensureDir(manifest.appStateDir);
  ensureDir(manifest.projectsDir);
  seedWorkspace(manifest);
  prepareLauncherState(manifest);
  writeJson(manifest.manifestPath, manifest);
  return manifest;
}

function restoreSeedFixtures(manifest, mode = 'launcher') {
  seedWorkspace(manifest);
  if (mode === 'launcher') {
    prepareLauncherState(manifest);
    return;
  }
  if (mode === 'seeded') {
    prepareWorkspaceState(manifest, manifest.workspaces.seeded, [
      manifest.workspaces.recent,
      manifest.workspaces.alt,
    ]);
    return;
  }
  if (mode === 'alt') {
    prepareWorkspaceState(manifest, manifest.workspaces.alt, [
      manifest.workspaces.seeded,
      manifest.workspaces.recent,
    ]);
    return;
  }
  throw new Error(`Modo de restore no soportado: ${mode}`);
}

function cleanupHarnessSandbox(manifest) {
  if (!manifest?.sandboxRoot) return;
  try {
    fs.rmSync(manifest.sandboxRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  } catch (error) {
    process.stderr.write(
      `[playwright-harness] No se pudo limpiar sandbox ${manifest.sandboxRoot}: ${error.message}\n`
    );
  }
}

module.exports = {
  DEFAULT_PORTS,
  cleanupHarnessSandbox,
  createHarnessManifest,
  ensureHarnessSandbox,
  prepareLauncherState,
  prepareWorkspaceState,
  readHarnessManifest,
  resolvePythonExecutable,
  restoreSeedFixtures,
  writeWorkspaceState,
};
