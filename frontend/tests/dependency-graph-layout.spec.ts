import { test, expect } from './helpers/testHarness';
import {
  gotoShell,
  openNotebookFromTree,
} from './helpers/ui';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { restoreSeedFixtures } = require('./helpers/inspyroHarness');

async function openDependencyGraph(page, symbol: string) {
  await page.getByTestId('visualization-view-dependencies').click();
  const dependencyForm = page.locator('.dependency-manual-form');
  await expect(dependencyForm).toBeVisible({ timeout: 30000 });
  await dependencyForm.getByLabel('Analizar simbolo').fill(symbol);
  await dependencyForm.getByRole('button', { name: 'Dependencias' }).click();

  await page.getByTestId('dependency-graph-panel').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.d3-graph-container svg g.node').first().waitFor({ state: 'visible', timeout: 30000 });
}

async function readGraphGeometry(page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };

    const intersects = (a: any, b: any) => {
      if (!a || !b) return false;
      return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    };

    const panel = rect('[data-testid="dependency-graph-panel"]');
    const headerActions = rect('[data-testid="dependency-graph-header-actions"]');
    const filterPanel = rect('[data-testid="dependency-filter-panel"]');
    const canvas = rect('[data-testid="dependency-graph-canvas-shell"]');
    const inspector = rect('[data-testid="dependency-graph-inspector"]');
    const minimap = rect('[data-testid="dependency-graph-minimap"]');
    const rail = rect('[data-testid="dependency-graph-rail"]');
    const diagnostics = rect('[data-testid="dependency-graph-diagnostics"]');
    const legend = rect('[data-testid="dependency-graph-legend"]');
    const titlebar = rect('.desktop-titlebar');

    return {
      panel,
      headerActions,
      filterPanel,
      canvas,
      inspector,
      minimap,
      rail,
      diagnostics,
      legend,
      titlebar,
      overlaps: {
        headerFilter: intersects(headerActions, filterPanel),
        canvasInspector: intersects(canvas, inspector),
        minimapInspector: intersects(minimap, inspector),
        legendCanvas: intersects(legend, canvas),
        diagnosticsCanvas: intersects(diagnostics, canvas),
      },
    };
  });
}

