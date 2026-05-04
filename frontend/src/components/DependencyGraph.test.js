import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DependencyGraph from './DependencyGraph';

let latestD3Props = null;

jest.mock('./dependency-graph', () => ({
  formatRuntimeValue: jest.fn(() => ''),
  computeHierarchicalLayout: jest.fn(() => ({
    nodes: [],
    edges: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  })),
  Legend: () => null,
  InfoPanel: ({ node }) => (
    <div data-testid="mock-info-panel">
      <span>{node?.data?.name || node?.id}</span>
      {node?.data?.is_overview_node && <span>overview</span>}
      {Number.isFinite(Number(node?.data?.overview_member_count)) && (
        <span>{node.data.overview_member_count}</span>
      )}
    </div>
  ),
  TraceTable: () => null,
  SensitivityPanel: () => null,
  OptimizationPanel: () => null,
  D3DependencyGraph: (props) => {
    latestD3Props = props;
    if (!props.graphData?.nodes?.length) {
      return null;
    }
    return (
      <>
        <button
          type="button"
          data-testid="dependency-graph-node-click"
          onClick={() => props.onNodeClick({ data: props.graphData.nodes[0] })}
        >
          select
        </button>
        <button
          type="button"
          data-testid="dependency-graph-double-click"
          onClick={() => props.onNodeDoubleClick({ data: props.graphData.nodes[0] })}
        >
          navigate
        </button>
      </>
    );
  },
}));

