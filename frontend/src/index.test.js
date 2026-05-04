import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';

describe('renderer bootstrap entrypoint', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    const originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message, ...rest) => {
      if (String(message || '').includes('not wrapped in act')) {
        return;
      }
      originalConsoleError(message, ...rest);
    });
  });

  afterEach(() => {
    jest.dontMock('./boot/RendererRoot');
    jest.dontMock('./boot/rendererDesktopBridge');
    consoleErrorSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('reports renderer_bootstrap_ready and mounts visible content into #root', async () => {
    const reportRendererPhase = jest.fn();
    const installRendererErrorHandlers = jest.fn();

    jest.doMock('./boot/rendererDesktopBridge', () => ({
      __esModule: true,
      installRendererErrorHandlers,
      reportRendererPhase,
    }));

    jest.doMock('./boot/RendererRoot', () => ({
      __esModule: true,
      default: () => React.createElement('div', { 'data-testid': 'renderer-root-smoke' }, 'Renderer root ready'),
    }));

    await act(async () => {
      jest.isolateModules(() => {
        require('./index');
      });
    });

    await waitFor(() => expect(screen.getByTestId('renderer-root-smoke')).toBeTruthy());

    expect(installRendererErrorHandlers).toHaveBeenCalledTimes(1);
    expect(reportRendererPhase).toHaveBeenCalledWith(
      'renderer_bootstrap_ready',
      expect.objectContaining({
        phase: 'renderer_bootstrap_ready',
        href: expect.stringContaining('http://localhost'),
      }),
    );
    expect(document.getElementById('root').innerHTML).not.toEqual('');
  });
});
