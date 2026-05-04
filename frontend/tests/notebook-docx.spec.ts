import { createHash } from 'crypto';

import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

const REVISION_DOCX_CELL_SOURCE = [
  'from librerias_propias.docx_builder.api import build_doc, doc_reset',
  '',
  'doc_reset(hard=True)',
  "with build_doc(block_id='cover', order=10) as builder:",
  "    builder.heading('Reporte tecnico E2E - revision B', level=1)",
  "    builder.text(f'Luz: {L}')",
  "    builder.text(f'Carga distribuida: {w}')",
  "    builder.text(f'Reaccion: {reaction}')",
  "    builder.text(f'Momento maximo: {M_max}')",
  "    builder.text(f'Esfuerzo admisible: {sigma_adm}')",
  "    builder.heading('Resumen estructural', level=2)",
  "    builder.text('Resumen corto para validar el rail lateral del PDF.')",
  "    builder.heading('Detalle de tabla', level=2)",
  "    builder.text('Detalle corto en la misma pagina para probar destinos exactos.')",
  "    builder.heading('Cierre', level=2)",
  "    builder.text('Cierre corto para validar el item activo del indice.')",
  "    builder.text('Revision DOCX descargada desde el boton principal.')",
  "    builder.table([",
  "        ['Parametro', 'Valor'],",
  "        ['L', str(L)],",
  "        ['w', str(w)],",
  "        ['reaction', str(reaction)],",
  "        ['M_max', str(M_max)],",
  "        ['revision', 'B'],",
  "    ], headers=['Nombre', 'Resultado'], style='Table Grid')",
  "print('playwright docx revision ok')",
].join('\n');

const downloadDocxHash = async (page) => {
  const [response] = await Promise.all([
    page.waitForResponse(
      async (candidate) => candidate.ok() && candidate.url().includes('/api/docx/download'),
      { timeout: 120000 },
    ),
    page.getByRole('button', { name: /^DOCX$/i }).first().click(),
  ]);
  const buffer = Buffer.from(await response.body());
  return {
    hash: createHash('sha256').update(buffer).digest('hex'),
    url: response.url(),
  };
};

const toNotebookSource = (source: string) => (
  source.split('\n').map((line, index, lines) => (index === lines.length - 1 ? line : `${line}\n`))
);

const getLatestDocxHistoryEntry = async (request, harness) => {
  const response = await request.get(`${harness.urls.backend}/api/docx/history`, {
    params: { source_path: harness.files.reportNotebook, limit: 20 },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload?.items?.[0] || null;
};

const waitForLatestDocxArtifactChange = async (request, harness, previousArtifactId) => {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 120000) {
    const latestEntry = await getLatestDocxHistoryEntry(request, harness);
    if (latestEntry?.artifact_id && latestEntry.artifact_id !== previousArtifactId) {
      return latestEntry;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for a newer DOCX artifact');
};

const getRunAllCompletedPattern = (executed: number, total = executed) => new RegExp(
  `Run All completado \\(${executed}\\/${total} celdas\\)\\.`,
  'i',
);

const maybeAssertRunAllCompletedNotification = async (page, executed: number, total = executed) => {
  const messagePattern = getRunAllCompletedPattern(executed, total);

  await page.getByText(messagePattern).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => null);

  const notificationCenter = page.getByRole('button', { name: /Centro de notificaciones/i });
  await notificationCenter.click();
  await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 15000 });
  const notificationText = await page.getByTestId('notification-dropdown').textContent();
  await notificationCenter.click();
  await expect(page.getByTestId('notification-dropdown')).toHaveCount(0, { timeout: 15000 });
  if (notificationText && messagePattern.test(notificationText)) {
    return true;
  }
  return false;
};

