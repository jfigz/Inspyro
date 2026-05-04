import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import NotebookEditor from './NotebookEditor';

jest.mock('./notebook/NotebookCell', () => function MockNotebookCell({
  cell,
  isSelected = false,
  highlightLine = null,
  highlightColumn = null,
}) {
  return (
    <div
      data-testid={`cell-row-${cell.id}`}
      data-cell-id={cell.id}
      data-selected={isSelected ? 'true' : 'false'}
      data-highlight-line={highlightLine ?? ''}
      data-highlight-column={highlightColumn ?? ''}
    >
      <div data-testid={`cell-source-${cell.id}`}>
        {Array.isArray(cell.source) ? cell.source.join('\n') : cell.source}
      </div>
      <div data-testid={`cell-outputs-${cell.id}`}>{Array.isArray(cell.outputs) ? cell.outputs.length : 0}</div>
      {(cell.outputs || []).map((output, index) => (
        <div key={`${cell.id}-output-${index}`} data-testid={`cell-output-${cell.id}-${index}`}>
          {output.output_type}:{output?.data?.['text/plain'] || output?.evalue || output?.text || ''}
        </div>
      ))}
    </div>
  );
});

const FILE_PATH = 'C:\\workspace\\demo.ipynb';
const SECOND_FILE_PATH = 'C:\\workspace\\second.ipynb';