describe('DependencyGraph request payloads', () => {
  beforeEach(() => {
    latestD3Props = null;
  });

  it('preserva line y column cuando vienen como ubicacion valida', async () => {
    const sendMessage = jest.fn();

    render(
      <DependencyGraph
        symbol="sigma"
        sourceCode="sigma = a + b"
        line={7}
        column={11}
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    const request = sendMessage.mock.calls[0][0];
    expect(request).toEqual(expect.objectContaining({
      type: 'analyze_dependencies',
      symbol: 'sigma',
      source_code: 'sigma = a + b',
      line: 7,
      column: 11,
      request_id: expect.any(String),
    }));
  });

  it('omite line y column cuando no existe ubicacion real', async () => {
    const sendMessage = jest.fn();

    render(
      <DependencyGraph
        symbol="sigma"
        sourceCode="sigma = 120"
        mode="impact"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    const request = sendMessage.mock.calls[0][0];
    expect(request).toEqual(expect.objectContaining({
      type: 'analyze_impact',
      symbol: 'sigma',
      source_code: 'sigma = 120',
      max_depth: 10,
      request_id: expect.any(String),
    }));
    expect(request).not.toHaveProperty('line');
    expect(request).not.toHaveProperty('column');
  });

  it('propaga filePath al callback de navegación cuando el nodo viene de otro archivo', async () => {
    const sendMessage = jest.fn();
    const onNavigateToCode = jest.fn();

    const { rerender } = render(
      <DependencyGraph
        symbol="sigma"
        sourceCode="sigma = helper.B"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        onNavigateToCode={onNavigateToCode}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="sigma"
        sourceCode="sigma = helper.B"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'node-1',
            nodes: [
              {
                id: 'node-1',
                name: 'B',
                node_type: 'variable',
                scope_path: 'helpers.B',
                location: {
                  file: 'C:\\workspace\\helpers.py',
                  line: 7,
                  column: 2,
                  end_line: 7,
                  end_column: 3,
                },
              },
            ],
            edges: [],
            warnings: [],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: true,
            meta: {},
          },
        }}
        onNavigateToCode={onNavigateToCode}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('dependency-graph-double-click')).toBeTruthy());
    expect(latestD3Props?.graphData?.nodes?.[0]?.location?.file).toBe('C:\\workspace\\helpers.py');

    act(() => {
      screen.getByTestId('dependency-graph-double-click').click();
    });

    expect(onNavigateToCode).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\workspace\\helpers.py',
      line: 7,
      column: 2,
      symbol: 'B',
    }));
  });

  it('activa largeGraphMode automaticamente en grafos complejos por densidad', async () => {
    const sendMessage = jest.fn();
    const nodes = Array.from({ length: 49 }, (_, index) => ({
      id: `node-${index}`,
      name: `node_${index}`,
      node_type: 'variable',
    }));
    const edges = Array.from({ length: 54 }, (_, index) => ({
      source: `node-${index % 48}`,
      target: `node-${(index % 48) + 1}`,
      relation: 'uses',
    }));

    const { rerender } = render(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'node-48',
            nodes,
            edges,
            warnings: [],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: true,
            meta: {},
          },
        }}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(latestD3Props?.selectedNodeId).toBe('overview::target::node-48'));
    expect(screen.getByText('Large graph ON')).toBeTruthy();
    expect(screen.getByTestId('dependency-focus-strip')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resumen' }).className).toContain('primary'));
    expect(latestD3Props?.graphData?.meta?.overview_mode).toBe(true);
    await waitFor(() => expect(latestD3Props?.graphData?.nodes?.length).toBeLessThan(nodes.length));

    act(() => {
      screen.getByRole('button', { name: 'Todo' }).click();
    });

    await waitFor(() => expect(latestD3Props?.largeGraphMode).toBe(true));
    await waitFor(() => expect(latestD3Props?.graphData?.nodes?.length).toBe(nodes.length));
    expect(latestD3Props?.selectedPathHighlight?.edge_keys).toEqual(['node-47->node-48']);
    expect(screen.getByRole('button', { name: 'Camino' }).disabled).toBe(false);

    act(() => {
      screen.getByRole('button', { name: 'Camino' }).click();
    });

    await waitFor(() => expect(latestD3Props?.graphData?.edges?.length).toBeGreaterThan(0));
  });

  it('reabre el inspector al hacer click en un nodo de resumen ya seleccionado', async () => {
    const sendMessage = jest.fn();
    const nodes = Array.from({ length: 49 }, (_, index) => ({
      id: `node-${index}`,
      name: index === 48 ? 'capacity_ratio' : `stage_${String(index).padStart(2, '0')}`,
      node_type: index === 48 ? 'property' : 'variable',
      scope_path: index < 20 ? `BeamModel.stage_${index}` : `load_cases.stage_${index}`,
      location: {
        file: index < 20 ? 'beam_model.py' : 'loads.py',
        line: index + 1,
      },
    }));
    const edges = Array.from({ length: 54 }, (_, index) => ({
      source: `node-${index % 48}`,
      target: `node-${(index % 48) + 1}`,
      relation: 'uses',
    }));

    const { rerender } = render(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'node-48',
            nodes,
            edges,
            warnings: [],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: true,
            meta: {},
          },
        }}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(latestD3Props?.graphData?.meta?.overview_mode).toBe(true));
    const overviewNode = latestD3Props.graphData.nodes[0];

    fireEvent.click(screen.getByTestId('dependency-graph-node-click'));

    await waitFor(() => expect(screen.getByTestId('mock-info-panel')).toBeTruthy());
    expect(screen.getByTestId('mock-info-panel').textContent).toContain('overview');

    act(() => {
      screen.getByRole('button', { name: 'Colapsar' }).click();
    });

    expect(screen.getByText(/El detalle esta colapsado/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('dependency-graph-node-click'));

    await waitFor(() => expect(screen.getByTestId('mock-info-panel')).toBeTruthy());
    expect(screen.getByTestId('mock-info-panel').textContent).toContain(String(overviewNode.overview_member_count));
  });

  it('usa la busqueda como foco antes de filtrar resultados explicitamente', async () => {
    const sendMessage = jest.fn();
    const nodes = [
      { id: 'root', name: 'capacity_ratio', node_type: 'variable' },
      { id: 'area', name: 'area_gross', node_type: 'variable', scope_path: 'section.area_gross' },
      { id: 'steel', name: 'steel_fy', node_type: 'variable', scope_path: 'materials.steel_fy' },
    ];
    const edges = [
      { source: 'area', target: 'root', relation: 'uses' },
      { source: 'steel', target: 'root', relation: 'uses' },
    ];

    const { rerender } = render(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = area_gross / steel_fy"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = area_gross / steel_fy"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'root',
            nodes,
            edges,
            warnings: [],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: true,
            meta: {},
          },
        }}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(latestD3Props?.graphData?.nodes?.length).toBe(3));

    act(() => {
      screen.getByRole('button', { name: 'Filtros' }).click();
    });

    fireEvent.change(screen.getByLabelText('Buscar nodo'), { target: { value: 'area' } });

    await waitFor(() => expect(latestD3Props?.graphData?.nodes?.length).toBe(3));
    expect(latestD3Props?.selectedNodeId).toBe('area');
    expect(screen.getByText(/Busqueda en modo foco/)).toBeTruthy();

    act(() => {
      screen.getByRole('button', { name: 'Filtrar resultados' }).click();
    });

    await waitFor(() => expect(latestD3Props?.graphData?.nodes?.length).toBeLessThan(3));
    expect(screen.getByText(/Filtro de busqueda activo/)).toBeTruthy();
  });

  it('bloquea el scroll del body durante pantalla completa', async () => {
    const sendMessage = jest.fn();
    const { rerender, unmount } = render(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = a"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = a"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'root',
            nodes: [{ id: 'root', name: 'capacity_ratio', node_type: 'variable' }],
            edges: [],
            warnings: [],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: true,
            meta: {},
          },
        }}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy());

    act(() => {
      screen.getByRole('button', { name: 'Pantalla completa' }).click();
    });

    expect(document.body.classList.contains('dependency-graph-fullscreen-active')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.classList.contains('dependency-graph-fullscreen-active')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('muestra banner de calidad desde analisis parcial y permite aumentar profundidad', async () => {
    const sendMessage = jest.fn();

    const { rerender } = render(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={null}
        layout="embedded"
      />,
    );

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const requestId = sendMessage.mock.calls[0][0].request_id;

    rerender(
      <DependencyGraph
        symbol="capacity_ratio"
        sourceCode="capacity_ratio = model.capacity_ratio()"
        mode="dependencies"
        sendMessage={sendMessage}
        lastMessage={{
          type: 'dependency_analysis_result',
          request_id: requestId,
          graph: {
            root_id: 'node-1',
            nodes: [
              { id: 'node-1', name: 'capacity_ratio', node_type: 'function' },
              { id: 'node-2', name: 'flexural_capacity', node_type: 'method' },
            ],
            edges: [{ source: 'node-1', target: 'node-2', relation: 'uses' }],
            warnings: [
              'max_depth reached at BeamModel.flexural_capacity',
              'Dependencias no resueltas (top): float, int, model.load_case, property, seed',
            ],
            parse_errors: [],
            input_node_ids: [],
            output_node_ids: [],
            check_node_ids: [],
            analysis_complete: false,
            meta: {},
          },
        }}
        layout="embedded"
      />,
    );

    const qualityBanner = await screen.findByTestId('dependency-quality-banner');
    expect(qualityBanner).toBeTruthy();
    expect(within(qualityBanner).getByText('max_depth reached at BeamModel.flexural_capacity')).toBeTruthy();
    expect(within(qualityBanner).getByText('Dependencias no resueltas (top): model.load_case, seed')).toBeTruthy();
    expect(within(qualityBanner).queryByText(/float, int/)).toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'Calidad de analisis' }).click();
    });

    expect(await screen.findByTestId('dependency-graph-diagnostics')).toBeTruthy();
    expect(screen.getAllByText('max_depth reached at BeamModel.flexural_capacity').length).toBeGreaterThanOrEqual(2);

    act(() => {
      within(qualityBanner).getByRole('button', { name: 'Aumentar profundidad' }).click();
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage.mock.calls[1][0]).toEqual(expect.objectContaining({
      type: 'analyze_dependencies',
      symbol: 'capacity_ratio',
      max_depth: 20,
    }));
  });
});
