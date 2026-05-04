import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RendererRoot from './RendererRoot';

describe('RendererRoot', () => {
  let reportRendererPhase;
  let openDevTools;
  let reloadRenderer;
  let consoleErrorSpy;

  beforeEach(() => {
    reportRendererPhase = jest.fn();
    openDevTools = jest.fn();
    reloadRenderer = jest.fn();
    window.inspyroDesktop = {
      reportRendererPhase,
      openDevTools,
      reloadRenderer,
    };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.inspyroDesktop;
    consoleErrorSpy.mockRestore();
  });

  it('reports renderer_app_ready when the shell mounts successfully', async () => {
    const ReadyApp = () => <div>Shell listo</div>;
    const ScrollManager = () => <div>Scroll manager</div>;

    render(
      <RendererRoot
        AppComponent={ReadyApp}
        ScrollManagerComponent={ScrollManager}
      />
    );

    expect(screen.getByText('Shell listo')).toBeTruthy();

    await waitFor(() => expect(reportRendererPhase).toHaveBeenCalledWith(
      'renderer_app_ready',
      expect.objectContaining({
        phase: 'renderer_app_ready',
        timestamp: expect.any(String),
      }),
    ));
  });

  it('shows a fatal fallback and reports renderer_app_failed when App throws during bootstrap', async () => {
    const BrokenApp = () => {
      throw new Error('boom');
    };

    render(
      <RendererRoot
        AppComponent={BrokenApp}
        ScrollManagerComponent={null}
      />
    );

    expect(screen.getByTestId('renderer-fatal-screen')).toBeTruthy();
    expect(screen.getByText(/no pudo iniciar la interfaz/i)).toBeTruthy();

    await waitFor(() => expect(reportRendererPhase).toHaveBeenCalledWith(
      'renderer_app_failed',
      expect.objectContaining({
        message: 'boom',
        phase: 'renderer_app_failed',
        timestamp: expect.any(String),
      }),
    ));
  });

  it('can retry the renderer after a bootstrap failure', async () => {
    let shouldThrow = true;
    const FlakyApp = () => {
      if (shouldThrow) {
        throw new Error('first crash');
      }
      return <div>Renderer recuperado</div>;
    };

    render(
      <RendererRoot
        AppComponent={FlakyApp}
        ScrollManagerComponent={null}
      />
    );

    expect(screen.getByTestId('renderer-fatal-screen')).toBeTruthy();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /reintentar renderer/i }));

    expect(screen.getByText('Renderer recuperado')).toBeTruthy();
    await waitFor(() => expect(reportRendererPhase).toHaveBeenCalledWith(
      'renderer_app_ready',
      expect.objectContaining({
        phase: 'renderer_app_ready',
      }),
    ));
  });

  it('exposes recovery actions in the fatal fallback', () => {
    const BrokenApp = () => {
      throw new Error('broken again');
    };

    render(
      <RendererRoot
        AppComponent={BrokenApp}
        ScrollManagerComponent={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /reiniciar shell/i }));
    fireEvent.click(screen.getByRole('button', { name: /abrir devtools/i }));

    expect(reloadRenderer).toHaveBeenCalledTimes(1);
    expect(openDevTools).toHaveBeenCalledTimes(1);
  });
});
