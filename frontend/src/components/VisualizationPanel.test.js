import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VisualizationPanel, { __resetVisualizationPanelViewMemoryForTests } from './VisualizationPanel';

const mockDocxViewer = jest.fn(() => null);

jest.mock('./DocxViewer', () => ({
  __esModule: true,
  default: (props) => mockDocxViewer(props),
}));

jest.mock('./DependencyGraph', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-dependency-graph">dependency-graph</div>,
}));

jest.mock('./notebook/QuantityVariablesPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-variables-panel">variables-panel</div>,
}));

describe('VisualizationPanel', () => {
  beforeEach(() => {
    __resetVisualizationPanelViewMemoryForTests();
    mockDocxViewer.mockClear();
  });

  it('passes a stable visibility signal to DocxViewer across view changes and collapse', () => {
    const onDocumentVisibilityChange = jest.fn();
    const onToggleCollapse = jest.fn();

    const { rerender } = render(
      <VisualizationPanel
        documentState={{ docxBase64: 'docx-inline', sourcePath: 'C:\\workspace\\demo.ipynb', sourceKind: 'notebook', docxHistory: [] }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() }}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
        onDocumentVisibilityChange={onDocumentVisibilityChange}
      />,
    );

    expect(mockDocxViewer).toHaveBeenCalled();
    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(true);
    expect(onDocumentVisibilityChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByTestId('visualization-view-dependencies'));

    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(false);
    expect(onDocumentVisibilityChange).toHaveBeenLastCalledWith(false);

    rerender(
      <VisualizationPanel
        documentState={{ docxBase64: 'docx-inline', sourcePath: 'C:\\workspace\\demo.ipynb', sourceKind: 'notebook', docxHistory: [] }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() }}
        isCollapsed
        onToggleCollapse={onToggleCollapse}
        onDocumentVisibilityChange={onDocumentVisibilityChange}
      />,
    );

    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(false);
    expect(onDocumentVisibilityChange).toHaveBeenLastCalledWith(false);
  });

  it('starts directly in dependencies when a dependency target already exists', () => {
    render(
      <VisualizationPanel
        documentState={{ docxBase64: 'docx-inline', sourcePath: 'C:\\workspace\\demo.ipynb', sourceKind: 'notebook', docxHistory: [] }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() }}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
        dependencyProps={{
          dependencyTarget: {
            symbol: 'beam_capacity',
            sourceCode: 'beam_capacity = 42',
          },
        }}
      />,
    );

    expect(screen.getByTestId('mock-dependency-graph')).toBeTruthy();
    expect(mockDocxViewer.mock.calls.map(([props]) => props.isVisible)).not.toContain(true);
  });

  it('offers manual symbol analysis from the empty dependency state', () => {
    const onRequestDependencyAnalysis = jest.fn();

    render(
      <VisualizationPanel
        documentState={{ docxBase64: null, sourcePath: 'C:\\workspace\\demo.ipynb', sourceKind: 'notebook', docxHistory: [] }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() }}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
        onRequestDependencyAnalysis={onRequestDependencyAnalysis}
      />,
    );

    fireEvent.click(screen.getByTestId('visualization-view-dependencies'));

    expect(screen.getByText(/Sin grafo activo/)).toBeTruthy();
    expect(screen.getByTitle(/Ctrl\+Shift\+D/)).toBeTruthy();
    expect(onRequestDependencyAnalysis).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Analizar simbolo'), {
      target: { value: 'BeamModel.capacity_ratio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dependencias' }));
    expect(onRequestDependencyAnalysis).toHaveBeenLastCalledWith({
      symbol: 'BeamModel.capacity_ratio',
      mode: 'dependencies',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Impacto' }));
    expect(onRequestDependencyAnalysis).toHaveBeenLastCalledWith({
      symbol: 'BeamModel.capacity_ratio',
      mode: 'impact',
    });
  });

  it('reopens dependencies for the same symbol when the dependency target identity changes', async () => {
    const onToggleCollapse = jest.fn();
    const baseProps = {
      documentState: { docxBase64: 'docx-inline', sourcePath: 'C:\\workspace\\repeat.ipynb', sourceKind: 'notebook', docxHistory: [] },
      documentActions: { onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() },
      isCollapsed: false,
      onToggleCollapse,
    };

    const { rerender } = render(<VisualizationPanel {...baseProps} />);
    fireEvent.click(screen.getByTestId('visualization-view-variables'));
    expect(screen.getByTestId('mock-variables-panel')).toBeTruthy();

    rerender(
      <VisualizationPanel
        {...baseProps}
        dependencyProps={{
          filePath: 'C:\\workspace\\repeat.ipynb',
          dependencyTarget: {
            requestToken: 'target-1',
            symbol: 'M_max',
            sourceCode: 'M_max = w * L**2 / 8',
          },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('mock-dependency-graph')).toBeTruthy());

    fireEvent.click(screen.getByTestId('visualization-view-variables'));
    expect(screen.getByTestId('mock-variables-panel')).toBeTruthy();

    rerender(
      <VisualizationPanel
        {...baseProps}
        dependencyProps={{
          filePath: 'C:\\workspace\\repeat.ipynb',
          dependencyTarget: {
            requestToken: 'target-2',
            symbol: 'M_max',
            sourceCode: 'M_max = w * L**2 / 8',
          },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('mock-dependency-graph')).toBeTruthy());
  });

  it('reads DOCX props only from documentState and ignores legacy flattened fields', () => {
    const onToggleCollapse = jest.fn();
    const onStatusMessage = jest.fn();
    const { rerender } = render(
      <VisualizationPanel
        documentState={{ docxBase64: 'canonical-docx', sourcePath: 'C:\\workspace\\demo.ipynb', sourceKind: 'notebook', docxHistory: [] }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage }}
        docxBase64="legacy-docx"
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    expect(mockDocxViewer.mock.lastCall[0].docxBase64).toBe('canonical-docx');
    expect(mockDocxViewer.mock.lastCall[0].onStatusMessage).toBe(onStatusMessage);

    rerender(
      <VisualizationPanel
        docxBase64="legacy-docx"
        onStatusMessage={jest.fn()}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    expect(mockDocxViewer.mock.lastCall[0].docxBase64).toBeNull();
    expect(mockDocxViewer.mock.lastCall[0].onStatusMessage).toBeNull();
  });

  it('passes DOCX quality metadata and quality focus requests to DocxViewer', () => {
    render(
      <VisualizationPanel
        documentState={{
          docxBase64: 'canonical-docx',
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          docxHistory: [],
          docxQualityStatus: 'warning',
          docxQualityScore: 82,
          docxQualityCounts: { warning: 2, error: 0, info: 1 },
        }}
        documentActions={{ onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() }}
        requestedView={{ view: 'docx', focus: 'quality', token: 7 }}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />,
    );

    expect(mockDocxViewer.mock.lastCall[0].docxQualityStatus).toBe('warning');
    expect(mockDocxViewer.mock.lastCall[0].docxQualityScore).toBe(82);
    expect(mockDocxViewer.mock.lastCall[0].docxQualityCounts).toEqual({ warning: 2, error: 0, info: 1 });
    expect(mockDocxViewer.mock.lastCall[0].qualityOpenRequest).toEqual({ view: 'docx', focus: 'quality', token: 7 });
  });

  it('remembers the last non-document tab for the same notebook source across remounts', () => {
    const sourcePath = 'C:\\workspace\\remember-view.ipynb';
    const initialProps = {
      documentState: { docxBase64: 'docx-inline', sourcePath, sourceKind: 'notebook', docxHistory: [] },
      documentActions: { onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() },
      isCollapsed: false,
      onToggleCollapse: jest.fn(),
    };

    const firstRender = render(<VisualizationPanel {...initialProps} />);

    fireEvent.click(screen.getByTestId('visualization-view-variables'));
    expect(screen.getByTestId('mock-variables-panel')).toBeTruthy();
    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(false);

    firstRender.unmount();

    render(<VisualizationPanel {...initialProps} />);

    expect(screen.getByTestId('mock-variables-panel')).toBeTruthy();
    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(false);
  });

  it('lets an explicit document request override the remembered tab for the same notebook source', () => {
    const sourcePath = 'C:\\workspace\\requested-document.ipynb';
    const initialProps = {
      documentState: { docxBase64: 'docx-inline', sourcePath, sourceKind: 'notebook', docxHistory: [] },
      documentActions: { onClearDocx: jest.fn(), onRetryPdf: jest.fn(), onStatusMessage: jest.fn() },
      isCollapsed: false,
      onToggleCollapse: jest.fn(),
    };

    const firstRender = render(<VisualizationPanel {...initialProps} />);
    fireEvent.click(screen.getByTestId('visualization-view-variables'));
    firstRender.unmount();

    render(
      <VisualizationPanel
        {...initialProps}
        requestedView={{ view: 'docx', token: 1 }}
      />,
    );

    expect(screen.queryByTestId('mock-variables-panel')).toBeNull();
    expect(mockDocxViewer.mock.lastCall[0].isVisible).toBe(true);
  });
});
