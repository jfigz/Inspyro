import { expect, Page } from '@playwright/test';

type LayoutSelector = {
  name: string;
  selector: string;
};

type LayoutPair = {
  a: LayoutSelector;
  b: LayoutSelector;
};

type Rect = {
  name: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

const readRects = async (page: Page, selectors: LayoutSelector[]) => (
  page.evaluate((items) => {
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && box.width > 0
        && box.height > 0
      );
    };

    return items.map((item) => {
      const element = document.querySelector(item.selector);
      if (!element || !isVisible(element)) return null;
      const box = element.getBoundingClientRect();
      return {
        name: item.name,
        selector: item.selector,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    }).filter(Boolean);
  }, selectors) as Promise<Rect[]>
);

const intersects = (a: Rect, b: Rect, tolerance = 0) => !(
  a.right <= b.x + tolerance
  || b.right <= a.x + tolerance
  || a.bottom <= b.y + tolerance
  || b.bottom <= a.y + tolerance
);

export const expectInsideViewport = async (
  page: Page,
  selectors: LayoutSelector[],
  margin = 0,
) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const rects = await readRects(page, selectors);

  for (const rect of rects) {
    expect(rect.x, `${rect.name} left edge is outside viewport`).toBeGreaterThanOrEqual(margin);
    expect(rect.y, `${rect.name} top edge is outside viewport`).toBeGreaterThanOrEqual(margin);
    expect(rect.right, `${rect.name} right edge is outside viewport`).toBeLessThanOrEqual((viewport?.width || 0) - margin + 0.5);
    expect(rect.bottom, `${rect.name} bottom edge is outside viewport`).toBeLessThanOrEqual((viewport?.height || 0) - margin + 0.5);
  }
};

export const expectNoOverlap = async (
  page: Page,
  pairs: LayoutPair[],
  tolerance = 0,
) => {
  const selectors = pairs.flatMap((pair) => [pair.a, pair.b]);
  const rects = await readRects(page, selectors);
  const bySelector = new Map(rects.map((rect) => [rect.selector, rect]));

  for (const pair of pairs) {
    const left = bySelector.get(pair.a.selector);
    const right = bySelector.get(pair.b.selector);
    if (!left || !right) continue;
    expect(
      intersects(left, right, tolerance),
      `${pair.a.name} overlaps ${pair.b.name}`,
    ).toBe(false);
  }
};