async function readGraphRuntimeState(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.d3-graph-container svg');
    const mainGroup = document.querySelector('.d3-graph-container svg g.viewport-group');
    const nodes = Array.from(document.querySelectorAll('.d3-graph-container svg g.node'));
    const edges = Array.from(document.querySelectorAll('.d3-graph-container svg path.edge'));
    const edgeHeads = Array.from(document.querySelectorAll('.d3-graph-container svg path.edge-head'));
    const edgeHeadsByKey = new Map(edgeHeads.map((head) => [head.getAttribute('data-edge-key'), head]));
    const externalRouteCount = edges.reduce((count, edge) => (
      count + (edge.getAttribute('data-routing-scope') === 'external' ? 1 : 0)
    ), 0);

    const parseTranslateScale = (value: string | null) => {
      if (!value) return null;
      const match = /translate\(([^,]+),([^\)]+)\)\s*scale\(([^\)]+)\)/.exec(value);
      if (!match) return { raw: value };
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        k: Number(match[3]),
      };
    };

    const nodeRects = new Map(nodes.map((node) => {
      const id = node.getAttribute('data-id');
      const rect = node.querySelector('.node-body') || node.querySelector('rect');
      if (!id || !rect) return [null, null];

      const x = Number(rect.getAttribute('x') || 0);
      const y = Number(rect.getAttribute('y') || 0);
      const width = Number(rect.getAttribute('width') || 0);
      const height = Number(rect.getAttribute('height') || 0);
      const tr = /translate\(([^,]+),([^\)]+)\)/.exec(node.getAttribute('transform') || '');
      const tx = tr ? Number(tr[1]) : 0;
      const ty = tr ? Number(tr[2]) : 0;

      return [id, {
        left: tx + x,
        top: ty + y,
        right: tx + x + width,
        bottom: ty + y + height,
      }];
    }).filter(([id, rect]) => Boolean(id && rect)));

    const edgeGaps = edges.map((edge) => {
      const targetId = edge.getAttribute('data-target');
      const targetRect = nodeRects.get(targetId || '');
      const edgeKey = edge.getAttribute('data-edge-key');
      const head = edgeHeadsByKey.get(edgeKey || '');
      if (!targetRect || typeof (edge as SVGPathElement).getTotalLength !== 'function') return null;

      const pathElement = edge as SVGPathElement;
      const length = pathElement.getTotalLength();
      const end = Number.isFinite(Number(head?.getAttribute('data-arrow-tip-x')))
        && Number.isFinite(Number(head?.getAttribute('data-arrow-tip-y')))
        ? {
            x: Number(head?.getAttribute('data-arrow-tip-x')),
            y: Number(head?.getAttribute('data-arrow-tip-y')),
          }
        : pathElement.getPointAtLength(length);
      const horizontalDistance = end.x < targetRect.left
        ? targetRect.left - end.x
        : (end.x > targetRect.right ? end.x - targetRect.right : 0);
      const verticalDistance = end.y < targetRect.top
        ? targetRect.top - end.y
        : (end.y > targetRect.bottom ? end.y - targetRect.bottom : 0);

      return {
        horizontalDistance,
        verticalDistance,
        outside: horizontalDistance > 0 || verticalDistance > 0,
      };
    }).filter(Boolean) as Array<{ horizontalDistance: number; verticalDistance: number; outside: boolean }>;

    const arrowIntegrity = edges.map((edge) => {
      const edgeKey = edge.getAttribute('data-edge-key');
      const head = edgeHeadsByKey.get(edgeKey || '');
      const pathElement = edge as SVGPathElement;
      const bodyLength = typeof pathElement.getTotalLength === 'function' ? pathElement.getTotalLength() : 0;
      const bodyEnd = bodyLength > 0 ? pathElement.getPointAtLength(bodyLength) : null;
      const headPath = head?.getAttribute('d') || '';
      const arrowBaseX = Number(head?.getAttribute('data-arrow-base-x') || NaN);
      const arrowBaseY = Number(head?.getAttribute('data-arrow-base-y') || NaN);
      let headBBox = null as null | { width: number; height: number };
      try {
        if (head && typeof (head as SVGGraphicsElement).getBBox === 'function') {
          const box = (head as SVGGraphicsElement).getBBox();
          headBBox = { width: box.width, height: box.height };
        }
      } catch (_error) {
        headBBox = null;
      }

      return {
        hasHead: Boolean(head && headPath),
        headVisible: Boolean(headBBox && headBBox.width > 0 && headBBox.height > 0),
        edgeOpacity: Number(getComputedStyle(edge).opacity || '0'),
        edgeStrokeOpacity: Number(getComputedStyle(edge).strokeOpacity || edge.getAttribute('stroke-opacity') || '0'),
        headOpacity: head ? Number(getComputedStyle(head).opacity || '0') : 0,
        headFillOpacity: head ? Number(getComputedStyle(head).fillOpacity || head.getAttribute('fill-opacity') || '0') : 0,
        bodyLength,
        baseGap: bodyEnd && Number.isFinite(arrowBaseX) && Number.isFinite(arrowBaseY)
          ? Math.hypot(bodyEnd.x - arrowBaseX, bodyEnd.y - arrowBaseY)
          : Number.POSITIVE_INFINITY,
      };
    });

    const svgBox = svg?.getBoundingClientRect();
    const curvedPathCount = edges.reduce((count, edge) => {
      const d = edge.getAttribute('d') || '';
      return count + (/[CQSA]/.test(d) ? 1 : 0);
    }, 0);
    const nodeBoxes = nodes.map((node) => node.getBoundingClientRect());
    const visibleNodes = nodeBoxes.filter((box) => svgBox && box.width > 0 && box.height > 0 && !(box.right < svgBox.left || box.left > svgBox.right || box.bottom < svgBox.top || box.top > svgBox.bottom)).length;
    const nodePositions = nodes.map((node) => {
      const id = node.getAttribute('data-id');
      const tr = /translate\(([^,]+),([^\)]+)\)/.exec(node.getAttribute('transform') || '');
      const tx = tr ? Number(tr[1]) : 0;
      const ty = tr ? Number(tr[2]) : 0;
      return { id, x: tx, y: ty, isRoot: node.classList.contains('root') };
    }).filter((entry) => entry.id);
    const sortedByX = [...nodePositions].sort((a, b) => a.x - b.x);
    const columns: Array<{ x: number; count: number }> = [];
    sortedByX.forEach((entry) => {
      const previous = columns[columns.length - 1];
      if (previous && Math.abs(previous.x - entry.x) <= 6) {
        previous.count += 1;
      } else {
        columns.push({ x: entry.x, count: 1 });
      }
    });
    const rootNode = nodePositions.find((entry) => entry.isRoot);

    return {
      transform: parseTranslateScale(mainGroup?.getAttribute('transform') || null),
      totalNodes: nodes.length,
      visibleNodes,
      outsideGapCount: edgeGaps.filter((gap) => gap.outside).length,
      maxHorizontalGap: edgeGaps.reduce((max, gap) => Math.max(max, gap.horizontalDistance), 0),
      maxVerticalGap: edgeGaps.reduce((max, gap) => Math.max(max, gap.verticalDistance), 0),
      missingHeadCount: arrowIntegrity.filter((entry) => !entry.hasHead).length,
      invisibleHeadCount: arrowIntegrity.filter((entry) => !entry.headVisible).length,
      invisibleEdgeCount: arrowIntegrity.filter((entry) => entry.edgeOpacity <= 0.01).length,
      transparentHeadCount: arrowIntegrity.filter((entry) => (
        entry.headOpacity <= 0.01
        && entry.headFillOpacity <= 0.01
        && entry.edgeStrokeOpacity > 0.01
      )).length,
      minBodyLength: arrowIntegrity.reduce((min, entry) => Math.min(min, entry.bodyLength), Number.POSITIVE_INFINITY),
      maxBodyHeadGap: arrowIntegrity.reduce((max, entry) => Math.max(max, entry.baseGap), 0),
      curvedPathCount,
      externalRouteCount,
      columnCount: columns.length,
      maxNodesPerColumn: columns.reduce((max, column) => Math.max(max, column.count), 0),
      rootX: rootNode?.x ?? null,
      leftMostX: sortedByX[0]?.x ?? null,
      rightMostX: sortedByX[sortedByX.length - 1]?.x ?? null,
    };
  });
}

