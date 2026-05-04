import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotebookCell from './NotebookCell';

jest.mock('../MonacoEditor', () => ({
  __esModule: true,
  default: function MockMonacoEditor({ value }) {
    return <div data-testid="monaco-value">{value}</div>;
  },
}));

jest.mock('./MarkdownRenderer', () => function MockMarkdownRenderer({ trustHtml = false }) {
  return <div data-testid="markdown-renderer" data-trust-html={String(trustHtml)} />;
});

jest.mock('../OutputRenderer', () => function MockOutputRenderer() {
  return <div data-testid="output-renderer" />;
});

jest.mock('../DropdownMenu', () => function MockDropdownMenu() {
  return null;
});

jest.mock('../Icons', () => ({
  IconPlay: () => null,
  IconCode: () => null,
  IconText: () => null,
  IconDocx: () => null,
  IconChevronUp: () => null,
  IconChevronDown: () => null,
  IconTrash: () => null,
  IconCheck: () => null,
  IconMenu: () => null,
  IconMinus: () => null,
  IconSquare: () => null,
}));

const buildCell = (source, cellType = 'code', overrides = {}) => ({
  id: 'cell-a',
  cell_type: cellType,
  source,
  outputs: [],
  execution_count: null,
  metadata: {},
  ...overrides,
});

const expandMinimizedCell = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('minimized-code-preview'));
    await Promise.resolve();
  });
};

const originalConsoleError = console.error;

