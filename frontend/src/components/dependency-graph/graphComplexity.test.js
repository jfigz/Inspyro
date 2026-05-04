import {
    getGraphComplexity,
    shouldUseLargeGraphMode,
} from './graphComplexity';

function createGraph(nodeCount, edgeCount) {
    return {
        nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}` })),
        edges: Array.from({ length: edgeCount }, (_, index) => ({
            source: `n${index % Math.max(1, nodeCount)}`,
            target: `n${(index + 1) % Math.max(1, nodeCount)}`,
        })),
    };
}

describe('graph complexity thresholds', () => {
    it('activa modo denso para grafos tipo capacity_ratio', () => {
        const graph = createGraph(49, 54);

        expect(shouldUseLargeGraphMode(graph)).toBe(true);
        expect(getGraphComplexity(graph)).toEqual(expect.objectContaining({
            nodeCount: 49,
            edgeCount: 54,
            large: true,
        }));
    });

    it('mantiene grafos medianos y poco conectados fuera del modo denso', () => {
        expect(shouldUseLargeGraphMode(createGraph(30, 20))).toBe(false);
    });

    it('detecta densidad aunque el conteo de nodos sea menor al umbral absoluto', () => {
        const complexity = getGraphComplexity(createGraph(34, 50));

        expect(complexity.dense).toBe(true);
        expect(complexity.large).toBe(true);
    });
});
