import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import NotebookIndexPanel from './NotebookIndexPanel';

describe('NotebookIndexPanel', () => {
  it('renders an empty state when there is no active notebook', () => {
    render(
      <NotebookIndexPanel
        notebook={null}
        notebookPath={null}
        onToggleCollapse={jest.fn()}
        onNavigate={jest.fn()}
      />
    );

    expect(screen.getByText('Sin notebook activo')).toBeTruthy();
  });

  it('renders the notebook outline and calls onNavigate with the selected cell target', () => {
    const handleNavigate = jest.fn();

    render(
      <NotebookIndexPanel
        notebook={{
          cells: [
            { id: 'cell-1', cell_type: 'markdown', source: ['# Resumen', '## Alcance'] },
            { id: 'cell-2', cell_type: 'code', source: ['print("hola")'] },
          ],
        }}
        notebookPath={'C:\\workspace\\report.ipynb'}
        activeCellId={'cell-1'}
        onToggleCollapse={jest.fn()}
        onNavigate={handleNavigate}
      />
    );

    const headingButton = screen.getByTitle('Resumen');
    expect(screen.getByText('Alcance')).toBeTruthy();
    fireEvent.click(headingButton);

    expect(handleNavigate).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\workspace\\report.ipynb',
      cellId: 'cell-1',
      cellIndex: 0,
      title: 'Resumen',
      level: 1,
    }));
  });

  it('does not expose placeholder chevrons as unnamed buttons', () => {
    render(
      <NotebookIndexPanel
        notebook={{
          cells: [
            { id: 'cell-1', cell_type: 'markdown', source: ['# Resumen', '## Alcance'] },
            { id: 'cell-2', cell_type: 'markdown', source: ['# Cierre'] },
          ],
        }}
        notebookPath={'C:\\workspace\\report.ipynb'}
        onToggleCollapse={jest.fn()}
        onNavigate={jest.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.every((button) => button.getAttribute('aria-label') || button.textContent.trim())).toBe(true);
  });

  it('hides the tree content when the panel is collapsed', () => {
    render(
      <NotebookIndexPanel
        notebook={{
          cells: [
            { id: 'cell-1', cell_type: 'markdown', source: ['# Resumen'] },
          ],
        }}
        notebookPath={'C:\\workspace\\report.ipynb'}
        isCollapsed
        onToggleCollapse={jest.fn()}
        onNavigate={jest.fn()}
      />
    );

    expect(screen.queryByRole('tree', { name: 'Estructura del notebook activo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expandir indice de notebook' })).toBeTruthy();
  });
});