test.describe.serial('Notebook And DOCX', () => {
  test('keeps Run All visible across home/file navigation and delivers document output', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    const resetDocxResponse = await request.post(`${harness.urls.backend}/api/docx/test/reset`, {
      data: { source_path: harness.files.reportNotebook },
    });
    expect(resetDocxResponse.ok()).toBeTruthy();

    const pdfStatusResponse = await request.get(`${harness.urls.backend}/pdf-status`);
    const pdfStatus = await pdfStatusResponse.json();
    const pdfAvailable = Boolean(
      pdfStatus?.available
      || pdfStatus?.pdf_available
      || pdfStatus?.word_available
      || pdfStatus?.libreoffice_available
    );

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');
    await openNotebookFromTree(page, 'report.ipynb');

    await page.getByTestId('notebook-toolbar-run-all').click();
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('process-rail-execution')).not.toContainText(
      'Iniciando kernel para ejecutar Run All...',
      { timeout: 30000 },
    );
    await expect(page.getByTestId('notebook-toolbar-run-all')).toBeDisabled({ timeout: 15000 });
    await expect(page.getByTestId('notebook-toolbar-run-all')).toBeEnabled({ timeout: 120000 });
    await maybeAssertRunAllCompletedNotification(page, 2);
    await expect(page.getByRole('button', { name: /DOCX/i }).first()).toBeVisible({ timeout: 120000 });

    const firstDocxEntry = await waitForLatestDocxArtifactChange(request, harness, null);
    const firstDocxDownload = await downloadDocxHash(page);
    const firstDocxHash = firstDocxDownload.hash;

    if (pdfAvailable) {
      await expect(page.getByTestId('docx-pdf-toolbar')).toBeVisible({ timeout: 120000 });
      await expect(page.getByTestId('docx-page-indicator')).toBeVisible({ timeout: 120000 });
    } else {
      await expect(page.getByText(/PDF:/i).first()).toBeVisible({ timeout: 30000 });
    }

    const notebookReadResponse = await request.get(`${harness.urls.backend}/api/files/read`, {
      params: { path: harness.files.reportNotebook },
    });
    expect(notebookReadResponse.ok()).toBeTruthy();
    const notebookReadPayload = await notebookReadResponse.json();
    const notebookContent = notebookReadPayload.content;
    notebookContent.cells.push({
      id: 'docx-revision-cell',
      cell_type: 'code',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toNotebookSource(REVISION_DOCX_CELL_SOURCE),
    });

    const notebookWriteResponse = await request.post(`${harness.urls.backend}/api/files/write`, {
      data: {
        path: harness.files.reportNotebook,
        content: notebookContent,
      },
    });
    expect(notebookWriteResponse.ok()).toBeTruthy();

    await page.reload();
    await openNotebookFromTree(page, 'report.ipynb');
    await page.getByTestId('notebook-toolbar-run-all').click();
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('process-rail-execution')).not.toContainText(
      'Iniciando kernel para ejecutar Run All...',
      { timeout: 30000 },
    );
    await expect(page.getByTestId('notebook-toolbar-run-all')).toBeDisabled({ timeout: 15000 });
    await page.getByTestId('desktop-titlebar-go-home').click();
    await expect(page.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeVisible({ timeout: 15000 });
    await waitForLatestDocxArtifactChange(request, harness, firstDocxEntry?.artifact_id || null);
    await maybeAssertRunAllCompletedNotification(page, 3);
    await page.getByTestId('desktop-titlebar-go-file').click();
    await expect(page.getByTestId('notebook-toolbar')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /DOCX/i }).first()).toBeVisible({ timeout: 120000 });

    const secondDocxDownload = await downloadDocxHash(page);
    expect(secondDocxDownload.hash).not.toBe(firstDocxHash);

    if (pdfAvailable) {
      await expect(page.getByTestId('docx-pdf-toolbar')).toBeVisible({ timeout: 120000 });
      const outlineToggle = page.getByTestId('docx-outline-toggle');
      await expect(outlineToggle).toBeVisible({ timeout: 120000 });
      await expect(outlineToggle).toBeEnabled({ timeout: 120000 });

      await outlineToggle.click();
      const outlineRail = page.getByTestId('docx-outline-rail');
      await expect(outlineRail).toBeVisible({ timeout: 120000 });

      const outlineItems = page.locator('[data-testid^="docx-outline-item-"]');
      expect(await outlineItems.count()).toBeGreaterThanOrEqual(2);

      const pageIndicatorBefore = (await page.getByTestId('docx-page-indicator').textContent())?.trim() || '';
      const secondOutlineItem = page.getByTestId('docx-outline-item-1');
      await secondOutlineItem.click();
      await expect(secondOutlineItem).toHaveAttribute('data-active', 'true');
      await expect(page.getByTestId('docx-page-indicator')).toHaveText(pageIndicatorBefore);

      await page.setViewportSize({ width: 980, height: 900 });
      await expect(page.getByTestId('docx-outline-rail')).toHaveClass(/is-overlay/);
      await expect(page.getByTestId('docx-outline-backdrop')).toBeVisible({ timeout: 15000 });
      await page.getByTestId('docx-outline-backdrop').click();
      await expect(page.locator('[data-testid="docx-outline-rail"]')).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
});
