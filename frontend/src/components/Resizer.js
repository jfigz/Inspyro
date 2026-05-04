import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Resizer.css';

const Resizer = ({
  onResize,
  direction = 'horizontal',
  className = '',
  ariaLabel,
  onResizeStart,
  onResizeEnd,
  testId,
}) => {
  const resizerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const startPositionRef = useRef(0);
  const pointerIdRef = useRef(null);
  const pendingDeltaRef = useRef(0);
  const frameRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const dragCursorClass = direction === 'horizontal'
    ? 'app-resizer-dragging-horizontal'
    : 'app-resizer-dragging-vertical';
  const resolvedTestId = testId || `resizer-${(ariaLabel || direction)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;

  const flushPendingResize = useCallback(() => {
    if (!pendingDeltaRef.current) {
      return;
    }
    const nextDelta = pendingDeltaRef.current;
    pendingDeltaRef.current = 0;
    onResize?.(nextDelta);
  }, [onResize]);

  const scheduleResize = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      flushPendingResize();
    });
  }, [flushPendingResize]);

  const stopDragging = useCallback((skipStateUpdate = false) => {
    if (!isDraggingRef.current) return;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    flushPendingResize();
    const activePointerId = pointerIdRef.current;
    if (resizerRef.current?.releasePointerCapture && activePointerId !== null) {
      try {
        resizerRef.current.releasePointerCapture(activePointerId);
      } catch (error) {
        // Ignore capture errors in older browsers.
      }
    }
    isDraggingRef.current = false;
    if (!skipStateUpdate) {
      setIsDragging(false);
    }
    pointerIdRef.current = null;
    pendingDeltaRef.current = 0;
    document.body.classList.remove('app-resizer-dragging-horizontal', 'app-resizer-dragging-vertical');
    onResizeEnd?.();
  }, [flushPendingResize, onResizeEnd]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    pointerIdRef.current = event.pointerId ?? null;
    pendingDeltaRef.current = 0;
    startPositionRef.current = direction === 'horizontal' ? event.clientX : event.clientY;
    document.body.classList.add(dragCursorClass);
    onResizeStart?.();

    if (resizerRef.current?.setPointerCapture && event.pointerId !== undefined) {
      try {
        resizerRef.current.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture errors in older browsers.
      }
    }
    event.preventDefault();
  }, [direction, dragCursorClass, onResizeStart]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!isDraggingRef.current) return;
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;

      const currentPosition = direction === 'horizontal' ? event.clientX : event.clientY;
      const delta = currentPosition - startPositionRef.current;
      startPositionRef.current = currentPosition;
      pendingDeltaRef.current += delta;
      scheduleResize();
      event.preventDefault();
    };

    const handlePointerUp = (event) => {
      if (!isDraggingRef.current) return;
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      stopDragging();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      stopDragging(true);
    };
  }, [direction, scheduleResize, stopDragging]);

  const handleKeyboardResize = useCallback((event) => {
    if (!onResize) return;
    const horizontal = direction === 'horizontal';
    const step = event.shiftKey ? 24 : 12;
    if ((horizontal && event.key === 'ArrowLeft') || (!horizontal && event.key === 'ArrowUp')) {
      onResize(-step);
      event.preventDefault();
    } else if ((horizontal && event.key === 'ArrowRight') || (!horizontal && event.key === 'ArrowDown')) {
      onResize(step);
      event.preventDefault();
    }
  }, [direction, onResize]);

  const resizerClassName = useMemo(() => ([
    'app-resizer',
    `app-resizer--${direction}`,
    isDragging ? 'app-resizer--dragging' : '',
    className,
  ].filter(Boolean).join(' ')), [className, direction, isDragging]);

  return (
    <div
      ref={resizerRef}
      className={resizerClassName}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel || `Redimensionar ${direction === 'horizontal' ? 'horizontalmente' : 'verticalmente'}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyboardResize}
      data-testid={resolvedTestId}
      data-resizer-state={isDragging ? 'dragging' : 'idle'}
      data-resizer-direction={direction}
      title={`Arrastra para redimensionar ${direction === 'horizontal' ? 'horizontalmente' : 'verticalmente'}`}
    >
      <div className="app-resizer__lane">
        <div className="app-resizer__grip" />
      </div>
    </div>
  );
};

export default Resizer;
