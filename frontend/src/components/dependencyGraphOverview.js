function fileBasename(filePath = '') {
    if (typeof filePath !== 'string' || !filePath.trim()) return '';
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || filePath;
}

function locationFile(node) {
    return node?.location?.file || node?.file_path || '';
}

function firstScopePart(node) {
    const scope = node?.scope_path || node?.full_name || node?.name || '';
    if (typeof scope !== 'string' || !scope.trim()) return '';
    return scope.split('.').filter(Boolean)[0] || '';
}

function collectDescendantsByParent(nodes = [], rootId = null) {
    const descendants = new Set();
    if (!rootId) return descendants;

    const childrenByParent = new Map();
    nodes.forEach((node) => {
        if (!node?.parent_id) return;
        if (!childrenByParent.has(node.parent_id)) childrenByParent.set(node.parent_id, []);
        childrenByParent.get(node.parent_id).push(node.id);
    });

    const pending = [rootId];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current || descendants.has(current)) continue;
        descendants.add(current);
        (childrenByParent.get(current) || []).forEach((childId) => pending.push(childId));
    }

    return descendants;
}

function resolveDominant(values) {
    const counts = new Map();
    values.forEach((value) => {
        if (!value) return;
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || null;
}

function resolveGroup(node, { rootId, rootDescendants, rootFileLabel }) {
    if (!node?.id) return null;
    const fileLabel = fileBasename(locationFile(node));
    const scopeTop = firstScopePart(node);

    if (node.id === rootId || rootDescendants.has(node.id)) {
        return {
            id: `overview::target::${rootId}`,
            name: node.id === rootId ? (node.name || 'target') : 'target internals',
            label: node.id === rootId ? (node.name || 'target') : 'target',
            kind: 'target',
            order: 0,
        };
    }

    if (node.is_external) {
        return {
            id: 'overview::external',
            name: 'externos',
            label: 'externos',
            kind: 'external',
            order: 900,
        };
    }

    if (fileLabel && fileLabel !== rootFileLabel) {
        return {
            id: `overview::file::${fileLabel}`,
            name: fileLabel,
            label: fileLabel,
            kind: 'file',
            order: 400,
        };
    }

    if (scopeTop && scopeTop !== node.name) {
        return {
            id: `overview::scope::${rootFileLabel || 'current'}::${scopeTop}`,
            name: scopeTop,
            label: scopeTop,
            kind: 'scope',
            order: 200,
        };
    }

    return {
        id: `overview::file::${fileLabel || 'current'}`,
        name: fileLabel || 'current',
        label: fileLabel || 'current',
        kind: 'file',
        order: 300,
    };
}

function makeGroupNode(group, rootId) {
    const memberCount = group.members.length;
    const dominantType = resolveDominant(group.members.map((node) => node.node_type || node.type));
    const dominantCategory = resolveDominant(group.members.map((node) => node.category));
    const sampleNames = group.members
        .map((node) => node.name)
        .filter(Boolean)
        .slice(0, 4);
    const memberPreview = sampleNames.join(', ');

    return {
        id: group.id,
        name: group.kind === 'target' ? group.label : group.name,
        type: 'group',
        node_type: 'group',
        full_name: group.name,
        scope_path: group.kind,
        value_preview: `${memberCount} nodos · ${group.internalEdges} internas`,
        description: memberPreview ? `Incluye: ${memberPreview}` : `${memberCount} nodos agrupados`,
        location: group.primaryLocation || null,
        is_external: group.kind === 'external',
        category: dominantCategory || (group.kind === 'target' ? 'result' : null),
        is_container: false,
        container_type: null,
        overview_kind: group.kind,
        overview_member_count: memberCount,
        overview_internal_edge_count: group.internalEdges,
        overview_member_ids: group.members.map((node) => node.id),
        overview_member_types: Array.from(new Set(group.members.map((node) => node.node_type || node.type).filter(Boolean))).sort(),
        overview_files: Array.from(group.files).sort(),
        overview_member_preview: memberPreview,
        overview_dominant_type: dominantType,
        is_overview_node: true,
        source_root_id: rootId,
    };
}

export function buildLargeGraphOverview(graph) {
    if (!graph?.nodes?.length) {
        return { graph, nodeIdMap: {}, summary: null };
    }

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const rootId = graph.root_id;
    const rootNode = nodes.find((node) => node.id === rootId) || nodes[0];
    const rootFileLabel = fileBasename(locationFile(rootNode));
    const rootDescendants = collectDescendantsByParent(nodes, rootId);
    const groups = new Map();
    const nodeIdMap = {};

    const ensureGroup = (groupInfo) => {
        if (!groups.has(groupInfo.id)) {
            groups.set(groupInfo.id, {
                ...groupInfo,
                members: [],
                files: new Set(),
                internalEdges: 0,
                primaryLocation: null,
            });
        }
        return groups.get(groupInfo.id);
    };

    nodes.forEach((node) => {
        const groupInfo = resolveGroup(node, { rootId, rootDescendants, rootFileLabel });
        if (!groupInfo) return;
        const group = ensureGroup(groupInfo);
        group.members.push(node);
        const file = fileBasename(locationFile(node));
        if (file) group.files.add(file);
        if (!group.primaryLocation && node.location) group.primaryLocation = node.location;
        nodeIdMap[node.id] = group.id;
    });

    const edgeGroups = new Map();
    let internalEdgeCount = 0;
    edges.forEach((edge) => {
        const sourceGroupId = nodeIdMap[edge.source];
        const targetGroupId = nodeIdMap[edge.target];
        if (!sourceGroupId || !targetGroupId) return;
        if (sourceGroupId === targetGroupId) {
            internalEdgeCount += 1;
            const group = groups.get(sourceGroupId);
            if (group) group.internalEdges += 1;
            return;
        }

        const key = `${sourceGroupId}->${targetGroupId}`;
        if (!edgeGroups.has(key)) {
            edgeGroups.set(key, {
                source: sourceGroupId,
                target: targetGroupId,
                relationCounts: new Map(),
                count: 0,
            });
        }
        const grouped = edgeGroups.get(key);
        const relation = edge.relation || 'uses';
        grouped.count += 1;
        grouped.relationCounts.set(relation, (grouped.relationCounts.get(relation) || 0) + 1);
    });

    const overviewNodes = Array.from(groups.values())
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((group) => makeGroupNode(group, rootId));

    const overviewEdges = Array.from(edgeGroups.values()).map((grouped) => {
        const relations = Array.from(grouped.relationCounts.keys()).sort();
        const relation = relations.length === 1 ? relations[0] : 'mixed';
        return {
            source: grouped.source,
            target: grouped.target,
            relation,
            relations,
            aggregated_count: grouped.count,
            overview_edge: true,
        };
    });

    const overviewGraph = {
        ...graph,
        nodes: overviewNodes,
        edges: overviewEdges,
        root_id: nodeIdMap[rootId] || overviewNodes[0]?.id || null,
        input_node_ids: (graph.input_node_ids || []).map((id) => nodeIdMap[id]).filter(Boolean),
        output_node_ids: (graph.output_node_ids || []).map((id) => nodeIdMap[id]).filter(Boolean),
        check_node_ids: (graph.check_node_ids || []).map((id) => nodeIdMap[id]).filter(Boolean),
        meta: {
            ...(graph.meta || {}),
            overview_mode: true,
            overview_original_nodes: nodes.length,
            overview_original_edges: edges.length,
            overview_group_count: overviewNodes.length,
            overview_edge_count: overviewEdges.length,
            overview_internal_edge_count: internalEdgeCount,
        },
    };

    return {
        graph: overviewGraph,
        nodeIdMap,
        summary: overviewGraph.meta,
    };
}
