const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeRemove(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}

function resetDirectory(dirPath) {
  ensureDir(dirPath);
  for (const entry of fs.readdirSync(dirPath)) {
    safeRemove(path.join(dirPath, entry));
  }
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function makeMarkdownCell(id, source) {
  return {
    id,
    cell_type: 'markdown',
    metadata: {},
    source: source.split('\n').map((line, index, lines) => (
      index === lines.length - 1 ? line : `${line}\n`
    )),
  };
}

function makeCodeCell(id, source) {
  return {
    id,
    cell_type: 'code',
    metadata: {},
    execution_count: null,
    outputs: [],
    source: source.split('\n').map((line, index, lines) => (
      index === lines.length - 1 ? line : `${line}\n`
    )),
  };
}

function createSeedNotebook() {
  return {
    cells: [
      makeMarkdownCell(
        'intro-md',
        '# Informe Demo\nNotebook semilla para Playwright y validacion E2E.'
      ),
      makeCodeCell(
        'calc-cell',
        [
          'from librerias_propias.inspyro_units import *',
          '',
          'L = 6.0 * m',
          'w = 12.5 * kN / m',
          'reaction = w * L / 2',
          'M_max = w * L**2 / 8',
          'sigma_adm = 25 * MPa',
          'print(f"reaction = {reaction}")',
          'print(f"M_max = {M_max}")',
          'print(f"sigma_adm = {sigma_adm}")',
        ].join('\n')
      ),
      makeCodeCell(
        'docx-cell',
        [
          'from librerias_propias.docx_builder.api import build_doc, doc_reset',
          '',
          'doc_reset(hard=True)',
          "with build_doc(block_id='cover', order=10) as builder:",
          "    builder.heading('Reporte tecnico E2E', level=1)",
          "    builder.text(f'Luz: {L}')",
          "    builder.text(f'Carga distribuida: {w}')",
          "    builder.text(f'Reaccion: {reaction}')",
          "    builder.text(f'Momento maximo: {M_max}')",
          "    builder.text(f'Esfuerzo admisible: {sigma_adm}')",
          "    builder.table([",
          "        ['Parametro', 'Valor'],",
          "        ['L', str(L)],",
          "        ['w', str(w)],",
          "        ['reaction', str(reaction)],",
          "        ['M_max', str(M_max)],",
          "    ], headers=['Nombre', 'Resultado'], style='Table Grid')",
        ].join('\n')
      ),
    ],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.12',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function createQuickstartNotebook() {
  return {
    cells: [
      makeMarkdownCell('quickstart-md', '# Quickstart\nWorkspace reciente para el launcher.'),
      makeCodeCell('quickstart-code', "print('workspace reciente listo')"),
    ],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.12',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function createTemplateDocx(manifest) {
  const outputPath = manifest.files.templateDocx;
  const pythonScript = [
    'from pathlib import Path',
    'from docx import Document',
    '',
    `output_path = Path(r"""${outputPath}""")`,
    'output_path.parent.mkdir(parents=True, exist_ok=True)',
    'document = Document()',
    "document.add_heading('Plantilla E2E Inspyro', level=1)",
    "document.add_paragraph('Plantilla generada automaticamente para pruebas Playwright.')",
    "document.add_paragraph('Incluye una tabla para validar preview y formato directo.')",
    "table = document.add_table(rows=3, cols=2)",
    "table.style = 'Table Grid'",
    "table.cell(0, 0).text = 'Parametro'",
    "table.cell(0, 1).text = 'Valor'",
    "table.cell(1, 0).text = 'L'",
    "table.cell(1, 1).text = '6.0 m'",
    "table.cell(2, 0).text = 'w'",
    "table.cell(2, 1).text = '12.5 kN/m'",
    'document.save(str(output_path))',
  ].join('\n');

  const result = spawnSync(manifest.pythonExecutable, ['-c', pythonScript], {
    cwd: manifest.repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status === 0 && fs.existsSync(outputPath)) {
    return;
  }

  const fallbackTemplatesRoot = path.join(manifest.repoRoot, 'backend', '.templates');
  const fallbackTemplate = fs.existsSync(fallbackTemplatesRoot)
    ? fs.readdirSync(fallbackTemplatesRoot)
      .map((entry) => path.join(fallbackTemplatesRoot, entry, 'template.docx'))
      .find((candidate) => fs.existsSync(candidate))
    : null;

  if (fallbackTemplate) {
    ensureDir(path.dirname(outputPath));
    fs.copyFileSync(fallbackTemplate, outputPath);
    return;
  }

  const stderr = result.stderr ? `\n${result.stderr}` : '';
  throw new Error(`No se pudo generar sample-template.docx${stderr}`);
}

function seedWorkspace(manifest) {
  ensureDir(manifest.projectsDir);
  const workspaceDirs = Object.values(manifest.workspaces || {});
  workspaceDirs.forEach((workspaceDir) => {
    resetDirectory(workspaceDir);
  });

  const notebook = createSeedNotebook();
  const quickstart = createQuickstartNotebook();

  writeText(
    manifest.files.mainPy,
    [
      'from librerias_propias.inspyro_units import *',
      '',
      'span = 6.0 * m',
      'distributed_load = 12.5 * kN / m',
      'reaction = distributed_load * span / 2',
      'moment = distributed_load * span**2 / 8',
      '',
      'def utilization(moment_capacity):',
      '    return moment / moment_capacity',
      '',
      'if __name__ == "__main__":',
      '    print(f"reaction={reaction}")',
      '    print(f"moment={moment}")',
      '',
    ].join('\n')
  );

  writeText(
    manifest.files.notesMd,
    [
      '# Notas E2E',
      '',
      '- Verificar explorador, edicion y guardado.',
      '- Confirmar que MCP refleja cambios sobre archivos limpios.',
      '',
    ].join('\n')
  );

  writeText(
    manifest.files.loadsCsv,
    [
      'case,load_kN_m,span_m',
      'base,12.5,6.0',
      'service,9.0,6.0',
      'ultimate,18.0,6.0',
      '',
    ].join('\n')
  );

  writeJson(manifest.files.reportNotebook, notebook);
  writeJson(manifest.files.recentNotebook, quickstart);

  writeText(
    manifest.files.altNotes,
    [
      '# Workspace alternativo',
      '',
      'Este workspace se usa para validar cambio de proyecto desde la UI.',
      '',
    ].join('\n')
  );

  createTemplateDocx(manifest);
}

module.exports = {
  seedWorkspace,
};
