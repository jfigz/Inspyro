import React from 'react';
import { render, screen } from '@testing-library/react';
import FileActionDialog from './FileActionDialog';

describe('FileActionDialog', () => {
  it('does not prefill create dialogs with the current selection name', () => {
    render(
      <FileActionDialog
        isOpen
        mode="create_file"
        targetName="demo_docx_api_completo.ipynb"
        parentPath="C:\\workspace"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByTestId('file-action-name-input').value).toBe('');
    expect(screen.getByPlaceholderText('ej: calculo.py')).toBeTruthy();
  });

  it('keeps rename dialogs prefilled with the selected item name', () => {
    render(
      <FileActionDialog
        isOpen
        mode="rename"
        targetName="demo_docx_api_completo.ipynb"
        targetPath="C:\\workspace\\demo_docx_api_completo.ipynb"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByTestId('file-action-name-input').value).toBe('demo_docx_api_completo.ipynb');
  });
});
