/**
 * DependencyGraph.js - Componente de visualizacion de arbol de dependencias
 * 
 * Muestra un grafo interactivo de dependencias entre variables, funciones,
 * clases e imports usando D3.js para control total de la visualizacion.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import './DependencyGraph.css';
import {
    formatRuntimeValue,
    computeHierarchicalLayout,
    Legend,
    InfoPanel,
    TraceTable,
    SensitivityPanel,
    OptimizationPanel,
    D3DependencyGraph
} from './dependency-graph';
import { computeUpstreamPathHighlight } from './dependency-graph/highlightUtils';
import {
    getLargeGraphAutoSummary,
    shouldUseLargeGraphMode,
} from './dependency-graph/graphComplexity';
import { buildCollapsedGraphView } from './dependency-graph/collapsedGraph';
import { buildLargeGraphOverview } from './dependencyGraphOverview';

const EMPTY_COLLAPSED_NODE_MAP = Object.freeze({});
const PYTHON_BUILTIN_WARNING_NAMES = new Set([
    'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float',
    'format', 'int', 'len', 'list', 'map', 'max', 'min', 'object',
    'pow', 'print', 'property', 'range', 'round', 'set', 'sorted',
    'str', 'sum', 'super', 'tuple', 'zip'
]);

function normalizeDependencyWarning(warning) {
    if (typeof warning !== 'string') return null;
    const unresolvedPrefix = 'Dependencias no resueltas (top):';
    if (!warning.startsWith(unresolvedPrefix)) {
        return warning;
    }

    const reportableNames = warning
        .slice(unresolvedPrefix.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => !PYTHON_BUILTIN_WARNING_NAMES.has(name.split('.', 1)[0]));

    if (reportableNames.length === 0) {
        return null;
    }
    return `${unresolvedPrefix} ${reportableNames.join(', ')}`;
}

function normalizeDependencyWarnings(warnings) {
    const seen = new Set();
    return (Array.isArray(warnings) ? warnings : [])
        .map(normalizeDependencyWarning)
        .filter(Boolean)
        .filter((warning) => {
            if (seen.has(warning)) return false;
            seen.add(warning);
            return true;
        });
}

function buildOptionalAnalysisLocation(line, column) {
    const hasValidLine = Number.isInteger(line) && line > 0;
    if (!hasValidLine) {
        return {};
    }

    const location = { line };
    if (Number.isInteger(column) && column >= 0) {
        location.column = column;
    }

    return location;
}

function mapNodeToSelected(node) {
    if (!node) return null;
    return {
        id: node.id,
        data: {
            ...node,
            label: node.name,
            valuePreview: node.value_preview,
            runtimeValue: node.runtime_value,
            location: node.location,
            type: node.node_type,
        }
    };
}

function getCellKeyAndLabel(node) {
    const location = node?.location;
    if (!location) return { key: 'none', label: 'Sin celda' };
    if (Number.isInteger(location.cell_index)) {
        const key = typeof location.cell_id === 'string' && location.cell_id.trim().length > 0
            ? `id:${location.cell_id}`
            : `idx:${location.cell_index}`;
        return { key, label: `Celda ${location.cell_index + 1}` };
    }
    if (typeof location.cell_id === 'string' && location.cell_id.trim().length > 0) {
        return { key: `id:${location.cell_id}`, label: 'Celda del notebook' };
    }
    return { key: 'none', label: 'Sin celda' };
}

function estimateCycleMeta(graph) {
    if (!graph?.nodes?.length) {
        return { hasCycles: false, cycleNodeCount: 0 };
    }
    const nodes = graph.nodes;
    const edges = graph.edges || [];
    const inDegree = new Map(nodes.map(node => [node.id, 0]));
    const adjacency = new Map(nodes.map(node => [node.id, []]));

    edges.forEach((edge) => {
        if (!inDegree.has(edge.target)) return;
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        adjacency.get(edge.source).push(edge.target);
    });

    const queue = [];
    inDegree.forEach((deg, nodeId) => {
        if (deg === 0) queue.push(nodeId);
    });

    let processed = 0;
    while (queue.length > 0) {
        const nodeId = queue.shift();
        processed += 1;
        (adjacency.get(nodeId) || []).forEach((targetId) => {
            const next = (inDegree.get(targetId) || 0) - 1;
            inDegree.set(targetId, next);
            if (next === 0) queue.push(targetId);
        });
    }

    const cycleNodeCount = nodes.length - processed;
    return {
        hasCycles: cycleNodeCount > 0,
        cycleNodeCount: Math.max(0, cycleNodeCount),
    };
}

function computeShortestUndirectedPath(edges, startId, endId) {
    if (!startId || !endId || startId === endId) return startId === endId ? [startId] : [];
    const adjacency = new Map();
    edges.forEach((edge) => {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
        adjacency.get(edge.source).add(edge.target);
        adjacency.get(edge.target).add(edge.source);
    });
    if (!adjacency.has(startId) || !adjacency.has(endId)) return [];

    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === endId) break;
        (adjacency.get(current) || []).forEach((neighbor) => {
            if (visited.has(neighbor)) return;
            visited.add(neighbor);
            parent.set(neighbor, current);
            queue.push(neighbor);
        });
    }

    if (!visited.has(endId)) return [];
    const path = [endId];
    let current = endId;
    while (parent.has(current)) {
        current = parent.get(current);
        path.push(current);
    }
    return path.reverse();
}

function computeFocusNodeIds(graph, selectedNodeId, focusMode) {
    if (!graph?.nodes?.length || !selectedNodeId || focusMode === 'all' || focusMode === 'overview') return null;
    const edges = graph.edges || [];
    const focusIds = new Set([selectedNodeId]);

    if (focusMode === 'neighbors') {
        edges.forEach((edge) => {
            if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
                focusIds.add(edge.source);
                focusIds.add(edge.target);
            }
        });
        return focusIds;
    }

    if (focusMode === 'path') {
        const rootId = graph.root_id;
        if (!rootId) return focusIds;
        if (rootId === selectedNodeId) {
            edges.forEach((edge) => {
                if (edge.source === rootId || edge.target === rootId) {
                    focusIds.add(edge.source);
                    focusIds.add(edge.target);
                }
            });
            return focusIds;
        }
        const path = computeShortestUndirectedPath(edges, rootId, selectedNodeId);
        if (path.length > 0) {
            path.forEach((id) => focusIds.add(id));
        } else {
            focusIds.add(rootId);
        }
        return focusIds;
    }

    return null;
}

function computeImmediateNeighborhoodHighlight(nodes = [], edges = [], selectedNodeId = null) {
    if (!Array.isArray(nodes) || !selectedNodeId) {
        return { node_ids: [], edge_keys: [] };
    }

    const visibleNodeIds = new Set(nodes.map((node) => node?.id).filter(Boolean));
    if (!visibleNodeIds.has(selectedNodeId)) {
        return { node_ids: [], edge_keys: [] };
    }

    const highlightNodeIds = new Set([selectedNodeId]);
    const highlightEdgeKeys = new Set();
    (Array.isArray(edges) ? edges : []).forEach((edge) => {
        if (!edge?.source || !edge?.target) return;
        if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) return;
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;
        highlightNodeIds.add(edge.source);
        highlightNodeIds.add(edge.target);
        highlightEdgeKeys.add(`${edge.source}->${edge.target}`);
    });

    return {
        node_ids: Array.from(highlightNodeIds),
        edge_keys: Array.from(highlightEdgeKeys),
    };
}

function nodeMatchesSearch(node, searchValue) {
    if (!searchValue) return true;
    const search = searchValue.toLowerCase();
    const runtimeType = typeof node.runtime_value?.type === 'string' ? node.runtime_value.type : '';
    const fields = [
        node.name,
        node.scope_path,
        node.full_name,
        node.unit,
        node.category,
        runtimeType,
    ];
    return fields.some((value) => typeof value === 'string' && value.toLowerCase().includes(search));
}

function cloneGraphSnapshot(graph) {
    if (!graph) return null;
    return JSON.parse(JSON.stringify(graph));
}

function computeSccBundles(graph) {
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    const nodeIds = nodes.map((node) => node.id);
    if (nodeIds.length === 0) {
        return { bundles: [], memberToBundleId: {} };
    }

    const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
    edges.forEach((edge) => {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        adjacency.get(edge.source).push(edge.target);
    });

    let index = 0;
    const stack = [];
    const indexMap = new Map();
    const lowLinkMap = new Map();
    const onStack = new Set();
    const components = [];

    function strongConnect(nodeId) {
        indexMap.set(nodeId, index);
        lowLinkMap.set(nodeId, index);
        index += 1;
        stack.push(nodeId);
        onStack.add(nodeId);

        (adjacency.get(nodeId) || []).forEach((neighborId) => {
            if (!indexMap.has(neighborId)) {
                strongConnect(neighborId);
                lowLinkMap.set(nodeId, Math.min(lowLinkMap.get(nodeId), lowLinkMap.get(neighborId)));
            } else if (onStack.has(neighborId)) {
                lowLinkMap.set(nodeId, Math.min(lowLinkMap.get(nodeId), indexMap.get(neighborId)));
            }
        });

        if (lowLinkMap.get(nodeId) === indexMap.get(nodeId)) {
            const component = [];
            while (stack.length > 0) {
                const popped = stack.pop();
                onStack.delete(popped);
                component.push(popped);
                if (popped === nodeId) break;
            }
            components.push(component);
        }
    }

    nodeIds.forEach((nodeId) => {
        if (!indexMap.has(nodeId)) strongConnect(nodeId);
    });

    const bundles = [];
    const memberToBundleId = {};
    let bundleCounter = 0;

    components.forEach((component) => {
        const hasSelfLoop = component.length === 1
            ? edges.some((edge) => edge.source === component[0] && edge.target === component[0])
            : false;
        if (component.length <= 1 && !hasSelfLoop) return;

        bundleCounter += 1;
        const bundleId = `scc::${bundleCounter}`;
        const sortedMembers = [...component].sort();
        sortedMembers.forEach((memberId) => {
            memberToBundleId[memberId] = bundleId;
        });
        bundles.push({
            bundleId,
            index: bundleCounter,
            members: sortedMembers,
        });
    });

    return { bundles, memberToBundleId };
}

function buildSccViewGraph(graph, expandedBundleIds = new Set()) {
    if (!graph?.nodes?.length) return graph;

    const { bundles, memberToBundleId } = computeSccBundles(graph);
    if (bundles.length === 0) {
        return {
            ...graph,
            meta: {
                ...(graph.meta || {}),
                scc_view_enabled: false,
                scc_view_bundle_count: 0,
                scc_member_to_super: {},
            },
        };
    }

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const superNodeById = new Map();
    const collapsedMemberIds = new Set();

    bundles.forEach((bundle) => {
        if (expandedBundleIds.has(bundle.bundleId)) return;
        const memberNodes = bundle.members
            .map((memberId) => nodeById.get(memberId))
            .filter(Boolean);
        memberNodes.forEach((node) => collapsedMemberIds.add(node.id));
        const primaryNode = memberNodes[0];
        const memberNames = memberNodes.map((node) => node.name || node.id).slice(0, 4).join(', ');
        const sccNode = {
            id: bundle.bundleId,
            name: `cycle_${bundle.index}`,
            type: 'unknown',
            node_type: 'unknown',
            scope_path: `SCC.${bundle.index}`,
            full_name: `SCC.${bundle.index}`,
            is_cycle_supernode: true,
            scc_members: bundle.members,
            scc_size: bundle.members.length,
            internal_edge_count: 0,
            value_preview: memberNames,
            description: `Ciclo de ${bundle.members.length} nodos`,
            location: primaryNode?.location || null,
            parent_id: null,
            children_ids: [],
            is_container: false,
            container_type: null,
            category: 'cycle',
        };
        superNodeById.set(bundle.bundleId, sccNode);
    });

    function mapNodeId(nodeId) {
        const bundleId = memberToBundleId[nodeId];
        if (!bundleId) return nodeId;
        if (expandedBundleIds.has(bundleId)) return nodeId;
        return bundleId;
    }

    const visibleNodes = graph.nodes.filter((node) => !collapsedMemberIds.has(node.id));
    superNodeById.forEach((sccNode) => visibleNodes.push(sccNode));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

    const edgeMap = new Map();
    (graph.edges || []).forEach((edge, edgeIndex) => {
        const mappedSource = mapNodeId(edge.source);
        const mappedTarget = mapNodeId(edge.target);
        if (!visibleNodeIds.has(mappedSource) || !visibleNodeIds.has(mappedTarget)) return;

        if (mappedSource === mappedTarget) {
            if (superNodeById.has(mappedSource)) {
                const node = superNodeById.get(mappedSource);
                node.internal_edge_count = (node.internal_edge_count || 0) + 1;
            }
            return;
        }

        const relation = typeof edge.relation === 'string' ? edge.relation : null;
        const key = `${mappedSource}->${mappedTarget}`;
        const originalPair = {
            source: edge.source,
            target: edge.target,
            relation,
            index: edgeIndex,
        };

        if (!edgeMap.has(key)) {
            edgeMap.set(key, {
                ...edge,
                source: mappedSource,
                target: mappedTarget,
                aggregated_count: 1,
                original_pairs: [originalPair],
                relations: relation ? [relation] : [],
                relation: relation || null,
            });
            return;
        }

        const existing = edgeMap.get(key);
        existing.aggregated_count += 1;
        existing.original_pairs.push(originalPair);
        if (relation && !existing.relations.includes(relation)) {
            existing.relations.push(relation);
        }
        if (existing.relations.length > 1) {
            existing.relation = 'mixed';
        } else if (existing.relations.length === 1) {
            existing.relation = existing.relations[0];
        }
    });

    const mapNodeIdList = (ids = []) => {
        const mapped = ids.map((id) => mapNodeId(id));
        return Array.from(new Set(mapped.filter((id) => visibleNodeIds.has(id))));
    };

    const bundleToMembers = {};
    bundles.forEach((bundle) => {
        bundleToMembers[bundle.bundleId] = bundle.members;
    });

    return {
        ...graph,
        root_id: mapNodeId(graph.root_id),
        nodes: visibleNodes,
        edges: Array.from(edgeMap.values()),
        input_node_ids: mapNodeIdList(graph.input_node_ids),
        output_node_ids: mapNodeIdList(graph.output_node_ids),
        check_node_ids: mapNodeIdList(graph.check_node_ids),
        meta: {
            ...(graph.meta || {}),
            scc_view_enabled: true,
            scc_view_bundle_count: bundles.length,
            scc_member_to_super: memberToBundleId,
            scc_super_to_members: bundleToMembers,
        },
    };
}

function compareRawGraphs(currentGraph, baselineGraph) {
    if (!currentGraph?.nodes || !baselineGraph?.nodes) return null;

    const currentNodeIds = new Set(currentGraph.nodes.map((node) => node.id));
    const baselineNodeIds = new Set(baselineGraph.nodes.map((node) => node.id));
    const addedNodeIds = new Set([...currentNodeIds].filter((nodeId) => !baselineNodeIds.has(nodeId)));
    const removedNodeIds = new Set([...baselineNodeIds].filter((nodeId) => !currentNodeIds.has(nodeId)));

    const currentEdgeKeys = new Set((currentGraph.edges || []).map((edge) => `${edge.source}->${edge.target}`));
    const baselineEdgeKeys = new Set((baselineGraph.edges || []).map((edge) => `${edge.source}->${edge.target}`));
    const addedEdgeKeys = new Set([...currentEdgeKeys].filter((edgeKey) => !baselineEdgeKeys.has(edgeKey)));
    const removedEdgeKeys = new Set([...baselineEdgeKeys].filter((edgeKey) => !currentEdgeKeys.has(edgeKey)));

    return {
        addedNodeIds,
        removedNodeIds,
        addedEdgeKeys,
        removedEdgeKeys,
        nodesAdded: addedNodeIds.size,
        nodesRemoved: removedNodeIds.size,
        edgesAdded: addedEdgeKeys.size,
        edgesRemoved: removedEdgeKeys.size,
    };
}

function annotateGraphWithComparison(displayGraph, rawDelta, baselineGraph) {
    if (!displayGraph || !rawDelta || !baselineGraph) return { graph: displayGraph, summary: null };

    const baselineNodeNameById = new Map((baselineGraph.nodes || []).map((node) => [node.id, node.name || node.id]));
    const baselineEdgeSet = rawDelta.addedEdgeKeys;

    const nodes = (displayGraph.nodes || []).map((node) => {
        if (node.is_cycle_supernode && Array.isArray(node.scc_members)) {
            const addedCount = node.scc_members.filter((memberId) => rawDelta.addedNodeIds.has(memberId)).length;
            let abStatus = 'unchanged';
            if (addedCount === node.scc_members.length && addedCount > 0) abStatus = 'added';
            else if (addedCount > 0) abStatus = 'mixed';
            return { ...node, ab_status: abStatus };
        }
        return {
            ...node,
            ab_status: rawDelta.addedNodeIds.has(node.id) ? 'added' : 'unchanged',
        };
    });

    const edges = (displayGraph.edges || []).map((edge) => {
        const originalPairs = Array.isArray(edge.original_pairs) ? edge.original_pairs : [];
        if (originalPairs.length > 0) {
            const addedCount = originalPairs.filter((pair) => baselineEdgeSet.has(`${pair.source}->${pair.target}`)).length;
            let abStatus = 'unchanged';
            if (addedCount === originalPairs.length && addedCount > 0) abStatus = 'added';
            else if (addedCount > 0) abStatus = 'mixed';
            return { ...edge, ab_status: abStatus };
        }
        const edgeKey = `${edge.source}->${edge.target}`;
        return { ...edge, ab_status: baselineEdgeSet.has(edgeKey) ? 'added' : 'unchanged' };
    });

    const removedNodeNames = [...rawDelta.removedNodeIds]
        .map((nodeId) => baselineNodeNameById.get(nodeId) || nodeId)
        .slice(0, 12);

    const summary = {
        nodesAdded: rawDelta.nodesAdded,
        nodesRemoved: rawDelta.nodesRemoved,
        edgesAdded: rawDelta.edgesAdded,
        edgesRemoved: rawDelta.edgesRemoved,
        removedNodeNames,
    };

    return {
        graph: {
            ...displayGraph,
            nodes,
            edges,
            meta: {
                ...(displayGraph.meta || {}),
                comparison_enabled: true,
                comparison_summary: summary,
            },
        },
        summary,
    };
}


// =============================================================================
// Componente principal
// =============================================================================

function DependencyGraph({
    symbol,
    sourceCode,
    line,
    column,
    notebookContext,
    filePath,
    kernelId = null, // ID del kernel para obtener valores de runtime
    cellId, // ID de la celda actual
    contextCellIds, // IDs de celdas de contexto
    mode = 'dependencies', // 'dependencies' o 'impact'
    sendMessage,
    lastMessage, // Nuevo prop: mensaje WebSocket recibido desde el padre
    onClose,
    onNavigateToCode = null, // Callback para navegar al codigo: ({ cellIndex, line, column, symbol }) => void
    layout = 'modal', // 'modal', 'lateral', o 'embedded' (integrado en contenedor padre)
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [graphData, setGraphData] = useState(null);
    const [showTrace, setShowTrace] = useState(false);
    const [showSensitivity, setShowSensitivity] = useState(false);
    const [showOptimization, setShowOptimization] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showEdgeEvidence, setShowEdgeEvidence] = useState(false);
    const [cycleViewMode, setCycleViewMode] = useState('normal'); // normal | scc
    const [expandedCycleIds, setExpandedCycleIds] = useState(new Set());
    const [maxDepth, setMaxDepth] = useState(10);
    const [searchText, setSearchText] = useState('');
    const [searchFilterActive, setSearchFilterActive] = useState(false);
    const [nodeTypeFilter, setNodeTypeFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [cellFilter, setCellFilter] = useState('all');
    const [focusMode, setFocusMode] = useState('all'); // overview | all | neighbors | path
    const [largeGraphAuto, setLargeGraphAuto] = useState(true);
    const [largeGraphManual, setLargeGraphManual] = useState(false);
    const [showMiniMap, setShowMiniMap] = useState(false);
    const [showLegend, setShowLegend] = useState(null);
    const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
    const [collapsedNodeIds, setCollapsedNodeIds] = useState(new Set());
    const [focusNodeRequest, setFocusNodeRequest] = useState({ nodeId: null, seq: 0 });
    const [baselineGraphSnapshot, setBaselineGraphSnapshot] = useState(null);
    const [showComparisonMode, setShowComparisonMode] = useState(false);
    const [resetViewSignal, setResetViewSignal] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const analysisRequestRef = useRef({ requestId: null, resultType: null, errorType: null });
    const autoSelectionRef = useRef(false);
    const autoSelectedGraphKeyRef = useRef(null);
    const requestSeqRef = useRef(0);
    const moreMenuRef = useRef(null);
    const moreMenuButtonRef = useRef(null);
    const panelRef = useRef(null);
    const [panelMetrics, setPanelMetrics] = useState({ width: 0, height: 0 });
    const [moreMenuStyle, setMoreMenuStyle] = useState({ top: 0, left: 0, width: 280 });
    const [shellChromeOffset, setShellChromeOffset] = useState(0);
    const [analysisMeta, setAnalysisMeta] = useState({
        requestId: null,
        startedAt: null,
        completedAt: null,
        ignoredMessages: 0,
    });

    // Sincronizar estado de fullscreen con el body para selectores CSS globales
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const body = document.body;
        const docEl = document.documentElement;
        if (!body) return undefined;

        if (!isFullscreen) {
            body.classList.remove('dependency-graph-fullscreen-active');
            return undefined;
        }

        const previousBodyOverflow = body.style.overflow;
        const previousDocOverflow = docEl?.style?.overflow || '';
        if (isFullscreen) {
            body.classList.add('dependency-graph-fullscreen-active');
            body.style.overflow = 'hidden';
            if (docEl) docEl.style.overflow = 'hidden';
        }
        return () => {
            body.classList.remove('dependency-graph-fullscreen-active');
            body.style.overflow = previousBodyOverflow;
            if (docEl) docEl.style.overflow = previousDocOverflow;
        };
    }, [isFullscreen]);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        document.body.style.setProperty('--dependency-graph-shell-offset', `${shellChromeOffset}px`);
        return () => {
            document.body.style.removeProperty('--dependency-graph-shell-offset');
        };
    }, [shellChromeOffset]);

    useEffect(() => {
        if (!panelRef.current || typeof ResizeObserver === 'undefined') return undefined;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            setPanelMetrics({
                width: entry.contentRect.width,
                height: entry.contentRect.height,
            });
        });

        observer.observe(panelRef.current);
        return () => observer.disconnect();
    }, [loading, graphData]);

    useEffect(() => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;

        const titlebar = document.querySelector('.desktop-titlebar');
        const updateShellChromeOffset = () => {
            const titlebarRect = titlebar?.getBoundingClientRect();
            const nextOffset = titlebar
                ? Math.ceil(Math.max(titlebarRect.height, titlebarRect.bottom))
                : 0;
            setShellChromeOffset((prev) => (prev === nextOffset ? prev : nextOffset));
        };

        updateShellChromeOffset();

        let titlebarObserver;
        if (titlebar && typeof ResizeObserver !== 'undefined') {
            titlebarObserver = new ResizeObserver(() => updateShellChromeOffset());
            titlebarObserver.observe(titlebar);
        }

        window.addEventListener('resize', updateShellChromeOffset);

        return () => {
            window.removeEventListener('resize', updateShellChromeOffset);
            titlebarObserver?.disconnect();
        };
    }, []);

    const updateMoreMenuPosition = useCallback(() => {
        if (!moreMenuButtonRef.current || typeof window === 'undefined') return;
        const rect = moreMenuButtonRef.current.getBoundingClientRect();
        const menuWidth = Math.min(320, Math.max(240, Math.floor(window.innerWidth * 0.28)));
        const left = Math.min(
            window.innerWidth - menuWidth - 12,
            Math.max(12, rect.right - menuWidth),
        );
        const top = Math.min(window.innerHeight - 12, rect.bottom + 8);
        setMoreMenuStyle({ top, left, width: menuWidth });
    }, []);

    useEffect(() => {
        if (!showMoreMenu) return undefined;
        updateMoreMenuPosition();

        const handleReposition = () => updateMoreMenuPosition();
        window.addEventListener('resize', handleReposition);
        window.addEventListener('scroll', handleReposition, true);

        return () => {
            window.removeEventListener('resize', handleReposition);
            window.removeEventListener('scroll', handleReposition, true);
        };
    }, [showMoreMenu, updateMoreMenuPosition]);

    useEffect(() => {
        const onDocumentMouseDown = (event) => {
            const target = event.target;
            if (moreMenuRef.current?.contains(target) || moreMenuButtonRef.current?.contains(target)) {
                return;
            }
            if (showMoreMenu) {
                setShowMoreMenu(false);
            }
        };
        document.addEventListener('mousedown', onDocumentMouseDown);
        return () => document.removeEventListener('mousedown', onDocumentMouseDown);
    }, [showMoreMenu]);

    useEffect(() => {
        if (!baselineGraphSnapshot && showComparisonMode) {
            setShowComparisonMode(false);
        }
    }, [baselineGraphSnapshot, showComparisonMode]);

    useEffect(() => {
        if (!selectedNode?.id) {
            return;
        }
        if (autoSelectionRef.current) {
            setInspectorCollapsed(true);
            return;
        }
        setInspectorCollapsed(false);
    }, [selectedNode?.id]);

    // Solicitar analisis al backend
    useEffect(() => {
        if (!symbol || !sendMessage) return;

        setLoading(true);
        setError(null);
        setSelectedNode(null);
        autoSelectionRef.current = false;
        autoSelectedGraphKeyRef.current = null;
        setShowMoreMenu(false);
        setExpandedCycleIds(new Set());
        setFocusNodeRequest({ nodeId: null, seq: 0 });
        setCollapsedNodeIds(new Set());
        setSearchFilterActive(false);

        const messageType = mode === 'impact' ? 'analyze_impact' : 'analyze_dependencies';
        const requestId = `dep_${Date.now()}_${++requestSeqRef.current}`;
        analysisRequestRef.current = {
            requestId,
            resultType: mode === 'impact' ? 'impact_analysis_result' : 'dependency_analysis_result',
            errorType: mode === 'impact' ? 'impact_analysis_error' : 'dependency_analysis_error',
        };
        setAnalysisMeta({
            requestId,
            startedAt: Date.now(),
            completedAt: null,
            ignoredMessages: 0,
        });
        const optionalLocation = buildOptionalAnalysisLocation(line, column);

        sendMessage({
            type: messageType,
            request_id: requestId,
            symbol: symbol,
            source_code: sourceCode || '',
            ...optionalLocation,
            notebook_context: notebookContext,
            context_cell_ids: contextCellIds, // Needed so backend can disambiguate notebook cell context
            file_path: filePath || '',
            kernel_id: kernelId,  // Para obtener valores de runtime
            max_depth: maxDepth,
            cell_id: cellId, // Pass current cell ID too
        });
    }, [symbol, sourceCode, line, column, notebookContext, contextCellIds, filePath, kernelId, cellId, mode, sendMessage, maxDepth]);

    // Handler para recibir resultados
    const handleAnalysisResult = useCallback((result) => {
        setLoading(false);

        if (result.error) {
            setError(result.error);
            return;
        }

        if (result.graph) {
            setGraphData(result.graph);
            setSelectedNode(null);
        }
    }, []);

    // Manejar mensajes entrantes via prop (lastMessage)
    useEffect(() => {
        if (!lastMessage) return;
        const pending = analysisRequestRef.current;
        if (!pending.requestId) return;

        if (lastMessage.request_id && lastMessage.request_id !== pending.requestId) {
            setAnalysisMeta((prev) => (
                prev.requestId === pending.requestId
                    ? { ...prev, ignoredMessages: prev.ignoredMessages + 1 }
                    : prev
            ));
            return;
        }

        // Fallback defensivo para payloads legacy sin request_id
        if (!lastMessage.request_id && lastMessage.symbol && lastMessage.symbol !== symbol) {
            setAnalysisMeta((prev) => (
                prev.requestId === pending.requestId
                    ? { ...prev, ignoredMessages: prev.ignoredMessages + 1 }
                    : prev
            ));
            return;
        }

        if (lastMessage.type === pending.resultType) {
            analysisRequestRef.current.requestId = null;
            setAnalysisMeta((prev) => ({ ...prev, completedAt: Date.now() }));
            handleAnalysisResult({ graph: lastMessage.graph });
        } else if (lastMessage.type === pending.errorType) {
            analysisRequestRef.current.requestId = null;
            setAnalysisMeta((prev) => ({ ...prev, completedAt: Date.now() }));
            handleAnalysisResult({ error: lastMessage.error });
        }
    }, [lastMessage, symbol, handleAnalysisResult]);

    useEffect(() => {
        if (!graphData?.nodes?.length || !graphData.root_id || !shouldUseLargeGraphMode(graphData)) {
            return;
        }

        const graphKey = [
            analysisMeta.requestId || '',
            graphData.root_id,
            graphData.nodes.length,
            graphData.edges?.length || 0,
        ].join('|');
        if (autoSelectedGraphKeyRef.current === graphKey) {
            return;
        }

        const rootNode = graphData.nodes.find((node) => node.id === graphData.root_id);
        if (!rootNode) {
            return;
        }

        autoSelectionRef.current = true;
        autoSelectedGraphKeyRef.current = graphKey;
        setSelectedNode(mapNodeToSelected(rootNode));
        setFocusMode((prev) => (prev === 'all' ? 'overview' : prev));
        setInspectorCollapsed(true);
    }, [analysisMeta.requestId, graphData]);

    const diagnostics = useMemo(() => {
        const nodesCount = graphData?.nodes?.length || 0;
        const edgesCount = graphData?.edges?.length || 0;
        const warnings = normalizeDependencyWarnings(graphData?.warnings || []);
        const parseErrors = Array.isArray(graphData?.parse_errors) ? graphData.parse_errors : [];
        const outputs = graphData?.output_node_ids?.length || 0;
        const inputs = graphData?.input_node_ids?.length || 0;
        const checks = graphData?.check_node_ids?.length || 0;
        const started = analysisMeta.startedAt;
        const finished = analysisMeta.completedAt || (loading ? null : Date.now());
        const durationMs = (started && finished && finished >= started) ? (finished - started) : null;
        const cycleMeta = estimateCycleMeta(graphData);
        const runtimeEnriched = Boolean(graphData?.runtime_enriched || graphData?.meta?.runtime_enriched);
        const declaredScc = Number.isFinite(graphData?.meta?.scc_count) ? graphData.meta.scc_count : null;

        return {
            nodesCount,
            edgesCount,
            warnings,
            parseErrors,
            outputs,
            inputs,
            checks,
            durationMs,
            analysisComplete: graphData?.analysis_complete !== false,
            runtimeEnriched,
            hasCycles: Boolean(graphData?.meta?.has_cycles ?? cycleMeta.hasCycles),
            sccCount: declaredScc,
            cycleNodeCount: cycleMeta.cycleNodeCount,
        };
    }, [graphData, analysisMeta.startedAt, analysisMeta.completedAt, loading]);

    const navigateToNodeLocation = useCallback((nodeLike) => {
        const data = nodeLike?.data || nodeLike;
        const location = data?.location;
        const name = data?.name || data?.label || symbol;
        if (!location || !onNavigateToCode) return;
        const hasLine = Number(location.line) > 0;
        const hasCellIndex = Number.isInteger(location.cell_index);
        const hasCellId = typeof location.cell_id === 'string' && location.cell_id.trim().length > 0;
        const hasFilePath = typeof location.file === 'string' && location.file.trim().length > 0;
        if (hasLine || hasCellIndex || hasCellId || hasFilePath) {
            onNavigateToCode({
                filePath: hasFilePath ? location.file : null,
                cellId: hasCellId ? location.cell_id : null,
                cellIndex: location.cell_index,
                line: location.line,
                column: location.column || 0,
                symbol: name
            });
        }
    }, [onNavigateToCode, symbol]);

    const selectNodeById = useCallback((nodeId, explicitNode = null) => {
        autoSelectionRef.current = false;
        if (explicitNode) {
            setInspectorCollapsed(false);
            setSelectedNode(mapNodeToSelected(explicitNode.data || explicitNode));
            return;
        }
        if (!nodeId || !graphData?.nodes) return;
        const node = graphData.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        setInspectorCollapsed(false);
        setSelectedNode(mapNodeToSelected(node));
    }, [graphData]);

    // Manejar seleccion de nodo (adaptado para D3)
    const handleNodeClick = useCallback((node) => {
        autoSelectionRef.current = false;
        setInspectorCollapsed(false);
        setSelectedNode(mapNodeToSelected(node.data || node));
    }, []);

    // Manejar doble-clic en nodo para navegar al codigo
    const handleNodeDoubleClick = useCallback((node) => {
        navigateToNodeLocation(node);
    }, [navigateToNodeLocation]);

    // Manejar clic en el fondo
    const handleBackgroundClick = useCallback(() => {
        autoSelectionRef.current = false;
        setSelectedNode(null);
    }, []);

    // Manejar tecla Escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key !== 'Escape') return;

            const target = e.target;
            const isEditableTarget = target instanceof HTMLElement && (
                target.isContentEditable
                || ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase())
                || Boolean(target.closest('[contenteditable="true"]'))
            );
            if (isEditableTarget) return;

            e.preventDefault();
            if (isFullscreen) {
                setIsFullscreen(false);
                return;
            }
            onClose?.();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen, onClose]);

    // Preparar nodos para TraceTable con orden topologico (Kahn's algorithm)
    const traceNodes = useMemo(() => {
        if (!graphData?.nodes) return [];
        const nodeMap = {};
        graphData.nodes.forEach(n => { nodeMap[n.id] = n; });

        // Build adjacency and in-degree
        const inDegree = {};
        const adj = {};
        graphData.nodes.forEach(n => { inDegree[n.id] = 0; adj[n.id] = []; });
        (graphData.edges || []).forEach(e => {
            adj[e.source] = adj[e.source] || [];
            adj[e.source].push(e.target);
            inDegree[e.target] = (inDegree[e.target] || 0) + 1;
        });

        // Kahn's topological sort
        const queue = Object.keys(inDegree).filter(id => inDegree[id] === 0);
        const sorted = [];
        while (queue.length > 0) {
            const id = queue.shift();
            sorted.push(id);
            (adj[id] || []).forEach(neighbor => {
                inDegree[neighbor]--;
                if (inDegree[neighbor] === 0) queue.push(neighbor);
            });
        }
        // Append any remaining nodes (cycles) that weren't sorted
        graphData.nodes.forEach(n => {
            if (!sorted.includes(n.id)) sorted.push(n.id);
        });

        return sorted.map(id => nodeMap[id]).filter(Boolean).map(node => ({
            id: node.id,
            data: {
                label: node.name,
                valuePreview: node.value_preview,
                runtimeValue: node.runtime_value,
                type: node.node_type,
                unit: node.unit,
                description: node.description,
                category: node.category,
                isCheck: node.is_check,
            }
        }));
    }, [graphData]);

    const cycleViewGraphData = useMemo(() => {
        if (!graphData?.nodes?.length) return graphData;
        if (cycleViewMode !== 'scc') {
            return {
                ...graphData,
                meta: {
                    ...(graphData.meta || {}),
                    scc_view_enabled: false,
                    scc_view_bundle_count: 0,
                    scc_member_to_super: {},
                },
            };
        }
        return buildSccViewGraph(graphData, expandedCycleIds);
    }, [graphData, cycleViewMode, expandedCycleIds]);

    useEffect(() => {
        if (!selectedNode?.id || !cycleViewGraphData?.nodes) return;
        if (selectedNode?.data?.is_overview_node || String(selectedNode.id).startsWith('overview::')) return;
        const visibleIds = new Set(cycleViewGraphData.nodes.map((node) => node.id));
        if (visibleIds.has(selectedNode.id)) return;
        const memberToSuper = cycleViewGraphData.meta?.scc_member_to_super || {};
        const mappedId = memberToSuper[selectedNode.id];
        if (!mappedId || !visibleIds.has(mappedId)) {
            setSelectedNode(null);
            return;
        }
        const mappedNode = cycleViewGraphData.nodes.find((node) => node.id === mappedId);
        if (mappedNode) {
            setSelectedNode(mapNodeToSelected(mappedNode));
        }
    }, [cycleViewGraphData, selectedNode?.data?.is_overview_node, selectedNode?.id]);

    const rawComparisonDelta = useMemo(() => (
        compareRawGraphs(graphData, baselineGraphSnapshot)
    ), [graphData, baselineGraphSnapshot]);

    const availableNodeTypes = useMemo(() => {
        if (!cycleViewGraphData?.nodes) return [];
        return Array.from(new Set(cycleViewGraphData.nodes
            .map((node) => node.node_type || node.type)
            .filter(Boolean)))
            .sort();
    }, [cycleViewGraphData]);

    const availableCategories = useMemo(() => {
        if (!cycleViewGraphData?.nodes) return [];
        return Array.from(new Set(cycleViewGraphData.nodes
            .map((node) => node.category)
            .filter((category) => typeof category === 'string' && category.trim().length > 0)))
            .sort();
    }, [cycleViewGraphData]);

    const availableCells = useMemo(() => {
        if (!cycleViewGraphData?.nodes) return [];
        const seen = new Set();
        const cells = [];
        cycleViewGraphData.nodes.forEach((node) => {
            const { key, label } = getCellKeyAndLabel(node);
            if (seen.has(key)) return;
            seen.add(key);
            cells.push({ key, label });
        });
        return cells.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }, [cycleViewGraphData]);

    const searchMatches = useMemo(() => {
        const q = searchText.trim().toLowerCase();
        if (!q || !cycleViewGraphData?.nodes) return [];
        return cycleViewGraphData.nodes
            .filter((node) => nodeMatchesSearch(node, q))
            .slice(0, 12);
    }, [cycleViewGraphData, searchText]);

    useEffect(() => {
        const query = searchText.trim();
        const firstMatch = searchMatches[0];
        if (!query || searchFilterActive || !firstMatch) return;
        autoSelectionRef.current = true;
        setSelectedNode(mapNodeToSelected(firstMatch));
        setFocusNodeRequest({ nodeId: firstMatch.id, seq: Date.now() });
    }, [searchFilterActive, searchMatches, searchText]);

    const filteredGraphData = useMemo(() => {
        if (!cycleViewGraphData?.nodes?.length) return cycleViewGraphData;

        const search = searchFilterActive ? searchText.trim().toLowerCase() : '';
        const hasSearchFilter = search.length > 0;
        const hasNodeFilters = nodeTypeFilter !== 'all' || categoryFilter !== 'all' || cellFilter !== 'all' || hasSearchFilter;
        const focusIds = computeFocusNodeIds(cycleViewGraphData, selectedNode?.id, focusMode);
        const hasFocusFilter = focusMode !== 'all' && focusIds instanceof Set;

        if (!hasNodeFilters && !hasFocusFilter) {
            return cycleViewGraphData;
        }

        const nodeById = new Map(cycleViewGraphData.nodes.map((node) => [node.id, node]));
        let keptNodeIds = new Set();

        cycleViewGraphData.nodes.forEach((node) => {
            const nodeType = node.node_type || node.type || 'unknown';
            const nodeCategory = node.category || null;
            const nodeCell = getCellKeyAndLabel(node).key;
            if (nodeTypeFilter !== 'all' && nodeType !== nodeTypeFilter) return;
            if (categoryFilter !== 'all' && nodeCategory !== categoryFilter) return;
            if (cellFilter !== 'all' && nodeCell !== cellFilter) return;
            if (hasSearchFilter && !nodeMatchesSearch(node, search)) return;
            keptNodeIds.add(node.id);
        });

        if (hasFocusFilter) {
            if (keptNodeIds.size === 0 && hasNodeFilters) {
                // Nada coincide, mantenemos vacío para que el usuario lo note.
            } else if (keptNodeIds.size === 0 && !hasNodeFilters) {
                keptNodeIds = new Set(focusIds);
            } else if (hasSearchFilter) {
                const intersected = new Set(Array.from(keptNodeIds).filter((id) => focusIds.has(id)));
                keptNodeIds = intersected.size > 0
                    ? intersected
                    : new Set([...keptNodeIds, ...focusIds]);
            } else {
                keptNodeIds = new Set(Array.from(keptNodeIds).filter((id) => focusIds.has(id)));
            }
        }

        if (hasNodeFilters && keptNodeIds.size === 0) {
            return {
                ...cycleViewGraphData,
                nodes: [],
                edges: [],
            };
        }

        if (selectedNode?.id) keptNodeIds.add(selectedNode.id);
        if (cycleViewGraphData.root_id) keptNodeIds.add(cycleViewGraphData.root_id);

        const pending = Array.from(keptNodeIds);
        while (pending.length > 0) {
            const nodeId = pending.pop();
            const parentId = nodeById.get(nodeId)?.parent_id;
            if (!parentId || keptNodeIds.has(parentId) || !nodeById.has(parentId)) continue;
            keptNodeIds.add(parentId);
            pending.push(parentId);
        }

        const filteredNodes = cycleViewGraphData.nodes.filter((node) => keptNodeIds.has(node.id));
        const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
        const filteredEdges = (cycleViewGraphData.edges || []).filter((edge) => (
            filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
        ));

        return {
            ...cycleViewGraphData,
            nodes: filteredNodes,
            edges: filteredEdges,
        };
    }, [cycleViewGraphData, nodeTypeFilter, categoryFilter, cellFilter, searchText, searchFilterActive, focusMode, selectedNode?.id]);

    const comparisonView = useMemo(() => {
        if (!showComparisonMode) return { graph: filteredGraphData, summary: null };
        return annotateGraphWithComparison(filteredGraphData, rawComparisonDelta, baselineGraphSnapshot);
    }, [filteredGraphData, showComparisonMode, rawComparisonDelta, baselineGraphSnapshot]);

    const baseRenderGraphData = comparisonView.graph || filteredGraphData;
    const overviewGraphView = useMemo(() => {
        if (focusMode !== 'overview' || !baseRenderGraphData?.nodes?.length) {
            return { graph: null, nodeIdMap: EMPTY_COLLAPSED_NODE_MAP, summary: null };
        }
        if (!shouldUseLargeGraphMode(graphData) && !shouldUseLargeGraphMode(baseRenderGraphData)) {
            return { graph: null, nodeIdMap: EMPTY_COLLAPSED_NODE_MAP, summary: null };
        }
        return buildLargeGraphOverview(baseRenderGraphData);
    }, [baseRenderGraphData, focusMode, graphData]);
    const renderGraphData = overviewGraphView.graph || baseRenderGraphData;
    const overviewNodeMap = overviewGraphView.nodeIdMap || EMPTY_COLLAPSED_NODE_MAP;
    const collapsedGraphView = useMemo(() => (
        buildCollapsedGraphView(renderGraphData, collapsedNodeIds)
    ), [renderGraphData, collapsedNodeIds]);
    const renderVisibleGraphData = collapsedGraphView.graph || renderGraphData;
    const collapsedNodeMap = collapsedGraphView.nodeIdMap || EMPTY_COLLAPSED_NODE_MAP;
    const comparisonSummary = comparisonView.summary;

    const hasActiveFilters = useMemo(() => (
        nodeTypeFilter !== 'all' ||
        categoryFilter !== 'all' ||
        cellFilter !== 'all' ||
        focusMode !== 'all' ||
        (searchFilterActive && searchText.trim().length > 0)
    ), [nodeTypeFilter, categoryFilter, cellFilter, focusMode, searchText, searchFilterActive]);

    const effectiveLargeGraphMode = useMemo(() => {
        if (largeGraphAuto) return shouldUseLargeGraphMode(renderVisibleGraphData);
        return largeGraphManual;
    }, [renderVisibleGraphData, largeGraphAuto, largeGraphManual]);

    const clearFilters = useCallback(() => {
        setSearchText('');
        setNodeTypeFilter('all');
        setCategoryFilter('all');
        setCellFilter('all');
        setFocusMode('all');
        setSearchFilterActive(false);
    }, []);

    const setFocusModeFromStrip = useCallback((nextMode) => {
        if (nextMode !== 'all' && nextMode !== 'overview' && !selectedNode?.id) {
            return;
        }
        setFocusMode(nextMode);
    }, [selectedNode?.id]);

    const handleIncreaseDepth = useCallback(() => {
        setMaxDepth((prev) => {
            if (prev < 5) return 5;
            if (prev < 10) return 10;
            if (prev < 20) return 20;
            return prev;
        });
    }, []);

    const filteredNodesCount = renderVisibleGraphData?.nodes?.length || 0;
    const filteredEdgesCount = renderVisibleGraphData?.edges?.length || 0;
    const sourceLargeGraphActive = shouldUseLargeGraphMode(graphData);
    const autoLargeGraphActive = shouldUseLargeGraphMode(renderVisibleGraphData);
    const displayLargeGraphActive = sourceLargeGraphActive || effectiveLargeGraphMode;
    const nodesHeaderText = filteredNodesCount === diagnostics.nodesCount
        ? `${filteredNodesCount} nodos`
        : `${filteredNodesCount} / ${diagnostics.nodesCount} nodos`;
    const edgesHeaderText = filteredEdgesCount === diagnostics.edgesCount
        ? `${filteredEdgesCount} aristas`
        : `${filteredEdgesCount} / ${diagnostics.edgesCount} aristas`;
    const searchQuery = searchText.trim();
    const searchFilterApplied = searchFilterActive && searchQuery.length > 0;
    const qualityWarnings = diagnostics.warnings;
    const hasPartialAnalysis = Boolean(graphData && graphData.analysis_complete === false);

    const sccBundleCount = Number(cycleViewGraphData?.meta?.scc_view_bundle_count || 0);
    const sccBundleIds = useMemo(() => (
        Object.keys(cycleViewGraphData?.meta?.scc_super_to_members || {})
    ), [cycleViewGraphData]);
    const selectedSccId = selectedNode?.id?.startsWith('scc::') ? selectedNode.id : null;
    const selectedNodeBaseMappedId = selectedNode?.id
        ? (overviewNodeMap[selectedNode.id] || selectedNode.id)
        : null;
    const selectedNodeMappedId = selectedNodeBaseMappedId
        ? (collapsedNodeMap[selectedNodeBaseMappedId] || selectedNodeBaseMappedId)
        : null;

    const miniMapLayout = useMemo(() => {
        if (!showMiniMap || !renderVisibleGraphData?.nodes?.length) return null;
        try {
            return computeHierarchicalLayout(renderVisibleGraphData, {});
        } catch (_error) {
            return null;
        }
    }, [showMiniMap, renderVisibleGraphData]);

    const miniMapViewBox = useMemo(() => {
        if (!miniMapLayout?.bounds) return null;
        const width = Math.max(miniMapLayout.bounds.width, 10);
        const height = Math.max(miniMapLayout.bounds.height, 10);
        return {
            width,
            height,
            nodeRects: miniMapLayout.nodes.filter((node) => !node.isContainer),
        };
    }, [miniMapLayout]);

    const selectedNodeInRenderGraph = useMemo(() => {
        if (!selectedNodeMappedId || !renderVisibleGraphData?.nodes) return null;
        return renderVisibleGraphData.nodes.find((node) => node.id === selectedNodeMappedId) || null;
    }, [selectedNodeMappedId, renderVisibleGraphData]);

    useEffect(() => {
        if (!selectedNode?.id || !renderVisibleGraphData?.nodes) return;
        const overviewMappedId = overviewNodeMap[selectedNode.id] || selectedNode.id;
        const mappedId = collapsedNodeMap[overviewMappedId] || overviewMappedId;
        const mappedNode = renderVisibleGraphData.nodes.find((node) => node.id === mappedId) || null;
        if (!mappedNode) {
            setSelectedNode(null);
            return;
        }
        if (overviewMappedId !== selectedNode.id) return;
        if (mappedNode.id === selectedNode.id) return;
        setSelectedNode(mapNodeToSelected(mappedNode));
    }, [collapsedNodeMap, overviewNodeMap, renderVisibleGraphData, selectedNode?.id]);

    const selectedPathHighlight = useMemo(() => {
        if (!renderVisibleGraphData?.nodes?.length) return null;
        const activeSelectedNodeId = selectedNodeInRenderGraph?.id || selectedNodeMappedId;
        if (!activeSelectedNodeId) return null;
        if (
            effectiveLargeGraphMode
            && focusMode === 'all'
            && activeSelectedNodeId === renderVisibleGraphData.root_id
        ) {
            const localHighlight = computeImmediateNeighborhoodHighlight(
                renderVisibleGraphData.nodes,
                renderVisibleGraphData.edges || [],
                activeSelectedNodeId
            );
            return localHighlight.node_ids.length ? localHighlight : null;
        }
        const highlight = computeUpstreamPathHighlight(
            renderVisibleGraphData.nodes,
            renderVisibleGraphData.edges || [],
            activeSelectedNodeId
        );
        if (!highlight.node_ids.length) return null;
        return highlight;
    }, [
        effectiveLargeGraphMode,
        focusMode,
        renderVisibleGraphData,
        selectedNodeInRenderGraph?.id,
        selectedNodeMappedId,
    ]);

    const railCanFit = panelMetrics.width >= 640 && panelMetrics.height >= 560;
    const isOverviewMode = focusMode === 'overview' && Boolean(overviewGraphView.graph);
    const effectiveShowLegend = showLegend ?? (railCanFit && !effectiveLargeGraphMode && !isOverviewMode);
    const showLegendCard = Boolean(effectiveShowLegend);
    const showMiniMapCard = Boolean(showMiniMap);
    const showDiagnosticsCard = Boolean(showDiagnostics);
    const showComparisonCard = Boolean(showComparisonMode && comparisonSummary);
    const showRightRail = railCanFit && (
        showLegendCard ||
        showMiniMapCard ||
        showDiagnosticsCard ||
        showComparisonCard
    );
    const showInlineSecondaryCards = !showRightRail && (
        showLegendCard ||
        showMiniMapCard ||
        showDiagnosticsCard ||
        showComparisonCard
    );
    const inspectorHasSelection = Boolean(selectedNode);
    const inspectorExpanded = inspectorHasSelection && !inspectorCollapsed;
    const graphFitPadding = renderVisibleGraphData?.nodes?.length <= 4
        ? { x: 24, y: 24 }
        : (renderVisibleGraphData?.nodes?.length <= 12 ? { x: 30, y: 30 } : { x: 36, y: 36 });
    const graphMaxAutoScale = renderVisibleGraphData?.nodes?.length <= 4
        ? (searchFilterApplied ? 1.45 : 2)
        : (displayLargeGraphActive ? 1.9 : 2.2);

    const toggleLegendVisibility = useCallback(() => {
        setShowLegend((prev) => (prev === null ? !showRightRail : !prev));
    }, [showRightRail]);

    const renderLegendCard = useCallback(() => {
        if (!showLegendCard) return null;
        return <Legend />;
    }, [showLegendCard]);

    const renderMiniMapCard = useCallback(() => {
        if (!showMiniMapCard || !miniMapViewBox) return null;

        return (
            <div className="dependency-minimap" data-testid="dependency-graph-minimap">
                <div className="dependency-minimap-header">
                    <span>Minimap</span>
                    <button
                        className="dependency-minimap-close"
                        onClick={() => setShowMiniMap(false)}
                        title="Ocultar minimapa"
                    >
                        x
                    </button>
                </div>
                <svg
                    className="dependency-minimap-svg"
                    viewBox={`0 0 ${miniMapViewBox.width} ${miniMapViewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                >
                    {miniMapViewBox.nodeRects.map((miniNode) => {
                        const isSelectedMini = (selectedNodeInRenderGraph?.id || selectedNodeMappedId) === miniNode.id;
                        const isRootMini = renderVisibleGraphData?.root_id === miniNode.id;
                        const nodeData = miniNode.data || {};
                        const abStatus = nodeData.ab_status;
                        let fill = 'rgba(179, 236, 255, 0.65)';
                        if (abStatus === 'added') fill = 'rgba(46, 204, 113, 0.82)';
                        if (abStatus === 'mixed') fill = 'rgba(241, 196, 15, 0.82)';
                        return (
                            <rect
                                key={`mini_${miniNode.id}`}
                                x={miniNode.x}
                                y={miniNode.y}
                                width={Math.max(4, miniNode.width)}
                                height={Math.max(4, miniNode.height)}
                                rx={2}
                                fill={fill}
                                stroke={isRootMini ? '#ffd700' : (isSelectedMini ? '#00ff88' : 'rgba(15, 25, 38, 0.82)')}
                                strokeWidth={isRootMini || isSelectedMini ? 3 : 1}
                                className="dependency-minimap-node"
                                onClick={() => {
                                    selectNodeById(miniNode.id, nodeData);
                                    setFocusNodeRequest({ nodeId: miniNode.id, seq: Date.now() });
                                }}
                            />
                        );
                    })}
                </svg>
            </div>
        );
    }, [
        miniMapViewBox,
        renderVisibleGraphData?.root_id,
        selectedNodeInRenderGraph?.id,
        selectedNodeMappedId,
        showMiniMapCard,
        selectNodeById,
    ]);

    const renderComparisonCard = useCallback(() => {
        if (!showComparisonCard) return null;

        return (
            <div className="dependency-comparison-panel" data-testid="dependency-graph-comparison">
                <div className="dependency-comparison-header">
                    <h5>Comparador A/B</h5>
                    <button
                        className="dependency-comparison-close"
                        onClick={() => setShowComparisonMode(false)}
                        title="Cerrar comparador"
                    >
                        x
                    </button>
                </div>
                <div className="dependency-comparison-grid">
                    <div className="cmp-row"><span>Nodos nuevos</span><strong>{comparisonSummary.nodesAdded}</strong></div>
                    <div className="cmp-row"><span>Nodos removidos</span><strong>{comparisonSummary.nodesRemoved}</strong></div>
                    <div className="cmp-row"><span>Aristas nuevas</span><strong>{comparisonSummary.edgesAdded}</strong></div>
                    <div className="cmp-row"><span>Aristas removidas</span><strong>{comparisonSummary.edgesRemoved}</strong></div>
                </div>
                {comparisonSummary.removedNodeNames.length > 0 && (
                    <div className="dependency-comparison-removed">
                        <strong>Nodos removidos (top):</strong>
                        <ul>
                            {comparisonSummary.removedNodeNames.map((name, idx) => (
                                <li key={`removed_${idx}_${name}`}>{name}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }, [comparisonSummary, showComparisonCard]);

    const renderDiagnosticsCard = useCallback(() => {
        if (!showDiagnosticsCard) return null;

        return (
            <div className="dependency-diagnostics-panel" data-testid="dependency-graph-diagnostics">
                <div className="dependency-diagnostics-header">
                    <h5>Calidad de analisis</h5>
                    <button
                        className="dependency-diagnostics-close"
                        onClick={() => setShowDiagnostics(false)}
                        title="Cerrar diagnostico"
                    >
                        x
                    </button>
                </div>
                <div className="dependency-diagnostics-grid">
                    <div className="diag-row"><span>Simbolo</span><strong>{symbol}</strong></div>
                    <div className="diag-row"><span>Modo</span><strong>{mode === 'impact' ? 'impacto' : 'dependencias'}</strong></div>
                    <div className="diag-row"><span>Request ID</span><code>{analysisMeta.requestId || 'n/a'}</code></div>
                    <div className="diag-row"><span>Estado</span><strong>{loading ? 'en progreso' : (error ? 'error' : 'ok')}</strong></div>
                    <div className="diag-row"><span>Duracion</span><strong>{diagnostics.durationMs !== null ? `${diagnostics.durationMs} ms` : 'n/a'}</strong></div>
                    <div className="diag-row"><span>Mensajes descartados</span><strong>{analysisMeta.ignoredMessages}</strong></div>
                    <div className="diag-row"><span>Profundidad actual</span><strong>{maxDepth}</strong></div>
                    <div className="diag-row"><span>Nodos / Aristas</span><strong>{`${diagnostics.nodesCount} / ${diagnostics.edgesCount}`}</strong></div>
                    <div className="diag-row"><span>Inputs / Outputs / Checks</span><strong>{`${diagnostics.inputs} / ${diagnostics.outputs} / ${diagnostics.checks}`}</strong></div>
                    <div className="diag-row"><span>Analisis completo</span><strong>{diagnostics.analysisComplete ? 'si' : 'parcial'}</strong></div>
                    <div className="diag-row"><span>Runtime enriquecido</span><strong>{diagnostics.runtimeEnriched ? 'si' : 'no'}</strong></div>
                    <div className="diag-row"><span>Ciclos detectados</span><strong>{diagnostics.hasCycles ? (diagnostics.sccCount ? `${diagnostics.sccCount} SCC` : `${diagnostics.cycleNodeCount} nodos`) : 'no'}</strong></div>
                    <div className="diag-row"><span>Vista de ciclos</span><strong>{cycleViewMode === 'scc' ? `SCC (${sccBundleCount})` : 'normal'}</strong></div>
                    <div className="diag-row"><span>Comparador A/B</span><strong>{showComparisonMode ? 'activo' : (baselineGraphSnapshot ? 'baseline cargado' : 'inactivo')}</strong></div>
                    <div className="diag-row"><span>Parse errors</span><strong>{diagnostics.parseErrors.length}</strong></div>
                </div>
                {diagnostics.parseErrors.length > 0 && (
                    <div className="dependency-diagnostics-parse-errors">
                        <strong>Parse errors del analisis:</strong>
                        <ul>
                            {diagnostics.parseErrors.slice(0, 8).map((parseError, idx) => (
                                <li key={`${idx}_${parseError}`}>{parseError}</li>
                            ))}
                        </ul>
                        <div className="dependency-diagnostics-hint">
                            Sugerencia: corrige errores de sintaxis o celdas incompletas para recuperar nodos y aristas faltantes.
                        </div>
                    </div>
                )}
                {error && (
                    <div className="dependency-diagnostics-error">
                        <strong>Error:</strong> {error}
                    </div>
                )}
                {diagnostics.warnings.length > 0 && (
                    <div className="dependency-diagnostics-warnings">
                        <strong>Warnings:</strong>
                        <ul>
                            {diagnostics.warnings.map((warning, idx) => (
                                <li key={`${idx}_${warning}`}>{warning}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {!diagnostics.analysisComplete && maxDepth < 20 && (
                    <button
                        type="button"
                        className="dependency-diagnostics-action"
                        onClick={handleIncreaseDepth}
                    >
                        Aumentar profundidad
                    </button>
                )}
            </div>
        );
    }, [
        analysisMeta.ignoredMessages,
        analysisMeta.requestId,
        baselineGraphSnapshot,
        cycleViewMode,
        diagnostics.analysisComplete,
        diagnostics.cycleNodeCount,
        diagnostics.durationMs,
        diagnostics.edgesCount,
        diagnostics.hasCycles,
        diagnostics.inputs,
        diagnostics.nodesCount,
        diagnostics.outputs,
        diagnostics.parseErrors,
        diagnostics.runtimeEnriched,
        diagnostics.sccCount,
        diagnostics.warnings,
        diagnostics.checks,
        error,
        handleIncreaseDepth,
        loading,
        maxDepth,
        mode,
        sccBundleCount,
        showComparisonMode,
        showDiagnosticsCard,
        symbol,
    ]);

    const renderQualityBanner = useCallback(() => {
        if (!hasPartialAnalysis) return null;
        const visibleWarnings = qualityWarnings.slice(0, 3);
        const remainingWarnings = Math.max(0, qualityWarnings.length - visibleWarnings.length);

        return (
            <div className="dependency-quality-banner" data-testid="dependency-quality-banner" role="status">
                <div className="dependency-quality-copy">
                    <strong>[!] Analisis parcial</strong>
                    <span>
                        El grafo puede omitir dependencias porque el analizador alcanzo el limite de profundidad o encontro simbolos sin resolver.
                    </span>
                    {visibleWarnings.length > 0 && (
                        <ul>
                            {visibleWarnings.map((warning, index) => (
                                <li key={`${warning}-${index}`}>{warning}</li>
                            ))}
                            {remainingWarnings > 0 && <li>{`${remainingWarnings} advertencias mas en calidad de analisis.`}</li>}
                        </ul>
                    )}
                </div>
                <div className="dependency-quality-actions">
                    {maxDepth < 20 && (
                        <button type="button" className="dependency-graph-btn primary" onClick={handleIncreaseDepth}>
                            Aumentar profundidad
                        </button>
                    )}
                    <button type="button" className="dependency-graph-btn" onClick={() => setShowDiagnostics(true)}>
                        Calidad de analisis
                    </button>
                </div>
            </div>
        );
    }, [handleIncreaseDepth, hasPartialAnalysis, maxDepth, qualityWarnings]);

    const renderSecondaryCards = useCallback(() => (
        <>
            {renderMiniMapCard()}
            {renderLegendCard()}
            {renderDiagnosticsCard()}
            {renderComparisonCard()}
        </>
    ), [renderComparisonCard, renderDiagnosticsCard, renderLegendCard, renderMiniMapCard]);

    const handleToggleCollapse = useCallback((nodeId) => {
        if (!nodeId) return;
        setCollapsedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const requestFocusOnNode = useCallback((nodeId) => {
        if (!nodeId) return;
        setFocusNodeRequest({ nodeId, seq: Date.now() });
    }, []);

    const expandSelectedOverviewGroup = useCallback(() => {
        const memberId = selectedNode?.data?.overview_member_ids?.[0];
        setFocusMode('all');
        if (memberId) {
            selectNodeById(memberId);
            requestFocusOnNode(memberId);
        }
    }, [requestFocusOnNode, selectNodeById, selectedNode?.data?.overview_member_ids]);

    const toggleSelectedCycleExpansion = useCallback(() => {
        if (!selectedSccId) return;
        setExpandedCycleIds((prev) => {
            const next = new Set(prev);
            if (next.has(selectedSccId)) next.delete(selectedSccId);
            else next.add(selectedSccId);
            return next;
        });
    }, [selectedSccId]);

    const toggleBaselineCapture = useCallback(() => {
        if (!graphData?.nodes?.length) return;
        setBaselineGraphSnapshot(cloneGraphSnapshot(graphData));
    }, [graphData]);

    const clearBaselineCapture = useCallback(() => {
        setBaselineGraphSnapshot(null);
        setShowComparisonMode(false);
    }, []);

    const moreMenuPortal = showMoreMenu && typeof document !== 'undefined'
        ? createPortal(
            <div
                ref={moreMenuRef}
                className="dependency-more-menu dependency-more-menu--portal"
                style={moreMenuStyle}
                data-testid="dependency-more-menu"
            >
                <button
                    className={`dependency-more-item ${showTrace ? 'active' : ''}`}
                    onClick={() => {
                        setShowTrace((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    Trace
                </button>
                <button
                    className={`dependency-more-item ${showSensitivity ? 'active' : ''}`}
                    onClick={() => {
                        setShowSensitivity((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    Sensibilidad
                </button>
                <button
                    className={`dependency-more-item ${showOptimization ? 'active' : ''}`}
                    onClick={() => {
                        setShowOptimization((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    Optimizar
                </button>
                <button
                    className={`dependency-more-item ${showDiagnostics ? 'active' : ''}`}
                    onClick={() => {
                        setShowDiagnostics((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    Calidad de analisis
                </button>
                <button
                    className={`dependency-more-item ${showEdgeEvidence ? 'active' : ''}`}
                    onClick={() => {
                        setShowEdgeEvidence((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    Evidence mode
                </button>
                <button
                    className={`dependency-more-item ${showMiniMap ? 'active' : ''}`}
                    onClick={() => {
                        setShowMiniMap((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                >
                    {showMiniMap ? 'Ocultar minimap' : 'Mostrar minimap'}
                </button>
                <button
                    className={`dependency-more-item ${showLegendCard ? 'active' : ''}`}
                    onClick={() => {
                        toggleLegendVisibility();
                        setShowMoreMenu(false);
                    }}
                >
                    {showLegendCard ? 'Ocultar leyenda' : 'Mostrar leyenda'}
                </button>
                <button
                    className={`dependency-more-item ${showComparisonMode ? 'active' : ''}`}
                    onClick={() => {
                        if (!baselineGraphSnapshot) return;
                        setShowComparisonMode((prev) => !prev);
                        setShowMoreMenu(false);
                    }}
                    disabled={!baselineGraphSnapshot}
                >
                    Modo A/B
                </button>
                <button
                    className="dependency-more-item"
                    onClick={() => {
                        toggleBaselineCapture();
                        setShowMoreMenu(false);
                    }}
                >
                    Capturar baseline
                </button>
                {baselineGraphSnapshot && (
                    <button
                        className="dependency-more-item"
                        onClick={() => {
                            clearBaselineCapture();
                            setShowMoreMenu(false);
                        }}
                    >
                        Limpiar baseline
                    </button>
                )}
                {selectedSccId && (
                    <button
                        className="dependency-more-item"
                        onClick={() => {
                            toggleSelectedCycleExpansion();
                            setShowMoreMenu(false);
                        }}
                    >
                        {expandedCycleIds.has(selectedSccId) ? 'Colapsar ciclo seleccionado' : 'Expandir ciclo seleccionado'}
                    </button>
                )}
                <label className="dependency-more-item-toggle">
                    <input
                        type="checkbox"
                        checked={largeGraphAuto}
                        onChange={(event) => setLargeGraphAuto(event.target.checked)}
                    />
                    Large graph auto ({getLargeGraphAutoSummary()})
                </label>
                {!largeGraphAuto && (
                    <label className="dependency-more-item-toggle">
                        <input
                            type="checkbox"
                            checked={largeGraphManual}
                            onChange={(event) => setLargeGraphManual(event.target.checked)}
                        />
                        Forzar modo Large Graph
                    </label>
                )}
            </div>,
            document.body
        )
        : null;

    // Renderizar estado de carga
    if (loading) {
        return (
            <>
                {layout !== 'embedded' && <div className="dependency-graph-overlay" onClick={onClose} />}
                <div className={`dependency-graph-panel ${layout}`}>
                    <div className="dependency-graph-header">
                        <h3>
                            Analizando <span className="symbol-name">{symbol}</span>
                        </h3>
                        {onClose && (
                            <button className="dependency-graph-close-btn" onClick={onClose} aria-label="Cerrar analisis">
                                x
                            </button>
                        )}
                    </div>
                    <div className="dependency-loading">
                        <div className="dependency-loading-spinner"></div>
                        <span>Analizando dependencias...</span>
                    </div>
                </div>
            </>
        );
    }

    // Renderizar error
    if (error) {
        return (
            <>
                {layout !== 'embedded' && <div className="dependency-graph-overlay" onClick={onClose} />}
                <div className={`dependency-graph-panel ${layout}`}>
                    <div className="dependency-graph-header">
                        <h3>Error de Analisis</h3>
                        {onClose && (
                            <button className="dependency-graph-close-btn" onClick={onClose} aria-label="Cerrar analisis">
                                x
                            </button>
                        )}
                    </div>
                    <div className="dependency-error">
                        <div className="dependency-error-icon">[!]</div>
                        <p>{error}</p>
                    </div>
                </div>
            </>
        );
    }

    // Renderizar grafo vacio
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
        return (
            <>
                {layout !== 'embedded' && <div className="dependency-graph-overlay" onClick={onClose} />}
                <div className={`dependency-graph-panel ${layout}`}>
                    <div className="dependency-graph-header">
                        <h3>
                            {mode === 'impact' ? 'Impacto de' : 'Dependencias de'}{' '}
                            <span className="symbol-name">{symbol}</span>
                        </h3>
                        {onClose && (
                            <button className="dependency-graph-close-btn" onClick={onClose} aria-label="Cerrar analisis">
                                x
                            </button>
                        )}
                    </div>
                    <div className="dependency-empty">
                        <div className="dependency-empty-icon">[ ]</div>
                        <p>No se encontraron {mode === 'impact' ? 'dependientes' : 'dependencias'} para este simbolo.</p>
                        {qualityWarnings.length > 0 && (
                            <p className="dependency-empty-detail">
                                {qualityWarnings.join(', ')}
                            </p>
                        )}
                        {onClose && (
                            <button type="button" className="dependency-graph-btn" onClick={onClose}>
                                Probar otro simbolo
                            </button>
                        )}
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            {layout !== 'embedded' && <div className="dependency-graph-overlay" onClick={onClose} />}
            <div
                ref={panelRef}
                className={`dependency-graph-panel ${layout} ${isFullscreen ? 'fullscreen' : ''} ${showRightRail ? 'has-right-rail' : 'is-compact-layout'}`}
                data-testid="dependency-graph-panel"
                style={{ '--dependency-graph-shell-offset': `${shellChromeOffset}px` }}
            >
                <div className="dependency-graph-header dependency-graph-header--relayout">
                    <div className="dependency-graph-header-copy">
                        <h3>
                            {mode === 'impact' ? 'Impacto de' : 'Dependencias de'}{' '}
                            <span className="symbol-name">{symbol}</span>
                        </h3>
                        <div className="dependency-graph-header-meta">
                            <span>{nodesHeaderText}</span>
                            <span>{edgesHeaderText}</span>
                            <span>{displayLargeGraphActive ? 'Large graph ON' : 'Large graph OFF'}</span>
                        </div>
                    </div>
                    <div className="dependency-graph-header-actions" data-testid="dependency-graph-header-actions">
                        <button
                            className="dependency-graph-btn"
                            onClick={() => setResetViewSignal((prev) => prev + 1)}
                            title="Centrar y reajustar vista"
                        >
                            Reset view
                        </button>
                        <button
                            className={`dependency-graph-btn ${showFilters ? 'primary' : ''}`}
                            onClick={() => setShowFilters((prev) => !prev)}
                            title="Mostrar u ocultar filtros del grafo"
                        >
                            Filtros
                        </button>
                        <button
                            className={`dependency-graph-btn ${isFullscreen ? 'primary' : ''}`}
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                        >
                            {isFullscreen ? 'Salir' : 'Pantalla completa'}
                        </button>
                        <button
                            ref={moreMenuButtonRef}
                            className={`dependency-graph-btn ${showMoreMenu ? 'primary' : ''}`}
                            onClick={() => setShowMoreMenu((prev) => !prev)}
                            title="Mas acciones"
                        >
                            More
                        </button>
                        {onClose && (
                            <button className="dependency-graph-close-btn" onClick={onClose} aria-label="Cerrar analisis">
                                x
                            </button>
                        )}
                    </div>
                </div>

                <div className="dependency-graph-body">
                    {(displayLargeGraphActive || selectedNode?.id || focusMode !== 'all') && (
                        <div className="dependency-focus-strip" data-testid="dependency-focus-strip">
                            <span>Vista</span>
                            <button
                                type="button"
                                className={focusMode === 'overview' ? 'primary' : ''}
                                disabled={!displayLargeGraphActive}
                                onClick={() => setFocusModeFromStrip('overview')}
                            >
                                Resumen
                            </button>
                            <button
                                type="button"
                                className={focusMode === 'all' ? 'primary' : ''}
                                onClick={() => setFocusModeFromStrip('all')}
                            >
                                Todo
                            </button>
                            <button
                                type="button"
                                className={focusMode === 'path' ? 'primary' : ''}
                                disabled={!selectedNode?.id}
                                onClick={() => setFocusModeFromStrip('path')}
                            >
                                Camino
                            </button>
                            <button
                                type="button"
                                className={focusMode === 'neighbors' ? 'primary' : ''}
                                disabled={!selectedNode?.id}
                                onClick={() => setFocusModeFromStrip('neighbors')}
                            >
                                Vecinos
                            </button>
                            <span className="dependency-focus-strip-target">
                                {selectedNode?.data?.name || selectedNode?.id || 'selecciona un nodo'}
                            </span>
                        </div>
                    )}
                    {displayLargeGraphActive && (
                        <div className={`dependency-view-note ${focusMode === 'all' ? 'is-map' : 'is-reading'}`}>
                            {focusMode === 'all'
                                ? 'Todo es el mapa completo: sirve para orientarse, no para lectura detallada. Usa Resumen, Camino o Vecinos para investigar.'
                                : focusMode === 'overview'
                                    ? 'Resumen agrupa archivos y scopes para leer grafos densos sin perder la estructura principal.'
                                    : 'Vista enfocada: conserva solo el contexto necesario para seguir relaciones del nodo seleccionado.'}
                        </div>
                    )}
                    {renderQualityBanner()}
                    {showFilters && (
                        <div className="dependency-filter-panel" data-testid="dependency-filter-panel">
                            <div className="dependency-filter-row">
                                <label>
                                    Profundidad
                                    <select value={maxDepth} onChange={(event) => setMaxDepth(Number(event.target.value))}>
                                        <option value={3}>3</option>
                                        <option value={5}>5</option>
                                        <option value={10}>10</option>
                                        <option value={20}>20</option>
                                    </select>
                                </label>
                                <label>
                                    Focus
                                    <select value={focusMode} onChange={(event) => setFocusMode(event.target.value)}>
                                        <option value="overview" disabled={!displayLargeGraphActive}>Resumen por grupos</option>
                                        <option value="all">Todo</option>
                                        <option value="neighbors" disabled={!selectedNode?.id}>Vecinos (1 salto)</option>
                                        <option value="path" disabled={!selectedNode?.id}>Path root ⇄ nodo</option>
                                    </select>
                                </label>
                                <label>
                                    Ciclos
                                    <select
                                        value={cycleViewMode}
                                        onChange={(event) => {
                                            setCycleViewMode(event.target.value);
                                            if (event.target.value !== 'scc') {
                                                setExpandedCycleIds(new Set());
                                            }
                                        }}
                                    >
                                        <option value="normal">Normal</option>
                                        <option value="scc">SCC (supernodos)</option>
                                    </select>
                                </label>
                                <label>
                                    Tipo
                                    <select value={nodeTypeFilter} onChange={(event) => setNodeTypeFilter(event.target.value)}>
                                        <option value="all">Todos</option>
                                        {availableNodeTypes.map((nodeType) => (
                                            <option key={nodeType} value={nodeType}>{nodeType}</option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    Categoria
                                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                                        <option value="all">Todas</option>
                                        {availableCategories.map((category) => (
                                            <option key={category} value={category}>{category}</option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    Celda
                                    <select value={cellFilter} onChange={(event) => setCellFilter(event.target.value)}>
                                        <option value="all">Todas</option>
                                        {availableCells.map((cell) => (
                                            <option key={cell.key} value={cell.key}>{cell.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="dependency-filter-row secondary">
                                <label className="dependency-search-field">
                                    Buscar nodo
                                    <input
                                        type="text"
                                        value={searchText}
                                        onChange={(event) => {
                                            const nextSearch = event.target.value;
                                            setSearchText(nextSearch);
                                            if (!nextSearch.trim()) {
                                                setSearchFilterActive(false);
                                            }
                                        }}
                                        placeholder="name, scope_path, unit, category..."
                                    />
                                </label>
                                <button
                                    className={`dependency-graph-btn dependency-search-mode-btn ${searchFilterApplied ? 'primary' : ''}`}
                                    onClick={() => setSearchFilterActive((prev) => (searchQuery ? !prev : false))}
                                    disabled={!searchQuery}
                                    title={searchFilterApplied ? 'Volver a buscar conservando contexto' : 'Recortar el grafo a los resultados de busqueda'}
                                >
                                    {searchFilterApplied ? 'Mostrar contexto' : 'Filtrar resultados'}
                                </button>
                                <button
                                    className="dependency-graph-btn"
                                    onClick={clearFilters}
                                    disabled={!hasActiveFilters}
                                    title="Limpiar todos los filtros"
                                >
                                    Limpiar
                                </button>
                                <div className="dependency-filter-stats">
                                    {filteredNodesCount} / {diagnostics.nodesCount} nodos
                                    <span>{filteredEdgesCount} aristas</span>
                                    <span>{effectiveLargeGraphMode ? 'Large graph: ON' : 'Large graph: OFF'}</span>
                                    <span>{largeGraphAuto ? (autoLargeGraphActive ? 'auto activo' : 'auto en espera') : 'auto desactivado'}</span>
                                    {cycleViewMode === 'scc' && <span>{`SCC: ${sccBundleCount} (expand.: ${expandedCycleIds.size})`}</span>}
                                    {showComparisonMode && baselineGraphSnapshot && <span>A/B activo</span>}
                                </div>
                                {searchQuery.length > 0 && !searchFilterApplied && (
                                    <div className="dependency-filter-hint">
                                        Busqueda en modo foco: selecciona un resultado para centrarlo o usa "Filtrar resultados" para recortar el grafo.
                                    </div>
                                )}
                                {searchQuery.length > 0 && searchFilterApplied && (
                                    <div className="dependency-filter-hint">
                                        Filtro de busqueda activo: el grafo muestra solo resultados y contexto minimo.
                                    </div>
                                )}
                                {searchQuery.length > 0 && focusMode !== 'all' && (
                                    <div className="dependency-filter-hint">
                                        La busqueda conserva el camino seleccionado para mantener contexto.
                                    </div>
                                )}
                            </div>
                            {cycleViewMode === 'scc' && sccBundleCount > 0 && (
                                <div className="dependency-filter-row tertiary">
                                    <button
                                        className="dependency-graph-btn"
                                        onClick={() => setExpandedCycleIds(new Set(sccBundleIds))}
                                    >
                                        Expandir todos los ciclos
                                    </button>
                                    <button
                                        className="dependency-graph-btn"
                                        onClick={() => setExpandedCycleIds(new Set())}
                                    >
                                        Colapsar todos los ciclos
                                    </button>
                                </div>
                            )}
                            {searchMatches.length > 0 && (
                                <div className="dependency-search-results">
                                    {searchMatches.map((node) => (
                                        <button
                                            key={node.id}
                                            className="dependency-search-hit"
                                            onClick={() => {
                                                selectNodeById(node.id, node);
                                                setFocusMode('neighbors');
                                                requestFocusOnNode(node.id);
                                            }}
                                        >
                                            <strong>{node.name || node.id}</strong>
                                            <span>{node.scope_path || node.node_type || 'node'}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="dependency-graph-workarea">
                        <div className="dependency-graph-primary">
                            {onNavigateToCode && (
                                <div className="dependency-navigation-tip">
                                    Doble clic en un nodo para ir al codigo. Tambien puedes usar el inspector inferior.
                                </div>
                            )}
                            <div className="dependency-graph-canvas-shell" data-testid="dependency-graph-canvas-shell">
                                {hasActiveFilters && filteredNodesCount === 0 ? (
                                    <div className="dependency-empty-filter-state">
                                        <div className="dependency-empty-icon">[ ]</div>
                                        <p>No hay nodos que cumplan los filtros activos.</p>
                                        <button className="dependency-graph-btn" onClick={clearFilters}>Restablecer filtros</button>
                                    </div>
                                ) : (
                                    <div className="dependency-graph-container" data-testid="dependency-graph-canvas">
                                        <D3DependencyGraph
                                            graphData={renderVisibleGraphData}
                                            rootId={renderVisibleGraphData?.root_id}
                                            selectedNodeId={selectedNodeInRenderGraph?.id || selectedNodeMappedId}
                                            collapsedNodeIds={collapsedNodeIds}
                                            onToggleCollapse={handleToggleCollapse}
                                            onNodeClick={handleNodeClick}
                                            onNodeDoubleClick={handleNodeDoubleClick}
                                            onBackgroundClick={handleBackgroundClick}
                                            resetViewSignal={resetViewSignal}
                                            focusNodeRequest={focusNodeRequest}
                                            showEdgeEvidence={showEdgeEvidence}
                                            largeGraphMode={effectiveLargeGraphMode}
                                            selectedPathHighlight={selectedPathHighlight}
                                            selectionHighlightTrigger="click"
                                            selectionHighlightMode="upstream_transitive"
                                            fitPadding={graphFitPadding}
                                            maxAutoScale={graphMaxAutoScale}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {showRightRail && (
                            <aside className="dependency-graph-sidecards" data-testid="dependency-graph-rail">
                                {renderSecondaryCards()}
                            </aside>
                        )}
                    </div>

                    {showInlineSecondaryCards && (
                        <div className="dependency-graph-inline-tools">
                            {renderSecondaryCards()}
                        </div>
                    )}

                    <div
                        className={`dependency-graph-inspector-dock ${inspectorExpanded ? 'is-expanded' : 'is-collapsed'} ${inspectorHasSelection ? 'has-selection' : 'is-empty'}`}
                        data-testid="dependency-graph-inspector"
                    >
                        <div className="dependency-graph-inspector-header">
                            <div>
                                <strong>Inspector</strong>
                                <span>{inspectorHasSelection ? (selectedNode?.data?.name || selectedNode?.id) : 'Selecciona un nodo para ver detalle'}</span>
                            </div>
                            <button
                                className="dependency-graph-btn dependency-graph-btn--small"
                                onClick={() => setInspectorCollapsed((prev) => !prev)}
                                disabled={!inspectorHasSelection}
                            >
                                {inspectorExpanded ? 'Colapsar' : 'Expandir'}
                            </button>
                        </div>
                        {inspectorExpanded ? (
                            <InfoPanel
                                node={selectedNode}
                                canNavigate={Boolean(onNavigateToCode)}
                                onNavigate={selectedNode ? () => navigateToNodeLocation(selectedNode) : null}
                                onShowNeighbors={selectedNode ? () => setFocusMode('neighbors') : null}
                                onShowPath={selectedNode ? () => setFocusMode('path') : null}
                                onExpandGroup={selectedNode?.data?.is_overview_node ? expandSelectedOverviewGroup : null}
                            />
                        ) : (
                            <div className="dependency-graph-inspector-placeholder">
                                {inspectorHasSelection
                                    ? 'El detalle esta colapsado. Expande el inspector para revisar propiedades y navegar al codigo.'
                                    : 'El grafo queda libre de overlays: selecciona un nodo para abrir el detalle docked abajo.'}
                            </div>
                        )}
                    </div>

                    {showTrace && graphData && (
                        <TraceTable
                            trace={traceNodes.map((node, idx) => ({
                                step: idx + 1,
                                node_id: node.id,
                                variable: node.data.label,
                                formula: node.data.valuePreview || '(entrada)',
                                value: formatRuntimeValue(node.data.runtimeValue),
                                unit: node.data.unit,
                                description: node.data.description,
                                category: node.data.category,
                                is_check: node.data.isCheck,
                            }))}
                            onClose={() => setShowTrace(false)}
                        />
                    )}

                    {showSensitivity && graphData && (
                        <SensitivityPanel
                            inputNodes={traceNodes.filter(n => graphData.input_node_ids?.includes(n.id))}
                            outputNodes={traceNodes.filter(n => graphData.output_node_ids?.includes(n.id))}
                            allNodes={traceNodes}
                            onClose={() => setShowSensitivity(false)}
                            sendMessage={sendMessage}
                            lastMessage={lastMessage}
                        />
                    )}

                    {showOptimization && graphData && (
                        <OptimizationPanel
                            inputNodes={traceNodes.filter(n => graphData.input_node_ids?.includes(n.id))}
                            outputNodes={traceNodes.filter(n => graphData.output_node_ids?.includes(n.id))}
                            allNodes={traceNodes}
                            onClose={() => setShowOptimization(false)}
                            sendMessage={sendMessage}
                            lastMessage={lastMessage}
                        />
                    )}

                </div>
            </div>
            {moreMenuPortal}
        </>
    );


}

export default DependencyGraph;
