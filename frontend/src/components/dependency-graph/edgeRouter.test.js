import { PortSide } from './edgePorts';
import {
    routeAllEdges,
    routeOrthogonal,
    calculateOrthogonalWaypoints,
    ROUTING_CONFIG,
    RoutingType,
} from './edgeRouter';

describe('edgeRouter orthogonal detours', () => {
    it('evita obstaculos laterales (right -> left) usando un carril vertical libre', () => {
        const sourcePort = { x: 100, y: 100, side: PortSide.RIGHT };
        const targetPort = { x: 320, y: 110, side: PortSide.LEFT };
        const obstacle = { x: 170, y: 60, width: 90, height: 120 };
        const margin = ROUTING_CONFIG.NODE_PADDING + ROUTING_CONFIG.EDGE_SPACING;

        const route = routeOrthogonal(sourcePort, targetPort, [obstacle]);
        expect(route.waypoints.length).toBeGreaterThan(3);

        const hasFreeLaneWaypoint = route.waypoints.some((point) => (
            point.y <= obstacle.y - margin || point.y >= obstacle.y + obstacle.height + margin
        ));
        expect(hasFreeLaneWaypoint).toBe(true);
        expect(route.path).not.toMatch(/[CQSA]/);
    });

    it('evita obstaculos verticales (bottom -> top) usando desvio lateral', () => {
        const source = { x: 140, y: 120 };
        const target = { x: 150, y: 320 };
        const obstacle = { x: 110, y: 180, width: 100, height: 90 };
        const margin = ROUTING_CONFIG.NODE_PADDING + ROUTING_CONFIG.EDGE_SPACING;

        const waypoints = calculateOrthogonalWaypoints(
            source,
            target,
            [obstacle],
            PortSide.BOTTOM,
            PortSide.TOP,
        );

        const hasSideDetour = waypoints.some((point) => (
            point.x <= obstacle.x - margin || point.x >= obstacle.x + obstacle.width + margin
        ));
        expect(hasSideDetour).toBe(true);
    });
});

