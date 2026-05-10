import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

const BANK_DOCX_CELL_SOURCE = [
  'from librerias_propias.docx_builder.api import build_doc, doc_reset',
  '',
  'doc_reset(hard=True)',
  "with build_doc(block_id='template-bank', order=30) as builder:",
  "    builder.heading('Template Editor Bank Document', level=1)",
  "    builder.text('Cliente: Banco Template Editor')",
  "    builder.heading('Resumen', level=2)",
  "    builder.text(f'Luz evaluada: {L}')",
  "    builder.text(f'Carga distribuida: {w}')",
  "    builder.text(f'Reaccion calculada: {reaction}')",
  "    builder.text(f'Momento maximo: {M_max}')",
  "    for idx in range(18):",
  "        builder.heading(f'Escenario {idx + 1}', level=2)",
  "        builder.text('Parrafo multipagina para validar estilos heredados, headers, footers y saltos.')",
  "    builder.table([",
  "        ['Parametro', 'Valor', 'Unidad'],",
  "        ['L', str(L), 'm'],",
  "        ['w', str(w), 'kN/m'],",
  "        ['reaction', str(reaction), 'kN'],",
  "        ['M_max', str(M_max), 'kN m'],",
  "    ], headers=['Campo', 'Resultado', 'Unidad'], style='Table Grid')",
  "print('template editor bank docx ok')",
].join('\n');

const toNotebookSource = (source: string) => (
  source.split('\n').map((line, index, lines) => (index === lines.length - 1 ? line : `${line}\n`))
);

const FORMAT_CATEGORIES = ['body', 'headings', 'captions', 'lists', 'code', 'tables'];

type BankReport = {
  runId: string;
  outputDir: string;
  scenarios: any[];
  add: (name: string, status: string, fixture?: string | null, details?: any, artifacts?: any) => void;
  write: () => void;
};

