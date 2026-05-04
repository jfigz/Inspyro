import { buildCollapsedGraphView } from './collapsedGraph';

describe('buildCollapsedGraphView', () => {
    it('colapsa subarbol y agrega aristas preservando metadata', () => {
        const graphData = {
            root_id: 'leaf-a',
            nodes: [
                {
                    id: 'container-a',
                    name: 'A',
                    is_container: true,
                    children_ids: ['leaf-a', 'leaf-b'],
                },
                {
                    id: 'leaf-a',
                    name: 'a',
                    parent_id: 'container-a',
                },
                {
                    id: 'leaf-b',
                    name: 'b',
                    parent_id: 'container-a',
                },
                {
                    id: 'target',
                    name: 'target',
                },
            ],
            edges: [
                { source: 'leaf-a', target: 'target', relation: 'assigns' },
                { source: 'leaf-b', target: 'target', relation: 'calls' },
            ],
            input_node_ids: ['leaf-a', 'leaf-b'],
            output_node_ids: ['target'],
            check_node_ids: [],
            meta: {},
        };

        const { graph, nodeIdMap } = buildCollapsedGraphView(graphData, new Set(['container-a']));

        expect(new Set(graph.nodes.map((node) => node.id))).toEqual(new Set(['container-a', 'target']));
        const collapsedContainer = graph.nodes.find((node) => node.id === 'container-a');
        expect(collapsedContainer.ui_is_collapsed).toBe(true);
        expect(graph.root_id).toBe('container-a');
        expect(graph.input_node_ids).toEqual(['container-a']);

        expect(graph.edges).toHaveLength(1);
        const aggregatedEdge = graph.edges[0];
        expect(aggregatedEdge.source).toBe('container-a');
        expect(aggregatedEdge.target).toBe('target');
        expect(aggregatedEdge.aggregated_count).toBe(2);
        expect(aggregatedEdge.relation).toBe('mixed');
        expect(new Set(aggregatedEdge.relations)).toEqual(new Set(['assigns', 'calls']));

        expect(nodeIdMap['leaf-a']).toBe('container-a');
        expect(nodeIdMap['leaf-b']).toBe('container-a');
        expect(nodeIdMap.target).toBe('target');
    });

    it('retorna grafo original cuando no hay colapsado activo', () => {
        const graphData = {
            root_id: 'n1',
            nodes: [{ id: 'n1' }, { id: 'n2' }],
            edges: [{ source: 'n1', target: 'n2', relation: 'uses' }],
        };

        const { graph, nodeIdMap } = buildCollapsedGraphView(graphData, new Set());

        expect(graph).toBe(graphData);
        expect(nodeIdMap).toEqual({ n1: 'n1', n2: 'n2' });
    });
});