const buildNotebook = (cells) => ({
  cells,
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

const buildCodeCell = (id, source) => ({
  id,
  cell_type: 'code',
  source: [source],
  outputs: [],
  execution_count: null,
  metadata: {},
});

const buildDocxCell = (id, source) => ({
  id,
  cell_type: 'docx',
  source: [source],
  outputs: [],
  execution_count: null,
  metadata: {},
});

const buildExecutedCodeCell = (id, source) => ({
  id,
  cell_type: 'code',
  source: [source],
  outputs: [{ output_type: 'stream', text: 'ok\n' }],
  execution_count: 3,
  metadata: { execution_duration: 125 },
});

const buildCodeCellWithoutId = (source) => ({
  cell_type: 'code',
  source: [source],
  outputs: [],
  execution_count: null,
  metadata: {},
});

const getCellOrder = (container) => (
  Array.from(container.querySelectorAll('[data-testid^="cell-row-"]')).map((node) => node.getAttribute('data-cell-id'))
);

describe('NotebookEditor imperative MCP APIs', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('replaceNotebookSnapshot updates the active notebook for the same path', async () => {
    const actionsRef = { current: null };
    const onStatusMessage = jest.fn();
    const onNotebookChange = jest.fn();
    const { queryByTestId } = render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
        onNotebookChange={onNotebookChange}
      />
    );

    await waitFor(() => expect(actionsRef.current?.replaceNotebookSnapshot).toBeInstanceOf(Function));
    await waitFor(() => expect(screen.getByTestId('cell-row-cell-a')).not.toBeNull());
    jest.useFakeTimers();

    act(() => {
      actionsRef.current.replaceNotebookSnapshot(
        buildNotebook([buildCodeCell('cell-b', 'print("snapshot")')]),
        { focusCellId: 'cell-b' },
      );
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() => expect(screen.getByTestId('cell-row-cell-b')).not.toBeNull());
    expect(screen.getByTestId('cell-source-cell-b').textContent).toBe('print("snapshot")');
    expect(queryByTestId('cell-row-cell-a')).toBeNull();
    expect(onStatusMessage).not.toHaveBeenCalled();
    expect(onNotebookChange).not.toHaveBeenCalled();
  });

  it('does not emit a persistable notebook change on the initial mount', async () => {
    const actionsRef = { current: null };
    const onNotebookChange = jest.fn();

    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
        onNotebookChange={onNotebookChange}
      />
    );

    await waitFor(() => expect(actionsRef.current?.getNotebook).toBeInstanceOf(Function));
    await waitFor(() => expect(screen.getByTestId('cell-row-cell-a')).not.toBeNull());
    expect(onNotebookChange).not.toHaveBeenCalled();
  });

  it('prefers shell-owned hydration over replaying the current lastMessage on mount', async () => {
    const actionsRef = { current: null };
    const onStatusMessage = jest.fn();

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={jest.fn()}
        lastMessage={{
          type: 'notebook_loaded',
          kernel_id: 'kernel-live',
          notebook_path: FILE_PATH,
          notebook: buildNotebook([buildCodeCell('cell-stale', 'print("stale")')]),
        }}
        initialNotebook={buildNotebook([buildCodeCell('cell-live', 'print("live")')])}
        initialNotebookOrigin="runtime"
        initialKernelId="kernel-live"
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
      />
    );

    await waitFor(() => expect(actionsRef.current?.getNotebook).toBeInstanceOf(Function));
    await waitFor(() => expect(screen.getByTestId('cell-row-cell-live')).not.toBeNull());
    expect(screen.queryByTestId('cell-row-cell-stale')).toBeNull();
    expect(actionsRef.current.getNotebook().cells.map((cell) => cell.id)).toEqual(['cell-live']);
    expect(onStatusMessage).not.toHaveBeenCalled();
  });

  it('does not report the previous kernel when the visible notebook path changes', async () => {
    const actionsRef = { current: null };
    const onKernelStateChange = jest.fn();
    const { rerender } = render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        initialNotebookOrigin="runtime"
        initialKernelId="kernel-a"
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
        onKernelStateChange={onKernelStateChange}
      />
    );

    await waitFor(() => expect(onKernelStateChange).toHaveBeenCalledWith(expect.objectContaining({
      filePath: FILE_PATH,
      kernelId: 'kernel-a',
    })));
    onKernelStateChange.mockClear();

    rerender(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-b', 'print("b")')])}
        initialNotebookOrigin="runtime"
        initialKernelId={null}
        filePath={SECOND_FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
        onKernelStateChange={onKernelStateChange}
      />
    );

    await waitFor(() => expect(onKernelStateChange).toHaveBeenCalledWith(expect.objectContaining({
      filePath: SECOND_FILE_PATH,
      kernelId: null,
    })));
    expect(onKernelStateChange).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: SECOND_FILE_PATH,
      kernelId: 'kernel-a',
    }));
  });

  it('keeps fallback cell ids stable across runtime notebook hydrations', async () => {
    const actionsRef = { current: null };
    const runtimeNotebook = buildNotebook([
      buildCodeCellWithoutId('x = 1'),
      buildCodeCellWithoutId('y = x + 1'),
    ]);
    const clonedRuntimeNotebook = JSON.parse(JSON.stringify(runtimeNotebook));
    const { rerender } = render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={runtimeNotebook}
        initialNotebookOrigin="runtime"
        initialNotebookToken={1}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.getNotebook).toBeInstanceOf(Function));
    const firstIds = actionsRef.current.getNotebook().cells.map((cell) => cell.id);

    rerender(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={clonedRuntimeNotebook}
        initialNotebookOrigin="runtime"
        initialNotebookToken={2}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current.getNotebook().cells).toHaveLength(2));
    const secondIds = actionsRef.current.getNotebook().cells.map((cell) => cell.id);

    expect(firstIds.every(Boolean)).toBe(true);
    expect(secondIds).toEqual(firstIds);
  });

  it('falls back to line-based notebook navigation when the requested cell id no longer exists', async () => {
    const actionsRef = { current: null };
    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([
          buildCodeCell('cell-a', 'print("short")'),
          buildCodeCell('cell-b', 'line 1\nline 2\nline 3'),
        ])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.navigateToCode).toBeInstanceOf(Function));

    act(() => {
      expect(actionsRef.current.navigateToCode({
        filePath: FILE_PATH,
        cellId: 'cell-missing',
        line: 3,
      })).toBe(true);
    });

    await waitFor(() => expect(screen.getByTestId('cell-row-cell-b').getAttribute('data-selected')).toBe('true'));
    expect(screen.getByTestId('cell-row-cell-b').getAttribute('data-highlight-line')).toBe('3');
  });

  it('consumeRemoteNotebookMessage handles executed, moved, reordered and deleted cells', async () => {
    const actionsRef = { current: null };
    const { container, queryByTestId } = render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([
          buildCodeCell('cell-a', 'print("a")'),
          buildCodeCell('cell-b', 'print("b")'),
          buildCodeCell('cell-c', 'print("c")'),
        ])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));
    await waitFor(() => expect(getCellOrder(container)).toEqual(['cell-a', 'cell-b', 'cell-c']));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-b',
        outputs: [{ output_type: 'stream', text: 'ok' }],
        execution_count: 1,
      });
    });
    await waitFor(() => expect(screen.getByTestId('cell-outputs-cell-b').textContent).toBe('1'));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_moved',
        cell_id: 'cell-c',
        direction: 'up',
      });
    });
    await waitFor(() => expect(getCellOrder(container)).toEqual(['cell-a', 'cell-c', 'cell-b']));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_order_set',
        order: ['cell-b', 'cell-a', 'cell-c'],
      });
    });
    await waitFor(() => expect(getCellOrder(container)).toEqual(['cell-b', 'cell-a', 'cell-c']));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_deleted',
        cell_id: 'cell-a',
      });
    });
    await waitFor(() => expect(getCellOrder(container)).toEqual(['cell-b', 'cell-c']));
    expect(queryByTestId('cell-row-cell-a')).toBeNull();
  });

  it('consumeRemoteNotebookMessage replaces live display outputs by display_id', async () => {
    const actionsRef = { current: null };
    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'display(progress)')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />,
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_display_data',
        cell_id: 'cell-a',
        content: {
          transient: { display_id: 'progress-1' },
          data: { 'text/plain': '10%' },
          metadata: {},
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('cell-outputs-cell-a').textContent).toBe('1'));
    expect(actionsRef.current.getNotebook().cells[0].outputs[0]).toEqual(expect.objectContaining({
      output_type: 'display_data',
      data: { 'text/plain': '10%' },
      transient: { display_id: 'progress-1' },
    }));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_update_display_data',
        cell_id: 'cell-a',
        content: {
          transient: { display_id: 'progress-1' },
          data: { 'text/plain': '80%' },
          metadata: {},
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('cell-output-cell-a-0').textContent).toContain('80%'));
    expect(actionsRef.current.getNotebook().cells[0].outputs).toHaveLength(1);
    expect(actionsRef.current.getNotebook().cells[0].outputs[0]).toEqual(expect.objectContaining({
      output_type: 'display_data',
      data: { 'text/plain': '80%' },
      transient: { display_id: 'progress-1' },
    }));
  });

  it('consumeRemoteNotebookMessage keeps live execution errors inline on the cell', async () => {
    const actionsRef = { current: null };
    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'raise ValueError("bad")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />,
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_error',
        cell_id: 'cell-a',
        error_code: 'notebook_execute_cell_failed',
        error: 'bad',
        details: {
          ename: 'ValueError',
          evalue: 'bad',
          traceback: ['Traceback...', 'ValueError: bad'],
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('cell-outputs-cell-a').textContent).toBe('1'));
    expect(actionsRef.current.getNotebook().cells[0].outputs[0]).toEqual({
      output_type: 'error',
      ename: 'ValueError',
      evalue: 'bad',
      traceback: ['Traceback...', 'ValueError: bad'],
    });
  });

  it('propagates degraded variable snapshot diagnostics to visualization data', async () => {
    const actionsRef = { current: null };
    const onVisualizationData = jest.fn();

    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={onVisualizationData}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-a',
        execution_id: 'exec-1',
        outputs: [],
        execution_count: 1,
        variables: { x: { repr: '1' } },
        variables_snapshot_degraded: true,
        execution_diagnostics: { variables_capture_degraded: true },
      });
    });

    await waitFor(() => expect(onVisualizationData).toHaveBeenCalledWith(expect.objectContaining({
      variablesSnapshotDegraded: true,
      executionDiagnostics: { variables_capture_degraded: true },
    })));
  });

  it('propagates persisted DOCX workspace metadata to visualization data', async () => {
    const actionsRef = { current: null };
    const onVisualizationData = jest.fn();

    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={onVisualizationData}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_docx_update',
        execution_id: 'exec-docx-1',
        kernel_id: 'kernel-1',
        source_path: FILE_PATH,
        source_kind: 'notebook',
        docx_artifact_id: 'artifact-docx-1',
        docx_ref: '/api/docx/download?artifact_id=artifact-docx-1',
        workspace_path: 'C:\\workspace\\Docx_Documents\\Docx_document_2026-04-18_22-30-00.docx',
        workspace_relpath: 'Docx_Documents\\Docx_document_2026-04-18_22-30-00.docx',
        workspace_warning: null,
      });
    });

    await waitFor(() => expect(onVisualizationData).toHaveBeenCalledWith(expect.objectContaining({
      docxArtifactId: 'artifact-docx-1',
      docxWorkspacePath: 'C:\\workspace\\Docx_Documents\\Docx_document_2026-04-18_22-30-00.docx',
      docxWorkspaceRelpath: 'Docx_Documents\\Docx_document_2026-04-18_22-30-00.docx',
      docxWorkspaceWarning: null,
    })));
  });

  it('shows word error details when PDF conversion fails', async () => {
    const onStatusMessage = jest.fn();
    const { rerender } = render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={{ current: null }}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
      />
    );

    rerender(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={{
          type: 'notebook_pdf_ready',
          pdf_conversion_error: 'all_converters_unavailable',
          word_error: 'El archivo parece estar corrompido.',
        }}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={{ current: null }}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
      />
    );

    await waitFor(() => expect(onStatusMessage).toHaveBeenCalledWith(
      'Error al generar PDF: all_converters_unavailable (Word: El archivo parece estar corrompido.)',
      'error',
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'document',
          sourcePath: FILE_PATH,
        }),
      }),
    ));
  });

  it('executeAll keeps batch mode active after the first notebook_cell_executed message', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([
      buildCodeCell('cell-a', 'print("a")'),
      buildCodeCell('cell-b', 'print("b")'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notebook_load',
      path: FILE_PATH,
    }));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook,
      });
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a'),
    ).toBe(true));

    const firstExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    expect(firstExecution.execution_timeout_s).toBe(600);

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-a',
        execution_id: firstExecution.execution_id,
        outputs: [{ output_type: 'stream', text: 'ok' }],
        execution_count: 1,
      });
    });

    await waitFor(() => expect(actionsRef.current.getExecutionState().executeAllInProgress).toBe(true));
    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b'),
    ).toBe(true));

    const secondExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b');

    expect(secondExecution.execution_timeout_s).toBe(600);

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-b',
        execution_id: secondExecution.execution_id,
        outputs: [{ output_type: 'stream', text: 'done' }],
        execution_count: 2,
      });
    });

    await act(async () => {
      await runAllPromise;
    });

    expect(
      sendMessage.mock.calls
        .map(([msg]) => msg)
        .filter((msg) => msg.type === 'notebook_execute_cell')
        .map((msg) => msg.cell_id),
    ).toEqual(['cell-a', 'cell-b']);
  });

  it('executeAll reuses a shell-owned kernel without sending notebook_load', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([buildCodeCell('cell-a', 'print("a")')]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        initialNotebookOrigin="runtime"
        initialKernelId="kernel-1"
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    expect(sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_load')).toBe(false);

    const executionMessage = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    expect(executionMessage).toBeTruthy();
    expect(executionMessage.kernel_id).toBe('kernel-1');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        kernel_id: 'kernel-1',
        cell_id: 'cell-a',
        execution_id: executionMessage.execution_id,
        outputs: [],
        execution_count: 1,
      });
    });

    await act(async () => {
      await runAllPromise;
    });
  });

  it('executeAll includes code and docx cells when DOCX/PDF is enabled', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([
      buildCodeCell('cell-code', 'x = 1'),
      buildDocxCell('cell-docx', 'with build_doc() as doc:\n    doc.text("x")'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        initialNotebookOrigin="runtime"
        initialKernelId="kernel-1"
        externalAutoDocEnabled={true}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-code'),
    ).toBe(true));

    const firstExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-code');
    expect(firstExecution.cell_type).toBe('code');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        kernel_id: 'kernel-1',
        cell_id: 'cell-code',
        execution_id: firstExecution.execution_id,
        outputs: [],
        execution_count: 1,
      });
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-docx'),
    ).toBe(true));

    const secondExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-docx');
    expect(secondExecution.cell_type).toBe('docx');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        kernel_id: 'kernel-1',
        cell_id: 'cell-docx',
        execution_id: secondExecution.execution_id,
        outputs: [],
        execution_count: 2,
      });
    });

    await act(async () => {
      await runAllPromise;
    });
  });

  it('executeAll omits docx cells when DOCX/PDF is disabled', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([
      buildDocxCell('cell-docx', 'with build_doc() as doc:\n    doc.text("x")'),
      buildCodeCell('cell-code', 'x = 1'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        initialNotebookOrigin="runtime"
        initialKernelId="kernel-1"
        externalAutoDocEnabled={false}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-code'),
    ).toBe(true));

    const executionMessages = sendMessage.mock.calls
      .map(([msg]) => msg)
      .filter((msg) => msg.type === 'notebook_execute_cell');

    expect(executionMessages.map((msg) => msg.cell_id)).toEqual(['cell-code']);
    expect(executionMessages[0].cell_type).toBe('code');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        kernel_id: 'kernel-1',
        cell_id: 'cell-code',
        execution_id: executionMessages[0].execution_id,
        outputs: [],
        execution_count: 1,
      });
    });

    await act(async () => {
      await runAllPromise;
    });
  });

  it('does not clear the current document artifact when DOCX/PDF is disabled', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([buildCodeCell('cell-a', 'print("a")')]);
    const props = {
      connectionStatus: 'connected',
      sendMessage,
      lastMessage: null,
      initialNotebook: notebook,
      initialNotebookOrigin: 'runtime',
      initialKernelId: 'kernel-1',
      filePath: FILE_PATH,
      actionsRef,
      onVisualizationData: jest.fn(),
      onStatusMessage: jest.fn(),
    };

    const { rerender } = render(
      <NotebookEditor
        {...props}
        externalAutoDocEnabled={true}
      />
    );

    await waitFor(() => expect(actionsRef.current?.getNotebook).toBeInstanceOf(Function));
    sendMessage.mockClear();

    rerender(
      <NotebookEditor
        {...props}
        externalAutoDocEnabled={false}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_mdoc_clear')).toBe(false);
  });

  it('strips runtime outputs before notebook_load when executeAll needs to start the kernel', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([
      buildExecutedCodeCell('cell-a', 'print("a")'),
      buildCodeCell('cell-b', 'print("b")'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    const loadMessage = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_load');

    expect(loadMessage).toBeTruthy();

    const loadedNotebook = JSON.parse(loadMessage.content);
    expect(loadedNotebook.cells[0].source).toEqual(['print("a")']);
    expect(loadedNotebook.cells[0].outputs).toEqual([]);
    expect(loadedNotebook.cells[0].execution_count).toBeNull();
    expect(loadedNotebook.cells[0].metadata).toEqual({ inspyro_id: 'cell-a' });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook: loadedNotebook,
      });
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a'),
    ).toBe(true));

    const firstExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    expect(firstExecution.execution_timeout_s).toBe(600);

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-a',
        execution_id: firstExecution.execution_id,
        outputs: [],
        execution_count: 1,
      });
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b'),
    ).toBe(true));

    const secondExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b');

    expect(secondExecution.execution_timeout_s).toBe(600);

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-b',
        execution_id: secondExecution.execution_id,
        outputs: [],
        execution_count: 2,
      });
    });

    await act(async () => {
      await runAllPromise;
    });
  });

  it('executeAll waits through the 180s mark and only cancels after the canonical 600s budget', async () => {
    jest.useFakeTimers();
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const onStatusMessage = jest.fn();
    const notebook = buildNotebook([buildCodeCell('cell-a', 'print("a")')]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook,
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const executionMessage = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    expect(executionMessage).toBeTruthy();
    expect(executionMessage.execution_timeout_s).toBe(600);

    await act(async () => {
      jest.advanceTimersByTime(180000);
      await Promise.resolve();
    });

    expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_cancel_execution' && msg.execution_id === executionMessage.execution_id),
    ).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(425000);
      await Promise.resolve();
      await runAllPromise;
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notebook_cancel_execution',
      execution_id: executionMessage.execution_id,
    }));
    expect(onStatusMessage).toHaveBeenCalledWith(
      expect.stringContaining('timeout esperando mensaje terminal para la celda cell-a'),
      'warning',
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'code',
          filePath: FILE_PATH,
          cellId: 'cell-a',
        }),
      }),
    );
  });

  it('refreshes pending execution liveness on notebook_progress_update and ignores late docx updates as terminal signals', async () => {
    jest.useFakeTimers();
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const onStatusMessage = jest.fn();
    const notebook = buildNotebook([buildCodeCell('cell-a', 'print("a")')]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook,
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const executionMessage = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    expect(executionMessage).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(47000);
      await Promise.resolve();
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: executionMessage.execution_id,
        message: 'Recuperando documento DOCX...',
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(47000);
      await Promise.resolve();
    });

    expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_cancel_execution' && msg.execution_id === executionMessage.execution_id),
    ).toBe(false);

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-a',
        execution_id: executionMessage.execution_id,
        outputs: [{ output_type: 'stream', text: 'ok' }],
        execution_count: 1,
        pdf_converting: true,
      });
    });

    await act(async () => {
      await runAllPromise;
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_docx_update',
        kernel_id: 'kernel-1',
        execution_id: executionMessage.execution_id,
        docx_ref: '/api/docx/download?artifact_id=artifact-1',
        docx_artifact_id: 'artifact-1',
        docx_file_name: 'inspyro_document.docx',
      });
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_pdf_ready',
        kernel_id: 'kernel-1',
        execution_id: executionMessage.execution_id,
        pdf_ref: null,
        pdf_file_b64: null,
        pdf_conversion_error: null,
      });
    });

    expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_cancel_execution' && msg.execution_id === executionMessage.execution_id),
    ).toBe(false);
    expect(
      onStatusMessage.mock.calls.some(([message]) => String(message).includes('Ejecución interrumpida')),
    ).toBe(false);
    expect(
      onStatusMessage.mock.calls.some(([message]) => String(message).includes('Notebook interrumpido')),
    ).toBe(false);
  });

  it('shows a green execution rail first and then a red document rail for Run All document generation', async () => {
    jest.useFakeTimers();
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const notebook = buildNotebook([
      buildCodeCell('cell-a', 'print("a")'),
      buildCodeCell('cell-b', 'print("b")'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.executeAll).toBeInstanceOf(Function));

    let runAllPromise;
    await act(async () => {
      runAllPromise = actionsRef.current.executeAll();
      await Promise.resolve();
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook,
      });
    });

    await waitFor(() => expect(screen.getByTestId('process-rail-execution')).not.toBeNull());
    expect(screen.getByTestId('process-rail-execution').textContent).toContain('Ejecutando notebook');

    const firstExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-a');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-a',
        execution_id: firstExecution.execution_id,
        outputs: [],
        execution_count: 1,
      });
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([msg]) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b'),
    ).toBe(true));
    expect(screen.getByTestId('process-rail-execution').textContent).toContain('1 de 2 celdas completadas');

    const secondExecution = sendMessage.mock.calls
      .map(([msg]) => msg)
      .find((msg) => msg.type === 'notebook_execute_cell' && msg.cell_id === 'cell-b');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_cell_executed',
        cell_id: 'cell-b',
        execution_id: secondExecution.execution_id,
        outputs: [],
        execution_count: 2,
        pdf_converting: true,
      });
    });

    await act(async () => {
      await runAllPromise;
    });

    expect(screen.getByTestId('process-rail-execution').textContent).toContain('Todas las 2 celdas terminaron.');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: secondExecution.execution_id,
        progress_scope: 'document',
        progress_stage: 'queued',
        progress_status: 'running',
        progress_percent: 8,
        message: 'Preparando documento...',
      });
    });

    expect(screen.queryByTestId('process-rail-document')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(950);
      await Promise.resolve();
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('Generando documento');
    expect(screen.getByTestId('process-rail-document').textContent).toContain('Preparando documento...');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: secondExecution.execution_id,
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        message: 'Convirtiendo a PDF...',
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('PDF');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_pdf_ready',
        kernel_id: 'kernel-1',
        execution_id: secondExecution.execution_id,
        pdf_ref: '/api/pdf/download?token=pdf-1',
        pdf_file_b64: null,
        pdf_conversion_error: null,
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('PDF listo en Documento.');

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(screen.queryByTestId('process-rail-document')).toBeNull();
  });

  it('clears local document progress when switching notebook files', async () => {
    const actionsRef = { current: null };
    const commonProps = {
      connectionStatus: 'connected',
      sendMessage: jest.fn(),
      lastMessage: null,
      actionsRef,
      onVisualizationData: jest.fn(),
      onStatusMessage: jest.fn(),
    };

    const { rerender } = render(
      <NotebookEditor
        {...commonProps}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-doc-a',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        message: 'Convirtiendo a PDF...',
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('Convirtiendo a PDF...');

    rerender(
      <NotebookEditor
        {...commonProps}
        initialNotebook={buildNotebook([buildCodeCell('cell-b', 'print("b")')])}
        initialNotebookToken={1}
        filePath={SECOND_FILE_PATH}
      />
    );

    await waitFor(() => expect(screen.queryByTestId('process-rail-document')).toBeNull());
  });

  it('keeps the document success hide timer across parent callback rerenders', async () => {
    jest.useFakeTimers();
    const actionsRef = { current: null };
    const baseProps = {
      connectionStatus: 'connected',
      sendMessage: jest.fn(),
      lastMessage: null,
      initialNotebook: buildNotebook([buildCodeCell('cell-a', 'print("a")')]),
      filePath: FILE_PATH,
      actionsRef,
      onVisualizationData: jest.fn(),
      onStatusMessage: jest.fn(),
    };

    const { rerender } = render(
      <NotebookEditor
        {...baseProps}
        onPendingExecutionRequestChange={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-doc-success',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        message: 'Convirtiendo a PDF...',
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('Convirtiendo a PDF...');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_pdf_ready',
        kernel_id: 'kernel-1',
        execution_id: 'exec-doc-success',
        pdf_ref: '/api/pdf/download?token=pdf-success',
        pdf_file_b64: null,
        pdf_conversion_error: null,
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('PDF listo en Documento.');

    rerender(
      <NotebookEditor
        {...baseProps}
        onPendingExecutionRequestChange={jest.fn()}
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(screen.queryByTestId('process-rail-document')).toBeNull();
  });

  it('hides the document rail after a terminal document progress update', async () => {
    jest.useFakeTimers();
    const actionsRef = { current: null };

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-doc-terminal',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        message: 'Convirtiendo a PDF...',
      });
    });

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-doc-terminal',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'completed',
        progress_percent: 100,
        message: 'PDF listo en Documento.',
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('PDF listo en Documento.');

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(screen.queryByTestId('process-rail-document')).toBeNull();
  });

  it('shows explicit shared PDF converter copy from structured document progress metadata', async () => {
    const actionsRef = { current: null };

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([buildCodeCell('cell-a', 'print("a")')])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-shared-pdf',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        shared_resource: {
          kind: 'pdf_converter',
          scope: 'global',
          status: 'waiting',
        },
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('Esperando convertidor PDF compartido');

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_progress_update',
        kernel_id: 'kernel-1',
        execution_id: 'exec-shared-pdf',
        progress_scope: 'document',
        progress_stage: 'pdf_convert',
        progress_status: 'running',
        progress_percent: 80,
        shared_resource: {
          kind: 'pdf_converter',
          scope: 'global',
          status: 'running',
        },
      });
    });

    expect(screen.getByTestId('process-rail-document').textContent).toContain('Usando convertidor PDF compartido');
  });

  it('falls back to a hard notebook reload when kernel reset fails with a thread restart error', async () => {
    const actionsRef = { current: null };
    const sendMessage = jest.fn();
    const onStatusMessage = jest.fn();
    const notebook = buildNotebook([
      buildExecutedCodeCell('cell-a', 'print("a")'),
      buildCodeCell('cell-b', 'print("b")'),
    ]);

    render(
      <NotebookEditor
        connectionStatus="connected"
        sendMessage={sendMessage}
        lastMessage={null}
        initialNotebook={notebook}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
        onClearRuntimeData={jest.fn()}
      />
    );

    await waitFor(() => expect(actionsRef.current?.consumeRemoteNotebookMessage).toBeInstanceOf(Function));

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_loaded',
        kernel_id: 'kernel-1',
        notebook,
      });
    });

    sendMessage.mockClear();
    onStatusMessage.mockClear();

    act(() => {
      actionsRef.current.consumeRemoteNotebookMessage({
        type: 'notebook_error',
        error_code: 'notebook_reset_kernel_failed',
        error: 'threads can only be started once',
      });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notebook_load',
      path: FILE_PATH,
      previous_kernel_id: 'kernel-1',
    })));

    const loadMessage = sendMessage.mock.calls[0][0];
    const reloadedNotebook = JSON.parse(loadMessage.content);

    expect(reloadedNotebook.cells[0].outputs).toEqual([]);
    expect(reloadedNotebook.cells[0].execution_count).toBeNull();
    expect(onStatusMessage).toHaveBeenCalledWith(
      'Recreando kernel del notebook...',
      'warning',
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'file',
          path: FILE_PATH,
        }),
      }),
    );
  });

  it('clearOutputs removes notebook results and runtime metadata', async () => {
    const actionsRef = { current: null };
    const onStatusMessage = jest.fn();
    const onNotebookChange = jest.fn();
    const onClearRuntimeData = jest.fn();

    render(
      <NotebookEditor
        connectionStatus="disconnected"
        sendMessage={jest.fn()}
        lastMessage={null}
        initialNotebook={buildNotebook([
          buildExecutedCodeCell('cell-a', 'print("a")'),
          buildCodeCell('cell-b', 'print("b")'),
        ])}
        filePath={FILE_PATH}
        actionsRef={actionsRef}
        onVisualizationData={jest.fn()}
        onStatusMessage={onStatusMessage}
        onNotebookChange={onNotebookChange}
        onClearRuntimeData={onClearRuntimeData}
      />
    );

    await waitFor(() => expect(actionsRef.current?.clearOutputs).toBeInstanceOf(Function));
    expect(screen.getByTestId('cell-outputs-cell-a').textContent).toBe('1');

    act(() => {
      actionsRef.current.clearOutputs();
    });

    await waitFor(() => expect(screen.getByTestId('cell-outputs-cell-a').textContent).toBe('0'));
    await waitFor(() => expect(onNotebookChange).toHaveBeenCalled());

    const currentNotebook = actionsRef.current.getNotebook();
    const persistableNotebook = actionsRef.current.getPersistableNotebook();
    const lastNotebookChange = onNotebookChange.mock.calls[onNotebookChange.mock.calls.length - 1];

    expect(currentNotebook.cells[0].execution_count).toBeNull();
    expect(currentNotebook.cells[0].metadata.execution_duration).toBeUndefined();
    expect(persistableNotebook.cells[0].outputs).toEqual([]);
    expect(persistableNotebook.cells[0].execution_count).toBeNull();
    expect(persistableNotebook.cells[0].metadata.execution_duration).toBeUndefined();
    expect(lastNotebookChange[0].cells[0].outputs).toEqual([]);
    expect(lastNotebookChange[0].cells[0].execution_count).toBeNull();
    expect(lastNotebookChange[0].cells[0].metadata.execution_duration).toBeUndefined();
    expect(lastNotebookChange[2]).toEqual({ persistable: true });
    expect(onClearRuntimeData).toHaveBeenCalledTimes(1);
    expect(onStatusMessage).toHaveBeenCalledWith(
      'Resultados eliminados del notebook',
      'success',
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'file',
          path: FILE_PATH,
        }),
      }),
    );
  });
});
