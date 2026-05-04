const LARGE_GRAPH_LIMITS = Object.freeze({
    NODE_COUNT: 48,
    EDGE_COUNT: 64,
    DENSE_NODE_COUNT: 32,
    DENSE_EDGE_COUNT: 48,
    DENSE_EDGE_RATIO: 1.15,
});

export function getGraphComplexity(graphData = {}) {
    const nodeCount = graphData?.nodes?.length || 0;
    const edgeCount = graphData?.edges?.length || 0;
    const edgeRatio = nodeCount > 0 ? edgeCount / nodeCount : 0;
    const dense = (
        nodeCount >= LARGE_GRAPH_LIMITS.DENSE_NODE_COUNT
        && edgeCount >= LARGE_GRAPH_LIMITS.DENSE_EDGE_COUNT
        && edgeRatio >= LARGE_GRAPH_LIMITS.DENSE_EDGE_RATIO
    );

    return {
        nodeCount,
        edgeCount,
        edgeRatio,
        dense,
        large: dense
            || nodeCount >= LARGE_GRAPH_LIMITS.NODE_COUNT
            || edgeCount >= LARGE_GRAPH_LIMITS.EDGE_COUNT,
    };
}

export function shouldUseLargeGraphMode(graphData = {}) {
    return getGraphComplexity(graphData).large;
}

export function getLargeGraphAutoSummary() {
    return `${LARGE_GRAPH_LIMITS.NODE_COUNT}+ nodos / ${LARGE_GRAPH_LIMITS.EDGE_COUNT}+ aristas`;
}

export { LARGE_GRAPH_LIMITS };
