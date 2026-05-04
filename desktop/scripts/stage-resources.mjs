import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const stageDir = path.join(desktopDir, '.stage');
const backendSourceDir = path.join(repoRoot, 'backend');
const frontendBuildDir = path.join(repoRoot, 'frontend', 'build');
const pythonHome = process.env.INSPYRO_DESKTOP_PYTHON_HOME || process.env.INSPYRO_DESKTOP_PYTHON_DIR || '';
const stagedBackendDir = path.join(stageDir, 'backend');
const stagedFrontendBuildDir = path.join(stageDir, 'frontend-build');
const stagedPythonDir = path.join(stageDir, 'python');
const skipPythonSync = process.env.INSPYRO_DESKTOP_SKIP_PIP_SYNC === '1';

const backendExcludedRootNames = new Set([
  '.docx_downloads',
  '.pdf_downloads',
  '.pytest_cache',
  '.templates',
  '.template_tokens',
  '__pycache__',
  'dev',
  'tests',
]);
const backendExcludedFiles = new Set([
  'Dockerfile',
  'HOLA_DESDE_MCP.txt',
  'pytest.ini',
]);
const requiredPythonImports = [
  { module: 'fastapi', label: 'FastAPI backend' },
  { module: 'uvicorn', label: 'Uvicorn ASGI server' },
  { module: 'jupyter_client', label: 'Jupyter kernel client' },
  { module: 'ipykernel', label: 'IPython kernel runtime' },
  { module: 'docx', label: 'python-docx report generation' },
  { module: 'fitz', label: 'PyMuPDF DOCX/PDF visual cache' },
  { module: 'watchdog', label: 'workspace filesystem watcher' },
  { module: 'pylsp', label: 'Python LSP server' },
  { module: 'fastmcp', label: 'FastMCP Agents server' },
  { module: 'mcp', label: 'MCP protocol package' },
];

const assertExists = async (targetPath, label) => {
  try {
    await fs.access(targetPath);
  } catch (error) {
    throw new Error(`No se encontro ${label}: ${targetPath}`);
  }
};

const copyDirectory = async (sourceDir, targetDir, filter = null) => {
  const options = {
    recursive: true,
    force: true,
  };
  if (filter) {
    options.filter = filter;
  }

  await fs.cp(sourceDir, targetDir, {
    ...options,
  });
};

const backendFilter = (sourcePath) => {
  const relative = path.relative(backendSourceDir, sourcePath);
  if (!relative) {
    return true;
  }

  const parts = relative.split(path.sep);
  if (parts.some((part) => backendExcludedRootNames.has(part) || part.startsWith('tmp'))) {
    return false;
  }

  const baseName = path.basename(sourcePath);
  if (backendExcludedFiles.has(baseName)) {
    return false;
  }

  return !['.pyc', '.pyo'].includes(path.extname(sourcePath));
};

const pythonFilter = (sourcePath) => {
  const parts = path.relative(pythonHome, sourcePath).split(path.sep);
  if (parts.some((part) => part === '__pycache__')) {
    return false;
  }
  return !sourcePath.endsWith('.pyc');
};

const resolvePythonExecutable = (rootDir = pythonHome) => {
  const candidates = [
    path.join(rootDir, 'python.exe'),
    path.join(rootDir, 'bin', 'python3'),
    path.join(rootDir, 'bin', 'python'),
  ];
  return candidates.find((candidate) => candidate && path.basename(candidate) && existsSync(candidate)) || null;
};

const pythonSubprocessEnv = () => ({
  ...process.env,
  PYTHONNOUSERSITE: '1',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
});

const runChecked = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : '';
    const stdout = result.stdout ? `\n${result.stdout}` : '';
    throw new Error(`Comando fallo: ${command} ${args.join(' ')}${stderr}${stdout}`);
  }
  return result;
};