describe('NotebookCell', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
      if (
        typeof message === 'string'
        && message.includes('A suspended resource finished loading inside a test')
      ) {
        return;
      }
      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('collapses Python and DOCX cells by default while markdown stays rendered', () => {
    const baseProps = {
      onExecute: jest.fn(),
      onUpdate: jest.fn(),
      onDelete: jest.fn(),
      onMoveUp: jest.fn(),
      onMoveDown: jest.fn(),
      precedingCells: [],
      notebookPath: 'C:\\workspace\\demo.ipynb',
    };

    const { rerender } = render(
      <NotebookCell
        {...baseProps}
        cell={buildCell(['x = 1', 'display(x)'], 'code', {
          outputs: [{ output_type: 'stream', text: '1\n' }],
          execution_count: 1,
          metadata: { execution_duration: 125 },
        })}
      />,
    );

    expect(screen.queryByTestId('monaco-value')).toBeNull();
    const executedPreview = screen.getByTestId('minimized-code-preview');
    expect(executedPreview.textContent).toContain('PY');
    expect(executedPreview.textContent).not.toContain('2 lineas');
    expect(executedPreview.textContent).not.toContain('x = 1');
    expect(executedPreview.textContent).not.toContain('display(x)');
    expect(executedPreview.textContent).toContain('[1]');
    expect(executedPreview.textContent).toContain('0.1s');
    expect(executedPreview.textContent).toContain('1 resultado');
    expect(executedPreview.querySelector('.minimized-code-preview__summary')).toBeNull();
    expect(executedPreview.querySelector('.minimized-code-preview__source')).toBeNull();
    expect(executedPreview.textContent.indexOf('[1]')).toBeLessThan(executedPreview.textContent.indexOf('0.1s'));
    expect(screen.getByTestId('output-renderer')).not.toBeNull();
    const codeFrame = screen.getByTestId('minimized-code-preview').closest('.cell-frame');
    const outputCard = screen.getByTestId('output-renderer').closest('.cell-output');
    expect(codeFrame).not.toBeNull();
    expect(outputCard).not.toBeNull();
    expect(codeFrame.contains(outputCard)).toBe(false);
    expect(outputCard.previousElementSibling).toBe(codeFrame);
    expect(outputCard.querySelector('.output-header__meta').textContent).toContain('1 resultado');
    expect(outputCard.querySelector('.output-header__meta').textContent).not.toContain('Resultados');
    expect(outputCard.querySelector('.output-header__meta').textContent).not.toContain('stdout');
    expect(outputCard.querySelector('.output-header__secondary').textContent).toContain('stdout');
    expect(outputCard.querySelector('.output-header__secondary').textContent).toContain('JSON');

    rerender(
      <NotebookCell
        {...baseProps}
        cell={buildCell(['alpha = 1', 'beta = alpha + 1'], 'code')}
      />,
    );

    const pendingPreview = screen.getByTestId('minimized-code-preview');
    expect(pendingPreview.textContent).toContain('PY');
    expect(pendingPreview.textContent).not.toContain('alpha = 1');
    expect(pendingPreview.textContent).not.toContain('beta = alpha + 1');
    expect(pendingPreview.textContent).toContain('2 lineas');
    expect(pendingPreview.textContent).toContain('sin ejecutar');
    expect(pendingPreview.textContent).toContain('sin resultados');
    expect(pendingPreview.querySelector('.minimized-code-preview__summary')).toBeNull();
    expect(pendingPreview.querySelector('.minimized-code-preview__source')).toBeNull();

    rerender(
      <NotebookCell
        {...baseProps}
        cell={buildCell(['with build_doc() as doc:', '    doc.text("x")'], 'docx', {
          outputs: [
            { output_type: 'display_data', data: { 'text/html': '<b>x</b>' } },
            { output_type: 'execute_result', data: { 'application/json': { ok: true } } },
          ],
          execution_count: 2,
          metadata: { execution_duration: 245 },
        })}
      />,
    );

    expect(screen.queryByTestId('monaco-value')).toBeNull();
    expect(screen.getByTestId('minimized-code-preview').textContent).toContain('DOCX');
    expect(screen.getByTestId('minimized-code-preview').textContent).toContain('[2]');
    expect(screen.getByTestId('minimized-code-preview').textContent).toContain('0.2s');
    expect(screen.getByTestId('minimized-code-preview').textContent).toContain('2 resultados');
    expect(screen.getByTestId('minimized-code-preview').textContent).not.toContain('with build_doc() as doc:');
    expect(screen.getByTestId('minimized-code-preview').textContent).not.toContain('doc.text("x")');
    expect(screen.getByTestId('minimized-code-preview').textContent.indexOf('[2]')).toBeLessThan(
      screen.getByTestId('minimized-code-preview').textContent.indexOf('0.2s'),
    );

    rerender(
      <NotebookCell
        {...baseProps}
        cell={buildCell(['raise ValueError("x")'], 'code', {
          outputs: [{ output_type: 'error', ename: 'ValueError', evalue: 'x', traceback: [] }],
          execution_count: 4,
          metadata: { execution_duration: 789 },
        })}
      />,
    );

    const errorPreview = screen.getByTestId('minimized-code-preview');
    expect(errorPreview.textContent).not.toContain('raise ValueError("x")');
    expect(errorPreview.textContent).toContain('[4]');
    expect(errorPreview.textContent).toContain('0.8s');
    expect(errorPreview.textContent).toContain('con error');
    expect(errorPreview.querySelector('.minimized-code-preview__summary')).toBeNull();
    expect(errorPreview.querySelector('.minimized-code-preview__source')).toBeNull();
    expect(errorPreview.textContent.indexOf('[4]')).toBeLessThan(errorPreview.textContent.indexOf('0.8s'));

    rerender(
      <NotebookCell
        {...baseProps}
        cell={buildCell(['# Informe'], 'markdown')}
      />,
    );

    expect(screen.queryByTestId('minimized-code-preview')).toBeNull();
    expect(screen.getByTestId('markdown-renderer')).not.toBeNull();
    expect(screen.getByTestId('markdown-renderer').getAttribute('data-trust-html')).toBe('false');
  });

  it('passes trusted HTML mode to rendered markdown cells', () => {
    render(
      <NotebookCell
        cell={buildCell(['<script>window.ok = true</script>'], 'markdown')}
        trustHtml
        onExecute={jest.fn()}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onMoveUp={jest.fn()}
        onMoveDown={jest.fn()}
        precedingCells={[]}
        notebookPath="C:\\workspace\\demo.ipynb"
      />,
    );

    expect(screen.getByTestId('markdown-renderer').getAttribute('data-trust-html')).toBe('true');
  });

  it('mounts Monaco only after an explicit expand action without mutating source', async () => {
    const onUpdate = jest.fn();
    render(
      <NotebookCell
        cell={buildCell(['print("visible on demand")'])}
        onExecute={jest.fn()}
        onUpdate={onUpdate}
        onDelete={jest.fn()}
        onMoveUp={jest.fn()}
        onMoveDown={jest.fn()}
        precedingCells={[]}
        notebookPath="C:\\workspace\\demo.ipynb"
      />,
    );

    expect(screen.queryByTestId('monaco-value')).toBeNull();

    await expandMinimizedCell();

    await waitFor(() => expect(screen.getByTestId('monaco-value').textContent).toBe('print("visible on demand")'));
    expect(screen.getByTestId('cell-collapse-strip')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('cell-collapse-strip'));
      await Promise.resolve();
    });

    expect(screen.queryByTestId('monaco-value')).toBeNull();
    expect(screen.getByTestId('minimized-code-preview')).not.toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('syncs editor source when the same cell receives a remote source update', async () => {
    const props = {
      onExecute: jest.fn(),
      onUpdate: jest.fn(),
      onDelete: jest.fn(),
      onMoveUp: jest.fn(),
      onMoveDown: jest.fn(),
      precedingCells: [],
      notebookPath: 'C:\\workspace\\demo.ipynb',
    };

    const { rerender } = render(
      <NotebookCell
        {...props}
        cell={buildCell(['print("old")'])}
      />,
    );

    await expandMinimizedCell();

    await waitFor(() => expect(screen.getByTestId('monaco-value').textContent).toBe('print("old")'));

    rerender(
      <NotebookCell
        {...props}
        cell={buildCell(['print("new")'])}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('monaco-value').textContent).toBe('print("new")'));
  });

  it('executes from the left-side run control', () => {
    const onExecute = jest.fn();

    render(
      <NotebookCell
        cell={buildCell(['print("run")'])}
        onExecute={onExecute}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onMoveUp={jest.fn()}
        onMoveDown={jest.fn()}
        precedingCells={[]}
        notebookPath="C:\\workspace\\demo.ipynb"
      />,
    );

    fireEvent.click(screen.getByTestId('cell-run-button'));

    expect(onExecute).toHaveBeenCalledWith('cell-a', ['print("run")']);
  });

  it('toggles a Python cell between code and docx', () => {
    const onUpdate = jest.fn();
    const props = {
      onExecute: jest.fn(),
      onUpdate,
      onDelete: jest.fn(),
      onMoveUp: jest.fn(),
      onMoveDown: jest.fn(),
      precedingCells: [],
      notebookPath: 'C:\\workspace\\demo.ipynb',
    };

    const { rerender } = render(
      <NotebookCell
        {...props}
        cell={buildCell(['with build_doc() as doc:', '    doc.text("x")'])}
      />,
    );

    fireEvent.click(screen.getByTestId('cell-toggle-docx'));
    expect(onUpdate).toHaveBeenCalledWith(
      'cell-a',
      ['with build_doc() as doc:', '    doc.text("x")'],
      'docx',
    );

    rerender(
      <NotebookCell
        {...props}
        cell={buildCell(['with build_doc() as doc:', '    doc.text("x")'], 'docx')}
      />,
    );

    expect(screen.getByTestId('docx-cell-chip').textContent).toContain('DOCX');
    fireEvent.click(screen.getByTestId('cell-toggle-docx'));
    expect(onUpdate).toHaveBeenLastCalledWith(
      'cell-a',
      ['with build_doc() as doc:', '    doc.text("x")'],
      'code',
    );
  });

  it('blocks manual execution for docx cells when document execution is disabled', () => {
    const onExecute = jest.fn();

    render(
      <NotebookCell
        cell={buildCell(['with build_doc() as doc:', '    doc.text("x")'], 'docx')}
        docxExecutionEnabled={false}
        onExecute={onExecute}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onMoveUp={jest.fn()}
        onMoveDown={jest.fn()}
        precedingCells={[]}
        notebookPath="C:\\workspace\\demo.ipynb"
      />,
    );

    const runButton = screen.getByTestId('cell-run-button');
    expect(runButton.disabled).toBe(true);

    fireEvent.click(runButton);

    expect(onExecute).not.toHaveBeenCalled();
  });

  it('keeps the execution count before the last execution time in the minimized bar', () => {
    render(
      <NotebookCell
        cell={{
          ...buildCell(['print("done")']),
          execution_count: 3,
          metadata: { execution_duration: 245 },
        }}
        onExecute={jest.fn()}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onMoveUp={jest.fn()}
        onMoveDown={jest.fn()}
        precedingCells={[]}
        notebookPath="C:\\workspace\\demo.ipynb"
      />,
    );

    const preview = screen.getByTestId('minimized-code-preview');
    expect(preview.textContent).toContain('[3]');
    expect(preview.textContent).toContain('0.2s');
    expect(preview.textContent).not.toContain('print("done")');
    expect(preview.textContent.indexOf('[3]')).toBeLessThan(preview.textContent.indexOf('0.2s'));
  });
});
