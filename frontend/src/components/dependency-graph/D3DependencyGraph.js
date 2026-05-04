/**
 * D3DependencyGraph.js - Visualización elegante de grafos con D3.js
 * 
 * Diseño moderno con:
 * - Gradientes suaves en nodos
 * - Tipografía clara y legible
 * - Contenedores con glassmorphism
 * - Animaciones sutiles
 */

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { computeHierarchicalLayout, getAdaptiveLayoutOptions } from './d3Layout';
import { CATEGORY_COLORS, NODE_ICONS } from './constants';
import { checkValueInRange, formatRuntimeValue } from './utils';
import { NODE_LINE_HEIGHT } from './nodeSizing';
import { getEdgeKey, resolveEdgeFocusState } from './highlightUtils';
import {
    expandBounds,
    getAutoFitPadding,
    normalizeBounds,
    resolveViewportTransform,
} from './fitView';
import {
    buildPathFromPoints,
    computeVisibleArrowGeometry,
    computeWorldSize,
    EDGE_VISIBILITY_DEFAULTS,
    samplePathRange,
} from './edgeVisibility';
import { getNodeVisualProfile } from './nodeVisualProfile';
import { shouldUseLargeGraphMode } from './graphComplexity';

/** Lighten a hex/named color by mixing with white. `amount` 0..1. */
function lightenColor(color, amount = 0.35) {
    const c = d3.color(color);
    if (!c) return color;
    const r = Math.round(c.r + (255 - c.r) * amount);
    const g = Math.round(c.g + (255 - c.g) * amount);
    const b = Math.round(c.b + (255 - c.b) * amount);
    return `rgb(${r},${g},${b})`;
}

/** Return '#fff' or '#1a1a2e' based on perceived luminance. */
function contrastTextColor(bgColor) {
    const c = d3.color(bgColor);
    if (!c) return '#fff';
    const luminance = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    return luminance > 0.55 ? '#1a1a2e' : '#fff';
}

// =============================================================================
// Paleta de Colores Moderna
// =============================================================================

const NODE_STYLES = {
    variable: {
        gradient: ['#667eea', '#764ba2'],
        border: '#5a67d8',
        text: '#fff'
    },
    function: {
        gradient: ['#f093fb', '#f5576c'],
        border: '#d53f8c',
        text: '#fff'
    },
    class: {
        gradient: ['#4facfe', '#00f2fe'],
        border: '#0984e3',
        text: '#fff'
    },
    import: {
        gradient: ['#43e97b', '#38f9d7'],
        border: '#00b894',
        text: '#1a1a2e'
    },
    parameter: {
        gradient: ['#fa709a', '#fee140'],
        border: '#e17055',
        text: '#fff'
    },
    constant: {
        gradient: ['#a8edea', '#fed6e3'],
        border: '#81ecec',
        text: '#2d3436'
    },
    check: {
        gradient: ['#55efc4', '#00b894'],
        border: '#27ae60',
        text: '#fff'
    },
    group: {
        gradient: ['#7f8cff', '#16c7d4'],
        border: '#5dade2',
        text: '#fff'
    },
    attribute: {
        gradient: ['#667eea', '#764ba2'],
        border: '#6c5ce7',
        text: '#fff'
    },
    unknown: {
        gradient: ['#636e72', '#b2bec3'],
        border: '#636e72',
        text: '#fff'
    },
};

const RANGE_INDICATORS = {
    ok: { color: '#00b894', icon: '●' },
    warning: { color: '#fdcb6e', icon: '●' },
    error: { color: '#e17055', icon: '●' },
};

const TYPE_BADGES = {
    variable: 'VAR',
    function: 'FUNC',
    class: 'CLASS',
    import: 'IMPORT',
    parameter: 'PARAM',
    constant: 'CONST',
    attribute: 'ATTR',
    check: 'CHECK',
    group: 'GROUP',
    unknown: 'UNK',
};

const RELATION_COLORS = {
    uses: '#81ecec',
    calls: '#74b9ff',
    imports: '#55efc4',
    assigns: '#ffeaa7',
    attribute_of: '#ff7675',
    mixed: '#fdcb6e',
};

function getEdgeBaseColor(edgeLike) {
    const abStatus = edgeLike?.ab_status;
    if (abStatus === 'added') return '#2ecc71';
    if (abStatus === 'mixed') return '#f1c40f';
    return RELATION_COLORS[edgeLike?.relation] || '#81ecec';
}

const FONT_SANS = "'Source Sans 3', 'Segoe UI', sans-serif";
const FONT_MONO = "'Source Code Pro', Monaco, monospace";
const FONT_LABEL = "'Source Sans 3', 'Segoe UI', sans-serif";
const ZOOM_EXTENT = Object.freeze({ min: 0.05, max: 4 });
const CONTENT_BOUNDS_PADDING = 12;
const EDGE_HEAD_LENGTH_PX = 14;
const EDGE_HEAD_WIDTH_PX = 10;
const EDGE_STROKE_MIN_WORLD = 0.45;
const EDGE_MARKER_VARIANTS = Object.freeze({
    normal: { opacity: 0.7, size: 4.2 },
    highlight: { opacity: 0.98, size: 4.8 },
    dim: { opacity: 0.16, size: 3.8 },
    cycle: { opacity: 0.85, size: 4.2 },
    added: { opacity: 0.74, size: 4.2 },
    mixed: { opacity: 0.74, size: 4.2 },
});

function toD3ZoomTransform(transform) {
    const safeTransform = transform || { x: 0, y: 0, k: 1 };
    return d3.zoomIdentity.translate(safeTransform.x || 0, safeTransform.y || 0).scale(safeTransform.k || 1);
}

function readContentBounds(contentNode, fallbackBounds) {
    const normalizedFallbackBounds = normalizeBounds(fallbackBounds);

    if (contentNode && typeof contentNode.getBBox === 'function') {
        try {
            const bbox = contentNode.getBBox();
            if (Number.isFinite(bbox?.width) && Number.isFinite(bbox?.height) && bbox.width > 0 && bbox.height > 0) {
                return expandBounds({
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height,
                }, CONTENT_BOUNDS_PADDING);
            }
        } catch (_error) {
            // Fallback silencioso a bounds sinteticos si getBBox falla temporalmente.
        }
    }

    return expandBounds(normalizedFallbackBounds, CONTENT_BOUNDS_PADDING);
}

function getDefaultEdgeMarkerVariant(edgeLike) {
    if (edgeLike?.is_cycle) return 'cycle';
    if (edgeLike?.ab_status === 'added') return 'added';
    if (edgeLike?.ab_status === 'mixed') return 'mixed';
    return 'normal';
}

function getEdgeMarkerVariant(edgeLike, {
    highlighted = false,
    dimmed = false,
} = {}) {
    if (highlighted) return 'highlight';
    if (dimmed) return 'dim';
    return getDefaultEdgeMarkerVariant(edgeLike);
}

// =============================================================================
// Componente Principal
// =============================================================================

