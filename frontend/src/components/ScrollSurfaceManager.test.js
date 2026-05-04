import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import ScrollSurfaceManager from './ScrollSurfaceManager';

const defineScrollGeometry = (surface, overrides = {}) => {
  const geometry = {
    clientHeight: 100,
    scrollHeight: 300,
    clientWidth: 120,
    scrollWidth: 360,
    rect: {
      top: 10,
      left: 20,
      right: 140,
      bottom: 110,
      width: 120,
      height: 100,
    },
    ...overrides,
  };

  Object.defineProperties(surface, {
    clientHeight: { configurable: true, value: geometry.clientHeight },
    scrollHeight: { configurable: true, value: geometry.scrollHeight },
    clientWidth: { configurable: true, value: geometry.clientWidth },
    scrollWidth: { configurable: true, value: geometry.scrollWidth },
  });
  surface.getBoundingClientRect = jest.fn(() => geometry.rect);
};

const renderSurface = () => render(
  <>
    <ScrollSurfaceManager />
    <div className="scroll-surface" data-testid="surface" tabIndex={0} />
  </>,
);

const dispatchPointer = (target, type, props = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
};

describe('ScrollSurfaceManager', () => {
  let originalResizeObserver;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let rafCallbacks;

  beforeEach(() => {
    document.body.innerHTML = '';
    rafCallbacks = [];
    originalResizeObserver = global.ResizeObserver;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;

    global.ResizeObserver = class ResizeObserverMock {
      observe() {}
      disconnect() {}
    };
    window.requestAnimationFrame = jest.fn((callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    window.cancelAnimationFrame = jest.fn();
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.innerHTML = '';
  });

  const flushAnimationFrames = () => {
    act(() => {
      const pendingCallbacks = [...rafCallbacks];
      rafCallbacks = [];
      pendingCallbacks.forEach((callback) => callback());
    });
  };

  it('creates hidden vertical and horizontal overlays for scrollable surfaces', () => {
    const { getByTestId } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();

    const verticalOverlay = document.body.querySelector('.scroll-surface__overlay--vertical');
    const horizontalOverlay = document.body.querySelector('.scroll-surface__overlay--horizontal');

    expect(document.body.querySelectorAll('.scroll-surface__overlay')).toHaveLength(2);
    expect(surface.getAttribute('data-scrollbar-y')).toBe('true');
    expect(surface.getAttribute('data-scrollbar-x')).toBe('true');
    expect(verticalOverlay.getAttribute('data-visible')).toBe('false');
    expect(horizontalOverlay.getAttribute('data-visible')).toBe('false');

    fireEvent.pointerEnter(surface);

    expect(verticalOverlay.getAttribute('data-visible')).toBe('true');
    expect(horizontalOverlay.getAttribute('data-visible')).toBe('true');
  });

  it('updates vertical and horizontal thumb positions while scrolling', () => {
    const { getByTestId } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();
    surface.scrollTop = 100;
    surface.scrollLeft = 120;
    fireEvent.scroll(surface);
    flushAnimationFrames();

    const verticalThumb = document.body.querySelector('.scroll-surface__overlay--vertical .scroll-surface__thumb');
    const horizontalThumb = document.body.querySelector('.scroll-surface__overlay--horizontal .scroll-surface__thumb');

    expect(verticalThumb.style.getPropertyValue('--scroll-thumb-top')).not.toBe('0px');
    expect(horizontalThumb.style.getPropertyValue('--scroll-thumb-left')).not.toBe('0px');
  });

  it('keeps overlays interactive when moving from the surface onto the thumb', () => {
    const { getByTestId } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();

    const horizontalOverlay = document.body.querySelector('.scroll-surface__overlay--horizontal');
    const horizontalThumb = horizontalOverlay.querySelector('.scroll-surface__thumb');

    dispatchPointer(surface, 'pointerenter');
    expect(horizontalOverlay.getAttribute('data-visible')).toBe('true');

    dispatchPointer(surface, 'pointerleave', { relatedTarget: horizontalThumb });
    expect(horizontalOverlay.getAttribute('data-visible')).toBe('true');

    dispatchPointer(horizontalThumb, 'pointerdown', { button: 0, pointerId: 7, clientX: 20 });
    dispatchPointer(window, 'pointermove', { pointerId: 7, clientX: 70 });
    dispatchPointer(window, 'pointerup', { pointerId: 7 });

    expect(surface.scrollLeft).toBeGreaterThan(0);

    dispatchPointer(horizontalOverlay, 'pointerleave', { relatedTarget: document.body });
    expect(horizontalOverlay.getAttribute('data-visible')).toBe('false');
  });

  it('drags vertical and horizontal thumbs into scrollTop and scrollLeft changes', () => {
    const { getByTestId } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();

    const verticalThumb = document.body.querySelector('.scroll-surface__overlay--vertical .scroll-surface__thumb');
    const horizontalThumb = document.body.querySelector('.scroll-surface__overlay--horizontal .scroll-surface__thumb');

    dispatchPointer(verticalThumb, 'pointerdown', { button: 0, pointerId: 1, clientY: 10 });
    dispatchPointer(window, 'pointermove', { pointerId: 1, clientY: 50 });
    dispatchPointer(window, 'pointerup', { pointerId: 1 });

    dispatchPointer(horizontalThumb, 'pointerdown', { button: 0, pointerId: 2, clientX: 20 });
    dispatchPointer(window, 'pointermove', { pointerId: 2, clientX: 70 });
    dispatchPointer(window, 'pointerup', { pointerId: 2 });

    expect(surface.scrollTop).toBeGreaterThan(0);
    expect(surface.scrollLeft).toBeGreaterThan(0);
    expect(surface.hasAttribute('data-scrollbar-dragging')).toBe(false);
  });

  it('ignores stray pointerup events when no thumb is being dragged', () => {
    const { getByTestId } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();

    expect(() => {
      dispatchPointer(window, 'pointerup', { pointerId: 99 });
    }).not.toThrow();
    expect(surface.hasAttribute('data-scrollbar-dragging')).toBe(false);
  });

  it('removes overlays and managed attributes when unmounted', () => {
    const { getByTestId, unmount } = renderSurface();
    const surface = getByTestId('surface');
    defineScrollGeometry(surface);

    flushAnimationFrames();
    expect(document.body.querySelectorAll('.scroll-surface__overlay')).toHaveLength(2);

    unmount();

    expect(document.body.querySelectorAll('.scroll-surface__overlay')).toHaveLength(0);
    expect(surface.hasAttribute('data-scrollbar-managed')).toBe(false);
    expect(surface.hasAttribute('data-scrollbar-visible')).toBe(false);
  });
});
