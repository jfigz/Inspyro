import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Analysis And Units', () => {
  test('opens dependency analysis and converts engineering units', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');
    await openNotebookFromTree(page, 'report.ipynb');

    await page.getByTestId('notebook-toolbar-run-all').click();

    await page.getByTestId('visualization-view-variables').click();
    await expect(page.getByTestId('quantity-variable-card').first()).toBeVisible({ timeout: 60000 });

    const firstCard = page.getByTestId('quantity-variable-card').first();
    const targetSelect = firstCard.getByTestId('quantity-variable-target-unit');
    await targetSelect.selectOption({ index: 1 });
    await firstCard.getByTestId('quantity-variable-convert').click();
    await expect(firstCard.locator('.quantity-vars__feedback--success')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('visualization-view-dependencies').click();
    const dependencyForm = page.locator('.dependency-manual-form');
    await expect(dependencyForm).toBeVisible({ timeout: 15000 });
    await dependencyForm.getByLabel('Analizar simbolo').fill('M_max');
    await dependencyForm.getByRole('button', { name: 'Dependencias' }).click();
    await expect(page.locator('.dependency-graph-header')).toContainText(/Dependencias de/i, { timeout: 30000 });

    await page.getByRole('button', { name: /More/i }).click();
    await page.getByRole('button', { name: /Sensibilidad/i }).click();
    await expect(page.locator('.sensitivity-panel')).toBeVisible({ timeout: 15000 });
    await page.locator('.sensitivity-close-btn').click();
    await expect(page.locator('.sensitivity-panel')).toHaveCount(0);

    await page.getByRole('button', { name: /More/i }).click();
    await page.getByRole('button', { name: /Optimizar/i }).click();
    await expect(page.locator('.optimization-panel')).toBeVisible({ timeout: 15000 });
  });
});
