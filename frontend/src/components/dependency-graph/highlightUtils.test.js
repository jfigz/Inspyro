import { computeUpstreamPathHighlight, resolveEdgeFocusState } from './highlightUtils';

describe('computeUpstreamPathHighlight', () => {
    it('resalta upstream transitivo en cadena a->b->c', () => {
        const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const edges = [
            { source: 'a', target: 'b' },
            { source: 'b', target: 'c' },
        ];

        const result = computeUpstreamPathHighlight(nodes, edges, 'c');

        expect(new Set(result.node_ids)).toEqual(new Set(['a', 'b', 'c']));
        expect(new Set(result.edge_keys)).toEqual(new Set(['a->b', 'b->c']));
    });

    it('resalta ramas multiples a->c y b->c', () => {
        const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const edges = [
            { source: 'a', target: 'c' },
            { source: 'b', target: 'c' },
        ];

        const result = computeUpstreamPathHighlight(nodes, edges, 'c');

        expect(new Set(result.node_ids)).toEqual(new Set(['a', 'b', 'c']));
        expect(new Set(result.edge_keys)).toEqual(new Set(['a->c', 'b->c']));
    });

    it('maneja ciclos sin loop infinito (a->b->a) seleccionando b', () => {
        const nodes = [{ id: 'a' }, { id: 'b' }];
        const edges = [
            { source: 'a', target: 'b' },
            { source: 'b', target: 'a' },
        ];

        const result = computeUpstreamPathHighlight(nodes, edges, 'b');

        expect(new Set(result.node_ids)).toEqual(new Set(['a', 'b']));
        expect(new Set(result.edge_keys)).toEqual(new Set(['a->b', 'b->a']));
    });

    it('nodo sin upstream resalta solo nodo seleccionado', () => {
        const nodes = [{ id: 'solo' }];
        const edges = [];

        const result = computeUpstreamPathHighlight(nodes, edges, 'solo');

        expect(result.node_ids).toEqual(['solo']);
        expect(result.edge_keys).toEqual([]);
    });
});

describe('resolveEdgeFocusState', () => {
    it('mantiene estado normal cuando no hay dimming de path', () => {
        const result = resolveEdgeFocusState({
            baseOpacity: 0.7,
            baseWidth: 2,
            shouldDimForPath: false,
            isHighlightedEdge: false,
        });

        expect(result.edgeOpacity).toBeCloseTo(0.7);
        expect(result.edgeWidth).toBeCloseTo(2);
        expect(result.edgeGlow).toBe(false);
        expect(result.badgeOpacity).toBeCloseTo(0.92);
        expect(result.labelOpacity).toBeCloseTo(0.9);
    });

    it('sincroniza arista y overlays en estado highlight', () => {
        const result = resolveEdgeFocusState({
            baseOpacity: 0.7,
            baseWidth: 2,
            shouldDimForPath: true,
            isHighlightedEdge: true,
        });

        expect(result.edgeOpacity).toBeCloseTo(0.98);
        expect(result.edgeWidth).toBeCloseTo(3.2);
        expect(result.edgeGlow).toBe(true);
        expect(result.badgeOpacity).toBeCloseTo(0.95);
        expect(result.labelOpacity).toBeCloseTo(0.95);
    });

    it('atenua arista y overlays fuera del path seleccionado', () => {
        const result = resolveEdgeFocusState({
            baseOpacity: 0.7,
            baseWidth: 2,
            shouldDimForPath: true,
            isHighlightedEdge: false,
        });

        expect(result.edgeOpacity).toBeGreaterThanOrEqual(0.2);
        expect(result.edgeOpacity).toBeLessThanOrEqual(0.34);
        expect(result.edgeGlow).toBe(false);
        expect(result.badgeOpacity).toBeCloseTo(0.18);
        expect(result.labelOpacity).toBeCloseTo(0.2);
    });
});