test.describe.serial('Dependency Graph Layout', () => {
  test('keeps filters, menu, diagnostics and inspector separated on desktop', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await gotoShell(page);
    const workspaceButton = page.getByTestId('explorer-workspace-button');
    await expect(workspaceButton).toContainText('inspyro-e2e', { timeout: 20000 });
    await openNotebookFromTree(page, 'report.ipynb');
    await openDependencyGraph(page, 'M_max');

    await expect(page.getByTestId('dependency-graph-inspector')).toBeVisible();

    await page.getByRole('button', { name: /Filtros/i }).click();
    await expect(page.getByTestId('dependency-filter-panel')).toBeVisible();

    await page.getByRole('button', { name: /More/i }).click();
    await expect(page.getByTestId('dependency-more-menu')).toBeVisible();
    await page.getByRole('button', { name: /Calidad de analisis/i }).click();
    await expect(page.getByTestId('dependency-graph-diagnostics')).toHaveCount(1);

    await page.getByRole('button', { name: /More/i }).click();
    await page.getByRole('button', { name: /Mostrar minimap/i }).click();
    await expect(page.getByTestId('dependency-graph-minimap')).toBeVisible();

    const geometry = await readGraphGeometry(page);
    expect(geometry.overlaps.headerFilter).toBe(false);
    expect(geometry.overlaps.canvasInspector).toBe(false);
    expect(geometry.overlaps.minimapInspector).toBe(false);
    expect(geometry.overlaps.legendCanvas).toBe(false);
    expect(geometry.overlaps.diagnosticsCanvas).toBe(false);
    expect(geometry.canvas?.height ?? 0).toBeGreaterThan(100);
  });

  test('stays usable at 1280x800 without right rail overlap', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await gotoShell(page);
    const workspaceButton = page.getByTestId('explorer-workspace-button');
    await expect(workspaceButton).toContainText('inspyro-e2e', { timeout: 20000 });
    await openNotebookFromTree(page, 'report.ipynb');
    await openDependencyGraph(page, 'M_max');

    await page.getByRole('button', { name: /Filtros/i }).click();
    await page.getByRole('button', { name: /More/i }).click();
    await expect(page.getByTestId('dependency-more-menu')).toBeVisible();
    await page.getByRole('button', { name: /Mostrar leyenda/i }).click();
    await expect(page.getByTestId('dependency-graph-legend')).toBeVisible();

    await page.getByRole('button', { name: /More/i }).click();
    await page.getByRole('button', { name: /Mostrar minimap/i }).click();
    await expect(page.getByTestId('dependency-graph-minimap')).toBeVisible();

    await expect(page.getByTestId('dependency-graph-rail')).toHaveCount(0);

    const geometry = await readGraphGeometry(page);
    expect(geometry.overlaps.headerFilter).toBe(false);
    expect(geometry.panel?.width ?? 0).toBeGreaterThan(420);
  });

  test('grows horizontally with vertically aligned ranks in dependency mode', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await gotoShell(page);
    const workspaceButton = page.getByTestId('explorer-workspace-button');
    await expect(workspaceButton).toContainText('inspyro-e2e', { timeout: 20000 });
    await openNotebookFromTree(page, 'report.ipynb');
    await openDependencyGraph(page, 'M_max');

    const runtimeState = await readGraphRuntimeState(page);
    expect(runtimeState.columnCount).toBeGreaterThanOrEqual(2);
    expect(runtimeState.maxNodesPerColumn).toBeGreaterThanOrEqual(2);
    expect((runtimeState.rightMostX ?? 0) - (runtimeState.leftMostX ?? 0)).toBeGreaterThan(80);
    expect(runtimeState.rootX).toBe(runtimeState.rightMostX);
  });

  test('keeps arrows attached and refits automatically after zoom plus fullscreen transitions', async ({ page, harness }) => {
    restoreSeedFixtures(harness, 'seeded');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.request.post(`${harness.urls.backend}/api/system/workspace`, {
      data: { path: harness.workspaces.seeded },
    });

    await gotoShell(page);
    const workspaceButton = page.getByTestId('explorer-workspace-button');
    await expect(workspaceButton).toContainText('inspyro-e2e', { timeout: 20000 });
    await openNotebookFromTree(page, 'report.ipynb');
    await openDependencyGraph(page, 'M_max');

    const initialState = await readGraphRuntimeState(page);
    expect(initialState.outsideGapCount).toBe(0);
    expect(initialState.maxHorizontalGap).toBeLessThanOrEqual(1);
    expect(initialState.maxVerticalGap).toBeLessThanOrEqual(1);
    expect(initialState.missingHeadCount).toBe(0);
    expect(initialState.invisibleHeadCount).toBe(0);
    expect(initialState.invisibleEdgeCount).toBe(0);
    expect(initialState.transparentHeadCount).toBe(0);
    expect(initialState.minBodyLength).toBeGreaterThan(0);
    expect(initialState.maxBodyHeadGap).toBeLessThanOrEqual(1.5);
    expect(initialState.curvedPathCount).toBe(0);
    expect(initialState.externalRouteCount).toBe(0);
    expect(initialState.visibleNodes).toBe(initialState.totalNodes);

    const canvas = page.getByTestId('dependency-graph-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.move(
      (canvasBox?.x || 0) + (canvasBox?.width || 0) / 2,
      (canvasBox?.y || 0) + (canvasBox?.height || 0) / 2,
    );

    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, -320);
      await page.waitForTimeout(100);
    }

    const zoomedState = await readGraphRuntimeState(page);
    expect((zoomedState.transform as { k?: number } | null)?.k ?? 0).toBeGreaterThan(1);
    expect(zoomedState.missingHeadCount).toBe(0);
    expect(zoomedState.invisibleHeadCount).toBe(0);
    expect(zoomedState.invisibleEdgeCount).toBe(0);
    expect(zoomedState.transparentHeadCount).toBe(0);
    expect(zoomedState.minBodyLength).toBeGreaterThan(0);
    expect(zoomedState.maxBodyHeadGap).toBeLessThanOrEqual(1.5);
    expect(zoomedState.curvedPathCount).toBe(0);
    expect(zoomedState.externalRouteCount).toBe(0);

    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, 280);
      await page.waitForTimeout(90);
    }

    const zoomedOutState = await readGraphRuntimeState(page);
    expect((zoomedOutState.transform as { k?: number } | null)?.k ?? 0).toBeGreaterThan(0.2);
    expect(zoomedOutState.missingHeadCount).toBe(0);
    expect(zoomedOutState.invisibleHeadCount).toBe(0);
    expect(zoomedOutState.invisibleEdgeCount).toBe(0);
    expect(zoomedOutState.transparentHeadCount).toBe(0);
    expect(zoomedOutState.minBodyLength).toBeGreaterThan(0);
    expect(zoomedOutState.maxBodyHeadGap).toBeLessThanOrEqual(1.5);
    expect(zoomedOutState.curvedPathCount).toBe(0);
    expect(zoomedOutState.externalRouteCount).toBe(0);

    await page.getByRole('button', { name: /Pantalla completa/i }).click();
    await page.waitForTimeout(600);

    const fullscreenState = await readGraphRuntimeState(page);
    expect(fullscreenState.visibleNodes).toBe(fullscreenState.totalNodes);
    expect(fullscreenState.missingHeadCount).toBe(0);
    expect(fullscreenState.invisibleHeadCount).toBe(0);
    expect(fullscreenState.invisibleEdgeCount).toBe(0);
    expect(fullscreenState.transparentHeadCount).toBe(0);
    expect(fullscreenState.minBodyLength).toBeGreaterThan(0);
    expect(fullscreenState.maxBodyHeadGap).toBeLessThanOrEqual(1.5);
    expect(fullscreenState.curvedPathCount).toBe(0);
    expect(fullscreenState.externalRouteCount).toBe(0);

    await page.getByRole('button', { name: /Filtros/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /More/i }).click();
    await page.getByRole('button', { name: /Mostrar minimap/i }).click();
    await expect(page.getByTestId('dependency-graph-minimap')).toBeVisible();

    const compactFullscreenState = await readGraphRuntimeState(page);
    expect(compactFullscreenState.visibleNodes).toBe(compactFullscreenState.totalNodes);
    expect(compactFullscreenState.missingHeadCount).toBe(0);
    expect(compactFullscreenState.invisibleHeadCount).toBe(0);
    expect(compactFullscreenState.invisibleEdgeCount).toBe(0);
    expect(compactFullscreenState.transparentHeadCount).toBe(0);
    expect(compactFullscreenState.minBodyLength).toBeGreaterThan(0);
    expect(compactFullscreenState.maxBodyHeadGap).toBeLessThanOrEqual(1.5);
    expect(compactFullscreenState.curvedPathCount).toBe(0);
    expect(compactFullscreenState.externalRouteCount).toBe(0);

    const geometry = await readGraphGeometry(page);
    expect(geometry.headerActions?.y ?? 0).toBeGreaterThanOrEqual(geometry.titlebar?.bottom ?? 0);
  });
});
