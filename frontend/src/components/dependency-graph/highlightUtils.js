export function getEdgeKey(sourceId, targetId) {
    return `${sourceId}->${targetId}`;
}

export function computeUpstreamPathHighlight(nodes = [], edges = [], selectedNodeId = null) {
    if (!Array.isArray(nodes) || nodes.length === 0 || !selectedNodeId) {
        return { node_ids: [], edge_keys: [] };
    }

    const nodeIds = new Set(nodes.map((node) => node?.id).filter(Boolean));
    if (!nodeIds.has(selectedNodeId)) {
        return { node_ids: [], edge_keys: [] };
    }

    const incomingByTarget = new Map();
    (Array.isArray(edges) ? edges : []).forEach((edge) => {
        if (!edge || !edge.source || !edge.target) return;
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
        if (!incomingByTarget.has(edge.target)) {
            incomingByTarget.set(edge.target, []);
        }
        incomingByTarget.get(edge.target).push(edge);
    });

    const highlightNodeIds = new Set([selectedNodeId]);
    const highlightEdgeKeys = new Set();
    const pending = [selectedNodeId];

    while (pending.length > 0) {
        const currentNodeId = pending.pop();
        const incomingEdges = incomingByTarget.get(currentNodeId) || [];
        incomingEdges.forEach((edge) => {
            highlightEdgeKeys.add(getEdgeKey(edge.source, edge.target));
            if (!highlightNodeIds.has(edge.source)) {
                highlightNodeIds.add(edge.source);
                pending.push(edge.source);
            }
        });
    }

    return {
        node_ids: Array.from(highlightNodeIds),
        edge_keys: Array.from(highlightEdgeKeys),
    };
}

export function resolveEdgeFocusState({
    baseOpacity = 0.7,
    baseWidth = 1.8,
    shouldDimForPath = false,
    isHighlightedEdge = false,
} = {}) {
    let edgeOpacity = baseOpacity;
    let edgeWidth = baseWidth;
    let edgeGlow = false;

    if (shouldDimForPath) {
        if (isHighlightedEdge) {
            edgeOpacity = 0.98;
            edgeWidth = Math.min(5, baseWidth + 1.2);
            edgeGlow = true;
        } else {
            edgeOpacity = Math.max(0.2, Math.min(0.34, baseOpacity * 0.45));
        }
    }

    const badgeOpacity = shouldDimForPath
        ? (isHighlightedEdge ? 0.95 : 0.18)
        : 0.92;
    const labelOpacity = shouldDimForPath
        ? (isHighlightedEdge ? 0.95 : 0.2)
        : 0.9;

    return {
        edgeOpacity,
        edgeWidth,
        edgeGlow,
        badgeOpacity,
        labelOpacity,
    };
}