const checkPythonImports = (pythonExecutable, { throwOnMissing = false } = {}) => {
  const source = [
    'import importlib, json',
    `imports = ${JSON.stringify(requiredPythonImports.map((entry) => entry.module))}`,
    'missing = []',
    'for name in imports:',
    '    try:',
    '        importlib.import_module(name)',
    '    except Exception as exc:',
    '        missing.append({"module": name, "error": f"{type(exc).__name__}: {exc}"})',
    'print(json.dumps({"missing": missing}, ensure_ascii=False))',
  ].join('\n');
  const result = runChecked(pythonExecutable, ['-c', source], {
    env: pythonSubprocessEnv(),
  });
  const parsed = JSON.parse((result.stdout || '').trim() || '{"missing": []}');
  const missing = parsed.missing || [];
  if (throwOnMissing && missing.length) {
    const labels = new Map(requiredPythonImports.map((entry) => [entry.module, entry.label]));
    const detail = missing
      .map((item) => `- ${item.module} (${labels.get(item.module) || 'required'}): ${item.error}`)
      .join('\n');
    throw new Error(`Runtime Python portable incompleto para desktop:\n${detail}`);
  }
  return missing;
};

const syncPythonRequirements = (pythonExecutable) => {
  const missingBefore = checkPythonImports(pythonExecutable);
  if (!missingBefore.length) {
    return { pip_synced: false, missing_before: [] };
  }
  if (skipPythonSync) {
    checkPythonImports(pythonExecutable, { throwOnMissing: true });
  }

  console.log(`Sincronizando dependencias Python faltantes: ${missingBefore.map((item) => item.module).join(', ')}`);
  runChecked(
    pythonExecutable,
    [
      '-m',
      'pip',
      'install',
      '-r',
      path.join(backendSourceDir, 'requirements.txt'),
      '-r',
      path.join(backendSourceDir, 'mcp_server', 'requirements-mcp.txt'),
    ],
    {
      stdio: 'inherit',
      env: pythonSubprocessEnv(),
    },
  );
  checkPythonImports(pythonExecutable, { throwOnMissing: true });
  return { pip_synced: true, missing_before: missingBefore.map((item) => item.module) };
};

const main = async () => {
  await assertExists(frontendBuildDir, 'frontend compilado');
  if (!pythonHome) {
    throw new Error('Define INSPYRO_DESKTOP_PYTHON_HOME con la ruta a un runtime Python portable listo para distribuir.');
  }
  await assertExists(pythonHome, 'runtime Python portable');

  const pythonExecutable = resolvePythonExecutable();
  if (!pythonExecutable) {
    throw new Error(`No se encontro python.exe dentro de ${pythonHome}`);
  }

  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(stageDir, { recursive: true });

  await copyDirectory(backendSourceDir, stagedBackendDir, backendFilter);
  await copyDirectory(frontendBuildDir, stagedFrontendBuildDir);
  await copyDirectory(pythonHome, stagedPythonDir, pythonFilter);

  const stagedPythonExecutable = resolvePythonExecutable(stagedPythonDir);
  if (!stagedPythonExecutable) {
    throw new Error(`No se encontro python.exe dentro del runtime staged: ${stagedPythonDir}`);
  }
  const pythonSync = syncPythonRequirements(stagedPythonExecutable);

  const manifest = {
    generated_at: new Date().toISOString(),
    python_home: 'python',
    python_executable: path.relative(pythonHome, pythonExecutable).replace(/\\/g, '/'),
    frontend_build: 'frontend-build',
    backend_entry: 'backend/main.py',
    backend_exclusions: {
      state_dirs: Array.from(backendExcludedRootNames).sort(),
      files: Array.from(backendExcludedFiles).sort(),
      tmp_prefix: true,
    },
    python_requirements: {
      pip_synced: pythonSync.pip_synced,
      missing_before_sync: pythonSync.missing_before,
      required_imports: requiredPythonImports.map((entry) => entry.module),
    },
  };
  await fs.writeFile(
    path.join(stageDir, 'runtime-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  console.log(`Desktop stage listo en ${stageDir}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
