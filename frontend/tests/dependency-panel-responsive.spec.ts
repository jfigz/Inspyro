import { test, expect } from './helpers/testHarness';
import {
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Dependency Panel Responsive', () => {
  test('keeps dependency tabs visible and accepts the manual target for analysis', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');

    await page.setViewportSize({ width: 760, height: 900 });
    await gotoShell(page);
    await openNotebookFromTree(page, 'report.ipynb');

    await expect(page.getByTestId('visualization-view-docx')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('visualization-view-dependencies')).toBeVisible();
    await expect(page.getByTestId('visualization-view-variables')).toBeVisible();

    await page.getByTestId('visualization-view-dependencies').click();
    await expect(page.locator('.dependency-empty-state')).toBeVisible({ timeout: 10000 });

    const hideExplorerButton = page.getByRole('button', { name: /Ocultar explorador de archivos/i }).first();
    if (await hideExplorerButton.isVisible().catch(() => false)) {
      await hideExplorerButton.click();
    }

    const dependencyForm = page.locator('.dependency-manual-form');
    await expect(dependencyForm).toBeVisible({ timeout: 15000 });
    await dependencyForm.getByLabel('Analizar simbolo').fill('M_max');
    await dependencyForm.getByRole('button', { name: 'Dependencias' }).click();

    await expect(page.locator('.dependency-graph-header')).toContainText(/Dependencias de/i, { timeout: 30000 });
  });
});
