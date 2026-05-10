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

const PREVIEW_SLOT_CASES = [
  { name: 'body', testId: 'template-slot-card-body', required: true },
  { name: 'heading', testId: 'template-slot-card-heading_1', required: true },
  { name: 'caption', testId: 'template-slot-card-caption', required: true },
  { name: 'list', testId: 'template-slot-card-list_bullet', required: true },
  { name: 'code', testId: 'template-slot-card-code', required: false },
  { name: 'table', testId: 'template-slot-card-table_default', required: true },
];

const getPdfStatus = async (request: any, harness: any) => {
  const response = await request.get(`${harness.urls.backend}/pdf-status`);
  expect(response.ok()).toBeTruthy();
  return response.json();
};

const decodePngFromDataUrl = (src: string | null) => {
  expect(src).toMatch(/^data:image\/png;base64,/);
  const bytes = Buffer.from(String(src).split(',')[1] || '', 'base64');
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.length).toBeGreaterThan(500);
  return bytes;
};

const verifyWordPreviewButton = async (page: any, nativeWordAvailable: boolean) => {
  await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.word-preview-image')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId('template-open-sample-docx')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('template-native-word-preview').click();

  if (!nativeWordAvailable) {
    await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.preview-status-line')).toContainText(/Preview JS|Microsoft Word|Word no/i, { timeout: 30000 });
    return;
  }

  const image = page.locator('.word-preview-image');
  await expect(image).toBeVisible({ timeout: 90000 });
  decodePngFromDataUrl(await image.getAttribute('src'));
  await expect(page.locator('.preview-status-line')).toContainText(/Word nativo listo/i, { timeout: 15000 });
};

const activateSlotAndVerifyPreview = async (
  page: any,
  slot: { name: string; testId: string; required: boolean },
  nativeWordAvailable: boolean,
) => {
  const slotCard = page.getByTestId(slot.testId);
  const count = await slotCard.count();
  if (count === 0) {
    expect(slot.required, `${slot.name} slot is missing`).toBeFalsy();
    return false;
  }
  const select = page.getByTestId(slot.testId.replace('slot-card', 'slot-select'));
  if ((await select.count()) > 0 && !(await select.isEnabled())) {
    expect(slot.required, `${slot.name} slot has no selectable styles`).toBeFalsy();
    return false;
  }
  await slotCard.scrollIntoViewIfNeeded();
  await slotCard.click();
  await verifyWordPreviewButton(page, nativeWordAvailable);
  return true;
};

test.describe.serial('Template Editor', () => {
  test.setTimeout(240000);

  test('uploads a DOCX template, shows internal/native previews and applies direct table format', async ({ page, harness, request, consoleErrors }) => {
    void consoleErrors;
    restoreSeedFixtures(harness, 'seeded');
    const pdfStatus = await getPdfStatus(request, harness);
    const nativeWordAvailable = Boolean(pdfStatus.word_available);
    const pdfPreviewAvailable = Boolean(pdfStatus.pdf_available || pdfStatus.word_available || pdfStatus.soffice_path);

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

    await expect(page.getByTestId('template-sample-docx-preview')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('template-native-word-preview')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('template-open-sample-docx')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.preview-status-line')).toContainText(/Preview JS|Renderizando paginas DOCX/i, { timeout: 30000 });
    await expect.poll(async () => (
      page.locator('.preview-rail-frame').evaluate((node: HTMLElement) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
      }))
    ), { timeout: 30000 }).toMatchObject({
      scrollLeft: 0,
    });
    const previewCanPanHorizontally = await page.locator('.preview-rail-frame').evaluate((node: HTMLElement) => {
      const original = node.scrollLeft;
      node.scrollLeft = 96;
      const moved = node.scrollLeft > original;
      node.scrollLeft = original;
      return {
        moved,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    });
    expect(previewCanPanHorizontally.scrollWidth).toBeGreaterThan(previewCanPanHorizontally.clientWidth);
    expect(previewCanPanHorizontally.moved).toBe(true);
    const openDefaultRequests: any[] = [];
    await page.route('**/api/templates/sample-preview/open-default', async (route) => {
      openDefaultRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, path: 'mock-preview.docx', open_result: { success: true } }),
      });
    });
    await expect(page.getByTestId('template-open-sample-docx')).toBeEnabled({ timeout: 30000 });
    await page.getByTestId('template-open-sample-docx').click();
    await expect.poll(() => openDefaultRequests.length, { timeout: 15000 }).toBe(1);
    expect(openDefaultRequests[0].filename).toMatch(/\.docx$/);
    expect(openDefaultRequests[0].docx_base64.length).toBeGreaterThan(100);

    const coveredSlots: string[] = [];
    for (const slot of PREVIEW_SLOT_CASES) {
      if (await activateSlotAndVerifyPreview(page, slot, nativeWordAvailable)) {
        coveredSlots.push(slot.name);
      }
    }
    expect(coveredSlots).toEqual(expect.arrayContaining(['body', 'heading', 'caption', 'list', 'table']));

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
      if (pdfPreviewAvailable) {
        const tablePreview = page.locator('.direct-table-preview-img').first();
        await expect(tablePreview).toBeVisible({ timeout: 90000 });
        decodePngFromDataUrl(await tablePreview.getAttribute('src'));
        await page.locator('.direct-table-preview-container.clickable').first().click();
        await expect(page.locator('.table-preview-modal')).toBeVisible({ timeout: 15000 });
        decodePngFromDataUrl(await page.locator('.table-preview-modal-img').getAttribute('src'));
        await page.locator('.table-preview-modal-close').click();
        await expect(page.locator('.table-preview-modal')).toHaveCount(0, { timeout: 15000 });
      }
      await page.getByTestId('template-apply-table-format').first().click();
    }

    await page.getByTestId('template-close-button').click();
    await expect(page.getByTestId('template-editor')).toHaveCount(0);
  });
});
