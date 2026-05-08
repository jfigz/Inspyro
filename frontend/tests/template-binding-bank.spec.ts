import fs from 'fs';
import path from 'path';

import { test, expect } from './helpers/testHarness';
import { McpHttpClient } from './helpers/mcpClient';
import {
  ensureWorkspaceOpen,
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

type ScenarioRecord = {
  requirement: string;
  scenario: string;
  status: string;
  result?: any;
  artifacts?: any;
  finished_at: string;
};

type BindingBankReport = {
  runId: string;
  outputDir: string;
  scenarios: ScenarioRecord[];
  add: (requirement: string, scenario: string, status: string, result?: any, artifacts?: any) => void;
  write: () => void;
};

const createReport = (harness: any): BindingBankReport => {
  const runId = `${harness.runId}-template-binding-bank`;
  const outputDir = path.join(harness.repoRoot, 'output', 'template-binding-bank', runId);
  fs.mkdirSync(outputDir, { recursive: true });
  const scenarios: ScenarioRecord[] = [];
  return {
    runId,
    outputDir,
    scenarios,
    add(requirement, scenario, status, result = {}, artifacts = {}) {
      scenarios.push({
        requirement,
        scenario,
        status,
        result,
        artifacts,
        finished_at: new Date().toISOString(),
      });
    },
    write() {
      const statusCounts = scenarios.reduce((counts, scenario) => {
        counts[scenario.status] = (counts[scenario.status] || 0) + 1;
        return counts;
      }, {} as Record<string, number>);
      const payload = {
        schema_version: 'template-binding-bank-report@1',
        title: 'Template Binding JSON Bank',
        run_id: runId,
        generated_at: new Date().toISOString(),
        status_counts: statusCounts,
        scenarios,
      };
      fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(payload, null, 2), 'utf8');
      const rows = [
        '# Template Binding JSON Bank',
        '',
        `- Run id: \`${runId}\``,
        `- Status: ${Object.entries(statusCounts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
        '',
        '| Requisito | Escenario | Resultado | Artefactos |',
        '|---|---|---:|---|',
      ];
      for (const scenario of scenarios) {
        rows.push(`| ${escapeMd(scenario.requirement)} | ${escapeMd(scenario.scenario)} | ${escapeMd(scenario.status)} | ${escapeMd(JSON.stringify(scenario.artifacts || {}))} |`);
      }
      fs.writeFileSync(path.join(outputDir, 'summary.md'), `${rows.join('\n')}\n`, 'utf8');
    },
  };
};

const escapeMd = (value: string) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

const runScenario = async (
  report: BindingBankReport,
  requirement: string,
  scenario: string,
  fn: () => Promise<{ result?: any; artifacts?: any }>,
) => {
  try {
    const output = await fn();
    report.add(requirement, scenario, 'passed', output.result, output.artifacts);
  } catch (error: any) {
    report.add(requirement, scenario, 'failed', { message: String(error?.message || error) });
    throw error;
  }
};

const openTemplateEditor = async (page: any) => {
  const primary = page.getByTestId('docx-template-button');
  if (await primary.isVisible().catch(() => false)) {
    await primary.click();
  } else {
    await page.getByTestId('docx-template-button-empty').click();
  }
  await expect(page.getByTestId('template-editor')).toBeVisible({ timeout: 30000 });
};

const closeTemplateEditorIfOpen = async (page: any) => {
  const closeButton = page.getByTestId('template-close-button');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await expect(page.getByTestId('template-editor')).toHaveCount(0, { timeout: 15000 });
  }
};

const reloadNotebook = async (page: any, workspaceName: string, notebookName: string) => {
  await ensureWorkspaceOpen(page, workspaceName);
  const escapedName = notebookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closeButton = page.getByRole('button', { name: new RegExp(`Cerrar ${escapedName}`) });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await expect(closeButton).toHaveCount(0, { timeout: 15000 });
  }
  await openNotebookFromTree(page, notebookName);
};

const readJsonFile = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const unwrapToolPayload = (payload: any) => {
  if (
    payload
    && typeof payload === 'object'
    && payload.result
    && !payload.status
    && !payload.kernel_id
    && !payload.template_binding
  ) {
    return payload.result;
  }
  return payload;
};

const toolJson = (result: any) => {
  if (result?.structuredContent) return unwrapToolPayload(result.structuredContent);
  const text = (result?.content || [])
    .map((item: any) => item?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) return result || {};
  try {
    return unwrapToolPayload(JSON.parse(text));
  } catch {
    return { text };
  }
};

const startMcpFromUi = async (page: any, harness: any) => {
  await page.getByTestId('mcp-status-button').click();
  await expect(page.getByTestId('mcp-panel')).toBeVisible({ timeout: 15000 });
  const startButton = page.getByTestId('mcp-start');
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
  }
  await expect(page.getByTestId('mcp-stop')).toBeVisible({ timeout: 30000 });
  const mcp = new McpHttpClient(harness.urls.mcp);
  const init = await mcp.initialize();
  expect(init?.serverInfo?.name || '').toMatch(/inspyro/i);
  return mcp;
};

const writeEmptyNotebook = (notebookPath: string) => {
  fs.writeFileSync(
    notebookPath,
    JSON.stringify({
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }, null, 2),
    'utf8',
  );
};

const writeNotebookWithMissingBinding = (notebookPath: string, jsonFileName: string) => {
  fs.writeFileSync(
    notebookPath,
    JSON.stringify({
      cells: [],
      metadata: {
        inspyro: {
          template_binding: {
            schema_version: 1,
            type: 'template_export_json',
            path_base: 'notebook_dir',
            path: jsonFileName,
          },
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    }, null, 2),
    'utf8',
  );
};

test.describe.serial('template-binding-bank', () => {
  test('validates JSON binding persistence, UI warnings and live MCP contract', async ({ page, request, harness }) => {
    restoreSeedFixtures(harness, 'seeded');
    const report = createReport(harness);
    const notebookPath = harness.files.reportNotebook;
    const notebookName = path.basename(notebookPath);
    let bindingJsonPath = path.join(path.dirname(notebookPath), 'report.inspyro-template.json');
    const missingNotebookName = 'ui-missing-binding.ipynb';
    const missingNotebookPath = path.join(path.dirname(notebookPath), missingNotebookName);
    const missingJsonName = 'ui-missing-binding.inspyro-template.json';
    const missingJsonPath = path.join(path.dirname(notebookPath), missingJsonName);
    writeNotebookWithMissingBinding(missingNotebookPath, missingJsonName);

    try {
      await gotoShell(page);
      await ensureWorkspaceOpen(page, 'inspyro-e2e');
      await openNotebookFromTree(page, notebookName);

      await runScenario(report, 'Persistencia y contrato', 'UI uploads a DOCX template and binds it to the notebook JSON', async () => {
        await openTemplateEditor(page);
        await page.locator('input[type="file"][accept=".docx"]').setInputFiles(harness.files.templateDocx);
        await expect(page.getByTestId('template-sidebar-slots')).toBeVisible({ timeout: 90000 });
        await page.getByTestId('template-more-actions').click();
        const bindResponsePromise = page.waitForResponse(
          (response: any) => response.url().includes('/api/templates/bind') && response.request().method() === 'POST',
          { timeout: 60000 },
        );
        await page.getByTestId('template-bind-button').click();
        const bindResponse = await bindResponsePromise;
        expect(bindResponse.ok()).toBeTruthy();
        const bindPayload = await bindResponse.json();
        bindingJsonPath = bindPayload?.template_binding?.template_json_path || bindingJsonPath;
        await expect.poll(async () => (
          ((await page.getByTestId('template-binding-status').textContent()) || '').replace(/\s+/g, ' ').trim()
        ), { timeout: 30000 }).toMatch(/\bVinculada$/);

        const packageJson = readJsonFile(bindingJsonPath);
        const notebookJson = readJsonFile(notebookPath);
        expect(packageJson.schema_version).toBe('1.1');
        expect(packageJson.template).toBeTruthy();
        expect(packageJson.docx_base64).toBeTruthy();
        expect(packageJson.semantic_style_slots).toBeTruthy();
        expect(notebookJson.metadata?.inspyro?.template_binding?.path).toBe('report.inspyro-template.json');

        return {
          result: {
            schema_version: packageJson.schema_version,
            binding_status: 'bound',
          },
          artifacts: {
            notebook_path: notebookPath,
            json_path: bindingJsonPath,
          },
        };
      });

      await runScenario(report, 'Home y legacy', 'Home summary promotes the ipynb binding as canonical template source', async () => {
        const response = await request.get(`${harness.urls.backend}/api/system/home-summary`);
        expect(response.ok()).toBeTruthy();
        const summary = await response.json();
        const serialized = JSON.stringify(summary);
        expect(serialized).toContain('template_binding_status');
        expect(serialized).toContain('report.inspyro-template.json');
        return {
          result: { template_inventory_detected: true },
          artifacts: { endpoint: '/api/system/home-summary' },
        };
      });

      await runScenario(report, 'No dirty falso', 'Reloading a bound notebook hydrates runtime state without marking the tab dirty', async () => {
        await closeTemplateEditorIfOpen(page);
        await reloadNotebook(page, 'inspyro-e2e', notebookName);
        const notebookJson = readJsonFile(notebookPath);
        expect(notebookJson.metadata?.inspyro?.template_binding?.path).toBe('report.inspyro-template.json');
        await expect(page.locator('.file-tab.modified').filter({ hasText: notebookName })).toHaveCount(0, { timeout: 15000 });
        return {
          result: { dirty_tabs: 0, binding_path: notebookJson.metadata?.inspyro?.template_binding?.path },
          artifacts: { notebook_path: notebookPath },
        };
      });

      await runScenario(report, 'Degradacion segura', 'Missing linked JSON shows an explicit warning and keeps the notebook openable', async () => {
        await closeTemplateEditorIfOpen(page);
        await openNotebookFromTree(page, missingNotebookName);
        await openTemplateEditor(page);
        await expect(page.getByTestId('template-binding-warning')).toContainText(/Plantilla JSON perdida|no existe/i, { timeout: 30000 });
        expect(fs.existsSync(missingJsonPath)).toBeFalsy();
        return {
          result: { status: 'missing' },
          artifacts: {
            notebook_path: missingNotebookPath,
            json_path: missingJsonPath,
          },
        };
      });

      await runScenario(report, 'MCP', 'MCP binds, reloads, mutates, observes missing JSON and executes without blocking', async () => {
        await closeTemplateEditorIfOpen(page);
        const mcp = await startMcpFromUi(page, harness);
        const tools = await mcp.listTools();
        expect((tools?.tools || []).some((tool: any) => tool?.name === 'bind_template_to_notebook')).toBeTruthy();

        const mcpNotebookPath = path.join(path.dirname(notebookPath), 'mcp-binding-bank.ipynb');
        const mcpJsonPath = path.join(path.dirname(mcpNotebookPath), 'mcp-binding-bank.inspyro-template.json');
        writeEmptyNotebook(mcpNotebookPath);

        const loaded = toolJson(await mcp.callTool('notebook_load', {
          path: mcpNotebookPath,
          include_source: true,
        }));
        const kernelId = loaded.kernel_id;
        expect(kernelId).toBeTruthy();

        const uploaded = toolJson(await mcp.callTool('upload_template', {
          kernel_id: kernelId,
          file_path: harness.files.templateDocx,
        }));
        expect(JSON.stringify(uploaded)).toMatch(/template|docx/i);

        const bound = toolJson(await mcp.callTool('bind_template_to_notebook', {
          kernel_id: kernelId,
          path: mcpNotebookPath,
        }));
        expect(bound.template_binding?.status || bound.status).toBe('bound');
        expect(fs.existsSync(mcpJsonPath)).toBeTruthy();
        const beforeMutation = fs.readFileSync(mcpJsonPath, 'utf8');

        const updated = toolJson(await mcp.callTool('update_template_style', {
          kernel_id: kernelId,
          style_name: 'Normal',
          updates: {
            font_size: 12,
          },
        }));
        expect(updated.template_binding?.status || updated.status || JSON.stringify(updated)).toMatch(/updated|ok|success|Normal/i);
        await expect.poll(() => fs.readFileSync(mcpJsonPath, 'utf8'), { timeout: 30000 }).not.toBe(beforeMutation);

        await mcp.callTool('shutdown_kernel', { kernel_id: kernelId });
        const reloadValid = toolJson(await mcp.callTool('notebook_load', {
          path: mcpNotebookPath,
          include_source: true,
        }));
        expect(['applied', 'available', 'bound', 'updated', 'inherited']).toContain(reloadValid.template_binding?.status);
        const reloadedKernel = reloadValid.kernel_id;
        await mcp.callTool('shutdown_kernel', { kernel_id: reloadedKernel });

        fs.unlinkSync(mcpJsonPath);
        const reloadMissing = toolJson(await mcp.callTool('notebook_load', {
          path: mcpNotebookPath,
          include_source: true,
        }));
        expect(reloadMissing.template_binding?.status).toBe('missing');
        const execution = toolJson(await mcp.callTool('execute_all_cells', {
          kernel_id: reloadMissing.kernel_id,
          notebook_path: mcpNotebookPath,
          include_outputs: true,
          timeout_per_cell: 60,
        }));
        expect(JSON.stringify(execution)).toMatch(/completed|success|executed|ok/i);

        return {
          result: {
            bind_status: bound.template_binding?.status || bound.status,
            reload_status: reloadValid.template_binding?.status,
            missing_status: reloadMissing.template_binding?.status,
          },
          artifacts: {
            notebook_path: mcpNotebookPath,
            json_path: mcpJsonPath,
          },
        };
      });
    } finally {
      report.write();
    }
  });
});
