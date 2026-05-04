import {
    computeHierarchicalLayout,
    getAdaptiveLayoutOptions,
    LAYOUT_CONFIG,
} from './d3Layout';

function createSmallGraph() {
    return {
        root_id: 'mmax',
        analysis_mode: 'dependencies',
        nodes: [
            { id: 'load', name: 'w', node_type: 'variable' },
            { id: 'length', name: 'L', node_type: 'variable' },
            { id: 'mmax', name: 'M_max', node_type: 'variable' },
        ],
        edges: [
            { source: 'load', target: 'mmax', relation: 'uses' },
            { source: 'length', target: 'mmax', relation: 'uses' },
        ],
    };
}

function createLinearGraph() {
    return {
        root_id: 'd',
        analysis_mode: 'dependencies',
        nodes: [
            { id: 'a', name: 'a', node_type: 'variable' },
            { id: 'b', name: 'b', node_type: 'variable' },
            { id: 'c', name: 'c', node_type: 'variable' },
            { id: 'd', name: 'd', node_type: 'variable' },
        ],
        edges: [
            { source: 'a', target: 'b', relation: 'uses' },
            { source: 'b', target: 'c', relation: 'uses' },
            { source: 'c', target: 'd', relation: 'uses' },
        ],
    };
}

function createSparseThreeLayerGraph() {
    return {
        root_id: 'r0',
        analysis_mode: 'dependencies',
        nodes: [
            { id: 'a1', name: 'a1', node_type: 'variable' },
            { id: 'a2', name: 'a2', node_type: 'variable' },
            { id: 'b1', name: 'b1', node_type: 'variable' },
            { id: 'b2', name: 'b2', node_type: 'variable' },
            { id: 'r0', name: 'r0', node_type: 'variable' },
        ],
        edges: [
            { source: 'a1', target: 'b1', relation: 'uses' },
            { source: 'a2', target: 'b2', relation: 'uses' },
            { source: 'b1', target: 'r0', relation: 'uses' },
        ],
    };
}

function createDenseThreeLayerGraph() {
    return {
        root_id: 'r0',
        analysis_mode: 'dependencies',
        nodes: [
            { id: 'a1', name: 'a1', node_type: 'variable' },
            { id: 'a2', name: 'a2', node_type: 'variable' },
            { id: 'a3', name: 'a3', node_type: 'variable' },
            { id: 'b1', name: 'b1', node_type: 'variable' },
            { id: 'b2', name: 'b2', node_type: 'variable' },
            { id: 'b3', name: 'b3', node_type: 'variable' },
            { id: 'r0', name: 'r0', node_type: 'variable' },
        ],
        edges: [
            { source: 'a1', target: 'b1', relation: 'uses' },
            { source: 'a1', target: 'b2', relation: 'uses' },
            { source: 'a1', target: 'b3', relation: 'uses' },
            { source: 'a2', target: 'b1', relation: 'uses' },
            { source: 'a2', target: 'b2', relation: 'uses' },
            { source: 'a2', target: 'b3', relation: 'uses' },
            { source: 'a3', target: 'b1', relation: 'uses' },
            { source: 'a3', target: 'b2', relation: 'uses' },
            { source: 'a3', target: 'b3', relation: 'uses' },
            { source: 'b1', target: 'r0', relation: 'uses' },
            { source: 'b2', target: 'r0', relation: 'uses' },
            { source: 'b3', target: 'r0', relation: 'uses' },
        ],
    };
}

function createCapacityRatioLikeGraph() {
    const nodes = Array.from({ length: 49 }, (_, index) => ({
        id: `n${index}`,
        name: `n${index}`,
        node_type: index % 7 === 0 ? 'function' : 'variable',
    }));
    const edges = [];

    for (let index = 0; index < nodes.length - 1; index += 1) {
        edges.push({ source: `n${index}`, target: `n${index + 1}`, relation: 'uses' });
    }
    for (let index = 0; index < 6; index += 1) {
        edges.push({ source: `n${index * 5}`, target: `n${Math.min(nodes.length - 1, index * 5 + 12)}`, relation: 'calls' });
    }

    return {
        root_id: 'n48',
        analysis_mode: 'dependencies',
        nodes,
        edges,
    };
}

