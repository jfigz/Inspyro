import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import NotebookToolbar from './NotebookToolbar';

const buildProps = (overrides = {}) => ({
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

describe('NotebookToolbar', () => {
  it('opens the settings dropdown and exposes notebook toggles', () => {
    render(<NotebookToolbar {...buildProps()} />);

    fireEvent.click(screen.getByTitle('Configuración'));

    expect(screen.getByRole('button', { name: /Autoguardado/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /HTML\/JS confiable/i })).toBeTruthy();
  });

  it('invokes clear outputs from the more actions dropdown', () => {
    const props = buildProps();
    render(<NotebookToolbar {...props} />);

    fireEvent.click(screen.getByTitle('Más acciones'));
    fireEvent.click(screen.getByRole('button', { name: /Eliminar outputs/i }));

    expect(props.onClearOutputs).toHaveBeenCalledTimes(1);
  });

  it('disables clear outputs while the notebook is executing', () => {
    render(<NotebookToolbar {...buildProps({ isExecuting: true })} />);

    fireEvent.click(screen.getByTitle('Más acciones'));

    expect(screen.getByRole('button', { name: /Eliminar outputs/i }).disabled).toBe(true);
  });

  it('keeps Run All available while the notebook socket is connecting', () => {
    const props = buildProps({ connectionStatus: 'connecting' });
    render(<NotebookToolbar {...props} />);

    const runAllButton = screen.getByTestId('notebook-toolbar-run-all');
    expect(runAllButton.disabled).toBe(false);

    fireEvent.click(runAllButton);

    expect(props.onExecuteAll).toHaveBeenCalledTimes(1);
  });
});
