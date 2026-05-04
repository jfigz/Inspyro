import { useEffect } from 'react';

const MANAGED_ATTR = 'data-scrollbar-managed';
const ACTIVE_BODY_CLASS = 'scroll-surface-thumb-dragging';
const REVEAL_TIMEOUT_MS = 900;
const SURFACE_EDGE_GAP = 2;

const AXIS_CONFIG = {
  y: {
    orientation: 'vertical',
    clientSize: 'clientHeight',
    scrollSize: 'scrollHeight',
    scrollOffset: 'scrollTop',
    pointerCoord: 'clientY',
    thumbLengthVar: '--scroll-thumb-height',
    thumbOffsetVar: '--scroll-thumb-top',
    dataAttr: 'data-scrollbar-y',
  },
  x: {
    orientation: 'horizontal',
    clientSize: 'clientWidth',
    scrollSize: 'scrollWidth',
    scrollOffset: 'scrollLeft',
    pointerCoord: 'clientX',
    thumbLengthVar: '--scroll-thumb-width',
    thumbOffsetVar: '--scroll-thumb-left',
    dataAttr: 'data-scrollbar-x',
  },
};

const readCssNumber = (styles, name, fallback) => {
  const value = parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

const createAxisElements = (axis) => {
  const config = AXIS_CONFIG[axis];
  const overlay = document.createElement('div');
  overlay.className = `scroll-surface__overlay scroll-surface__overlay--${config.orientation}`;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('data-axis', axis);
  overlay.setAttribute('data-visible', 'false');

  const thumb = document.createElement('div');
  thumb.className = 'scroll-surface__thumb';
  overlay.appendChild(thumb);
  document.body.appendChild(overlay);

  return {
    axis,
    config,
    overlay,
    thumb,
    travel: 0,
    thumbOffset: 0,
    canScroll: false,
  };
};

const createManagedSurface = (surface) => {
  if (!surface || surface.getAttribute(MANAGED_ATTR) === 'true') {
    return null;
  }

  surface.setAttribute(MANAGED_ATTR, 'true');

  let frameId = null;
  let revealTimeoutId = null;
  let pointerInside = false;
  let overlayPointerInside = false;
  let focusInside = false;
  let scrollRevealActive = false;
  let activeDrag = null;

  const rootStyles = getComputedStyle(document.documentElement);
  const scrollbarSize = readCssNumber(rootStyles, '--scrollbar-size', 16);
  const thumbBorderHover = readCssNumber(rootStyles, '--scrollbar-thumb-border-hover', 1);
  const thumbMinLength = readCssNumber(rootStyles, '--scrollbar-thumb-min-length', 48);
  const overlaySize = Math.max(8, scrollbarSize - (thumbBorderHover * 2));

  const axisStates = [
    createAxisElements('y'),
    createAxisElements('x'),
  ];

  const getAxisState = (axis) => axisStates.find((state) => state.axis === axis);

  const isOverlayNode = (node) => Boolean(
    node && axisStates.some((state) => state.overlay.contains(node))
  );

  const shouldReveal = () => (
    pointerInside
    || overlayPointerInside
    || focusInside
    || scrollRevealActive
    || Boolean(activeDrag)
  );

  const applyVisibility = () => {
    const active = shouldReveal();
    surface.setAttribute('data-scrollbar-active', active ? 'true' : 'false');
    axisStates.forEach((state) => {
      state.overlay.setAttribute('data-visible', state.canScroll && active ? 'true' : 'false');
    });
  };

  const clearRevealTimeout = () => {
    if (revealTimeoutId !== null) {
      window.clearTimeout(revealTimeoutId);
      revealTimeoutId = null;
    }
  };

  const revealTemporarily = () => {
    scrollRevealActive = true;
    clearRevealTimeout();
    applyVisibility();
    revealTimeoutId = window.setTimeout(() => {
      revealTimeoutId = null;
      scrollRevealActive = false;
      applyVisibility();
    }, REVEAL_TIMEOUT_MS);
  };

  const scheduleUpdate = () => {
    if (frameId !== null) {
      return;
    }
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      updateThumb();
    });
  };

  const positionAxisOverlay = (state, rect, hasOtherAxis) => {
    if (state.axis === 'y') {
      const height = Math.max(0, rect.height - (SURFACE_EDGE_GAP * 2) - (hasOtherAxis ? overlaySize : 0));
      state.overlay.style.top = `${rect.top + SURFACE_EDGE_GAP}px`;
      state.overlay.style.left = `${rect.right - overlaySize - SURFACE_EDGE_GAP}px`;
      state.overlay.style.width = `${overlaySize}px`;
      state.overlay.style.height = `${height}px`;
      return height;
    }

    const width = Math.max(0, rect.width - (SURFACE_EDGE_GAP * 2) - (hasOtherAxis ? overlaySize : 0));
    state.overlay.style.top = `${rect.bottom - overlaySize - SURFACE_EDGE_GAP}px`;
    state.overlay.style.left = `${rect.left + SURFACE_EDGE_GAP}px`;
    state.overlay.style.width = `${width}px`;
    state.overlay.style.height = `${overlaySize}px`;
    return width;
  };

  const updateAxisThumb = (state, rect, hasOtherAxis) => {
    const { config } = state;
    const viewport = surface[config.clientSize];
    const content = surface[config.scrollSize];
    const canScroll = content - viewport > 1;
    state.canScroll = canScroll;
    surface.setAttribute(config.dataAttr, canScroll ? 'true' : 'false');

    const trackLength = positionAxisOverlay(state, rect, hasOtherAxis) || viewport;
    if (!canScroll) {
      state.thumb.style.removeProperty(config.thumbLengthVar);
      state.thumb.style.removeProperty(config.thumbOffsetVar);
      state.travel = 0;
      state.thumbOffset = 0;
      return;
    }

    const thumbLength = Math.max(
      Math.min(thumbMinLength, trackLength),
      Math.min(trackLength, (viewport / content) * trackLength),
    );
    const maxScrollOffset = Math.max(1, content - viewport);
    const maxThumbOffset = Math.max(0, trackLength - thumbLength);
    const thumbOffset = maxThumbOffset <= 0
      ? 0
      : (surface[config.scrollOffset] / maxScrollOffset) * maxThumbOffset;

    state.travel = maxThumbOffset;
    state.thumbOffset = thumbOffset;
    state.thumb.style.setProperty(config.thumbLengthVar, `${thumbLength}px`);
    state.thumb.style.setProperty(config.thumbOffsetVar, `${thumbOffset}px`);
  };

  const updateThumb = () => {
    if (!surface.isConnected) {
      return;
    }

    const rect = surface.getBoundingClientRect();
    const canScrollY = surface.scrollHeight - surface.clientHeight > 1;
    const canScrollX = surface.scrollWidth - surface.clientWidth > 1;
    updateAxisThumb(getAxisState('y'), rect, canScrollX);
    updateAxisThumb(getAxisState('x'), rect, canScrollY);
    surface.setAttribute('data-scrollbar-visible', (canScrollX || canScrollY) ? 'true' : 'false');
    applyVisibility();
  };

  const stopDrag = () => {
    if (!activeDrag) {
      return;
    }
    activeDrag.state.thumb.classList.remove('is-dragging');
    surface.removeAttribute('data-scrollbar-dragging');
    if (activeDrag.state.thumb.releasePointerCapture && activeDrag.pointerId !== null) {
      try {
        activeDrag.state.thumb.releasePointerCapture(activeDrag.pointerId);
      } catch (error) {
        // Ignore capture errors.
      }
    }
    activeDrag = null;
    document.body.classList.remove(ACTIVE_BODY_CLASS);
    applyVisibility();
  };

  const onPointerMove = (event) => {
    if (!activeDrag) {
      return;
    }
    if (activeDrag.pointerId !== null && event.pointerId !== activeDrag.pointerId) {
      return;
    }
    event.preventDefault();
    const { state } = activeDrag;
    const { config } = state;
    const viewport = surface[config.clientSize];
    const content = surface[config.scrollSize];
    const maxScrollOffset = Math.max(0, content - viewport);
    if (maxScrollOffset <= 0 || state.travel <= 0) {
      return;
    }
    const delta = event[config.pointerCoord] - activeDrag.startPointer;
    const nextOffset = Math.max(0, Math.min(state.travel, activeDrag.startThumbOffset + delta));
    state.thumbOffset = nextOffset;
    state.thumb.style.setProperty(config.thumbOffsetVar, `${nextOffset}px`);
    surface[config.scrollOffset] = (nextOffset / state.travel) * maxScrollOffset;
  };

  const onPointerUp = (event) => {
    if (!activeDrag) {
      return;
    }
    if (activeDrag.pointerId !== null && event.pointerId !== activeDrag.pointerId) {
      return;
    }
    stopDrag();
  };

  const onThumbPointerDown = (state) => (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    activeDrag = {
      state,
      pointerId: event.pointerId ?? null,
      startPointer: event[state.config.pointerCoord],
      startThumbOffset: state.thumbOffset,
    };
    state.thumb.classList.add('is-dragging');
    surface.setAttribute('data-scrollbar-dragging', state.axis);
    if (state.thumb.setPointerCapture && event.pointerId !== undefined) {
      try {
        state.thumb.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture errors.
      }
    }
    document.body.classList.add(ACTIVE_BODY_CLASS);
    applyVisibility();
    event.preventDefault();
    event.stopPropagation();
  };

  const onScroll = () => {
    scheduleUpdate();
    revealTemporarily();
  };

  const onPointerEnter = () => {
    pointerInside = true;
    applyVisibility();
  };

  const onSurfacePointerLeave = (event) => {
    pointerInside = false;
    overlayPointerInside = isOverlayNode(event.relatedTarget);
    applyVisibility();
  };

  const onOverlayPointerEnter = () => {
    overlayPointerInside = true;
    applyVisibility();
  };

  const onOverlayPointerLeave = (event) => {
    overlayPointerInside = false;
    pointerInside = Boolean(event.relatedTarget && surface.contains(event.relatedTarget));
    applyVisibility();
  };

  const onFocusIn = () => {
    focusInside = true;
    applyVisibility();
  };

  const onFocusOut = (event) => {
    if (event.relatedTarget && surface.contains(event.relatedTarget)) {
      return;
    }
    focusInside = surface.contains(document.activeElement);
    applyVisibility();
  };

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => scheduleUpdate())
    : null;
  resizeObserver?.observe(surface);

  const mutationObserver = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => scheduleUpdate())
    : null;
  mutationObserver?.observe(surface, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  surface.addEventListener('scroll', onScroll, { passive: true });
  surface.addEventListener('pointerenter', onPointerEnter);
  surface.addEventListener('pointerleave', onSurfacePointerLeave);
  surface.addEventListener('focusin', onFocusIn);
  surface.addEventListener('focusout', onFocusOut);
  axisStates.forEach((state) => {
    state.onThumbPointerDown = onThumbPointerDown(state);
    state.thumb.addEventListener('pointerdown', state.onThumbPointerDown);
    state.overlay.addEventListener('pointerenter', onOverlayPointerEnter);
    state.overlay.addEventListener('pointerleave', onOverlayPointerLeave);
  });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });

  scheduleUpdate();

  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }
    clearRevealTimeout();
    stopDrag();
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    surface.removeEventListener('scroll', onScroll);
    surface.removeEventListener('pointerenter', onPointerEnter);
    surface.removeEventListener('pointerleave', onSurfacePointerLeave);
    surface.removeEventListener('focusin', onFocusIn);
    surface.removeEventListener('focusout', onFocusOut);
    axisStates.forEach((state) => {
      state.thumb.removeEventListener('pointerdown', state.onThumbPointerDown);
      state.overlay.removeEventListener('pointerenter', onOverlayPointerEnter);
      state.overlay.removeEventListener('pointerleave', onOverlayPointerLeave);
    });
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('scroll', scheduleUpdate, { capture: true });
    axisStates.forEach((state) => {
      if (state.overlay.parentNode === document.body) {
        document.body.removeChild(state.overlay);
      }
    });
    surface.removeAttribute(MANAGED_ATTR);
    surface.removeAttribute('data-scrollbar-visible');
    surface.removeAttribute('data-scrollbar-active');
    surface.removeAttribute('data-scrollbar-y');
    surface.removeAttribute('data-scrollbar-x');
    surface.removeAttribute('data-scrollbar-dragging');
  };
};

const ScrollSurfaceManager = () => {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const cleanups = new Map();

    const enhanceAll = () => {
      const surfaces = document.querySelectorAll('.scroll-surface');
      surfaces.forEach((surface) => {
        if (cleanups.has(surface)) {
          return;
        }
        const cleanup = createManagedSurface(surface);
        if (cleanup) {
          cleanups.set(surface, cleanup);
        }
      });

      Array.from(cleanups.keys()).forEach((surface) => {
        if (surface.isConnected) {
          return;
        }
        cleanups.get(surface)?.();
        cleanups.delete(surface);
      });
    };

    enhanceAll();

    const observer = new MutationObserver(() => {
      enhanceAll();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return null;
};

export default ScrollSurfaceManager;
