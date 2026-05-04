import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';
import {
  expectInsideViewport,
  expectNoOverlap,
} from './helpers/layout';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Template Editor', () => {
  test('uploads a DOCX template, renders preview and applies direct table format', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');
    await openNotebookFromTree(page, 'report.ipynb');

    await page.getByTestId('notebook-toolbar-run-all').click();
    await expect(page.locator('.cell-output').first()).toContainText(/reaction|M_max|sigma_adm/i, { timeout: 120000 });

    await page.getByTestId('docx-template-button').click();
    await expect(page.getByTestId('template-editor')).toBeVisible({ timeout: 15000 });

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(harness.files.templateDocx);
    await expect(page.getByTestId('template-sidebar-slots')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('template-slots-panel')).toBeVisible();

    await page.getByTestId('template-sidebar-styles').click();
    await expect(page.getByTestId('template-styles-panel')).toBeVisible();

    await page.getByTestId('template-sidebar-diagnostics').click();
    await expect(page.getByTestId('template-diagnostics-panel')).toBeVisible();

    await page.getByTestId('template-sidebar-slots').click();

    const normalStyle = page.getByText(/^Normal$/).first();
    if (await normalStyle.isVisible().catch(() => false)) {
      await normalStyle.click();
    }

    const renderButton = page.getByRole('button', { name: /Renderizar/i });
    if (await renderButton.isEnabled().catch(() => false)) {
      await renderButton.click();
    }
    await expect(page.locator('.preview-status-line')).toBeVisible({ timeout: 60000 });

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 760, height: 900 },
      { width: 393, height: 852 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(150);
      await expectInsideViewport(page, [
        { name: 'template editor', selector: '[data-testid="template-editor"]' },
        { name: 'template header', selector: '.template-editor-header' },
        { name: 'template sidebar tabs', selector: '.template-sidebar-tabs' },
      ]);
      await expectNoOverlap(page, [
        {
          a: { name: 'template title', selector: '.template-editor-title-group' },
          b: { name: 'template actions', selector: '.header-actions' },
        },
      ], 1);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByTestId('template-sidebar-styles').click();
    const tableCategoryCard = page.locator('.category-browser-card:has([data-testid="template-category-select-tables"])').first();
    if (await tableCategoryCard.isVisible().catch(() => false)) {
      await tableCategoryCard.click();
    }

    const directTab = page.getByTestId('template-tab-direct');
    if (await directTab.isVisible()) {
      await directTab.click();
      await expect(page.getByTestId('template-apply-table-format').first()).toBeVisible({ timeout: 30000 });
      await page.getByTestId('template-apply-table-format').first().click();
    }

    await page.getByTestId('template-close-button').click();
    await expect(page.getByTestId('template-editor')).toHaveCount(0);
  });
});
