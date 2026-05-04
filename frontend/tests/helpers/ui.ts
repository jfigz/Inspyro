import { expect, Locator, Page } from '@playwright/test';

export const clearBrowserState = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
};

export const gotoApp = async (page: Page) => {
  await clearBrowserState(page);
  await page.goto('/');

  await Promise.race([
    page.locator('.connection-status').filter({ hasText: /Conectado/i }).first().waitFor({ state: 'visible', timeout: 30000 }),
    page.locator('.desktop-titlebar').getByText(/Conectado/i).first().waitFor({ state: 'visible', timeout: 30000 }),
  ]);

  await Promise.race([
    page.getByTestId('launcher-create-project').waitFor({ state: 'visible', timeout: 30000 }),
    page.getByTestId('explorer-workspace-button').waitFor({ state: 'visible', timeout: 30000 }),
    page.locator('.inspyro-header.compact').waitFor({ state: 'visible', timeout: 30000 }),
    page.locator('.desktop-titlebar').waitFor({ state: 'visible', timeout: 30000 }),
  ]);
};

export const gotoLauncher = async (page: Page) => {
  await gotoApp(page);
  await expect(page.getByTestId('launcher-create-project')).toBeVisible({ timeout: 30000 });
};

export const gotoShell = async (page: Page) => {
  await gotoApp(page);
  await Promise.race([
    page.locator('.inspyro-header.compact').waitFor({ state: 'visible', timeout: 30000 }),
    page.locator('.desktop-titlebar').waitFor({ state: 'visible', timeout: 30000 }),
  ]);
};

export const openWorkspaceFromLauncher = async (page: Page, workspaceName: string) => {
  const workspaceButton = page
    .locator('.project-launcher-recent-item')
    .filter({
      has: page.locator('.project-launcher-recent-name', { hasText: workspaceName }),
    })
    .first();
  await expect(workspaceButton).toBeVisible({ timeout: 15000 });
  await workspaceButton.click();
  await expect(page.getByTestId('explorer-workspace-button')).toContainText(workspaceName, { timeout: 15000 });
};

export const openWorkspacePicker = async (page: Page) => {
  await page.getByTestId('explorer-workspace-button').click();
  await expect(page.getByTestId('folder-selector-dialog')).toBeVisible({ timeout: 15000 });
};

export const selectFolderInPicker = async (page: Page, folderName: string) => {
  const folderItem = page.getByTestId('folder-selector-item').filter({ hasText: folderName }).first();
  await expect(folderItem).toBeVisible({ timeout: 15000 });
  await folderItem.scrollIntoViewIfNeeded();
  await folderItem.click({ force: true });
  return folderItem;
};

export const selectWorkspaceInPicker = async (page: Page, workspaceName: string, maxLevels = 6) => {
  for (let level = 0; level <= maxLevels; level += 1) {
    const folderItem = page.getByTestId('folder-selector-item').filter({ hasText: workspaceName }).first();
    if (await folderItem.isVisible().catch(() => false)) {
      await folderItem.click();
      return folderItem;
    }

    const upButton = page.getByTestId('folder-selector-up');
    if (await upButton.isDisabled().catch(() => true)) {
      break;
    }
    const currentPath = page.getByTestId('folder-selector-current-path');
    const previousPath = (await currentPath.textContent()) || '';
    await upButton.evaluate((element: HTMLButtonElement) => {
      element.click();
    });
    await expect(currentPath).not.toHaveText(previousPath, { timeout: 5000 });
    await page.waitForTimeout(150);
  }

  throw new Error(`No se encontró el workspace '${workspaceName}' en el selector.`);
};

const normalizePickerPath = (value: string) => (
  value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
);

