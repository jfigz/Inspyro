import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DesktopTitleBar from './DesktopTitleBar';

const buildNotebookToolbarProps = (overrides = {}) => ({
  kernelId: 'kernel-123456',
  kernelInterrupted: false,
  isExecuting: false,
  connectionStatus: 'connected',
  hasNotebook: true,
  onAddCode: jest.fn(),
  onAddMarkdown: jest.fn(),
  onExecuteAll: jest.fn(),
  onInterrupt: jest.fn(),
  onReset: jest.fn(),
  onShutdown: jest.fn(),
  onClearOutputs: jest.fn(),
  onSave: jest.fn(),
  onLoad: jest.fn(),
  autoDocEnabled: true,
  onToggleAutoDoc: jest.fn(),
  autoSaveEnabled: false,
  onToggleAutoSave: jest.fn(),
  trustHtml: false,
  onToggleTrustHtml: jest.fn(),
  enableTracing: false,
  onToggleTracing: jest.fn(),
  docxValidationEnabled: true,
  onToggleDocxValidation: jest.fn(),
  ...overrides,
});

const renderTitleBar = (props = {}) => render(
  <DesktopTitleBar
    isDesktop
    connectionStatus="connected"
    connectionStatusText="Conectado"
    notifications={[]}
    mcpStatus={{ status: 'stopped', port: 8100 }}
    onDismissNotification={jest.fn()}
    onDismissAllNotifications={jest.fn()}
    onNavigate={jest.fn()}
    onToggleMirror={jest.fn()}
    onToggleMcpPanel={jest.fn()}
    onMcpQuickAction={jest.fn()}
    onGoHome={jest.fn()}
    onGoToFileSurface={jest.fn()}
    onExecuteCode={jest.fn()}
    {...props}
  />,
);

describe('DesktopTitleBar', () => {
  it('shows notebook actions in the single top bar without project or notebook pills', () => {
    renderTitleBar({
      mode: 'notebook',
      hasContextualFile: true,
      notebookToolbarProps: buildNotebookToolbarProps(),
    });

    expect(screen.getByTestId('desktop-titlebar-context-actions')).toBeTruthy();
    expect(screen.getByTestId('notebook-toolbar')).toBeTruthy();
    expect(screen.getByText('Espacio de ingeniería nativo para IA')).toBeTruthy();
    expect(document.querySelector('.desktop-titlebar__project-card')).toBeNull();
    expect(document.querySelector('.desktop-titlebar__subbar')).toBeNull();
    expect(screen.queryByText(/^Notebook$/)).toBeNull();
    expect(screen.queryByText(/^Proyecto activo$/)).toBeNull();
    expect(screen.queryByText(/^Kernel\s/)).toBeNull();
  });

  it('keeps notebook dropdown actions usable inside the title bar context slot', () => {
    renderTitleBar({
      mode: 'notebook',
      hasContextualFile: true,
      notebookToolbarProps: buildNotebookToolbarProps(),
    });

    fireEvent.click(screen.getByTitle('Configuración'));

    expect(screen.getByRole('button', { name: /Autoguardado/i })).toBeTruthy();
  });

  it('shows the code run action in the contextual center slot for code files', () => {
    renderTitleBar({
      mode: 'code',
      hasContextualFile: true,
    });

    expect(screen.getByTestId('desktop-titlebar-context-actions')).toBeTruthy();
    expect(screen.getByTestId('desktop-titlebar-run-code')).toBeTruthy();
    expect(screen.queryByTestId('notebook-toolbar')).toBeNull();
  });

  it('hides contextual actions when the launcher is visible', () => {
    renderTitleBar({
      showProjectLauncher: true,
      mode: 'code',
      hasContextualFile: true,
    });

    expect(screen.queryByTestId('desktop-titlebar-context-actions')).toBeNull();
    expect(screen.getByTestId('desktop-titlebar-mission')).toBeTruthy();
    expect(screen.getByText('Entender el proyecto')).toBeTruthy();
  });

  it('shows persistent home/files navigation for the active workspace shell', () => {
    const onGoHome = jest.fn();
    const onGoToFileSurface = jest.fn();

    renderTitleBar({
      isWorkspaceHome: true,
      workspaceName: 'Bridge Report',
      hasOpenFiles: true,
      onGoHome,
      onGoToFileSurface,
    });

    expect(screen.getByTestId('desktop-titlebar-workspace-nav')).toBeTruthy();
    expect(screen.getByText('Bridge Report')).toBeTruthy();

    fireEvent.click(screen.getByTestId('desktop-titlebar-go-home'));
    fireEvent.click(screen.getByTestId('desktop-titlebar-go-file'));

    expect(onGoHome).toHaveBeenCalledTimes(1);
    expect(onGoToFileSurface).toHaveBeenCalledTimes(1);
  });

  it('passes notification navigation through to NotificationCenter', () => {
    const onNavigate = jest.fn();

    renderTitleBar({
      notifications: [{
        id: 'notif-nav',
        type: 'info',
        title: 'Abrir notebook',
        message: 'Ir al notebook activo',
        timestamp: new Date('2026-04-19T10:00:00Z'),
        filePath: 'C:\\workspace\\demo.ipynb',
        cellId: 'cell-1',
      }],
      onNavigate,
    });

    fireEvent.click(screen.getByRole('button', { name: /centro de notificaciones/i }));
    fireEvent.click(screen.getByTestId('notification-card-nav-notif-nav'));

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\workspace\\demo.ipynb',
      cellId: 'cell-1',
      line: null,
      column: null,
      symbol: null,
      focusView: null,
      sourceMode: null,
    }), expect.objectContaining({ id: 'notif-nav' }));
  });
});