function D3DependencyGraph({
    graphData,
    rootId,
    selectedNodeId,
    collapsedNodeIds = new Set(),
    onToggleCollapse,
    onNodeClick,
    onNodeDoubleClick,
    onBackgroundClick,
    resetViewSignal = 0,
    focusNodeRequest = null,
    showEdgeEvidence = false,
    largeGraphMode = false,
    selectedPathHighlight = null,
    selectionHighlightTrigger = 'click',
    selectionHighlightMode = 'upstream_transitive',
    fitPadding = null,
    maxAutoScale = 2.6,
    width = '100%',
    height = '100%',
}) {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    const zoomBehaviorRef = useRef(null);
    const viewportGroupRef = useRef(null);
    const contentGroupRef = useRef(null);
    const backgroundRectRef = useRef(null);
    const latestFitTransformRef = useRef({ x: 0, y: 0, k: 1 });
    const currentTransformRef = useRef({ x: 0, y: 0, k: 1 });
    const hasUserTransformRef = useRef(false);
    const isProgrammaticZoomRef = useRef(false);
    const graphSignatureRef = useRef('');
    const appliedGraphSignatureRef = useRef('');
    const selectedNodeIdRef = useRef(selectedNodeId);
    const selectedPathHighlightRef = useRef(selectedPathHighlight);
    const selectionHighlightTriggerRef = useRef(selectionHighlightTrigger);
    const selectionHighlightModeRef = useRef(selectionHighlightMode);
    const previousResetSignalRef = useRef(resetViewSignal);
    const previousViewportRef = useRef({ width: 0, height: 0 });
    const focusedNodeSeqRef = useRef(0);
    const markerPrefixRef = useRef(`dep-marker-${Math.random().toString(36).slice(2, 10)}`);
    const edgeSelectionRef = useRef(null);
    const edgeHeadSelectionRef = useRef(null);
    const nodeSelectionRef = useRef(null);
    const applyInteractiveStylesRef = useRef(() => { });
    const refreshEdgeVisibilityRef = useRef(() => { });
    const hasPersistentSelectionRef = useRef(false);
    const layoutInfoRef = useRef({
        bounds: normalizeBounds({}),
        fallbackBounds: normalizeBounds({}),
        graphSignature: '',
        nodeCount: 0,
        nodesById: new Map(),
    });
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    void collapsedNodeIds;

    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
        selectedPathHighlightRef.current = selectedPathHighlight;
        selectionHighlightTriggerRef.current = selectionHighlightTrigger;
        selectionHighlightModeRef.current = selectionHighlightMode;
        applyInteractiveStylesRef.current();
    }, [selectedNodeId, selectedPathHighlight, selectionHighlightTrigger, selectionHighlightMode]);

    // Observar cambios de tamaño
    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            setDimensions({ width, height });
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Renderizado D3
    useEffect(() => {
        if (!svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.interrupt();
        svg.on('.zoom', null);
        svg.selectAll('*').interrupt();
        svg.selectAll('*').remove();

        edgeSelectionRef.current = null;
        edgeHeadSelectionRef.current = null;
        nodeSelectionRef.current = null;
        applyInteractiveStylesRef.current = () => { };
        refreshEdgeVisibilityRef.current = () => { };
        viewportGroupRef.current = null;
        contentGroupRef.current = null;
        backgroundRectRef.current = null;
        layoutInfoRef.current = {
            bounds: normalizeBounds({}),
            fallbackBounds: normalizeBounds({}),
            graphSignature: '',
            nodeCount: 0,
            nodesById: new Map(),
        };

        if (!graphData) return;

        const layout = computeHierarchicalLayout(graphData, {
            ...getAdaptiveLayoutOptions(graphData),
            ENABLE_BUNDLING: false,
            largeGraphMode,
            ORIENTATION: graphData?.analysis_mode === 'impact' ? 'LR' : 'LR',
        });
        if (layout.nodes.length === 0) return;

        const graphSignature = `${layout.nodes.length}:${layout.edges.length}:${graphData?.root_id || rootId || ''}`;
        const graphStructureChanged = graphSignatureRef.current !== graphSignature;
        graphSignatureRef.current = graphSignature;

        const inputNodeIds = new Set(graphData.input_node_ids || []);
        const outputNodeIds = new Set(graphData.output_node_ids || []);
        const isLargeGraph = largeGraphMode || shouldUseLargeGraphMode(layout);
        const disableGraphDimming = isLargeGraph || layout.edges.length >= 320 || layout.nodes.length >= 180;

        const defs = svg.append('defs');
        const markerPrefix = markerPrefixRef.current;
        const defId = (name) => `${markerPrefix}-${name}`;
        const nodeShadowId = defId('node-shadow');
        const edgeGlowId = defId('edge-glow');
        const gradientIdByType = {};

        const dotPatternId = defId('dot-grid');
        const dotPattern = defs.append('pattern')
            .attr('id', dotPatternId)
            .attr('width', 20)
            .attr('height', 20)
            .attr('patternUnits', 'userSpaceOnUse');
        dotPattern.append('circle')
            .attr('cx', 10)
            .attr('cy', 10)
            .attr('r', 0.8)
            .attr('fill', 'rgba(255, 255, 255, 0.06)');

        const backgroundLayer = svg.append('g').attr('class', 'background-layer');
        const viewportGroup = svg.append('g').attr('class', 'viewport-group');
        const contentGroup = viewportGroup.append('g').attr('class', 'content-group');

        viewportGroupRef.current = viewportGroup.node();
        contentGroupRef.current = contentGroup.node();

        const backgroundRect = backgroundLayer.append('rect')
            .attr('class', 'background')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', 1)
            .attr('height', 1)
            .attr('fill', `url(#${dotPatternId})`)
            .on('click', () => onBackgroundClick?.());
        backgroundRectRef.current = backgroundRect.node();

        const shadowFilter = defs.append('filter')
            .attr('id', nodeShadowId)
            .attr('x', '-20%').attr('y', '-20%')
            .attr('width', '140%').attr('height', '150%');
        shadowFilter.append('feDropShadow')
            .attr('dx', '0').attr('dy', '3')
            .attr('stdDeviation', '4')
            .attr('flood-color', 'rgba(0,0,0,0.25)');

        const rootHaloId = defId('root-halo');
        const haloFilter = defs.append('filter')
            .attr('id', rootHaloId)
            .attr('x', '-30%').attr('y', '-30%')
            .attr('width', '160%').attr('height', '160%');
        haloFilter.append('feDropShadow')
            .attr('dx', '0').attr('dy', '0')
            .attr('stdDeviation', '6')
            .attr('flood-color', 'rgba(255, 215, 0, 0.35)');
        haloFilter.append('feDropShadow')
            .attr('dx', '0').attr('dy', '3')
            .attr('stdDeviation', '4')
            .attr('flood-color', 'rgba(0,0,0,0.25)');

        const containerGlowId = defId('container-glow');
        const containerGlowFilter = defs.append('filter')
            .attr('id', containerGlowId)
            .attr('x', '-10%').attr('y', '-10%')
            .attr('width', '120%').attr('height', '120%');
        containerGlowFilter.append('feDropShadow')
            .attr('dx', '0').attr('dy', '0')
            .attr('stdDeviation', '4')
            .attr('flood-color', 'rgba(129, 236, 236, 0.15)');

        Object.entries(NODE_STYLES).forEach(([type, style]) => {
            const gradId = defId(`grad-${type}`);
            gradientIdByType[type] = gradId;
            const grad = defs.append('linearGradient')
                .attr('id', gradId)
                .attr('x1', '0%').attr('y1', '0%')
                .attr('x2', '0%').attr('y2', '100%');
            grad.append('stop')
                .attr('offset', '0%')
                .attr('stop-color', style.gradient[0]);
            grad.append('stop')
                .attr('offset', '100%')
                .attr('stop-color', style.gradient[1]);
        });

        const glowFilter = defs.append('filter')
            .attr('id', edgeGlowId)
            .attr('x', '-50%').attr('y', '-50%')
            .attr('width', '200%').attr('height', '200%');
        glowFilter.append('feGaussianBlur')
            .attr('in', 'SourceGraphic')
            .attr('stdDeviation', '2')
            .attr('result', 'blur');
        glowFilter.append('feMerge')
            .selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .enter()
            .append('feMergeNode')
            .attr('in', d => d);

        const containerNodes = layout.nodes.filter(n => n.isContainer);
        const regularNodes = layout.nodes.filter(n => !n.isContainer);
        const layoutNodesById = new Map(layout.nodes.map((node) => [node.id, node]));

        const containersGroup = contentGroup.append('g').attr('class', 'containers-layer');
        const edgeBodiesGroup = contentGroup.append('g').attr('class', 'edge-bodies-layer');
        const edgeAnnotationsGroup = contentGroup.append('g').attr('class', 'edge-annotations-layer');
        const nodesGroup = contentGroup.append('g').attr('class', 'nodes-layer');
        const edgeHeadsGroup = contentGroup.append('g').attr('class', 'edge-heads-layer');
        const edgeMeasureGroup = contentGroup.append('g')
            .attr('class', 'edge-measure-layer')
            .style('opacity', 0)
            .style('pointer-events', 'none');

        // =================================================================
        // Nodos Contenedores
        // =================================================================

        containerNodes.forEach(node => {
            const data = node.data;
            const nodeType = data.node_type || data.type || 'unknown';
            const isCollapsed = node.isCollapsed;

            // Constantes visuales
            const headerHeight = 30;
            const nodeWidth = node.width;
            const nodeHeight = node.height;
            let style = NODE_STYLES[nodeType] || NODE_STYLES.unknown;
            const gradientId = gradientIdByType[nodeType] || gradientIdByType.unknown;

            const g = containersGroup.append('g')
                .attr('class', `container-node ${isCollapsed ? 'collapsed' : ''}`)
                .attr('data-id', node.id)
                .attr('transform', `translate(${node.x}, ${node.y})`);

            // Fondo principal del contenedor
            g.append('rect')
                .attr('width', nodeWidth)
                .attr('height', nodeHeight)
                .attr('rx', 12)
                .attr('fill', isCollapsed ? `url(#${gradientId})` : 'rgba(255, 255, 255, 0.03)')
                .attr('stroke', isCollapsed ? style.border : 'rgba(255, 255, 255, 0.12)')
                .attr('stroke-width', isCollapsed ? 1.5 : 1)
                .attr('filter', isCollapsed ? `url(#${nodeShadowId})` : `url(#${containerGlowId})`);

            // Header bar — clipPath for clean bottom corners when expanded
            if (!isCollapsed) {
                const clipId = defId(`container-header-clip-${node.id}`);
                const clip = defs.append('clipPath').attr('id', clipId);
                clip.append('rect')
                    .attr('width', nodeWidth)
                    .attr('height', headerHeight)
                    .attr('rx', 12);
                clip.append('rect')
                    .attr('y', 12)
                    .attr('width', nodeWidth)
                    .attr('height', headerHeight - 12);
                g.append('rect')
                    .attr('width', nodeWidth)
                    .attr('height', headerHeight)
                    .attr('fill', 'rgba(0, 0, 0, 0.3)')
                    .attr('clip-path', `url(#${clipId})`)
                    .style('cursor', 'pointer')
                    .on('click', (event) => {
                        event.stopPropagation();
                        onToggleCollapse?.(node.id);
                    });
            } else {
                g.append('rect')
                    .attr('width', nodeWidth)
                    .attr('height', headerHeight)
                    .attr('rx', 12)
                    .attr('fill', 'rgba(0, 0, 0, 0.2)')
                    .style('cursor', 'pointer')
                    .on('click', (event) => {
                        event.stopPropagation();
                        onToggleCollapse?.(node.id);
                    });
            }

            // Icono +/-
            g.append('text')
                .attr('x', 14)
                .attr('y', 20)
                .attr('fill', '#fff')
                .attr('font-size', '14px')
                .attr('font-weight', 'bold')
                .style('pointer-events', 'none')
                .text(isCollapsed ? '+' : '−');

            // Nombre (uses module-level FONT_LABEL for consistency with regular nodes)
            const icon = NODE_ICONS[nodeType] || '📦';
            g.append('text')
                .attr('x', 34)
                .attr('y', 20)
                .attr('fill', '#fff')
                .attr('font-size', '12px')
                .attr('font-weight', '600')
                .attr('font-family', FONT_LABEL)
                .style('pointer-events', 'none')
                .text(`${icon} ${truncate(data.name, 35)}`);

            // Indicador de cantidad de nodos if colapsado
            if (isCollapsed) {
                g.append('text')
                    .attr('x', nodeWidth / 2)
                    .attr('y', nodeHeight / 2 + 10)
                    .attr('text-anchor', 'middle')
                    .attr('fill', 'rgba(255,255,255,0.7)')
                    .attr('font-size', '11px')
                    .attr('font-family', FONT_LABEL)
                    .style('pointer-events', 'none')
                    .text(`${node.data.children_ids?.length || 0} nodos`);
            }
        });

        // =================================================================
        // Edges con metadata semántica (relation / aggregated_count / ciclos)
        // =================================================================
        const getBaseEdgeWidth = (edge) => {
            const width = Math.min(4, 1.8 + (Math.max(1, edge.aggregated_count || 1) - 1) * 0.4);
            return isLargeGraph ? Math.min(2.2, Math.max(0.8, width * 0.52)) : width;
        };
        const getBaseEdgeOpacity = (edge) => {
            const opacity = EDGE_MARKER_VARIANTS[getDefaultEdgeMarkerVariant(edge)]?.opacity ?? EDGE_MARKER_VARIANTS.normal.opacity;
            if (!isLargeGraph) return opacity;
            if (edge.is_cycle) return Math.min(opacity, 0.36);
            return Math.min(opacity, 0.24);
        };

        const edgeMeasureSelection = edgeMeasureGroup.selectAll('.edge-measure')
            .data(layout.edges)
            .enter()
            .append('path')
            .attr('class', 'edge-measure')
            .attr('data-edge-key', d => getEdgeKey(d.source, d.target))
            .attr('d', d => d.path)
            .attr('fill', 'none')
            .attr('stroke', 'none');

        const edgeSelection = edgeBodiesGroup.selectAll('.edge')
            .data(layout.edges)
            .enter()
            .append('path')
            .attr('class', d => `edge ${d.hasObstacles ? 'edge-routed' : ''} ${d.isBundled ? 'edge-bundled' : ''} ${d.is_cycle ? 'edge-cycle' : ''}`)
            .attr('data-source', d => d.source)
            .attr('data-target', d => d.target)
            .attr('data-route-type', d => d.route_type || '')
            .attr('data-routing-scope', d => d.routing_scope || '')
            .attr('data-lane-id', d => d.lane_id || '')
            .attr('data-shared-trunk-id', d => d.shared_trunk_id || '')
            .attr('data-edge-key', d => getEdgeKey(d.source, d.target))
            .attr('data-base-color', d => getEdgeBaseColor(d))
            .attr('data-base-variant', d => getDefaultEdgeMarkerVariant(d))
            .attr('data-base-width', d => getBaseEdgeWidth(d))
            .attr('data-base-opacity', d => getBaseEdgeOpacity(d))
            .attr('d', d => d.path)
            .attr('fill', 'none')
            .attr('stroke', d => getEdgeBaseColor(d))
            .attr('stroke-width', d => getBaseEdgeWidth(d))
            .attr('stroke-opacity', d => getBaseEdgeOpacity(d))
            .attr('stroke-dasharray', d => d.is_cycle ? '5,4' : null)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .style('transition', isLargeGraph ? null : 'stroke-opacity 0.25s, stroke-width 0.25s, stroke 0.25s, filter 0.25s');

        const edgeHeadSelection = edgeHeadsGroup.selectAll('.edge-head')
            .data(layout.edges)
            .enter()
            .append('path')
            .attr('class', d => `edge-head ${d.is_cycle ? 'edge-cycle' : ''}`)
            .attr('data-source', d => d.source)
            .attr('data-target', d => d.target)
            .attr('data-route-type', d => d.route_type || '')
            .attr('data-routing-scope', d => d.routing_scope || '')
            .attr('data-edge-key', d => getEdgeKey(d.source, d.target))
            .attr('data-base-color', d => getEdgeBaseColor(d))
            .attr('data-base-variant', d => getDefaultEdgeMarkerVariant(d))
            .attr('data-base-width', d => getBaseEdgeWidth(d))
            .attr('data-base-opacity', d => getBaseEdgeOpacity(d))
            .attr('fill', d => getEdgeBaseColor(d))
            .attr('fill-opacity', d => getBaseEdgeOpacity(d))
            .attr('stroke', 'none');

        edgeSelection.append('title')
            .text((d) => {
                const relation = d.relation || 'uses';
                const count = Math.max(1, d.aggregated_count || 1);
                const ab = d.ab_status ? ` [${d.ab_status}]` : '';
                return count > 1 ? `${relation} (${count} enlaces)${ab}` : `${relation}${ab}`;
            });

        edgeSelection.each(function appendAggregateBadge(d) {
            if ((d.aggregated_count || 1) <= 1) return;
            try {
                const pathEl = this;
                const totalLen = pathEl.getTotalLength();
                if (!Number.isFinite(totalLen) || totalLen <= 1) return;
                const point = pathEl.getPointAtLength(totalLen / 2);
                edgeAnnotationsGroup.append('circle')
                    .attr('class', 'edge-aggregate-badge')
                    .attr('data-edge-key', getEdgeKey(d.source, d.target))
                    .attr('cx', point.x)
                    .attr('cy', point.y)
                    .attr('r', 9)
                    .attr('fill', 'rgba(13, 20, 35, 0.92)')
                    .attr('stroke', getEdgeBaseColor(d))
                    .attr('stroke-width', 1.4);
                edgeAnnotationsGroup.append('text')
                    .attr('class', 'edge-aggregate-badge-text')
                    .attr('data-edge-key', getEdgeKey(d.source, d.target))
                    .attr('x', point.x)
                    .attr('y', point.y + 3)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '9px')
                    .attr('font-weight', '700')
                    .attr('fill', '#dff9ff')
                    .attr('font-family', FONT_MONO)
                    .text(String(d.aggregated_count));
            } catch (_error) {
                // getTotalLength puede fallar temporalmente en algunos navegadores; degradar sin badge.
            }
        });

        if (showEdgeEvidence) {
            edgeSelection.each(function appendEdgeEvidence(d) {
                const relation = d.relation || (d.relations?.[0] || 'uses');
                if (!relation) return;
                try {
                const pathEl = this;
                const totalLen = pathEl.getTotalLength();
                if (!Number.isFinite(totalLen) || totalLen <= 1) return;
                const point = pathEl.getPointAtLength(totalLen * 0.35);
                edgeAnnotationsGroup.append('text')
                    .attr('class', 'edge-evidence-label')
                    .attr('data-edge-key', getEdgeKey(d.source, d.target))
                    .attr('x', point.x)
                    .attr('y', point.y - 6)
                    .attr('text-anchor', 'middle')
                        .attr('font-size', '9px')
                        .attr('fill', '#caeff7')
                        .attr('font-family', FONT_SANS)
                        .attr('opacity', 0.9)
                        .text(relation);
                } catch (_error) {
                    // Degradar silenciosamente si no se puede leer el path length.
                }
            });
        }

        const edgeMeasurePathByKey = new Map();
        const edgeHeadByKey = new Map();

        edgeMeasureSelection.each(function registerMeasurePath(edge) {
            edgeMeasurePathByKey.set(getEdgeKey(edge.source, edge.target), this);
        });
        edgeHeadSelection.each(function registerHead(edge) {
            edgeHeadByKey.set(getEdgeKey(edge.source, edge.target), this);
        });

        const refreshEdgeVisibility = (zoomScale = currentTransformRef.current.k || 1) => {
            const safeZoomScale = Math.max(Number(zoomScale) || 1, ZOOM_EXTENT.min);

            edgeSelection.each(function updateVisibleEdge(edge) {
                const edgeSel = d3.select(this);
                const edgeKey = edgeSel.attr('data-edge-key') || getEdgeKey(edge.source, edge.target);
                const measurePath = edgeMeasurePathByKey.get(edgeKey);
                const headNode = edgeHeadByKey.get(edgeKey);
                const headSel = headNode ? d3.select(headNode) : null;
                const sourceNode = layoutNodesById.get(edge.source);
                const targetNode = layoutNodesById.get(edge.target);
                const baseWidthPx = Number(edgeSel.attr('data-base-width') || getBaseEdgeWidth(edge));
                const strokeWidth = computeWorldSize(baseWidthPx, safeZoomScale, EDGE_STROKE_MIN_WORLD);

                edgeSel
                    .attr('stroke-width', strokeWidth)
                    .attr('stroke-dasharray', edge.is_cycle
                        ? `${computeWorldSize(5, safeZoomScale, 0.45)},${computeWorldSize(4, safeZoomScale, 0.35)}`
                        : null)
                    .attr('data-rendered-stroke-width', strokeWidth);

                if (!measurePath || !headSel) return;

                try {
                    const totalLength = measurePath.getTotalLength();
                    if (!Number.isFinite(totalLength) || totalLength <= 0) {
                        edgeSel.attr('d', edge.path);
                        headSel.attr('d', null);
                        return;
                    }

                    const geometry = computeVisibleArrowGeometry({
                        getPointAtLength: (length) => measurePath.getPointAtLength(length),
                        totalLength,
                        sourceRect: sourceNode,
                        targetRect: targetNode,
                        radius: EDGE_VISIBILITY_DEFAULTS.nodeRadius,
                        zoomScale: safeZoomScale,
                        headLengthPx: Math.max(EDGE_HEAD_LENGTH_PX, baseWidthPx * 3.4),
                        headWidthPx: Math.max(EDGE_HEAD_WIDTH_PX, baseWidthPx * 2.6),
                    });

                    if (!geometry?.arrowPath) {
                        edgeSel.attr('d', edge.path);
                        headSel.attr('d', null);
                        return;
                    }

                    const bodySamplePoints = samplePathRange(
                        (length) => measurePath.getPointAtLength(length),
                        geometry.visibleStartLength,
                        geometry.bodyEndLength,
                        totalLength,
                        Math.max(8, Math.ceil((geometry.bodyEndLength - geometry.visibleStartLength) / 18)),
                    );
                    const bodyPath = buildPathFromPoints(bodySamplePoints);

                    edgeSel
                        .attr('d', bodyPath || edge.path)
                        .attr('data-visible-start-length', geometry.visibleStartLength)
                        .attr('data-visible-end-length', geometry.visibleEndLength)
                        .attr('data-body-end-length', geometry.bodyEndLength)
                        .attr('data-arrow-base-x', geometry.baseCenter.x)
                        .attr('data-arrow-base-y', geometry.baseCenter.y)
                        .attr('data-arrow-tip-x', geometry.tip.x)
                        .attr('data-arrow-tip-y', geometry.tip.y);

                    headSel
                        .attr('d', geometry.arrowPath)
                        .attr('data-visible-end-length', geometry.visibleEndLength)
                        .attr('data-body-end-length', geometry.bodyEndLength)
                        .attr('data-arrow-base-x', geometry.baseCenter.x)
                        .attr('data-arrow-base-y', geometry.baseCenter.y)
                        .attr('data-arrow-tip-x', geometry.tip.x)
                        .attr('data-arrow-tip-y', geometry.tip.y);
                } catch (_error) {
                    edgeSel.attr('d', edge.path);
                    headSel.attr('d', null);
                }
            });
        };

        refreshEdgeVisibilityRef.current = refreshEdgeVisibility;

        // =================================================================
        // Nodos con diseño premium
        // =================================================================
        regularNodes.forEach(node => {
            const data = node.data;
            const nodeType = data.node_type || data.type || 'unknown';
            const isRoot = node.id === rootId;
            const isInput = inputNodeIds.has(node.id);
            const isOutput = outputNodeIds.has(node.id);
            const visualProfile = getNodeVisualProfile(data, {
                isInput,
                isOutput,
                largeGraphMode: isLargeGraph,
            });
            const displayCategory = visualProfile.displayCategory;
            const displayUnit = visualProfile.displayUnit;
            const displayDescription = visualProfile.description;
            const showExtendedDetails = !visualProfile.compact;

            // Determinar estilo
            let style = NODE_STYLES[nodeType] || NODE_STYLES.unknown;
            const category = displayCategory;
            if (category && CATEGORY_COLORS[category]) {
                // Usar estilo de categoría con gradiente real (claro → base)
                const catBase = CATEGORY_COLORS[category].border;
                style = {
                    gradient: [lightenColor(catBase, 0.35), catBase],
                    border: catBase,
                    text: contrastTextColor(catBase)
                };
            }
            const abStatus = data.ab_status;
            const baseStroke = abStatus === 'added'
                ? '#2ecc71'
                : (abStatus === 'mixed' ? '#f1c40f' : style.border);
            const activeStroke = isRoot ? '#ffd700' : baseStroke;
            let nodeGradientId = gradientIdByType[nodeType] || gradientIdByType.unknown;

            // If category overrides style, create a custom gradient for this node
            if (category && CATEGORY_COLORS[category]) {
                const catGradId = defId(`grad-cat-${category}`);
                if (!gradientIdByType[`__cat_${category}`]) {
                    const catGrad = defs.append('linearGradient')
                        .attr('id', catGradId)
                        .attr('x1', '0%').attr('y1', '0%')
                        .attr('x2', '0%').attr('y2', '100%');
                    catGrad.append('stop').attr('offset', '0%').attr('stop-color', style.gradient[0]);
                    catGrad.append('stop').attr('offset', '100%').attr('stop-color', style.gradient[1]);
                    gradientIdByType[`__cat_${category}`] = catGradId;
                }
                nodeGradientId = gradientIdByType[`__cat_${category}`];
            }

            // Altura dinámica del nodo
            const lineHeight = NODE_LINE_HEIGHT;
            const nodeHeight = node.height;
            const nodeWidth = node.width;

            const g = nodesGroup.append('g')
                .datum(node)
                .attr('class', `node ${isRoot ? 'root' : ''} ${node.isCycle ? 'cycle-node' : ''}`)
                .attr('data-id', node.id)
                .attr('transform', `translate(${node.x}, ${node.y})`)
                .style('cursor', 'pointer')
                .on('mouseover', (event) => {
                    // Highlight node - target the rect element, not the group
                    const nodeGroup = d3.select(event.currentTarget);
                    const nodeBody = nodeGroup.select('.node-body');
                    const transition = isLargeGraph ? nodeBody : nodeBody.transition().duration(150);
                    transition
                        .attr('stroke', '#fff')
                        .attr('stroke-width', 3)
                        .attr('stroke-opacity', 1);

                    if (hasPersistentSelectionRef.current) {
                        return;
                    }

                    // Find connected edges
                    const connectedNodeIds = new Set();
                    connectedNodeIds.add(node.id);

                    edgeSelection
                        .each(function (edge) {
                            const edgeSel = d3.select(this);
                            const edgeKey = edgeSel.attr('data-edge-key') || getEdgeKey(edge.source, edge.target);
                            const headNode = edgeHeadByKey.get(edgeKey);
                            const headSel = headNode ? d3.select(headNode) : null;
                            const baseColor = edgeSel.attr('data-base-color') || getEdgeBaseColor(edge);
                            const baseWidth = Number(edgeSel.attr('data-base-width') || 1.8);
                            if (edge.source === node.id || edge.target === node.id) {
                                connectedNodeIds.add(edge.source);
                                connectedNodeIds.add(edge.target);

                                const edgeTransition = isLargeGraph ? edgeSel : edgeSel.transition().duration(150);
                                const previewMarkerVariant = getEdgeMarkerVariant(edge, { highlighted: true });
                                const previewOpacity = EDGE_MARKER_VARIANTS[previewMarkerVariant]?.opacity ?? EDGE_MARKER_VARIANTS.highlight.opacity;
                                edgeTransition
                                    .attr('stroke-opacity', previewOpacity)
                                    .attr('stroke-width', computeWorldSize(Math.max(baseWidth + 1, 2.8), currentTransformRef.current.k || 1, EDGE_STROKE_MIN_WORLD))
                                    .attr('stroke', baseColor)
                                    .attr('filter', `url(#${edgeGlowId})`);

                                if (headSel) {
                                    const headTransition = isLargeGraph ? headSel : headSel.transition().duration(150);
                                    headTransition
                                        .attr('fill', baseColor)
                                        .attr('fill-opacity', previewOpacity)
                                        .attr('opacity', previewOpacity)
                                        .attr('filter', `url(#${edgeGlowId})`);
                                }

                                // Bring to front
                                this.parentNode.appendChild(this);
                                if (headNode?.parentNode) {
                                    headNode.parentNode.appendChild(headNode);
                                }
                            } else {
                                if (!disableGraphDimming) {
                                    // Dim other edges solo en grafos no densos
                                    const edgeTransition = isLargeGraph ? edgeSel : edgeSel.transition().duration(150);
                                    const dimmedMarkerVariant = getEdgeMarkerVariant(edge, { dimmed: true });
                                    const dimmedOpacity = EDGE_MARKER_VARIANTS[dimmedMarkerVariant]?.opacity ?? EDGE_MARKER_VARIANTS.dim.opacity;
                                    edgeTransition
                                        .attr('stroke-opacity', dimmedOpacity)
                                        .attr('filter', null);

                                    if (headSel) {
                                        const headTransition = isLargeGraph ? headSel : headSel.transition().duration(150);
                                        headTransition
                                            .attr('fill-opacity', dimmedOpacity)
                                            .attr('opacity', dimmedOpacity)
                                            .attr('filter', null);
                                    }
                                }
                            }
                        });

                    if (!disableGraphDimming) {
                        // Dim other nodes (use data-id attribute since nodes aren't data-bound)
                        nodesGroup.selectAll('.node')
                            .each(function () {
                                const nodeId = d3.select(this).attr('data-id');
                                if (!connectedNodeIds.has(nodeId)) {
                                    d3.select(this)
                                        .transition().duration(150)
                                        .style('opacity', 0.25);
                                }
                            });
                    }

                })
                .on('mouseout', () => {
                    applyInteractiveStylesRef.current();
                })
                .on('click', (event) => {
                    event.stopPropagation();
                    onNodeClick?.(node);
                })
                .on('dblclick', (event) => {
                    event.stopPropagation();
                    onNodeDoubleClick?.(node);
                });

            // Fondo con gradiente y sombra (root gets golden halo filter)
            g.append('rect')
                .attr('class', 'node-body')
                .attr('width', nodeWidth)
                .attr('height', nodeHeight)
                .attr('rx', 12)
                .attr('fill', `url(#${nodeGradientId})`)
                .attr('filter', isRoot ? `url(#${rootHaloId})` : `url(#${nodeShadowId})`)
                .attr('stroke', activeStroke)
                .attr('stroke-width', isRoot ? 3 : 1.5)
                .attr('stroke-opacity', isRoot ? 1 : 0.5)
                .attr('data-default-stroke', baseStroke);

            // Inner glass stroke for depth (glassmorphism in SVG)
            g.append('rect')
                .attr('width', nodeWidth - 2)
                .attr('height', nodeHeight - 2)
                .attr('x', 1).attr('y', 1)
                .attr('rx', 11)
                .attr('fill', 'none')
                .attr('stroke', 'rgba(255, 255, 255, 0.12)')
                .attr('stroke-width', 1)
                .style('pointer-events', 'none');

            // Indicador de rango (esquina superior derecha)
            if (data.runtime_value && data.valid_range) {
                const formatted = formatRuntimeValue(data.runtime_value);
                const rangeStatus = checkValueInRange(formatted, data.valid_range);
                if (rangeStatus && RANGE_INDICATORS[rangeStatus]) {
                    g.append('circle')
                        .attr('cx', nodeWidth - 14)
                        .attr('cy', 14)
                        .attr('r', 6)
                        .attr('fill', RANGE_INDICATORS[rangeStatus].color)
                        .attr('stroke', '#fff')
                        .attr('stroke-width', 1.5);
                }
            }

            // Badge de nodo raíz
            if (isRoot) {
                g.append('circle')
                    .attr('cx', 14).attr('cy', 14)
                    .attr('r', 10)
                    .attr('fill', '#ffd700')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);
                g.append('text')
                    .attr('x', 14).attr('y', 17.5)
                    .attr('text-anchor', 'middle')
                    .attr('fill', '#1a1a2e')
                    .attr('font-size', '10px')
                    .attr('font-weight', '700')
                    .attr('font-family', FONT_SANS)
                    .style('pointer-events', 'none')
                    .text('R');
            }

            const textColor = style.text;
            const paddingX = 12;
            const headerHeight = 24;
            const badgeHeight = 14;
            const badgeGap = 6;

            // Header overlay for readability — top corners only (clipPath avoids rounding at bottom)
            const headerClip = defId(`node-header-clip-${node.id}`);
            const hClip = defs.append('clipPath').attr('id', headerClip);
            hClip.append('rect').attr('width', nodeWidth).attr('height', headerHeight).attr('rx', 12);
            hClip.append('rect').attr('y', 12).attr('width', nodeWidth).attr('height', headerHeight - 12);
            g.append('rect')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', nodeWidth)
                .attr('height', headerHeight)
                .attr('clip-path', `url(#${headerClip})`)
                .attr('fill', 'rgba(0, 0, 0, 0.2)')
                .style('pointer-events', 'none');

            // Separator line between header and content
            g.append('line')
                .attr('x1', paddingX).attr('y1', headerHeight)
                .attr('x2', nodeWidth - paddingX).attr('y2', headerHeight)
                .attr('stroke', 'rgba(255, 255, 255, 0.08)')
                .attr('stroke-width', 1)
                .style('pointer-events', 'none');

            // Nombre con icono y unidad
            const icon = data.is_overview_node
                ? 'G'
                : ((category && CATEGORY_COLORS[category]?.icon) || NODE_ICONS[nodeType] || 'N');
            const displayName = truncate(data.name, Math.max(18, Math.floor((nodeWidth - 54) / 6)));
            const unitStr = displayUnit ? ` [${displayUnit}]` : '';
            const scopeChip = visualProfile.scopeChip;

            g.append('text')
                .attr('x', paddingX)
                .attr('y', 16)
                .attr('text-anchor', 'start')
                .attr('fill', textColor)
                .attr('font-size', '12px')
                .attr('font-weight', '700')
                .attr('font-family', FONT_LABEL)
                .style('pointer-events', 'none')
                .text(`${icon} ${displayName}${unitStr}`);

            g.append('title')
                .text([
                    `${data.name || node.id}`,
                    scopeChip ? `scope: ${scopeChip}` : null,
                    visualProfile.fullName && visualProfile.fullName !== data.name ? `full: ${visualProfile.fullName}` : null,
                    visualProfile.fileLabel ? `file: ${visualProfile.fileLabel}` : null,
                    visualProfile.locationLabel || (data.location?.line ? `L${data.location.line}` : null),
                    data.location?.cell_id ? `cell: ${data.location.cell_id}` : null,
                ].filter(Boolean).join('\n'));

            // Badges de metadata
            const badges = [];
            const typeBadge = TYPE_BADGES[nodeType] || TYPE_BADGES.unknown;
            badges.push({
                text: typeBadge,
                fill: 'rgba(0, 0, 0, 0.25)',
                stroke: 'rgba(255, 255, 255, 0.25)',
                color: '#fff',
            });

            if (scopeChip) {
                badges.push({
                    text: truncate(scopeChip, 10),
                    fill: 'rgba(0, 0, 0, 0.28)',
                    stroke: 'rgba(129, 236, 236, 0.7)',
                    color: '#bff7ff',
                });
            }

            if (abStatus === 'added' || abStatus === 'mixed') {
                const abColor = abStatus === 'added' ? '#2ecc71' : '#f1c40f';
                badges.push({
                    text: abStatus === 'added' ? 'NEW' : 'DELTA',
                    fill: withAlpha(abColor, 0.18),
                    stroke: abColor,
                    color: abColor,
                });
            }

            if (category && CATEGORY_COLORS[category]) {
                const catColor = CATEGORY_COLORS[category].border;
                badges.push({
                    text: category.toUpperCase().slice(0, 6),
                    fill: withAlpha(catColor, 0.18),
                    stroke: catColor,
                    color: catColor,
                });
            }

            if (isInput) {
                const inputColor = CATEGORY_COLORS.input?.border || '#f1c40f';
                badges.push({
                    text: 'IN',
                    fill: withAlpha(inputColor, 0.2),
                    stroke: inputColor,
                    color: inputColor,
                });
            }

            if (isOutput) {
                const outputColor = CATEGORY_COLORS.output?.border || '#1abc9c';
                badges.push({
                    text: 'OUT',
                    fill: withAlpha(outputColor, 0.2),
                    stroke: outputColor,
                    color: outputColor,
                });
            }

            if (visualProfile.isExternal) {
                badges.push({
                    text: 'EXT',
                    fill: 'rgba(67, 233, 123, 0.16)',
                    stroke: '#43e97b',
                    color: '#b4ffca',
                });
            }

            if (visualProfile.fileLabel && visualProfile.fileLabel !== data.name) {
                badges.push({
                    text: truncate(visualProfile.fileLabel, 12),
                    fill: 'rgba(116, 185, 255, 0.16)',
                    stroke: '#74b9ff',
                    color: '#c7e2ff',
                });
            }

            const badgeTop = headerHeight + 6;
            let badgeX = paddingX;
            const maxBadgeX = nodeWidth - paddingX;
            badges.forEach(badge => {
                const badgeWidth = Math.max(24, badge.text.length * 6 + 12);
                // Skip badge if it would overflow the node width
                if (badgeX + badgeWidth > maxBadgeX) return;
                g.append('rect')
                    .attr('x', badgeX)
                    .attr('y', badgeTop)
                    .attr('width', badgeWidth)
                    .attr('height', badgeHeight)
                    .attr('rx', 6)
                    .attr('fill', badge.fill)
                    .attr('stroke', badge.stroke)
                    .attr('stroke-width', 1)
                    .style('pointer-events', 'none');
                g.append('text')
                    .attr('x', badgeX + badgeWidth / 2)
                    .attr('y', badgeTop + 10)
                    .attr('text-anchor', 'middle')
                    .attr('fill', badge.color)
                    .attr('font-size', '9px')
                    .attr('font-weight', '600')
                    .attr('font-family', FONT_SANS)
                    .style('pointer-events', 'none')
                    .text(badge.text);
                badgeX += badgeWidth + badgeGap;
            });

            let yPos = badgeTop + badgeHeight + 8;

            // Descripci??n (m??s peque??a, en gris claro)
            if (showExtendedDetails && displayDescription) {
                g.append('text')
                    .attr('x', paddingX)
                    .attr('y', yPos)
                    .attr('text-anchor', 'start')
                    .attr('fill', textColor)
                    .attr('font-size', '9px')
                    .attr('font-family', FONT_SANS)
                    .attr('opacity', 0.8)
                    .style('pointer-events', 'none')
                    .text(truncate(displayDescription, 28));
                yPos += lineHeight;
            }

            // Valor de runtime (destacado)
            if (showExtendedDetails && data.runtime_value) {
                const formatted = formatRuntimeValue(data.runtime_value);
                if (formatted) {
                    g.append('rect')
                        .attr('x', paddingX)
                        .attr('y', yPos - 12)
                        .attr('width', nodeWidth - paddingX * 2)
                        .attr('height', 16)
                        .attr('rx', 4)
                        .attr('fill', 'rgba(0, 0, 0, 0.25)')
                        .style('pointer-events', 'none');
                    g.append('text')
                        .attr('x', paddingX + 6)
                        .attr('y', yPos)
                        .attr('text-anchor', 'start')
                        .attr('fill', textColor)
                        .attr('font-size', '12px')
                        .attr('font-weight', '700')
                        .attr('font-family', FONT_MONO)
                        .style('pointer-events', 'none')
                        .text(`= ${formatted}`);
                    yPos += lineHeight;
                }
            }

            if (showExtendedDetails && data.value_preview) {
                const preview = truncate(data.value_preview, 30);
                g.append('text')
                    .attr('x', paddingX)
                    .attr('y', yPos)
                    .attr('text-anchor', 'start')
                    .attr('fill', textColor)
                    .attr('font-size', '9px')
                    .attr('font-family', FONT_MONO)
                    .attr('opacity', 0.75)
                    .style('pointer-events', 'none')
                    .text(`expr: ${preview}`);
                yPos += lineHeight;
            }

            // Resultado de verificaci??n
            if (data.is_check) {
                const result = data.check_result;
                let checkText = 'PENDING';
                let checkBg = 'rgba(253, 203, 110, 0.3)';
                let checkColor = '#fdcb6e';
                if (result === true) {
                    checkText = 'PASS';
                    checkBg = 'rgba(0, 184, 148, 0.3)';
                    checkColor = '#00b894';
                } else if (result === false) {
                    checkText = 'FAIL';
                    checkBg = 'rgba(225, 112, 85, 0.3)';
                    checkColor = '#e17055';
                }

                g.append('rect')
                    .attr('x', paddingX)
                    .attr('y', yPos - 11)
                    .attr('width', nodeWidth - paddingX * 2)
                    .attr('height', 16)
                    .attr('rx', 6)
                    .attr('fill', checkBg)
                    .style('pointer-events', 'none');

                g.append('text')
                    .attr('x', paddingX + 8)
                    .attr('y', yPos + 1)
                    .attr('text-anchor', 'start')
                    .attr('fill', checkColor)
                    .attr('font-size', '10px')
                    .attr('font-weight', '700')
                    .attr('font-family', FONT_SANS)
                    .style('pointer-events', 'none')
                    .text(checkText);
                yPos += lineHeight;
            }

            // Rango v??lido si existe
            if (showExtendedDetails && data.valid_range) {
                const minVal = data.valid_range[0] ?? 'na';
                const maxVal = data.valid_range[1] ?? 'na';
                g.append('text')
                    .attr('x', paddingX)
                    .attr('y', yPos)
                    .attr('text-anchor', 'start')
                    .attr('fill', textColor)
                    .attr('font-size', '9px')
                    .attr('font-family', FONT_MONO)
                    .attr('opacity', 0.75)
                    .style('pointer-events', 'none')
                    .text(`range: [${minVal}, ${maxVal}]`);
                yPos += lineHeight;
            }

            // Referencia normativa
            if (showExtendedDetails && data.reference) {
                g.append('text')
                    .attr('x', paddingX)
                    .attr('y', yPos)
                    .attr('text-anchor', 'start')
                    .attr('fill', textColor)
                    .attr('font-size', '9px')
                    .attr('font-family', FONT_SANS)
                    .attr('opacity', 0.7)
                    .style('pointer-events', 'none')
                    .text(`ref: ${truncate(data.reference, 24)}`);
                yPos += lineHeight;
            }
            // Ubicación (esquina inferior derecha, muy sutil)
            if (data.location && (visualProfile.locationLabel || Number(data.location.line) > 0 || Number.isInteger(data.location.cell_index) || (typeof data.location.cell_id === 'string' && data.location.cell_id.trim().length > 0))) {
                const locText = visualProfile.locationLabel || `L${Number(data.location.line) > 0 ? data.location.line : '?'}`;
                g.append('text')
                    .attr('x', nodeWidth - 6)
                    .attr('y', nodeHeight - 6)
                    .attr('text-anchor', 'end')
                    .attr('fill', textColor)
                    .attr('font-size', '8px')
                    .attr('font-family', FONT_MONO)
                    .attr('opacity', 0.55)
                    .style('pointer-events', 'none')
                    .text(locText);
            }
        });

        refreshEdgeVisibility(currentTransformRef.current.k || latestFitTransformRef.current.k || 1);

        // Staggered entry animation (skip in large graph mode)
        if (!isLargeGraph && graphStructureChanged) {
            nodesGroup.selectAll('.node')
                .style('opacity', 0)
                .attr('transform', function () {
                    const current = d3.select(this).attr('transform') || '';
                    return current;
                })
                .transition()
                .duration(350)
                .delay((d, i) => Math.min(i * 25, 400))
                .style('opacity', 1);

            containersGroup.selectAll('.container-node')
                .style('opacity', 0)
                .transition()
                .duration(300)
                .style('opacity', 1);

        }

        edgeSelectionRef.current = edgeSelection;
        edgeHeadSelectionRef.current = edgeHeadSelection;
        nodeSelectionRef.current = nodesGroup.selectAll('.node');
        const edgeBadgeSelection = edgeAnnotationsGroup.selectAll('.edge-aggregate-badge');
        const edgeBadgeTextSelection = edgeAnnotationsGroup.selectAll('.edge-aggregate-badge-text');
        const edgeEvidenceSelection = edgeAnnotationsGroup.selectAll('.edge-evidence-label');
        const visibleNodeIds = new Set(regularNodes.map((entry) => entry.id));

        const applyInteractiveStyles = () => {
            const selectedId = selectedNodeIdRef.current;
            const usePathSelection = selectionHighlightTriggerRef.current === 'click'
                && selectionHighlightModeRef.current === 'upstream_transitive';
            const highlight = usePathSelection ? (selectedPathHighlightRef.current || null) : null;
            const highlightNodeIds = new Set(Array.isArray(highlight?.node_ids) ? highlight.node_ids : []);
            const highlightEdgeKeys = new Set(Array.isArray(highlight?.edge_keys) ? highlight.edge_keys : []);
            if (selectedId) highlightNodeIds.add(selectedId);

            const hasSelectedNode = Boolean(selectedId && visibleNodeIds.has(selectedId));
            const shouldDimForPath = hasSelectedNode && highlightEdgeKeys.size > 0;
            hasPersistentSelectionRef.current = hasSelectedNode && (highlightNodeIds.size > 0 || highlightEdgeKeys.size > 0);

            const edgeSelectionLocal = edgeSelectionRef.current;
            const edgeHeadSelectionLocal = edgeHeadSelectionRef.current;
            const nodeSelectionLocal = nodeSelectionRef.current;
            if (!edgeSelectionLocal || !edgeHeadSelectionLocal || !nodeSelectionLocal) return;

            const withTransition = (selection) => (isLargeGraph ? selection : selection.transition().duration(150));
            const edgeVisualStateByKey = new Map();

            edgeSelectionLocal.each(function updateEdgeStyles(edge) {
                const edgeSel = d3.select(this);
                const baseColor = edgeSel.attr('data-base-color') || getEdgeBaseColor(edge);
                const baseWidth = Number(edgeSel.attr('data-base-width') || 1.8);
                const baseVariant = edgeSel.attr('data-base-variant') || getDefaultEdgeMarkerVariant(edge);
                const baseOpacity = Number(edgeSel.attr('data-base-opacity') || (EDGE_MARKER_VARIANTS[baseVariant]?.opacity ?? EDGE_MARKER_VARIANTS.normal.opacity));
                const edgeKey = edgeSel.attr('data-edge-key') || getEdgeKey(edge.source, edge.target);
                const isHighlightedEdge = shouldDimForPath && highlightEdgeKeys.has(edgeKey);
                const focusState = resolveEdgeFocusState({
                    baseOpacity,
                    baseWidth,
                    shouldDimForPath,
                    isHighlightedEdge,
                });
                const effectiveFocusState = isLargeGraph && shouldDimForPath && !isHighlightedEdge
                    ? {
                        ...focusState,
                        edgeOpacity: 0.055,
                        edgeWidth: Math.max(0.65, baseWidth * 0.45),
                        edgeGlow: false,
                        badgeOpacity: 0.04,
                        labelOpacity: 0,
                    }
                    : focusState;
                edgeVisualStateByKey.set(edgeKey, {
                    baseColor,
                    baseVariant,
                    isHighlightedEdge,
                    edgeOpacity: effectiveFocusState.edgeOpacity,
                    edgeGlow: effectiveFocusState.edgeGlow,
                    badgeOpacity: effectiveFocusState.badgeOpacity,
                    labelOpacity: effectiveFocusState.labelOpacity,
                });

                withTransition(edgeSel)
                    .attr('stroke-opacity', effectiveFocusState.edgeOpacity)
                    .attr('stroke-width', computeWorldSize(effectiveFocusState.edgeWidth, currentTransformRef.current.k || 1, EDGE_STROKE_MIN_WORLD))
                    .attr('stroke', baseColor)
                    .attr('filter', effectiveFocusState.edgeGlow ? `url(#${edgeGlowId})` : null);

                if (isHighlightedEdge && this.parentNode) {
                    this.parentNode.appendChild(this);
                }
            });

            edgeHeadSelectionLocal.each(function updateEdgeHeads(edge) {
                const headSel = d3.select(this);
                const edgeKey = headSel.attr('data-edge-key') || getEdgeKey(edge.source, edge.target);
                const visual = edgeVisualStateByKey.get(edgeKey);
                if (!visual) return;

                withTransition(headSel)
                    .attr('fill', visual.baseColor)
                    .attr('fill-opacity', visual.edgeOpacity)
                    .attr('opacity', visual.edgeOpacity)
                    .attr('filter', visual.edgeGlow ? `url(#${edgeGlowId})` : null);

                if (visual.isHighlightedEdge && this.parentNode) {
                    this.parentNode.appendChild(this);
                }
            });

            const applyEdgeBadgeState = (selection, painter) => {
                selection.each(function updateEdgeDecoration() {
                    const decorationSel = d3.select(this);
                    const edgeKey = decorationSel.attr('data-edge-key');
                    if (!edgeKey) return;
                    const visual = edgeVisualStateByKey.get(edgeKey);
                    if (!visual) return;
                    painter(decorationSel, visual);
                    if (visual.isHighlightedEdge && this.parentNode) {
                        this.parentNode.appendChild(this);
                    }
                });
            };

            applyEdgeBadgeState(edgeBadgeSelection, (badgeSel, visual) => {
                withTransition(badgeSel)
                    .attr('stroke', visual.baseColor)
                    .attr('stroke-opacity', visual.badgeOpacity)
                    .attr('opacity', visual.badgeOpacity);
            });

            applyEdgeBadgeState(edgeBadgeTextSelection, (textSel, visual) => {
                withTransition(textSel)
                    .attr('fill-opacity', visual.badgeOpacity)
                    .attr('opacity', visual.badgeOpacity);
            });

            applyEdgeBadgeState(edgeEvidenceSelection, (labelSel, visual) => {
                withTransition(labelSel)
                    .attr('opacity', visual.labelOpacity);
            });

            nodeSelectionLocal.each(function updateNodeStyles(layoutNode) {
                const nodeGroup = d3.select(this);
                const nodeBody = nodeGroup.select('.node-body');
                const nodeId = layoutNode?.id || nodeGroup.attr('data-id');
                if (!nodeId || nodeBody.empty()) {
                    return;
                }
                const nodeIsRoot = nodeId === rootId;
                const nodeIsSelected = Boolean(selectedId) && nodeId === selectedId;
                const nodeInPath = highlightNodeIds.has(nodeId);
                const defaultStroke = nodeBody.attr('data-default-stroke') || '#5a67d8';

                let strokeColor = nodeIsRoot ? '#ffd700' : defaultStroke;
                let strokeWidth = nodeIsRoot ? 3 : 1.5;
                let strokeOpacity = nodeIsRoot ? 1 : 0.5;

                if (nodeIsSelected) {
                    strokeColor = '#00ff88';
                    strokeWidth = 3;
                    strokeOpacity = 1;
                } else if (shouldDimForPath && nodeInPath && !nodeIsRoot) {
                    strokeColor = '#bff7ff';
                    strokeWidth = 2.3;
                    strokeOpacity = 0.95;
                }

                let nodeOpacity = 1;
                if (shouldDimForPath && !disableGraphDimming && !nodeInPath && !nodeIsSelected) {
                    nodeOpacity = 0.28;
                }

                nodeGroup.classed('selected', nodeIsSelected);

                withTransition(nodeBody)
                    .attr('stroke', strokeColor)
                    .attr('stroke-width', strokeWidth)
                    .attr('stroke-opacity', strokeOpacity);

                (isLargeGraph ? nodeGroup : nodeGroup.transition().duration(150))
                    .style('opacity', nodeOpacity);
            });
        };

        applyInteractiveStylesRef.current = applyInteractiveStyles;
        applyInteractiveStyles();

        const zoom = d3.zoom()
            .scaleExtent([ZOOM_EXTENT.min, ZOOM_EXTENT.max])
            .on('zoom', (event) => {
                viewportGroup.attr('transform', event.transform);
                currentTransformRef.current = {
                    x: event.transform.x,
                    y: event.transform.y,
                    k: event.transform.k,
                };
                refreshEdgeVisibilityRef.current(event.transform.k);
                applyInteractiveStylesRef.current();
                if (!isProgrammaticZoomRef.current && event.sourceEvent) {
                    hasUserTransformRef.current = true;
                }
            });

        zoomBehaviorRef.current = zoom;
        svg.call(zoom);
        layoutInfoRef.current = {
            bounds: readContentBounds(contentGroup.node(), layout.bounds),
            fallbackBounds: normalizeBounds(layout.bounds),
            graphSignature,
            nodeCount: layout.nodes.length,
            nodesById: layoutNodesById,
        };
    }, [graphData, rootId, onToggleCollapse, onNodeClick, onNodeDoubleClick, onBackgroundClick, largeGraphMode, showEdgeEvidence]);

    useEffect(() => {
        if (!svgRef.current || !zoomBehaviorRef.current || !viewportGroupRef.current) return;
        if (!graphData || !layoutInfoRef.current.graphSignature) return;

        const svg = d3.select(svgRef.current);
        const backgroundRect = d3.select(backgroundRectRef.current);
        if (!backgroundRect.empty()) {
            backgroundRect
                .attr('width', Math.max(1, dimensions.width))
                .attr('height', Math.max(1, dimensions.height));
        }

        const graphSignature = layoutInfoRef.current.graphSignature;
        const graphChanged = appliedGraphSignatureRef.current !== graphSignature;
        const previousViewport = previousViewportRef.current;
        const viewportChanged = previousViewport.width !== dimensions.width || previousViewport.height !== dimensions.height;
        const resetRequested = previousResetSignalRef.current !== resetViewSignal;
        previousResetSignalRef.current = resetViewSignal;

        if (resetRequested || graphChanged || viewportChanged) {
            hasUserTransformRef.current = false;
        }

        const { fitTransform, transform } = resolveViewportTransform({
            viewportWidth: dimensions.width,
            viewportHeight: dimensions.height,
            bounds: layoutInfoRef.current.bounds,
            padding: fitPadding || getAutoFitPadding(layoutInfoRef.current.nodeCount),
            previousTransform: currentTransformRef.current,
            preservePreviousTransform: !resetRequested && !graphChanged && !viewportChanged && hasUserTransformRef.current,
            fitMinScale: ZOOM_EXTENT.min,
            fitMaxScale: maxAutoScale,
            zoomMinScale: ZOOM_EXTENT.min,
            zoomMaxScale: ZOOM_EXTENT.max,
        });

        latestFitTransformRef.current = fitTransform;
        let targetTransform = transform;

        const focusSeq = Number(focusNodeRequest?.seq || 0);
        const focusNodeId = focusNodeRequest?.nodeId;
        if (focusNodeId && focusSeq > focusedNodeSeqRef.current) {
            focusedNodeSeqRef.current = focusSeq;
            const focusNode = layoutInfoRef.current.nodesById.get(focusNodeId);
            if (focusNode) {
                const focusScale = targetTransform.k || fitTransform.k || 1;
                targetTransform = {
                    x: dimensions.width / 2 - (focusNode.x + focusNode.width / 2) * focusScale,
                    y: dimensions.height / 2 - (focusNode.y + focusNode.height / 2) * focusScale,
                    k: focusScale,
                };
            }
        }

        isProgrammaticZoomRef.current = true;
        svg.call(zoomBehaviorRef.current.transform, toD3ZoomTransform(targetTransform));
        isProgrammaticZoomRef.current = false;
        currentTransformRef.current = targetTransform;
        appliedGraphSignatureRef.current = graphSignature;
        previousViewportRef.current = {
            width: dimensions.width,
            height: dimensions.height,
        };
    }, [graphData, dimensions, resetViewSignal, focusNodeRequest, fitPadding, maxAutoScale]);

    return (
        <div
            ref={containerRef}
            className="d3-graph-container"
            style={{
                width,
                height,
                position: 'relative',
                overflow: 'hidden',
                background: 'var(--dependency-graph-canvas-bg)',
            }}
        >
            <svg
                ref={svgRef}
                width={dimensions.width}
                height={dimensions.height}
                style={{ display: 'block', cursor: 'grab' }}
            />
        </div>
    );
}

// =============================================================================
// Utilidades
// =============================================================================

function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, Math.max(0, maxLength - 3)) + '...';
}

function withAlpha(color, alpha) {
    const c = d3.color(color);
    if (!c) return color;
    c.opacity = alpha;
    return c.formatRgb();
}

export default D3DependencyGraph;
