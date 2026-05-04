import { test, expect } from './helpers/testHarness';
import {
  gotoApp,
  openFileFromTree,
  openWorkspacePicker,
  selectWorkspaceInPicker,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Responsive Smoke', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('launcher and notebook basic flow stay usable on mobile width', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'launcher');

    await gotoApp(page);
    const launcherCreate = page.getByTestId('launcher-create-project');
    if (await launcherCreate.isVisible().catch(() => false)) {
      await expect(launcherCreate).toBeVisible();
      await expect(page.getByTestId('launcher-open-project')).toBeVisible();
      await launcherCreate.click();
    } else {
      await openWorkspacePicker(page);
    }

    await page.getByTestId('folder-selector-workspace-name').fill('mobile-workspace');
    await page.getByTestId('folder-selector-create-workspace').click();
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('mobile-workspace', { timeout: 15000 });

    await openWorkspacePicker(page);
    await selectWorkspaceInPicker(page, 'inspyro-e2e');
    await page.getByTestId('folder-selector-open-workspace').click();
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 15000 });
    await expect(page.getByTestId('mcp-status-button')).toBeVisible({ timeout: 15000 });

    await openFileFromTree(page, 'report.ipynb');
    await expect(page.getByTestId('notebook-toolbar')).toBeVisible({ timeout: 30000 });
  });
});
