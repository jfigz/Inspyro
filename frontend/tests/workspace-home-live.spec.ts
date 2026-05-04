import { test, expect } from './helpers/testHarness';
import {
  ensureWorkspaceOpen,
  gotoShell,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

test.describe.serial('Workspace Home Live', () => {
  test('updates the MCP card in place when new activity arrives', async ({ page, harness, request }) => {
    restoreSeedFixtures(harness, 'seeded');

    await gotoShell(page);
    await ensureWorkspaceOpen(page, 'inspyro-e2e');

    const homeRegion = page.getByRole('region', { name: /Inicio del espacio de trabajo de agentes/i });
    await expect(homeRegion).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('agent-home-lane-run')).toBeVisible();

    const heartbeatResponse = await request.post(`${harness.urls.backend}/api/mcp/client-heartbeat`, {
      data: {
        client_id: 'home-live-client',
        client_label: 'Home Live Agent',
        transport: 'streamable-http',
      },
    });
    expect(heartbeatResponse.ok()).toBeTruthy();

    const activityResponse = await request.post(`${harness.urls.backend}/api/mcp/activity/events`, {
      data: {
        run_id: 'run-home-live',
        phase: 'started',
        tool_name: 'execute_all_cells',
        tool_group: 'notebook',
        summary: 'Home live activity visible without navigation',
        client_id: 'home-live-client',
        transport: 'streamable-http',
      },
    });
    expect(activityResponse.ok()).toBeTruthy();

    await expect(page.getByText('Home Live Agent')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Home live activity visible without navigation/i)).toBeVisible({ timeout: 20000 });
    await expect(homeRegion).toBeVisible();
    await expect(page.getByTestId('notebook-toolbar')).toHaveCount(0);
  });
});
