import {
    computeAutoFitTransform,
    getTransformedBounds,
    getAutoFitPadding,
    hasVisibleViewportOverlap,
    normalizeFitPadding,
    resolveViewportTransform,
    sanitizeZoomTransform,
} from './fitView';

describe('fitView', () => {
    it('permite auto-scale mayor que 1 en grafos pequenos', () => {
        const transform = computeAutoFitTransform({
            viewportWidth: 800,
            viewportHeight: 500,
            bounds: { width: 240, height: 180 },
            padding: getAutoFitPadding(3),
            maxScale: 3,
        });

        expect(transform.scale).toBeGreaterThan(1);
        expect(transform.translateX).toBeGreaterThan(0);
        expect(transform.translateY).toBeGreaterThan(0);
    });

    it('respeta padding estable en ambos ejes', () => {
        const transform = computeAutoFitTransform({
            viewportWidth: 1000,
            viewportHeight: 600,
            bounds: { x: 0, y: 0, width: 400, height: 200 },
            padding: { x: 40, y: 28 },
            maxScale: 3,
        });

        expect(transform.scale).toBeCloseTo(2.3, 1);
        expect(transform.translateX).toBeGreaterThanOrEqual(40);
        expect(transform.translateY).toBeGreaterThanOrEqual(28);
    });

    it('normaliza padding numerico y estructurado', () => {
        expect(normalizeFitPadding(18)).toEqual({ x: 18, y: 18 });
        expect(normalizeFitPadding({ x: 12, y: 24 })).toEqual({ x: 12, y: 24 });
    });

    it('centra bounds con origen no nulo al hacer fit', () => {
        const transform = computeAutoFitTransform({
            viewportWidth: 900,
            viewportHeight: 500,
            bounds: { x: 100, y: 40, width: 300, height: 180 },
            padding: 24,
            maxScale: 3,
        });

        const transformed = getTransformedBounds({ x: 100, y: 40, width: 300, height: 180 }, {
            x: transform.translateX,
            y: transform.translateY,
            k: transform.scale,
        });

        expect(transformed.left).toBeGreaterThanOrEqual(24);
        expect(transformed.top).toBeGreaterThanOrEqual(24);
        expect(transformed.right).toBeLessThanOrEqual(900 - 24);
        expect(transformed.bottom).toBeLessThanOrEqual(500 - 24);
    });

    it('invalida transform previo cuando el viewport cambia', () => {
        const result = resolveViewportTransform({
            viewportWidth: 1200,
            viewportHeight: 700,
            bounds: { x: 40, y: 30, width: 280, height: 180 },
            padding: 24,
            previousTransform: { x: -320, y: -120, k: 3.2 },
            preservePreviousTransform: false,
            fitMaxScale: 2.4,
        });

        expect(result.usedPreviousTransform).toBe(false);
        expect(result.transform).toEqual(result.fitTransform);
        expect(result.transform.k).toBeLessThanOrEqual(2.4);
    });

    it('preserva transform manual cuando sigue visible', () => {
        const result = resolveViewportTransform({
            viewportWidth: 900,
            viewportHeight: 600,
            bounds: { x: 0, y: 0, width: 320, height: 200 },
            padding: 24,
            previousTransform: { x: 120, y: 80, k: 1.4 },
            preservePreviousTransform: true,
        });

        expect(result.usedPreviousTransform).toBe(true);
        expect(result.transform).toEqual({ x: 120, y: 80, k: 1.4 });
    });

    it('rehace fit cuando el transform previo deja el contenido fuera del viewport', () => {
        const bounds = { x: 0, y: 0, width: 320, height: 200 };
        const previousTransform = sanitizeZoomTransform({ x: -2200, y: -1800, k: 4 });

        expect(hasVisibleViewportOverlap({
            viewportWidth: 900,
            viewportHeight: 600,
            bounds,
            transform: previousTransform,
        })).toBe(false);

        const result = resolveViewportTransform({
            viewportWidth: 900,
            viewportHeight: 600,
            bounds,
            padding: 24,
            previousTransform,
            preservePreviousTransform: true,
        });

        expect(result.usedPreviousTransform).toBe(false);
        expect(result.transform).toEqual(result.fitTransform);
    });
});
