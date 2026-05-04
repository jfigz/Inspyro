import type { Locator, Page } from '@playwright/test';
import { test, expect } from './helpers/testHarness';
import {
  clearBrowserState,
  openFileFromTree,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

const getWidth = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('No se pudo medir el ancho del elemento solicitado.');
  }
  return box.width;
};

const dragResizer = async (page: Page, locator: Locator, deltaX: number) => {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('No se pudo ubicar el resizer para arrastrarlo.');
  }

  const startX = box.x + (box.width / 2);
  const startY = box.y + (box.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(120);
};

const beginResizerDrag = async (page: Page, locator: Locator, deltaX: number) => {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('No se pudo ubicar el resizer para arrastrarlo.');
  }

  const startX = box.x + (box.width / 2);
  const startY = box.y + (box.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 16 });
  await page.waitForTimeout(120);
};

const bootShell = async (page: Page) => {
  await clearBrowserState(page);
  await page.goto('/');
  await Promise.race([
    page.getByTestId('launcher-create-project').waitFor({ state: 'visible', timeout: 30000 }),
    page.getByTestId('explorer-workspace-button').waitFor({ state: 'visible', timeout: 30000 }),
    page.locator('.App').waitFor({ state: 'visible', timeout: 30000 }),
  ]);
};

test.describe.serial('Shell Layout', () => {
  test('explorer and code visualization resizers stay bounded', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    await request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await bootShell(page);
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 15000 });
    await openFileFromTree(page, 'main.py');

    const explorer = page.locator('.file-explorer');
    const codePanel = page.locator('.code-panel');
    const mainContainer = page.locator('.main-container');
    const explorerResizer = page.getByTestId('shell-resizer-explorer');
    const visualizationResizer = page.getByTestId('shell-resizer-code-viz');

    await expect(codePanel).toBeVisible({ timeout: 15000 });

    const initialExplorerWidth = await getWidth(explorer);
    await beginResizerDrag(page, explorerResizer, 220);
    const previewExplorerWidth = await getWidth(explorer);
    expect(previewExplorerWidth).toBeGreaterThan(initialExplorerWidth + 40);
    await page.mouse.up();
    await page.waitForTimeout(120);
    const expandedExplorerWidth = await getWidth(explorer);
    expect(expandedExplorerWidth).toBeGreaterThan(initialExplorerWidth + 40);
    expect(expandedExplorerWidth).toBeLessThanOrEqual(428);

    await dragResizer(page, explorerResizer, -520);
    const clampedExplorerWidth = await getWidth(explorer);
    expect(clampedExplorerWidth).toBeGreaterThanOrEqual(218);
    expect(clampedExplorerWidth).toBeLessThanOrEqual(224);

    const splitWidth = await getWidth(mainContainer);
    const initialCodeWidth = await getWidth(codePanel);

    await beginResizerDrag(page, visualizationResizer, 180);
    const previewCodeWidth = await getWidth(codePanel);
    expect(previewCodeWidth).toBeGreaterThan(initialCodeWidth + 30);
    await page.mouse.up();
    await page.waitForTimeout(120);
    const expandedCodeWidth = await getWidth(codePanel);
    expect(expandedCodeWidth).toBeGreaterThan(initialCodeWidth + 30);
    expect(expandedCodeWidth).toBeLessThanOrEqual(splitWidth * 0.76);

    await dragResizer(page, visualizationResizer, -720);
    const clampedCodeWidth = await getWidth(codePanel);
    expect(clampedCodeWidth).toBeGreaterThanOrEqual(splitWidth * 0.24);
    expect(clampedCodeWidth).toBeLessThanOrEqual(splitWidth * 0.31);
  });

  test('notebook visualization resizer stays bounded in notebook mode', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    await request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await bootShell(page);
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 15000 });
    await openNotebookFromTree(page, 'report.ipynb');

    const notebookContainer = page.locator('.notebook-container');
    const notebookPanel = page.locator('.notebook-panel');
    const notebookResizer = page.getByTestId('resizer-redimensionar-panel-de-visualizacion');

    await expect(page.getByTestId('notebook-toolbar')).toBeVisible({ timeout: 30000 });

    const splitWidth = await getWidth(notebookContainer);
    const initialNotebookWidth = await getWidth(notebookPanel);

    await beginResizerDrag(page, notebookResizer, 200);
    const previewNotebookWidth = await getWidth(notebookPanel);
    expect(previewNotebookWidth).toBeGreaterThan(initialNotebookWidth + 30);
    await page.mouse.up();
    await page.waitForTimeout(120);
    const expandedNotebookWidth = await getWidth(notebookPanel);
    expect(expandedNotebookWidth).toBeGreaterThan(initialNotebookWidth + 30);
    expect(expandedNotebookWidth).toBeLessThanOrEqual(splitWidth * 0.76);

    await dragResizer(page, notebookResizer, -760);
    const clampedNotebookWidth = await getWidth(notebookPanel);
    expect(clampedNotebookWidth).toBeGreaterThanOrEqual(splitWidth * 0.24);
    expect(clampedNotebookWidth).toBeLessThanOrEqual(splitWidth * 0.31);
  });
});
