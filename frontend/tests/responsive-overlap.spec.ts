import type { Page } from '@playwright/test';
import { test, expect } from './helpers/testHarness';
import {
  gotoShell,
  openFileFromTree,
  openNotebookFromTree,
} from './helpers/ui';
import {
  expectInsideViewport,
  expectNoOverlap,
} from './helpers/layout';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

const VIEWPORTS = [
  { width: 393, height: 852 },
  { width: 640, height: 720 },
  { width: 760, height: 900 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const settleLayout = async (page: Page) => {
  await page.waitForTimeout(120);
};

test.describe.serial('Responsive Overlap Guard', () => {
  test('keeps titlebar, notification dropdown, and Home controls in bounds', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    await request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoShell(page);
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 20000 });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await settleLayout(page);

      await expectInsideViewport(page, [
        { name: 'titlebar', selector: '.desktop-titlebar' },
        { name: 'titlebar identity', selector: '.desktop-titlebar__identity' },
        { name: 'titlebar actions', selector: '.desktop-titlebar__top-actions' },
        { name: 'notification center', selector: '.notification-center' },
        { name: 'connection chip', selector: '.desktop-status-chip' },
        { name: 'mcp status', selector: '.mcp-status-split' },
      ]);

      await expectInsideViewport(page, [
        { name: 'home header', selector: '.agent-workspace-home__header' },
        { name: 'home attention', selector: '.agent-home-attention' },
        { name: 'home lanes', selector: '.agent-home-lanes' },
      ], 0, { vertical: false });

      await expectNoOverlap(page, [
        {
          a: { name: 'notification badge', selector: '.notification-badge' },
          b: { name: 'connection chip', selector: '.desktop-status-chip' },
        },
        {
          a: { name: 'connection chip', selector: '.desktop-status-chip' },
          b: { name: 'mcp status', selector: '.mcp-status-split' },
        },
        {
          a: { name: 'titlebar identity', selector: '.desktop-titlebar__identity' },
          b: { name: 'titlebar actions', selector: '.desktop-titlebar__top-actions' },
        },
      ], 1);

      const badge = page.locator('.notification-badge');
      if (await badge.isVisible().catch(() => false)) {
        await badge.click();
        await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 5000 });
        await expectInsideViewport(page, [
          { name: 'notification dropdown', selector: '[data-testid="notification-dropdown"]' },
        ]);
        await badge.click();
        await expect(page.getByTestId('notification-dropdown')).toHaveCount(0);
      }
    }
  });

  test('keeps file, notebook, and Agents surfaces bounded at compact sizes', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');
    await request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoShell(page);
    await expect(page.getByTestId('explorer-workspace-button')).toContainText('inspyro-e2e', { timeout: 20000 });

    await openFileFromTree(page, 'main.py');
    for (const viewport of [
      { width: 760, height: 900 },
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expectInsideViewport(page, [
        { name: 'main layout', selector: '.main-layout' },
        { name: 'file tabs', selector: '.file-tabs' },
        { name: 'main container', selector: '.main-container' },
        { name: 'code panel', selector: '.code-panel' },
        { name: 'visualization panel', selector: '.visualization-panel' },
      ]);
    }

    await page.getByTestId('mcp-status-button').click();
    await expect(page.locator('.mcp-panel')).toBeVisible({ timeout: 10000 });
    await expectInsideViewport(page, [
      { name: 'mcp panel', selector: '.mcp-panel' },
      { name: 'mcp header', selector: '.mcp-panel-header' },
      { name: 'mcp tabs', selector: '.mcp-panel-tabs' },
    ]);
    await page.getByRole('button', { name: /cerrar panel de agentes/i }).click();
    await expect(page.locator('.mcp-panel')).toHaveCount(0);

    await openNotebookFromTree(page, 'report.ipynb');
    await page.setViewportSize({ width: 760, height: 900 });
    await settleLayout(page);
    await expectInsideViewport(page, [
      { name: 'notebook container', selector: '.notebook-container' },
      { name: 'notebook toolbar', selector: '[data-testid="notebook-toolbar"]' },
      { name: 'visualization tabs', selector: '.visualization-panel .panel-view-toggle' },
    ]);
  });
});
