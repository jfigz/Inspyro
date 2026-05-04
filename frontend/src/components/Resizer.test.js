import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Resizer from './Resizer';

describe('Resizer', () => {
  let requestAnimationFrameSpy;
  let cancelAnimationFrameSpy;
  let rafQueue;

  beforeEach(() => {
    rafQueue = [];
    requestAnimationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    });
    cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.classList.remove('app-resizer-dragging-horizontal', 'app-resizer-dragging-vertical');
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  const flushAnimationFrame = () => {
    const callback = rafQueue.shift();
    if (callback) {
      act(() => {
        callback(16);
      });
    }
  };

  const dispatchPointerEvent = (target, type, init = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.entries(init).forEach(([key, value]) => {
      Object.defineProperty(event, key, {
        configurable: true,
        enumerable: true,
        value,
      });
    });
    act(() => {
      target.dispatchEvent(event);
    });
  };

  it('batches pointer drag deltas through requestAnimationFrame', () => {
    const onResize = jest.fn();
    const onResizeStart = jest.fn();
    const onResizeEnd = jest.fn();
    render(
      <Resizer
        onResize={onResize}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
        ariaLabel="Redimensionar panel"
      />,
    );

    const separator = screen.getByRole('separator', { name: /redimensionar panel/i });
    dispatchPointerEvent(separator, 'pointerdown', { button: 0, pointerId: 1, clientX: 100 });
    dispatchPointerEvent(window, 'pointermove', { pointerId: 1, clientX: 110 });
    dispatchPointerEvent(window, 'pointermove', { pointerId: 1, clientX: 124 });

    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('app-resizer-dragging-horizontal')).toBe(true);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();

    flushAnimationFrame();

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(24);

    dispatchPointerEvent(window, 'pointerup', { pointerId: 1 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('app-resizer-dragging-horizontal')).toBe(false);
  });

  it('flushes a pending drag delta when pointerup happens before the frame runs', () => {
    const onResize = jest.fn();
    render(<Resizer onResize={onResize} ariaLabel="Redimensionar panel" />);

    const separator = screen.getByRole('separator', { name: /redimensionar panel/i });
    dispatchPointerEvent(separator, 'pointerdown', { button: 0, pointerId: 2, clientX: 50 });
    dispatchPointerEvent(window, 'pointermove', { pointerId: 2, clientX: 62 });
    dispatchPointerEvent(window, 'pointerup', { pointerId: 2 });

    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(12);
    expect(document.body.classList.contains('app-resizer-dragging-horizontal')).toBe(false);
  });

  it('keeps keyboard resizing immediate and accessible', () => {
    const onResize = jest.fn();
    const onResizeStart = jest.fn();
    const onResizeEnd = jest.fn();
    render(
      <Resizer
        onResize={onResize}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
        ariaLabel="Redimensionar panel"
      />,
    );

    const separator = screen.getByRole('separator', { name: /redimensionar panel/i });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });

    expect(onResize).toHaveBeenNthCalledWith(1, 12);
    expect(onResize).toHaveBeenNthCalledWith(2, -24);
    expect(onResizeStart).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});
