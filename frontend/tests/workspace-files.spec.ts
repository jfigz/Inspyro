import { test, expect } from './helpers/testHarness';
import {
  getPrimaryMonacoTextarea,
  gotoLauncher,
  gotoShell,
  navigatePickerToPath,
  openFileFromTree,
  openNotebookFromTree,
  openWorkspacePicker,
  selectFolderFromTree,
  selectFolderInPicker,
  selectWorkspaceInPicker,
  replaceMonacoValue,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Workspace And Files', () => {
  test('launcher creates a workspace and explorer switches to another one', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'launcher');
    await expect.poll(async () => {
      const response = await request.get(`${harness.urls.backend}/api/system/info`);
      const payload = await response.json();
      return payload?.active_workspace ?? null;
    }).toBeNull();

    await gotoLauncher(page);
    await expect(page.getByTestId('launcher-recent-workspace').filter({ hasText: 'inspyro-recent' })).toBeVisible();
    await page.getByTestId('launcher-create-project').click();
    await expect(page.getByTestId('folder-selector-dialog')).toBeVisible();
    await navigatePickerToPath(page, harness.projectsDir);
    await page.getByTestId('folder-selector-workspace-name').fill('ui-created-workspace');
    await page.getByTestId('folder-selector-create-workspace').click();

    await expect(page.getByTestId('explorer-workspace-button')).toContainText('ui-created-workspace', { timeout: 15000 });

    await openWorkspacePicker(page);
    await selectWorkspaceInPicker(page, 'inspyro-e2e');
    await page.getByTestId('folder-selector-open-workspace').click();

    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 15000 });
    await openWorkspacePicker(page);
    await selectWorkspaceInPicker(page, 'inspyro-recent');
    await page.getByTestId('folder-selector-open-workspace').click();
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-recent', { timeout: 15000 });
    await openNotebookFromTree(page, 'quickstart.ipynb');
  });

  test('explorer supports create, edit, save, rename and delete', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    await expect.poll(async () => {
      const response = await request.get(`${harness.urls.backend}/api/system/info`);
      const payload = await response.json();
      return payload?.active_workspace ?? null;
    }).toContain('inspyro-e2e');

    await gotoShell(page);
    const workspaceButton = page.getByTestId('explorer-workspace-button');
    if (!(await workspaceButton.textContent())?.includes('inspyro-e2e')) {
      await openWorkspacePicker(page);
      await selectWorkspaceInPicker(page, 'inspyro-e2e');
      await page.getByTestId('folder-selector-open-workspace').click();
    }
    await expect(workspaceButton).toContainText('inspyro-e2e', { timeout: 15000 });

    await openFileFromTree(page, 'main.py');
    await expect(page.locator('.file-tab.active')).toContainText('main.py');

    await openFileFromTree(page, 'notes.md');
    await expect(page.locator('.file-tab.active')).toContainText('notes.md');

    await page.getByTestId('explorer-new-folder').click();
    await expect(page.getByTestId('file-action-dialog')).toBeVisible();
    await page.getByTestId('file-action-name-input').fill('drafts');
    await page.getByTestId('file-action-confirm').click();
    await selectFolderFromTree(page, 'drafts');

    await page.getByTestId('explorer-new-file').click();
    await page.getByTestId('file-action-name-input').fill('checklist.md');
    await page.getByTestId('file-action-confirm').click();

    await expect(page.locator('.file-tab.active')).toContainText('checklist.md');

    const editor = getPrimaryMonacoTextarea(page);
    await editor.waitFor({ state: 'visible' });
    await replaceMonacoValue(page, editor, '# Checklist\n\n- validar explorer\n- validar guardado');

    await expect(page.locator('.file-tab.modified').filter({ hasText: 'checklist.md' })).toBeVisible({ timeout: 15000 });
    await page.locator('.save-all-btn').click();
    await expect(page.locator('.file-tab.modified').filter({ hasText: 'checklist.md' })).toHaveCount(0, { timeout: 15000 });

    await page.getByTestId('explorer-rename').click();
    await page.getByTestId('file-action-name-input').fill('checklist-final.md');
    await page.getByTestId('file-action-confirm').click();

    await expect(page.locator('.file-tab').filter({ hasText: 'checklist-final.md' })).toBeVisible();

    await page.getByTestId('explorer-delete').click();
    await expect(page.getByTestId('file-action-delete-warning')).toBeVisible();
    await page.getByTestId('file-action-confirm').click();

    await expect(page.locator('[data-testid="file-tree-file"]').filter({ hasText: 'checklist-final.md' })).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.file-tab').filter({ hasText: 'checklist-final.md' })).toHaveCount(0);
  });
});
