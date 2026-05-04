import {
    buildArrowPath,
    computeVisibleArrowGeometry,
    computeWorldSize,
    findFirstOutsideLength,
    findLastOutsideLength,
    pointInRoundedRect,
} from './edgeVisibility';

function createLinearPath(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const totalLength = Math.hypot(dx, dy);

    return {
        totalLength,
        getPointAtLength(length) {
            const safeLength = Math.min(Math.max(length, 0), totalLength);
            const t = totalLength > 0 ? safeLength / totalLength : 0;
            return {
                x: start.x + dx * t,
                y: start.y + dy * t,
            };
        },
    };
}

describe('edgeVisibility', () => {
    it('detecta puntos dentro y fuera de un rectangulo redondeado', () => {
        const rect = { x: 10, y: 20, width: 120, height: 60 };

        expect(pointInRoundedRect({ x: 40, y: 50 }, rect, 12)).toBe(true);
        expect(pointInRoundedRect({ x: 10, y: 20 }, rect, 12)).toBe(false);
        expect(pointInRoundedRect({ x: 129, y: 79 }, rect, 12)).toBe(false);
        expect(pointInRoundedRect({ x: 70, y: 20 }, rect, 12)).toBe(true);
    });

    it('encuentra la salida visible desde el nodo origen y la entrada al nodo destino', () => {
        const path = createLinearPath({ x: 50, y: 20 }, { x: 50, y: 220 });
        const sourceRect = { x: 10, y: 20, width: 80, height: 60 };
        const targetRect = { x: 10, y: 160, width: 80, height: 60 };

        const visibleStartLength = findFirstOutsideLength({
            getPointAtLength: path.getPointAtLength,
            totalLength: path.totalLength,
            rect: sourceRect,
            radius: 12,
        });
        const visibleEndLength = findLastOutsideLength({
            getPointAtLength: path.getPointAtLength,
            totalLength: path.totalLength,
            rect: targetRect,
            radius: 12,
        });

        expect(visibleStartLength).toBeGreaterThan(0);
        expect(visibleStartLength).toBeLessThan(65);
        expect(visibleEndLength).toBeGreaterThan(120);
        expect(visibleEndLength).toBeLessThan(path.totalLength);
    });

    it('calcula punta explicita con base coherente y tangente correcta', () => {
        const path = createLinearPath({ x: 50, y: 20 }, { x: 50, y: 220 });
        const geometry = computeVisibleArrowGeometry({
            getPointAtLength: path.getPointAtLength,
            totalLength: path.totalLength,
            sourceRect: { x: 10, y: 20, width: 80, height: 60 },
            targetRect: { x: 10, y: 160, width: 80, height: 60 },
            zoomScale: 1,
            headLengthPx: 18,
            headWidthPx: 12,
        });

        expect(geometry).toBeTruthy();
        expect(geometry.visibleEndLength).toBeGreaterThan(geometry.visibleStartLength);
        expect(geometry.bodyEndLength).toBeLessThan(geometry.visibleEndLength);
        expect(geometry.tip.x).toBeCloseTo(50, 1);
        expect(geometry.arrowPath).toContain('L');
        expect(geometry.direction.y).toBeGreaterThan(0.9);
    });

    it('escala ancho de cuerpo y punta en unidades del mundo segun zoom', () => {
        expect(computeWorldSize(12, 1)).toBeCloseTo(12, 5);
        expect(computeWorldSize(12, 2)).toBeCloseTo(6, 5);
        expect(computeWorldSize(12, 4)).toBeCloseTo(3, 5);
    });

    it('genera un path triangular valido para la punta', () => {
        const arrowPath = buildArrowPath({
            tip: { x: 10, y: 0 },
            baseCenter: { x: 0, y: 0 },
            direction: { x: 1, y: 0 },
            width: 8,
        });

        expect(arrowPath.startsWith('M ')).toBe(true);
        expect(arrowPath.endsWith(' Z')).toBe(true);
    });
});
