import { buildLargeGraphOverview } from './dependencyGraphOverview';

describe('buildLargeGraphOverview', () => {
  it('agrupa grafos grandes por target, scope y archivo preservando aristas agregadas', () => {
    const graph = {
      root_id: 'root',
      nodes: [
        {
          id: 'root',
          name: 'capacity_ratio',
          node_type: 'function',
          scope_path: 'BeamModel.capacity_ratio',
          parent_id: 'beam',
          location: { file: 'C:/demo/model.py', line: 50 },
        },
        {
          id: 'moment_ratio',
          name: 'moment_ratio',
          node_type: 'variable',
          scope_path: 'BeamModel.capacity_ratio.moment_ratio',
          parent_id: 'root',
          location: { file: 'C:/demo/model.py', line: 52 },
        },
        {
          id: 'demand_state',
          name: 'demand_state',
          node_type: 'function',
          scope_path: 'BeamModel.demand_state',
          parent_id: 'beam',
          location: { file: 'C:/demo/model.py', line: 35 },
        },
        {
          id: 'beam',
          name: 'BeamModel',
          node_type: 'class',
          scope_path: 'BeamModel',
          location: { file: 'C:/demo/model.py', line: 24 },
        },
        {
          id: 'stage45',
          name: 'stage_45',
          node_type: 'function',
          scope_path: 'demo_dependency_extreme.chain.stage_45',
          location: { file: 'C:/demo/chain.py', line: 140 },
        },
        {
          id: 'steel',
          name: 'steel_fy',
          node_type: 'variable',
          scope_path: 'demo_dependency_extreme.materials.steel_fy',
          location: { file: 'C:/demo/materials.py', line: 5 },
        },
      ],
      edges: [
        { source: 'stage45', target: 'demand_state', relation: 'calls' },
        { source: 'steel', target: 'demand_state', relation: 'uses' },
        { source: 'demand_state', target: 'moment_ratio', relation: 'calls' },
        { source: 'moment_ratio', target: 'root', relation: 'assigns' },
      ],
      meta: {},
    };

    const { graph: overview, nodeIdMap } = buildLargeGraphOverview(graph);

    expect(overview.meta.overview_mode).toBe(true);
    expect(overview.meta.overview_original_nodes).toBe(6);
    expect(overview.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['capacity_ratio', 'BeamModel', 'chain.py', 'materials.py'])
    );
    expect(nodeIdMap.root).toBe(overview.root_id);
    expect(nodeIdMap.moment_ratio).toBe(overview.root_id);
    expect(overview.nodes.length).toBeLessThan(graph.nodes.length);
    expect(overview.edges.some((edge) => edge.source.includes('chain.py') && edge.aggregated_count === 1)).toBe(true);
    expect(overview.nodes.find((node) => node.name === 'materials.py')).toEqual(expect.objectContaining({
      description: expect.stringContaining('Incluye:'),
      overview_member_preview: expect.stringContaining('steel_fy'),
    }));
  });

  it('acumula multiples enlaces entre los mismos grupos', () => {
    const graph = {
      root_id: 'root',
      nodes: [
        { id: 'root', name: 'result', node_type: 'variable', location: { file: 'model.py' } },
        { id: 'a', name: 'a', node_type: 'variable', location: { file: 'loads.py' } },
        { id: 'b', name: 'b', node_type: 'variable', location: { file: 'loads.py' } },
      ],
      edges: [
        { source: 'a', target: 'root', relation: 'uses' },
        { source: 'b', target: 'root', relation: 'assigns' },
      ],
    };

    const { graph: overview } = buildLargeGraphOverview(graph);
    const aggregated = overview.edges.find((edge) => edge.source === 'overview::file::loads.py');

    expect(aggregated).toEqual(expect.objectContaining({
      target: overview.root_id,
      relation: 'mixed',
      aggregated_count: 2,
    }));
  });
});
