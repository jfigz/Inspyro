import path from 'path';

import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

const toNotebookSource = (source: string) => (
  source.split('\n').map((line, index, lines) => (index === lines.length - 1 ? line : `${line}\n`))
);

const makeCodeCell = (id: string, source: string) => ({
  id,
  cell_type: 'code',
  metadata: {},
  execution_count: null,
  outputs: [],
  source: toNotebookSource(source),
});

const buildParallelNotebook = (label: string) => ({
  cells: [
    makeCodeCell(
      `${label}-cell-1`,
      [
        'import time',
        `print('${label} first start')`,
        'time.sleep(2.0)',
        `print('${label} first end')`,
      ].join('\n'),
    ),
    makeCodeCell(
      `${label}-cell-2`,
      [
        `print('${label} second done')`,
      ].join('\n'),
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
});

const buildDocumentParallelNotebook = (label: string) => ({
  cells: [
    makeCodeCell(
      `${label}-cell-1`,
      [
        'import time',
        `print('${label} first start')`,
        'time.sleep(1.5)',
        `print('${label} first end')`,
      ].join('\n'),
    ),
    makeCodeCell(
      `${label}-cell-2`,
      [
        'from librerias_propias.docx_builder.api import build_doc, doc_reset',
        '',
        'doc_reset(hard=True)',
        "with build_doc(block_id='cover', order=10) as builder:",
        `    builder.heading('Parallel document ${label}', level=1)`,
        `    builder.text('Notebook ${label} document output')`,
        `print('${label} document done')`,
      ].join('\n'),
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
});

test.describe.serial('Notebook Parallel Runtime', () => {
  test('keeps two Run All sessions advancing in parallel across tab switches', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');

    const secondNotebookName = 'beta.ipynb';
    const secondNotebookPath = path.join(harness.workspaces.seeded, secondNotebookName);
    const writeFirstNotebook = await request.post(`${harness.urls.backend}/api/files/write`, {
      data: {
        path: harness.files.reportNotebook,
        content: buildParallelNotebook('A'),
      },
    });
    expect(writeFirstNotebook.ok()).toBeTruthy();

    const writeSecondNotebook = await request.post(`${harness.urls.backend}/api/files/write`, {
      data: {
        path: secondNotebookPath,
        content: buildParallelNotebook('B'),
      },
    });
    expect(writeSecondNotebook.ok()).toBeTruthy();

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');

    await openNotebookFromTree(page, 'report.ipynb');
    await page.getByTestId('notebook-toolbar-run-all').click();
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });

    await openNotebookFromTree(page, secondNotebookName);
    await page.getByTestId('notebook-toolbar-run-all').click();
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });

    await openNotebookFromTree(page, 'report.ipynb');
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });
    await openNotebookFromTree(page, secondNotebookName);
    await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('B second done').first()).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('notebook-toolbar-run-all')).toBeEnabled({ timeout: 30000 });
    await expect(page.getByTestId('process-rail-execution')).toHaveCount(0, { timeout: 30000 });

    await openNotebookFromTree(page, 'report.ipynb');
    await expect(page.getByText('A second done').first()).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('notebook-toolbar-run-all')).toBeEnabled({ timeout: 30000 });
    await expect(page.getByTestId('process-rail-execution')).toHaveCount(0, { timeout: 30000 });
  });

  test('keeps three notebook document pipelines independent and exposes shared PDF queue state', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');

    const secondNotebookName = 'beta.ipynb';
    const thirdNotebookName = 'gamma.ipynb';
    const secondNotebookPath = path.join(harness.workspaces.seeded, secondNotebookName);
    const thirdNotebookPath = path.join(harness.workspaces.seeded, thirdNotebookName);

    const pdfStatusResponse = await request.get(`${harness.urls.backend}/pdf-status`);
    const pdfStatus = await pdfStatusResponse.json();
    const pdfAvailable = Boolean(
      pdfStatus?.available
      || pdfStatus?.pdf_available
      || pdfStatus?.word_available
      || pdfStatus?.libreoffice_available
    );
    const wordAvailable = Boolean(pdfStatus?.word_available);

    for (const [targetPath, notebook] of [
      [harness.files.reportNotebook, buildDocumentParallelNotebook('A')],
      [secondNotebookPath, buildDocumentParallelNotebook('B')],
      [thirdNotebookPath, buildDocumentParallelNotebook('C')],
    ] as const) {
      const response = await request.post(`${harness.urls.backend}/api/files/write`, {
        data: {
          path: targetPath,
          content: notebook,
        },
      });
      expect(response.ok()).toBeTruthy();
    }

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');

    for (const notebookName of ['report.ipynb', secondNotebookName, thirdNotebookName]) {
      await openNotebookFromTree(page, notebookName);
      await page.getByTestId('notebook-toolbar-run-all').click();
      await expect(page.getByTestId('process-rail-execution')).toBeVisible({ timeout: 15000 });
    }

    if (wordAvailable) {
      await openNotebookFromTree(page, thirdNotebookName);
      await expect(page.getByTestId('process-rail-document')).toContainText(/convertidor PDF compartido/i, { timeout: 120000 });

      await page.getByTestId('desktop-titlebar-go-home').click();
      await expect(page.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: /Notebooks/i }).first().click();
      await expect(page.getByText(/convertidor PDF compartido/i).first()).toBeVisible({ timeout: 30000 });
    }

    for (const [notebookName, readyText] of [
      ['report.ipynb', 'A document done'],
      [secondNotebookName, 'B document done'],
      [thirdNotebookName, 'C document done'],
    ] as const) {
      await openNotebookFromTree(page, notebookName);
      await expect(page.getByText(readyText).first()).toBeVisible({ timeout: 120000 });
      await expect(page.getByRole('button', { name: /^DOCX$/i }).first()).toBeVisible({ timeout: 120000 });
      await expect(page.getByTestId('process-rail-execution')).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByTestId('process-rail-document')).toHaveCount(0, { timeout: 30000 });

      if (pdfAvailable) {
        await expect(page.getByTestId('docx-pdf-toolbar')).toBeVisible({ timeout: 120000 });
      }
    }
  });
});
