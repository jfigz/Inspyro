import { getEdgeKey } from './highlightUtils';

function normalizeCollapsedNodeSet(collapsedNodeIds) {
    if (collapsedNodeIds instanceof Set) return new Set(collapsedNodeIds);
    if (Array.isArray(collapsedNodeIds)) return new Set(collapsedNodeIds);
    return new Set();
}

function mapNodeIdList(ids = [], mapNodeId, visibleNodeIds) {
    return Array.from(new Set(
        (Array.isArray(ids) ? ids : [])
            .map((id) => mapNodeId(id))
            .filter((id) => id && visibleNodeIds.has(id))
    ));
}

export function buildCollapsedGraphView(graphData, collapsedNodeIds) {
    if (!graphData || !Array.isArray(graphData.nodes) || graphData.nodes.length === 0) {
        return {
            graph: graphData,
            collapsedSet: normalizeCollapsedNodeSet(collapsedNodeIds),
            nodeIdMap: {},
        };
    }

    const collapsedSet = normalizeCollapsedNodeSet(collapsedNodeIds);
    if (collapsedSet.size === 0) {
        const identityMap = {};
        graphData.nodes.forEach((node) => {
            if (node?.id) identityMap[node.id] = node.id;
        });
        return {
            graph: graphData,
            collapsedSet,
            nodeIdMap: identityMap,
        };
    }

    const parentMap = new Map();
    const nodeById = new Map();
    graphData.nodes.forEach((node) => {
        if (!node?.id) return;
        nodeById.set(node.id, node);
        parentMap.set(node.id, node.parent_id || null);
    });

    const collapsedAncestorCache = new Map();
    const getCollapsedAncestor = (nodeId) => {
        if (!nodeId) return null;
        if (collapsedAncestorCache.has(nodeId)) return collapsedAncestorCache.get(nodeId);
        let current = parentMap.get(nodeId);
        while (current) {
            if (collapsedSet.has(current)) {
                collapsedAncestorCache.set(nodeId, current);
                return current;
            }
            current = parentMap.get(current);
        }
        collapsedAncestorCache.set(nodeId, null);
        return null;
    };

    const mapNodeId = (nodeId) => {
        if (!nodeId) return nodeId;
        return getCollapsedAncestor(nodeId) || nodeId;
    };

    const visibleNodes = [];
    const visibleNodeIds = new Set();
    graphData.nodes.forEach((node) => {
        if (!node?.id) return;
        if (getCollapsedAncestor(node.id)) return;
        visibleNodes.push({
            ...node,
            ui_is_collapsed: collapsedSet.has(node.id),
        });
        visibleNodeIds.add(node.id);
    });

    const edgeMap = new Map();
    const edges = Array.isArray(graphData.edges) ? graphData.edges : [];
    edges.forEach((edge, edgeIndex) => {
        if (!edge?.source || !edge?.target) return;

        const mappedSource = mapNodeId(edge.source);
        const mappedTarget = mapNodeId(edge.target);
        if (!mappedSource || !mappedTarget || mappedSource === mappedTarget) return;
        if (!visibleNodeIds.has(mappedSource) || !visibleNodeIds.has(mappedTarget)) return;

        const relation = typeof edge.relation === 'string' ? edge.relation : null;
        const abStatus = typeof edge.ab_status === 'string' ? edge.ab_status : null;
        const edgeKey = getEdgeKey(mappedSource, mappedTarget);
        const originalPair = {
            source: edge.source,
            target: edge.target,
            relation,
            ab_status: abStatus,
            index: edgeIndex,
        };

        if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
                ...edge,
                source: mappedSource,
                target: mappedTarget,
                originalSource: edge.source,
                originalTarget: edge.target,
                aggregated_count: 1,
                original_pairs: [originalPair],
                relations: relation ? [relation] : [],
                relation: relation || null,
                ab_statuses: abStatus ? [abStatus] : [],
                ab_status: abStatus || null,
            });
            return;
        }

        const existing = edgeMap.get(edgeKey);
        existing.aggregated_count += 1;
        existing.original_pairs.push(originalPair);
        if (relation && !existing.relations.includes(relation)) {
            existing.relations.push(relation);
        }
        if (abStatus && !existing.ab_statuses.includes(abStatus)) {
            existing.ab_statuses.push(abStatus);
        }
        if (existing.relations.length > 1) {
            existing.relation = 'mixed';
        } else if (existing.relations.length === 1) {
            existing.relation = existing.relations[0];
        }
        if (existing.ab_statuses.length > 1) {
            existing.ab_status = 'mixed';
        } else if (existing.ab_statuses.length === 1) {
            existing.ab_status = existing.ab_statuses[0];
        }
    });

    const nodeIdMap = {};
    graphData.nodes.forEach((node) => {
        if (!node?.id) return;
        nodeIdMap[node.id] = mapNodeId(node.id);
    });

    const collapsedGraph = {
        ...graphData,
        root_id: mapNodeId(graphData.root_id),
        nodes: visibleNodes,
        edges: Array.from(edgeMap.values()),
        input_node_ids: mapNodeIdList(graphData.input_node_ids, mapNodeId, visibleNodeIds),
        output_node_ids: mapNodeIdList(graphData.output_node_ids, mapNodeId, visibleNodeIds),
        check_node_ids: mapNodeIdList(graphData.check_node_ids, mapNodeId, visibleNodeIds),
        meta: {
            ...(graphData.meta || {}),
            collapsed_view_enabled: true,
            collapsed_nodes_count: collapsedSet.size,
        },
    };

    return {
        graph: collapsedGraph,
        collapsedSet,
        nodeIdMap,
    };
}

