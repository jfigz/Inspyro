import { test, expect } from './helpers/testHarness';
import { McpHttpClient } from './helpers/mcpClient';
import {
  ensureWorkspaceOpen,
  getPrimaryMonacoTextarea,
  gotoShell,
  openFileFromTree,
  replaceMonacoValue,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('MCP UI', () => {
  test('starts MCP from the UI, shows activity and mirrors safe file updates', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');
    await openFileFromTree(page, 'notes.md');

    await page.getByTestId('mcp-status-button').click();
    await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('mcp-start').click();
    await expect(page.getByTestId('mcp-stop')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('mcp-tab-activity').click();
    const mirrorToggle = page.getByTestId('mcp-panel-mirror-toggle');
    await expect(mirrorToggle).toBeVisible({ timeout: 15000 });
    if ((await mirrorToggle.getAttribute('aria-pressed')) !== 'true') {
      await mirrorToggle.click();
    }
    await expect(mirrorToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });

    await page.getByTestId('mcp-tab-info').click();
    await expect(page.locator('.mcp-info-grid')).toContainText(harness.urls.mcp, { timeout: 15000 });

    const mcp = new McpHttpClient(harness.urls.mcp);
    const initializeResult = await mcp.initialize();
    expect(initializeResult?.serverInfo?.name || '').toMatch(/inspyro/i);

    const profileResult = await mcp.callTool('set_component_profile', { profile: 'files' });
    expect(JSON.stringify(profileResult || {})).toMatch(/files/i);

    const tools = await mcp.listTools();
    const resources = await mcp.listResources();
    expect((tools?.tools || []).length).toBeGreaterThanOrEqual(10);
    expect((tools?.tools || []).some((tool) => tool?.name === 'write_file')).toBeTruthy();
    expect((tools?.tools || []).some((tool) => tool?.name === 'create_file')).toBeTruthy();
    expect((resources?.resources || []).length).toBeGreaterThan(5);

    await mcp.callTool('write_file', {
      path: 'notes.md',
      content: '# Notas remotas\n\nContenido sincronizado desde MCP limpio.\n',
    });

    await expect(page.locator('.view-lines')).toContainText(/Contenido\s+sincronizado\s+desde\s+MCP\s+limpio/i, { timeout: 30000 });

    await page.getByTestId('mcp-tab-activity').click();
    await expect(page.locator('.mcp-activity-list')).toContainText(/write_file/i, { timeout: 30000 });

    const editor = getPrimaryMonacoTextarea(page);
    await editor.waitFor({ state: 'visible' });
    await replaceMonacoValue(page, editor, '# Local dirty\n\nNo sobrescribir este contenido.\n');
    await expect(page.locator('.file-tab.modified').filter({ hasText: 'notes.md' })).toBeVisible({ timeout: 15000 });

    await mcp.callTool('write_file', {
      path: 'notes.md',
      content: '# Notas remotas\n\nEste cambio no debe reflejarse porque el archivo esta dirty.\n',
    });

    await expect(page.locator('.view-lines')).toContainText(/No\s+sobrescribir\s+este\s+contenido/i, { timeout: 15000 });
    await page.getByTestId('mcp-panel').getByRole('button', { name: 'Cerrar panel de agentes' }).click();
    await page.locator('.notification-badge').click();
    await expect(page.locator('.notification-dropdown')).toContainText(/MCP no reflejado|cambios locales sin guardar/i, { timeout: 30000 });
    await page.locator('.notification-badge').click();

    await mcp.callTool('create_file', {
      path: 'mcp-created.txt',
      is_directory: false,
    });
    await expect(page.locator('[data-testid="file-tree-file"]').filter({ hasText: 'mcp-created.txt' })).toBeVisible({ timeout: 30000 });

    await page.getByTestId('mcp-status-button').click();
    await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('mcp-tab-logs').click();
    await expect(page.locator('.mcp-logs-container')).toBeVisible();

    await page.getByTestId('mcp-stop').click();
    await expect(page.getByTestId('mcp-start')).toBeVisible({ timeout: 30000 });
  });
});