const createBankReport = (harness: any): BankReport => {
  const runId = `${harness.runId}-e2e`;
  const outputDir = path.join(harness.repoRoot, 'output', 'template-editor-bank', runId);
  fs.mkdirSync(outputDir, { recursive: true });
  const scenarios: any[] = [];
  return {
    runId,
    outputDir,
    scenarios,
    add(name, status, fixture = null, details = {}, artifacts = {}) {
      scenarios.push({
        name,
        status,
        fixture,
        details,
        artifacts,
        finished_at: Math.floor(Date.now() / 1000),
      });
    },
    write() {
      const statusCounts = scenarios.reduce((counts, scenario) => {
        const key = scenario.status || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {} as Record<string, number>);
      const payload = {
        schema_version: 'template-editor-bank-report@1',
        title: 'Template Editor E2E Bank',
        run_id: runId,
        finished_at: Math.floor(Date.now() / 1000),
        status_counts: statusCounts,
        scenarios,
      };
      fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(payload, null, 2), 'utf8');
      const rows = [
        '# Template Editor E2E Bank',
        '',
        `- Run id: \`${runId}\``,
        `- Scenarios: ${scenarios.length}`,
        `- Status: ${Object.entries(statusCounts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
        '',
        '| Scenario | Fixture | Status | Artifact | Notes |',
        '|---|---:|---:|---|---|',
      ];
      for (const scenario of scenarios) {
        const artifact = scenario.artifacts?.artifact_id || scenario.artifacts?.docx_path || scenario.artifacts?.json_path || '';
        const note = scenario.details?.reason || scenario.details?.summary || scenario.details?.message || '';
        rows.push(`| ${String(scenario.name).replace(/\|/g, '\\|')} | ${String(scenario.fixture || '').replace(/\|/g, '\\|')} | ${String(scenario.status).replace(/\|/g, '\\|')} | ${String(artifact).replace(/\|/g, '\\|')} | ${String(note).replace(/\|/g, '\\|')} |`);
      }
      fs.writeFileSync(path.join(outputDir, 'summary.md'), `${rows.join('\n')}\n`, 'utf8');
    },
  };
};

const runScenario = async <T,>(
  report: BankReport,
  name: string,
  fixture: string | null,
  fn: () => Promise<{ details?: any; artifacts?: any; value?: T }>,
): Promise<T | undefined> => {
  try {
    const result = await fn();
    report.add(name, 'passed', fixture, result.details, result.artifacts);
    return result.value;
  } catch (error: any) {
    report.add(name, 'failed', fixture, { reason: String(error?.message || error) });
    throw error;
  }
};

const generateBankFixtures = (harness: any, report: BankReport) => {
  const fixturesDir = path.join(report.outputDir, 'fixtures');
  const helperPath = path.join(harness.repoRoot, 'backend', 'tests', 'template_editor_bank_utils.py');
  const result = spawnSync(
    harness.pythonExecutable,
    [helperPath, '--write', fixturesDir, '--quiet'],
    { cwd: harness.repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`Fixture generation failed: ${result.stderr || result.stdout}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8'));
  return {
    fixturesDir,
    fixtures: manifest.fixtures,
    helperPath,
  };
};

const fixtureById = (fixtures: any[], id: string) => {
  const fixture = fixtures.find((item) => item.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return fixture;
};

const getPdfStatus = async (request: any, harness: any) => {
  const response = await request.get(`${harness.urls.backend}/pdf-status`);
  expect(response.ok()).toBeTruthy();
  return response.json();
};

const decodePngFromDataUrl = (src: string | null) => {
  expect(src).toMatch(/^data:image\/png;base64,/);
  const bytes = Buffer.from(String(src).split(',')[1] || '', 'base64');
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.length).toBeGreaterThan(500);
  return bytes;
};

const expectWordPreviewForCurrentStyle = async (page: any, nativeWordAvailable: boolean) => {
  await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.word-preview-image')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId('template-open-sample-docx')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('template-native-word-preview').click();
  if (!nativeWordAvailable) {
    await expect(page.locator('.preview-status-line')).toContainText(/Preview JS|Microsoft Word|Word no/i, { timeout: 30000 });
    await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible();
    return;
  }
  const image = page.locator('.word-preview-image');
  await expect(image).toBeVisible({ timeout: 90000 });
  decodePngFromDataUrl(await image.getAttribute('src'));
};

const validateCategoryPreviews = async (
  page: any,
  categories: string[],
  nativeWordAvailable: boolean,
  { requireNative = false } = {},
) => {
  const covered: string[] = [];
  await page.getByTestId('template-sidebar-styles').click();
  await expect(page.getByTestId('template-styles-panel')).toBeVisible({ timeout: 15000 });
  await page.locator('.template-search-input').fill('');
  for (const category of categories) {
    const select = page.getByTestId(`template-category-select-${category}`);
    if ((await select.count()) === 0) continue;
    const card = page.locator('.category-browser-card').filter({ has: select });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.word-preview-image')).toHaveCount(0, { timeout: 10000 });
    if (requireNative) {
      await expectWordPreviewForCurrentStyle(page, nativeWordAvailable);
    }
    covered.push(category);
  }
  return covered;
};

const appendBankCell = async (request: any, harness: any) => {
  const readResponse = await request.get(`${harness.urls.backend}/api/files/read`, {
    params: { path: harness.files.reportNotebook },
  });
  expect(readResponse.ok()).toBeTruthy();
  const notebook = (await readResponse.json()).content;
  const filteredCells = (notebook.cells || []).filter((cell: any) => cell.id !== 'template-editor-bank-docx-cell');
  filteredCells.push({
    id: 'template-editor-bank-docx-cell',
    cell_type: 'code',
    metadata: {},
    execution_count: null,
    outputs: [],
    source: toNotebookSource(BANK_DOCX_CELL_SOURCE),
  });
  notebook.cells = filteredCells;
  const writeResponse = await request.post(`${harness.urls.backend}/api/files/write`, {
    data: {
      path: harness.files.reportNotebook,
      content: notebook,
    },
  });
  expect(writeResponse.ok()).toBeTruthy();
};

const getLatestDocxHistoryEntry = async (request: any, harness: any) => {
  const response = await request.get(`${harness.urls.backend}/api/docx/history`, {
    params: { source_path: harness.files.reportNotebook, limit: 20 },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload?.items?.[0] || null;
};

const waitForLatestDocxArtifactChange = async (request: any, harness: any, previousArtifactId: string | null) => {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 150000) {
    const latestEntry = await getLatestDocxHistoryEntry(request, harness);
    if (latestEntry?.artifact_id && latestEntry.artifact_id !== previousArtifactId) {
      return latestEntry;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for a newer DOCX artifact');
};

const inspectGeneratedDocx = async (request: any, harness: any, report: BankReport, helperPath: string, artifactId: string) => {
  const response = await request.get(`${harness.urls.backend}/api/docx/download`, {
    params: { artifact_id: artifactId },
    timeout: 120000,
  });
  expect(response.ok()).toBeTruthy();
  const docxPath = path.join(report.outputDir, `${artifactId}.docx`);
  fs.writeFileSync(docxPath, Buffer.from(await response.body()));
  const result = spawnSync(
    harness.pythonExecutable,
    [helperPath, '--inspect-docx', docxPath],
    { cwd: harness.repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`DOCX inspection failed: ${result.stderr || result.stdout}`);
  }
  return {
    docxPath,
    inspection: JSON.parse(result.stdout),
  };
};

const validateWorkbench = async (request: any, harness: any, report: BankReport, artifactId: string) => {
  const auditResponse = await request.post(`${harness.urls.backend}/api/docx/workbench/run`, {
    data: { artifact_id: artifactId, operation: 'audit', profile: 'agent' },
    timeout: 120000,
  });
  expect(auditResponse.ok()).toBeTruthy();
  const auditPayload = await auditResponse.json();
  const summary = auditPayload.summary || auditPayload;
  expect(summary.status).not.toBe('error');

  const pdfStatusResponse = await request.get(`${harness.urls.backend}/pdf-status`);
  const pdfStatus = await pdfStatusResponse.json();
  const pdfAvailable = Boolean(
    pdfStatus?.available
    || pdfStatus?.pdf_available
    || pdfStatus?.word_available
    || pdfStatus?.libreoffice_available
  );
  if (!pdfAvailable) {
    report.add('workbench visual render', 'skipped', 'generated-docx', { reason: 'PDF converter unavailable' }, { artifact_id: artifactId });
    return { audit: summary, renderedPages: [] };
  }

  const renderResponse = await request.post(`${harness.urls.backend}/api/docx/workbench/run`, {
    data: { artifact_id: artifactId, operation: 'render_all_pages', profile: 'visual' },
    timeout: 180000,
  });
  expect(renderResponse.ok()).toBeTruthy();
  const renderPayload = await renderResponse.json();
  const renderedPages = renderPayload.rendered_pages || renderPayload.result?.rendered_pages || [];
  expect(Array.isArray(renderedPages)).toBeTruthy();
  expect(renderedPages.length).toBeGreaterThan(0);
  const firstPage = renderedPages[0];
  if (firstPage?.local_path && fs.existsSync(firstPage.local_path)) {
    const bytes = fs.readFileSync(firstPage.local_path);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  }
  report.add('workbench visual render', 'passed', 'generated-docx', { pages: renderedPages.length }, { artifact_id: artifactId });
  return { audit: summary, renderedPages };
};

const installTemplateAttachSpy = async (page: any) => {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    const attachMessages: any[] = [];
    const templateMessages: any[] = [];
    (window as any).__templateBankAttachMessages = attachMessages;
    (window as any).__templateBankTemplateMessages = templateMessages;
    function PatchedWebSocket(url: string | URL, protocols?: string | string[]) {
      const socket = protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols);
      const originalSend = socket.send.bind(socket);
      socket.send = (data: any) => {
        try {
          if (typeof data === 'string') {
            const message = JSON.parse(data);
            if (message?.type === 'template_attach') {
              attachMessages.push({
                request_id: message.request_id || null,
                template_token: message.template_token || null,
                at: Date.now(),
              });
            }
          }
        } catch {
          // ignore non-JSON websocket frames
        }
        return originalSend(data);
      };
      socket.addEventListener('message', (event: MessageEvent) => {
        try {
          if (typeof event.data !== 'string') return;
          const message = JSON.parse(event.data);
          if (['template_uploaded', 'template_error', 'error'].includes(message?.type)) {
            templateMessages.push({
              type: message.type,
              request_id: message.request_id || null,
              kernel_id: message.kernel_id || null,
              error_code: message.error_code || null,
              error: message.error || message.message || null,
              template_token: message.template_token || null,
              style_total: message.template?.style_coverage?.summary?.total ?? null,
              at: Date.now(),
            });
          }
        } catch {
          // ignore non-JSON websocket frames
        }
      });
      return socket;
    }
    (PatchedWebSocket as any).prototype = OriginalWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(PatchedWebSocket, key, { value: (OriginalWebSocket as any)[key] });
    }
    (window as any).WebSocket = PatchedWebSocket as any;
  });
};

test.describe.serial('Template Editor Exhaustive Bank', () => {
  test.setTimeout(360000);

  test('covers template corpus, Word-complete editing and generated DOCX quality', async ({ page, harness, request, consoleErrors }) => {
    void consoleErrors;
    const report = createBankReport(harness);
    try {
      restoreSeedFixtures(harness, 'seeded');
      const pdfStatus = await getPdfStatus(request, harness);
      const nativeWordAvailable = Boolean(pdfStatus.word_available);
      await appendBankCell(request, harness);
      const resetDocxResponse = await request.post(`${harness.urls.backend}/api/docx/test/reset`, {
        data: { source_path: harness.files.reportNotebook },
      });
      expect(resetDocxResponse.ok()).toBeTruthy();

      const generated = await runScenario(report, 'generate synthetic DOCX corpus', null, async () => {
        const corpus = generateBankFixtures(harness, report);
        return {
          value: corpus,
          details: { count: corpus.fixtures.length },
          artifacts: { fixtures_dir: corpus.fixturesDir },
        };
      });
      const wordCompleteFixture = fixtureById(generated!.fixtures, 'word_complete');

      await installTemplateAttachSpy(page);
      await gotoShell(page);
      await ensureWorkspaceOpen(page, 'inspyro-e2e');
      await openNotebookFromTree(page, 'report.ipynb');

      await runScenario(report, 'initial notebook DOCX generation', 'sample-template', async () => {
        await page.getByTestId('notebook-toolbar-run-all').click();
        await expect(page.locator('.cell-output').last()).toContainText(/template editor bank docx ok/i, { timeout: 150000 });
        await expect(page.getByRole('button', { name: /DOCX/i }).first()).toBeVisible({ timeout: 120000 });
        const entry = await waitForLatestDocxArtifactChange(request, harness, null);
        return { value: entry, details: { artifact_id: entry.artifact_id }, artifacts: { artifact_id: entry.artifact_id } };
      });
      const beforeTemplateEntry = await getLatestDocxHistoryEntry(request, harness);

      await page.getByTestId('docx-template-button').click();
      await expect(page.getByTestId('template-editor')).toBeVisible({ timeout: 30000 });

      await runScenario(report, 'fixture preview corpus internal', 'minimal-complete-localized', async () => {
        const coveredByFixture: Record<string, string[]> = {};
        for (const fixtureId of ['minimal', 'complete', 'localized']) {
          const fixture = fixtureById(generated!.fixtures, fixtureId);
          await page.locator('input[type="file"][accept=".docx"]').setInputFiles(fixture.path);
          await expect(page.getByTestId('template-sidebar-slots')).toBeVisible({ timeout: 90000 });
          await expect(page.getByTestId('template-upload-button')).toBeEnabled({ timeout: 90000 });
          const requiredCategories = fixtureId === 'minimal'
            ? FORMAT_CATEGORIES.filter((category) => !['captions', 'code'].includes(category))
            : FORMAT_CATEGORIES;
          const covered = await validateCategoryPreviews(page, requiredCategories, nativeWordAvailable);
          expect(covered).toEqual(expect.arrayContaining(requiredCategories));
          coveredByFixture[fixtureId] = covered;
        }
        return { details: { covered_by_fixture: coveredByFixture } };
      });

      await runScenario(report, 'upload attach once', 'word_complete', async () => {
        const attachBefore = await page.evaluate(() => ((window as any).__templateBankAttachMessages || []).length);
        await page.locator('input[type="file"][accept=".docx"]').setInputFiles(wordCompleteFixture.path);
        await expect(page.getByTestId('template-sidebar-slots')).toBeVisible({ timeout: 90000 });
        await expect(page.getByTestId('template-upload-button')).toBeEnabled({ timeout: 90000 });
        const attachMessages = await page.evaluate(() => (window as any).__templateBankAttachMessages || []);
        expect(attachMessages.length - attachBefore).toBe(1);
        const coveredWordComplete = await validateCategoryPreviews(page, FORMAT_CATEGORIES, nativeWordAvailable, { requireNative: true });
        expect(coveredWordComplete).toEqual(expect.arrayContaining(FORMAT_CATEGORIES));
        return {
          details: { attach_messages: attachMessages.length, native_word_available: nativeWordAvailable, covered: coveredWordComplete },
          artifacts: { fixture_path: wordCompleteFixture.path },
        };
      });

      await runScenario(report, 'slots styles diagnostics hidden toggle', 'word_complete', async () => {
        await page.getByTestId('template-sidebar-slots').click();
        await expect(page.getByTestId('template-slots-panel')).toBeVisible();
        await page.getByTestId('template-sidebar-styles').click();
        await expect(page.getByTestId('template-styles-panel')).toBeVisible();
        await expect(page.getByText('Bank Hidden Internal')).toHaveCount(0);
        await page.getByTestId('template-show-hidden-styles').check();
        await expect(page.locator('option', { hasText: 'Bank Hidden Internal' })).toHaveCount(1, { timeout: 15000 });
        await page.locator('.template-search-input').fill('Bank Word Complete');
        await expect(page.getByTestId('template-category-select-body').locator('option', { hasText: 'Bank Word Complete' })).toHaveCount(1);
        await page.getByTestId('template-sidebar-diagnostics').click();
        await expect(page.getByTestId('template-diagnostics-panel')).toBeVisible();
        await expect(page.getByTestId('template-content-controls-summary')).toBeVisible();
        await expect(page.getByTestId('template-header-footer-summary')).toBeVisible();
        return { details: { hidden_toggle: true, diagnostics: true } };
      });

      await runScenario(report, 'quick and Word-complete style edit', 'word_complete', async () => {
        await page.getByTestId('template-sidebar-styles').click();
        await page.locator('.template-search-input').fill('');
        await page.getByTestId('template-show-hidden-styles').uncheck();
        const bodySelect = page.getByTestId('template-category-select-body');
        await expect(bodySelect).toBeVisible({ timeout: 15000 });
        await bodySelect.selectOption({ label: 'Bank Word Complete' });
        await page.locator('.category-browser-card').filter({ has: bodySelect }).click();
        await expect(page.locator('.style-edit-panel h3').first()).toContainText(/Bank Word Complete/i, { timeout: 15000 });

        const sizeInput = page.locator('.edit-row').filter({ hasText: /Tama/i }).locator('input[type="number"]').first();
        await sizeInput.fill('12');

        await page.locator('details.word-complete-details summary').click();
        await page.getByTestId('template-word-complete-toggle').click();
        await page.getByTestId('template-word-tab-identity').click();
        await page.getByTestId('template-word-style-ui-priority').fill('5');
        await page.getByTestId('template-word-style-q-format').uncheck();
        await page.getByTestId('template-word-style-semi-hidden').check();
        await page.getByTestId('template-word-style-unhide-when-used').check();
        await page.getByTestId('template-word-tab-font').click();
        await page.getByTestId('template-word-font-complex-script').fill('Aptos');
        await page.getByTestId('template-word-font-east-asia').fill('Aptos');
        await page.getByTestId('template-word-font-language').fill('es-CL');
        await page.getByTestId('template-word-font-kerning').fill('10');
        await page.getByTestId('template-word-font-spacing').fill('24');
        await page.getByTestId('template-word-font-position').fill('2');
        await page.getByTestId('template-word-tab-paragraph').click();
        await page.getByTestId('template-word-paragraph-contextual-spacing').check();
        await page.getByTestId('template-word-paragraph-tab-pos').fill('4320');
        await page.getByTestId('template-word-paragraph-tab-val').selectOption('right');
        await page.getByTestId('template-word-paragraph-tab-leader').selectOption('dot');
        await page.getByTestId('template-word-paragraph-shading-fill').fill('F2F2F2');
        await page.getByTestId('template-word-paragraph-border-bottom-color').fill('1B4965');
        await page.getByRole('button', { name: /Guardar Cambios/i }).click();
        await expect(page.locator('.edit-panel-header')).not.toContainText(/Sin guardar/i, { timeout: 90000 });
        return { details: { quick_size_pt: 12, word_complete: true } };
      });

      const exportedJsonPath = await runScenario(report, 'portable JSON export import', 'word_complete', async () => {
        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.getByTestId('template-more-actions').click();
        await page.getByTestId('template-export-json').click();
        const download = await downloadPromise;
        const exportPath = path.join(report.outputDir, download.suggestedFilename());
        await download.saveAs(exportPath);
        const payload = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
        expect(payload.schema_version).toBe('1.1');
        expect(payload.docx_base64).toBeTruthy();

        await page.getByTestId('template-close-button').click();
        await expect(page.getByTestId('template-editor')).toHaveCount(0, { timeout: 15000 });
        await page.getByTestId('docx-template-button').click();
        await expect(page.getByTestId('template-editor')).toBeVisible({ timeout: 30000 });

        await page.getByTestId('template-more-actions').click();
        await page.getByTestId('template-import-json').click();
        await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(exportPath);
        await expect(page.getByTestId('template-sidebar-slots')).toBeVisible({ timeout: 90000 });
        await page.getByTestId('template-sidebar-styles').click();
        await expect(page.getByTestId('template-upload-button')).toBeEnabled({ timeout: 120000 });
        await page.getByTestId('template-show-hidden-styles').check();
        await page.locator('.template-search-input').fill('Bank Word Complete');
        await expect(page.getByTestId('template-category-select-body').locator('option', { hasText: 'Bank Word Complete' })).toHaveCount(1, { timeout: 60000 });
        return {
          value: exportPath,
          details: { schema_version: payload.schema_version, hidden_style_roundtrip: true },
          artifacts: { json_path: exportPath },
        };
      });

      await runScenario(report, 'close reopen editor keeps template state', 'word_complete', async () => {
        await page.getByTestId('template-close-button').click();
        await expect(page.getByTestId('template-editor')).toHaveCount(0, { timeout: 15000 });
        await page.getByTestId('docx-template-button').click();
        await expect(page.getByTestId('template-editor')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('template-sidebar-styles').click();
        await page.getByTestId('template-show-hidden-styles').check();
        await page.locator('.template-search-input').fill('Bank Word Complete');
        await expect(page.getByTestId('template-category-select-body').locator('option', { hasText: 'Bank Word Complete' })).toHaveCount(1, { timeout: 30000 });
        await page.getByTestId('template-close-button').click();
        return { details: { exported_json: exportedJsonPath } };
      });

      const generatedEntry = await runScenario(report, 'generate document with edited template', 'word_complete', async () => {
        await page.getByTestId('notebook-toolbar-run-all').click();
        await expect(page.getByTestId('notebook-toolbar-run-all')).toBeDisabled({ timeout: 15000 });
        await expect(page.getByTestId('notebook-toolbar-run-all')).toBeEnabled({ timeout: 150000 });
        const entry = await waitForLatestDocxArtifactChange(request, harness, beforeTemplateEntry?.artifact_id || null);
        return { value: entry, details: { artifact_id: entry.artifact_id }, artifacts: { artifact_id: entry.artifact_id } };
      });

      await runScenario(report, 'OOXML audit generated DOCX', 'generated-docx', async () => {
        const { docxPath, inspection } = await inspectGeneratedDocx(
          request,
          harness,
          report,
          generated!.helperPath,
          generatedEntry!.artifact_id,
        );
        expect(inspection.is_zip).toBeTruthy();
        expect(inspection.table_count).toBeGreaterThanOrEqual(1);
        expect(inspection.header_parts.length).toBeGreaterThanOrEqual(1);
        expect(inspection.footer_parts.length).toBeGreaterThanOrEqual(1);
        return {
          details: {
            tables: inspection.table_count,
            headers: inspection.header_parts.length,
            footers: inspection.footer_parts.length,
          },
          artifacts: { artifact_id: generatedEntry!.artifact_id, docx_path: docxPath },
        };
      });

      await runScenario(report, 'Workbench audit generated DOCX', 'generated-docx', async () => {
        const validation = await validateWorkbench(request, harness, report, generatedEntry!.artifact_id);
        return {
          details: {
            quality_status: validation.audit.status,
            errors: validation.audit.counts?.error || 0,
            warnings: validation.audit.counts?.warning || 0,
            rendered_pages: validation.renderedPages.length,
          },
          artifacts: { artifact_id: generatedEntry!.artifact_id },
        };
      });
    } finally {
      report.write();
    }
  });
});
