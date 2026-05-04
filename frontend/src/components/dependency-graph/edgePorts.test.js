import { assignPortsToEdges, PortSide, PORT_CONFIG } from './edgePorts';

function buildNodesMap() {
    const entries = [
        ['source', { id: 'source', x: 0, y: 0, width: 120, height: 80, rank: 0 }],
    ];
    for (let index = 0; index < 8; index += 1) {
        entries.push([
            `target-${index}`,
            {
                id: `target-${index}`,
                x: 260,
                y: 10 + index * 24,
                width: 120,
                height: 80,
                rank: 1,
            },
        ]);
    }
    return new Map(entries);
}

describe('assignPortsToEdges', () => {
    it('distribuye por round-robin estable cuando edgeCount supera portCount', () => {
        const nodesMap = buildNodesMap();
        const edges = Array.from({ length: 8 }).map((_, index) => ({
            source: 'source',
            target: `target-${index}`,
        }));

        const assigned = assignPortsToEdges(edges, nodesMap);
        expect(assigned).toHaveLength(edges.length);
        expect(assigned.every((edge) => edge.sourceSide === PortSide.RIGHT)).toBe(true);
        expect(assigned.every((edge) => edge.targetSide === PortSide.LEFT)).toBe(true);

        const perPortCount = new Map();
        assigned.forEach((edge) => {
            const index = edge.sourcePort?.index;
            perPortCount.set(index, (perPortCount.get(index) || 0) + 1);
        });

        expect(perPortCount.size).toBe(PORT_CONFIG.RIGHT_PORTS);
        const counts = Array.from(perPortCount.values());
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);
        expect(maxCount - minCount).toBeLessThanOrEqual(1);

        const uniqueY = new Set(assigned.map((edge) => edge.sourcePort?.y));
        expect(uniqueY.size).toBeGreaterThan(PORT_CONFIG.RIGHT_PORTS);
    });

    it('mantiene endpoints pegados al borde real del nodo', () => {
        const nodesMap = buildNodesMap();
        const [assigned] = assignPortsToEdges([{ source: 'source', target: 'target-0' }], nodesMap);
        const sourceNode = nodesMap.get('source');
        const targetNode = nodesMap.get('target-0');

        expect(Math.abs(assigned.sourcePort.x - (sourceNode.x + sourceNode.width))).toBeLessThanOrEqual(1);
        expect(Math.abs(assigned.targetPort.x - targetNode.x)).toBeLessThanOrEqual(1);
    });

    it('ordena los puertos laterales segun la posicion vertical del nodo opuesto en LR', () => {
        const nodesMap = new Map([
            ['source', { id: 'source', x: 0, y: 0, width: 120, height: 100, rank: 0 }],
            ['upper', { id: 'upper', x: 260, y: 0, width: 120, height: 80, rank: 1 }],
            ['middle', { id: 'middle', x: 260, y: 120, width: 120, height: 80, rank: 1 }],
            ['lower', { id: 'lower', x: 260, y: 260, width: 120, height: 80, rank: 1 }],
        ]);

        const assigned = assignPortsToEdges([
            { source: 'source', target: 'lower' },
            { source: 'source', target: 'upper' },
            { source: 'source', target: 'middle' },
        ], nodesMap, { orientation: 'LR' });

        const byTarget = new Map(assigned.map((edge) => [edge.target, edge]));
        expect(byTarget.get('upper').sourcePort.y).toBeLessThan(byTarget.get('middle').sourcePort.y);
        expect(byTarget.get('middle').sourcePort.y).toBeLessThan(byTarget.get('lower').sourcePort.y);
    });

    it('usa top/bottom para nodos del mismo rank cuando no hay separacion horizontal clara', () => {
        const nodesMap = new Map([
            ['top', { id: 'top', x: 0, y: 0, width: 120, height: 80, rank: 0 }],
            ['bottom', { id: 'bottom', x: 18, y: 180, width: 120, height: 80, rank: 0 }],
        ]);

        const [assigned] = assignPortsToEdges([{ source: 'top', target: 'bottom' }], nodesMap, { orientation: 'LR' });

        expect(assigned.sourceSide).toBe(PortSide.BOTTOM);
        expect(assigned.targetSide).toBe(PortSide.TOP);
        expect(Math.abs(assigned.sourcePort.y - (nodesMap.get('top').y + nodesMap.get('top').height))).toBeLessThanOrEqual(1);
        expect(Math.abs(assigned.targetPort.y - nodesMap.get('bottom').y)).toBeLessThanOrEqual(1);
    });
});