describe('edgeRouter local orthogonal routing', () => {
    it('mantiene aristas forward adyacentes dentro de un envelope local y sin curvas', () => {
        const nodes = [
            { id: 'a', x: 0, y: 0, width: 120, height: 80, rank: 0 },
            { id: 'b', x: 0, y: 140, width: 120, height: 80, rank: 0 },
            { id: 'c', x: 0, y: 280, width: 120, height: 80, rank: 0 },
            { id: 't', x: 320, y: 130, width: 140, height: 90, rank: 1 },
        ];
        const edges = [
            {
                id: 'a-t',
                source: 'a',
                target: 't',
                sourcePort: { x: 120, y: 30, side: PortSide.RIGHT },
                targetPort: { x: 320, y: 150, side: PortSide.LEFT },
            },
            {
                id: 'b-t',
                source: 'b',
                target: 't',
                sourcePort: { x: 120, y: 170, side: PortSide.RIGHT },
                targetPort: { x: 320, y: 175, side: PortSide.LEFT },
            },
            {
                id: 'c-t',
                source: 'c',
                target: 't',
                sourcePort: { x: 120, y: 310, side: PortSide.RIGHT },
                targetPort: { x: 320, y: 200, side: PortSide.LEFT },
            },
        ];

        const routed = routeAllEdges(edges, nodes);
        expect(routed).toHaveLength(edges.length);
        expect(routed.every((edge) => edge.path && !/[CQSA]/.test(edge.path))).toBe(true);
        expect(routed.every((edge) => edge.route?.type === RoutingType.ORTHOGONAL_BUS)).toBe(true);
        expect(routed.every((edge) => edge.routing_scope === 'local')).toBe(true);

        routed.forEach((edge) => {
            const envelopeTop = Math.min(edge.sourcePort.y, edge.targetPort.y) - 80;
            const envelopeBottom = Math.max(edge.sourcePort.y, edge.targetPort.y) + 80;
            const outsideLocalEnvelope = edge.route?.waypoints?.some((point) => (
                point.y < envelopeTop || point.y > envelopeBottom
            ));
            expect(outsideLocalEnvelope).toBe(false);
        });
    });

    it('hace avanzar aristas multi-rank de forma monotona por columnas sucesivas', () => {
        const nodes = [
            { id: 's', x: 0, y: 60, width: 120, height: 80, rank: 0 },
            { id: 'midA', x: 280, y: 0, width: 140, height: 80, rank: 1 },
            { id: 'midB', x: 280, y: 170, width: 140, height: 80, rank: 1 },
            { id: 'midC', x: 560, y: 90, width: 140, height: 80, rank: 2 },
            { id: 't', x: 840, y: 110, width: 140, height: 90, rank: 3 },
        ];
        const [routed] = routeAllEdges([
            {
                id: 's-t',
                source: 's',
                target: 't',
                sourcePort: { x: 120, y: 95, side: PortSide.RIGHT },
                targetPort: { x: 840, y: 145, side: PortSide.LEFT },
            },
        ], nodes);

        const xs = routed.route?.waypoints?.map((point) => point.x) || [];
        for (let index = 1; index < xs.length; index += 1) {
            expect(xs[index]).toBeGreaterThanOrEqual(xs[index - 1]);
        }
        expect(routed.route?.type).toBe(RoutingType.ORTHOGONAL_BUS);
        expect(routed.path).not.toMatch(/[CQSA]/);
    });

    it('envia back-edges y same-rank por un carril externo local', () => {
        const nodes = [
            { id: 'left', x: 40, y: 40, width: 120, height: 80, rank: 1 },
            { id: 'right', x: 320, y: 60, width: 120, height: 80, rank: 1 },
        ];
        const edge = {
            id: 'right-left',
            source: 'right',
            target: 'left',
            sourcePort: { x: 320, y: 100, side: PortSide.LEFT },
            targetPort: { x: 160, y: 80, side: PortSide.RIGHT },
        };

        const [routed] = routeAllEdges([edge], nodes);
        const localTop = Math.min(edge.sourcePort.y, edge.targetPort.y) - 80;
        const localBottom = Math.max(edge.sourcePort.y, edge.targetPort.y) + 80;
        const laneWaypoint = routed.route?.waypoints?.find((point) => (
            point.y < localTop || point.y > localBottom
        ));

        expect(routed.route?.type).toBe(RoutingType.ORTHOGONAL_DETOUR);
        expect(routed.path).not.toMatch(/[CQSA]/);
        expect(laneWaypoint).toBeTruthy();
        expect(routed.routing_scope).toBe('external');
        expect(typeof routed.lane_id).toBe('string');
        expect(routed.lane_id).toMatch(/^external-(top|bottom):/);
    });

    it('evita rectangulos globales en un caso parecido al capturado', () => {
        const nodes = [
            { id: 'fy', x: 0, y: 0, width: 130, height: 80, rank: 0 },
            { id: 'phi', x: 0, y: 120, width: 130, height: 80, rank: 0 },
            { id: 'b', x: 0, y: 240, width: 130, height: 80, rank: 0 },
            { id: 'tw', x: 0, y: 360, width: 130, height: 80, rank: 0 },
            { id: 'tf', x: 0, y: 480, width: 130, height: 80, rank: 0 },
            { id: 'd', x: 0, y: 600, width: 130, height: 80, rank: 0 },
            { id: 'h', x: 280, y: 300, width: 150, height: 90, rank: 1 },
            { id: 'ix', x: 560, y: 300, width: 160, height: 90, rank: 2 },
            { id: 'sx', x: 840, y: 300, width: 160, height: 90, rank: 3 },
            { id: 'mn', x: 1120, y: 300, width: 170, height: 90, rank: 4 },
            { id: 'phi-mn', x: 1400, y: 300, width: 170, height: 90, rank: 5 },
        ];

        const routed = routeAllEdges([
            { id: 'fy-final', source: 'fy', target: 'phi-mn', sourcePort: { x: 130, y: 30, side: PortSide.RIGHT }, targetPort: { x: 1400, y: 345, side: PortSide.LEFT } },
            { id: 'phi-final', source: 'phi', target: 'phi-mn', sourcePort: { x: 130, y: 150, side: PortSide.RIGHT }, targetPort: { x: 1400, y: 345, side: PortSide.LEFT } },
            { id: 'b-h', source: 'b', target: 'h', sourcePort: { x: 130, y: 270, side: PortSide.RIGHT }, targetPort: { x: 280, y: 345, side: PortSide.LEFT } },
            { id: 'tw-h', source: 'tw', target: 'h', sourcePort: { x: 130, y: 390, side: PortSide.RIGHT }, targetPort: { x: 280, y: 345, side: PortSide.LEFT } },
            { id: 'tf-ix', source: 'tf', target: 'ix', sourcePort: { x: 130, y: 510, side: PortSide.RIGHT }, targetPort: { x: 560, y: 345, side: PortSide.LEFT } },
            { id: 'd-ix', source: 'd', target: 'ix', sourcePort: { x: 130, y: 630, side: PortSide.RIGHT }, targetPort: { x: 560, y: 345, side: PortSide.LEFT } },
            { id: 'h-ix', source: 'h', target: 'ix', sourcePort: { x: 430, y: 345, side: PortSide.RIGHT }, targetPort: { x: 560, y: 345, side: PortSide.LEFT } },
            { id: 'ix-sx', source: 'ix', target: 'sx', sourcePort: { x: 720, y: 345, side: PortSide.RIGHT }, targetPort: { x: 840, y: 345, side: PortSide.LEFT } },
            { id: 'sx-mn', source: 'sx', target: 'mn', sourcePort: { x: 1000, y: 345, side: PortSide.RIGHT }, targetPort: { x: 1120, y: 345, side: PortSide.LEFT } },
            { id: 'mn-final', source: 'mn', target: 'phi-mn', sourcePort: { x: 1290, y: 345, side: PortSide.RIGHT }, targetPort: { x: 1400, y: 345, side: PortSide.LEFT } },
        ], nodes);

        const problematic = routed.filter((edge) => edge.id === 'fy-final' || edge.id === 'phi-final');
        problematic.forEach((edge) => {
            const yValues = edge.route?.waypoints?.map((point) => point.y) || [];
            const overshoot = Math.max(...yValues) - Math.min(...yValues);
            expect(edge.path).not.toMatch(/[CQSA]/);
            expect(overshoot).toBeLessThan(520);
            expect(edge.routing_scope).toBe('local');
        });
    });
});