describe('d3Layout adaptive spacing', () => {
    it('compacta gaps para grafos de baja densidad', () => {
        const adaptive = getAdaptiveLayoutOptions(createSmallGraph());

        expect(adaptive.NODE_MARGIN_X).toBeLessThan(LAYOUT_CONFIG.NODE_MARGIN_X);
        expect(adaptive.NODE_MARGIN_Y).toBeLessThan(LAYOUT_CONFIG.NODE_MARGIN_Y);
        expect(adaptive.FLOW_LAYER_GAP).toBeLessThan(LAYOUT_CONFIG.FLOW_LAYER_GAP);
    });

    it('reduce bounds verticales frente al spacing base en grafos chicos', () => {
        const graph = createSmallGraph();
        const adaptiveLayout = computeHierarchicalLayout(graph);
        const baseLayout = computeHierarchicalLayout(graph, { disableAdaptiveSpacing: true });

        expect(adaptiveLayout.bounds.height).toBeLessThan(baseLayout.bounds.height);
    });

    it('ubica los ranks sobre el eje X y deja el crecimiento hacia la derecha', () => {
        const layout = computeHierarchicalLayout(createLinearGraph(), { disableAdaptiveSpacing: true });
        const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));

        expect(nodeMap.get('a').x).toBeLessThan(nodeMap.get('b').x);
        expect(nodeMap.get('b').x).toBeLessThan(nodeMap.get('c').x);
        expect(nodeMap.get('c').x).toBeLessThan(nodeMap.get('d').x);
    });

    it('alinea verticalmente nodos del mismo nivel sin wrap por ancho', () => {
        const layout = computeHierarchicalLayout(createSmallGraph(), { disableAdaptiveSpacing: true });
        const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));

        expect(Math.abs(nodeMap.get('load').x - nodeMap.get('length').x)).toBeLessThanOrEqual(1);
        expect(nodeMap.get('mmax').x).toBeGreaterThan(nodeMap.get('load').x);
        expect(layout.bounds.width).toBeGreaterThan(layout.bounds.height);
    });

    it('mantiene endpoints de aristas pegados al borde real del nodo en flujo LR', () => {
        const layout = computeHierarchicalLayout(createSmallGraph(), { disableAdaptiveSpacing: true });
        const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));

        layout.edges.forEach((edge) => {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);

            expect(sourceNode).toBeTruthy();
            expect(targetNode).toBeTruthy();
            expect(Math.abs(edge.sourcePort.x - (sourceNode.x + sourceNode.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(edge.targetPort.x - targetNode.x)).toBeLessThanOrEqual(1);
        });
    });

    it('genera paths rectilineos y mantiene routing local en fan-in simple', () => {
        const layout = computeHierarchicalLayout(createSmallGraph(), { disableAdaptiveSpacing: true });

        expect(layout.edges.every((edge) => !/[CQSA]/.test(edge.path))).toBe(true);
        expect(layout.edges.every((edge) => edge.routing_scope === 'local')).toBe(true);
        expect(layout.edges.every((edge) => edge.route_type === 'orthogonal-bus')).toBe(true);
    });

    it('abre mas espacio horizontal cuando aumenta la demanda de carriles entre capas', () => {
        const sparseLayout = computeHierarchicalLayout(createSparseThreeLayerGraph(), { disableAdaptiveSpacing: true });
        const denseLayout = computeHierarchicalLayout(createDenseThreeLayerGraph(), { disableAdaptiveSpacing: true });

        const sparseNodeMap = new Map(sparseLayout.nodes.map((node) => [node.id, node]));
        const denseNodeMap = new Map(denseLayout.nodes.map((node) => [node.id, node]));

        const sparseGap = sparseNodeMap.get('b1').x - sparseNodeMap.get('a1').x;
        const denseGap = denseNodeMap.get('b1').x - denseNodeMap.get('a1').x;

        expect(denseGap).toBeGreaterThan(sparseGap);
        expect(denseLayout.bounds.width).toBeGreaterThan(sparseLayout.bounds.width);
    });

    it('expande spacing para grafos densos de dependencias complejas', () => {
        const adaptive = getAdaptiveLayoutOptions(createCapacityRatioLikeGraph());

        expect(adaptive.NODE_MARGIN_X).toBeGreaterThan(LAYOUT_CONFIG.NODE_MARGIN_X);
        expect(adaptive.NODE_MARGIN_Y).toBeGreaterThan(LAYOUT_CONFIG.NODE_MARGIN_Y);
        expect(adaptive.FLOW_LAYER_GAP).toBeGreaterThan(LAYOUT_CONFIG.FLOW_LAYER_GAP);
        expect(adaptive.FLOW_MIN_GAP).toBeGreaterThan(LAYOUT_CONFIG.FLOW_MIN_GAP);
    });
});