const splitPickerPath = (value: string) => (
  value.trim().replace(/\//g, '\\').replace(/\\+$/, '').split('\\').filter(Boolean)
);

const nextSegmentTowardPath = (currentPath: string, targetPath: string) => {
  const currentParts = splitPickerPath(currentPath);
  const targetParts = splitPickerPath(targetPath);
  if (currentParts.length >= targetParts.length) return null;

  const currentMatchesTarget = currentParts.every(
    (part, index) => part.toLowerCase() === targetParts[index]?.toLowerCase(),
  );
  return currentMatchesTarget ? targetParts[currentParts.length] : null;
};

export const openFolderInPicker = async (page: Page, folderName: string) => {
  const currentPath = page.getByTestId('folder-selector-current-path');
  const previousPath = (await currentPath.textContent()) || '';
  const folderItem = await selectFolderInPicker(page, folderName);
  await folderItem.dblclick();
  await expect(currentPath).not.toHaveText(previousPath, { timeout: 5000 });
};

export const navigatePickerToPath = async (page: Page, targetPath: string, maxSteps = 24) => {
  const currentPath = page.getByTestId('folder-selector-current-path');
  const normalizedTarget = normalizePickerPath(targetPath);

  for (let step = 0; step < maxSteps; step += 1) {
    const currentText = ((await currentPath.textContent()) || '').trim();
    if (normalizePickerPath(currentText) === normalizedTarget) {
      return;
    }

    const nextSegment = nextSegmentTowardPath(currentText, targetPath);
    if (nextSegment) {
      await openFolderInPicker(page, nextSegment);
      continue;
    }

    const upButton = page.getByTestId('folder-selector-up');
    if (await upButton.isDisabled().catch(() => true)) {
      break;
    }

    await upButton.evaluate((element: HTMLButtonElement) => {
      element.click();
    });
    await expect(currentPath).not.toHaveText(currentText, { timeout: 5000 });
  }

  const finalPath = ((await currentPath.textContent()) || '').trim();
  throw new Error(`No se pudo navegar el selector a '${targetPath}'. Ruta final: '${finalPath}'.`);
};

export const openFileFromTree = async (page: Page, fileName: string) => {
  const fileNode = page.locator('[data-testid="file-tree-file"]').filter({ hasText: fileName }).first();
  await expect(fileNode).toBeVisible({ timeout: 20000 });
  await fileNode.click();
  return fileNode;
};

export const selectFolderFromTree = async (page: Page, folderName: string) => {
  const folderNode = page.locator('[data-testid="file-tree-folder"]').filter({ hasText: folderName }).first();
  await expect(folderNode).toBeVisible({ timeout: 20000 });
  await folderNode.click();
  return folderNode;
};

export const getPrimaryMonacoTextarea = (scope: Page | Locator) => (
  scope.locator('.monaco-editor textarea').first()
);

export const getLastMonacoTextarea = (scope: Page | Locator) => (
  scope.locator('.monaco-editor textarea').last()
);

export const replaceMonacoValue = async (page: Page, textarea: Locator, nextValue: string) => {
  await textarea.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
  });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  if (nextValue) {
    await page.keyboard.insertText(nextValue);
  }
};

export const appendMonacoValue = async (page: Page, textarea: Locator, extraText: string) => {
  await textarea.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
  });
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(extraText);
};

export const waitForNotification = async (page: Page, text: RegExp | string) => {
  await expect(page.locator('.notification-center').getByText(text)).toBeVisible({ timeout: 20000 });
};

export const openNotebookFromTree = async (page: Page, notebookName: string) => {
  await openFileFromTree(page, notebookName);
  await expect(page.getByTestId('notebook-toolbar')).toBeVisible({ timeout: 30000 });
};

export const ensureWorkspaceOpen = async (page: Page, workspaceName: string) => {
  const launcherCreateButton = page.getByTestId('launcher-create-project');
  if (await launcherCreateButton.isVisible().catch(() => false)) {
    await openWorkspaceFromLauncher(page, workspaceName);
    return;
  }

  const workspaceButton = page.getByTestId('explorer-workspace-button');
  await expect(workspaceButton).toBeVisible({ timeout: 20000 });
  if ((await workspaceButton.textContent())?.includes(workspaceName)) {
    return;
  }

  await openWorkspacePicker(page);
  await selectWorkspaceInPicker(page, workspaceName);
  await page.getByTestId('folder-selector-open-workspace').click();
  await expect(workspaceButton).toContainText(workspaceName, { timeout: 20000 });
};
