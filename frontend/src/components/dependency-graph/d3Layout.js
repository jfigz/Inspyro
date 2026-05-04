import { assignPortsToEdges } from './edgePorts';
import { routeAllEdges } from './edgeRouter';
import { getGraphComplexity } from './graphComplexity';
import { getNodeDimensions } from './nodeSizing';

const LAYOUT_CONFIG = {
  NODE_WIDTH: 220,
  NODE_HEIGHT: 100,
  NODE_MARGIN_X: 56,
  NODE_MARGIN_Y: 26,
  CONTAINER_PADDING: { top: 50, right: 30, bottom: 30, left: 30 },
  LAYOUT_STYLE: 'flow',
  ORIENTATION: 'LR',
  CROSSING_ITERATIONS: 12,
  FLOW_SWEEPS: 6,
  FLOW_MIN_GAP: 18,
  FLOW_LAYER_GAP: 76,
  ENABLE_PORTS: true,
  ENABLE_ROUTING: true,
  ENABLE_BUNDLING: false,
  BUNDLING_EDGE_THRESHOLD: 160,
  ROUTING_DENSE_EDGE_THRESHOLD: 220,
  LARGE_GRAPH_NODE_THRESHOLD: 120,
};

function resolveOrientation(graphData, options = {}) {
  if (typeof options.ORIENTATION === 'string' && options.ORIENTATION) return options.ORIENTATION;
  return graphData?.analysis_mode === 'impact' ? 'LR' : 'LR';
}

export function getAdaptiveLayoutOptions(graphData, options = {}) {
  if (options?.disableAdaptiveSpacing) return {};
  const nodeCount = graphData?.nodes?.length || 0;
  const edgeCount = graphData?.edges?.length || 0;
  const complexity = getGraphComplexity(graphData);
  if (nodeCount <= 6 && edgeCount <= 10) {
    return {
      NODE_MARGIN_X: 42,
      NODE_MARGIN_Y: 20,
      FLOW_MIN_GAP: 14,
      FLOW_LAYER_GAP: 56,
      CONTAINER_PADDING: { top: 40, right: 24, bottom: 24, left: 24 },
    };
  }
  if (nodeCount <= 14 && edgeCount <= 24) {
    return {
      NODE_MARGIN_X: 48,
      NODE_MARGIN_Y: 22,
      FLOW_MIN_GAP: 16,
      FLOW_LAYER_GAP: 64,
      CONTAINER_PADDING: { top: 44, right: 26, bottom: 26, left: 26 },
    };
  }
  if (complexity.large) {
    return {
      NODE_MARGIN_X: edgeCount >= 120 ? 104 : 90,
      NODE_MARGIN_Y: nodeCount >= 80 ? 46 : 38,
      FLOW_MIN_GAP: edgeCount >= 120 ? 38 : 32,
      FLOW_LAYER_GAP: edgeCount >= 120 ? 156 : 132,
      CROSSING_ITERATIONS: 18,
      FLOW_SWEEPS: 9,
      CONTAINER_PADDING: { top: 64, right: 48, bottom: 56, left: 48 },
    };
  }
  if (nodeCount >= 22 || edgeCount >= 32) {
    return {
      NODE_MARGIN_X: 66,
      NODE_MARGIN_Y: 30,
      FLOW_MIN_GAP: 22,
      FLOW_LAYER_GAP: 92,
      CROSSING_ITERATIONS: 14,
      FLOW_SWEEPS: 7,
      CONTAINER_PADDING: { top: 52, right: 36, bottom: 38, left: 36 },
    };
  }
  return {};
}

function createLayoutNode(node, config, inputNodeIds, outputNodeIds) {
  const dimensions = getNodeDimensions(node, {
    largeGraphMode: Boolean(config.largeGraphMode),
    isInput: inputNodeIds.has(node.id),
    isOutput: outputNodeIds.has(node.id),
    minWidth: config.NODE_WIDTH,
    minHeight: config.NODE_HEIGHT,
  });
  return {
    id: node.id,
    data: node,
    children: [],
    parent: null,
    x: 0,
    y: 0,
    width: dimensions.width,
    height: dimensions.height,
    baseWidth: dimensions.width,
    baseHeight: dimensions.height,
    absoluteX: 0,
    absoluteY: 0,
    inDegree: 0,
    outDegree: 0,
    barycenter: 0,
  };
}

export function computeHierarchicalLayout(graphData, options = {}) {
  if (!graphData?.nodes?.length) return { nodes: [], edges: [], bounds: { width: 0, height: 0 } };

  const adaptiveOptions = getAdaptiveLayoutOptions(graphData, options);
  const orientation = resolveOrientation(graphData, options);
  const config = {
    ...LAYOUT_CONFIG,
    ...adaptiveOptions,
    ...options,
    NODE_WIDTH: options.NODE_WIDTH ?? adaptiveOptions.NODE_WIDTH ?? 220,
    NODE_MARGIN_X: options.NODE_MARGIN_X ?? adaptiveOptions.NODE_MARGIN_X ?? 56,
    NODE_MARGIN_Y: options.NODE_MARGIN_Y ?? adaptiveOptions.NODE_MARGIN_Y ?? 26,
    FLOW_MIN_GAP: options.FLOW_MIN_GAP ?? adaptiveOptions.FLOW_MIN_GAP ?? 18,
    FLOW_LAYER_GAP: options.FLOW_LAYER_GAP ?? adaptiveOptions.FLOW_LAYER_GAP ?? 76,
    ORIENTATION: orientation,
    CONTAINER_PADDING: {
      ...LAYOUT_CONFIG.CONTAINER_PADDING,
      ...(adaptiveOptions.CONTAINER_PADDING || {}),
      ...(options.CONTAINER_PADDING || {}),
    },
  };
  const inputNodeIds = new Set(graphData.input_node_ids || []);
  const outputNodeIds = new Set(graphData.output_node_ids || []);

  const nodesMap = new Map();
  graphData.nodes.forEach((node) => nodesMap.set(node.id, createLayoutNode(node, config, inputNodeIds, outputNodeIds)));

  const parentMap = new Map();
  graphData.nodes.forEach((node) => parentMap.set(node.id, node.parent_id));
  const collapsedSet = config.collapsedNodes instanceof Set
    ? config.collapsedNodes
    : new Set(Array.isArray(config.collapsedNodes) ? config.collapsedNodes : []);

  function getCollapsedAncestor(nodeId) {
    let current = parentMap.get(nodeId);
    while (current) {
      if (collapsedSet.has(current)) return current;
      current = parentMap.get(current);
    }
    return null;
  }

  const visibleNodes = graphData.nodes.filter((node) => !getCollapsedAncestor(node.id));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleNodesMap = new Map();
  visibleNodes.forEach((node) => {
    const nodeObj = nodesMap.get(node.id);
    if (nodeObj) visibleNodesMap.set(node.id, nodeObj);
  });

  const visibleEdgesMap = new Map();
  (graphData.edges || []).forEach((edge, edgeIdx) => {
    const newSource = getCollapsedAncestor(edge.source) || edge.source;
    const newTarget = getCollapsedAncestor(edge.target) || edge.target;
    if (newSource === newTarget) return;
    if (!visibleNodeIds.has(newSource) || !visibleNodeIds.has(newTarget)) return;

    const edgeKey = `${newSource}->${newTarget}`;
    const relation = typeof edge.relation === 'string' ? edge.relation : null;
    const abStatus = typeof edge.ab_status === 'string' ? edge.ab_status : null;
    const originalPair = { source: edge.source, target: edge.target, relation, ab_status: abStatus, index: edgeIdx };

    if (!visibleEdgesMap.has(edgeKey)) {
      visibleEdgesMap.set(edgeKey, {
        ...edge,
        source: newSource,
        target: newTarget,
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

    const existing = visibleEdgesMap.get(edgeKey);
    existing.aggregated_count += 1;
    existing.original_pairs.push(originalPair);
    if (relation && !existing.relations.includes(relation)) existing.relations.push(relation);
    if (abStatus && !existing.ab_statuses.includes(abStatus)) existing.ab_statuses.push(abStatus);
    existing.relation = existing.relations.length > 1 ? 'mixed' : (existing.relations[0] || null);
    existing.ab_status = existing.ab_statuses.length > 1 ? 'mixed' : (existing.ab_statuses[0] || null);
  });
  const visibleEdges = Array.from(visibleEdgesMap.values());

  const cycleInfo = detectStronglyConnectedComponents(visibleNodes, visibleEdges);
  const cycleEdgeKeys = new Set(cycleInfo.cycleEdgeKeys);
  visibleEdges.forEach((edge) => { edge.is_cycle = cycleEdgeKeys.has(`${edge.source}->${edge.target}`); });

  const rootNodes = [];
  visibleNodes.forEach((node) => {
    const nodeObj = nodesMap.get(node.id);
    if (node.parent_id && visibleNodesMap.has(node.parent_id) && !collapsedSet.has(node.parent_id)) {
      const parent = visibleNodesMap.get(node.parent_id);
      parent.children.push(nodeObj);
      nodeObj.parent = parent;
    } else {
      rootNodes.push(nodeObj);
    }
  });

  visibleNodes.forEach((node) => {
    const obj = visibleNodesMap.get(node.id);
    obj.inDegree = 0;
    obj.outDegree = 0;
  });
  visibleEdges.forEach((edge) => {
    const source = visibleNodesMap.get(edge.source);
    const target = visibleNodesMap.get(edge.target);
    if (source) source.outDegree += 1;
    if (target) target.inDegree += 1;
  });

  const visibleGraphData = { nodes: visibleNodes, edges: visibleEdges };
  const nodeRanks = computeRanks(visibleGraphData);
  const layers = buildLayers(visibleNodesMap, nodeRanks);
  minimizeCrossings(layers, visibleEdges, visibleNodesMap, config.CROSSING_ITERATIONS);

  const hasContainers = visibleNodes.some((node) => node.is_container && !node.ui_is_collapsed);
  if (!hasContainers && config.LAYOUT_STYLE === 'flow') {
    positionFlatLayers(layers, visibleNodesMap, visibleEdges, config);
  } else {
    applyOrderToContainers(rootNodes, nodeRanks);
    computeSizes(rootNodes, nodeRanks, config);
    rootNodes.sort((a, b) => {
      const rankDiff = (nodeRanks.get(a.id) || 0) - (nodeRanks.get(b.id) || 0);
      if (rankDiff !== 0) return rankDiff;
      return (a.barycenter || 0) - (b.barycenter || 0);
    });
    positionRootNodes(rootNodes, nodeRanks, config);
  }

  computeAbsolutePositions(rootNodes);
  const positionedNodes = collectPositionedNodes(rootNodes, collapsedSet, cycleInfo.cycleNodeIds);
  const edges = computeOptimizedEdges(visibleEdges, positionedNodes, config, { cycleEdgeKeys });
  const bounds = {
    width: Math.max(...positionedNodes.map((node) => node.x + node.width), 100) + 100,
    height: Math.max(...positionedNodes.map((node) => node.y + node.height), 100) + 100,
  };

  return {
    nodes: positionedNodes,
    edges,
    bounds,
    meta: {
      has_cycles: cycleInfo.sccCount > 0,
      scc_count: cycleInfo.sccCount,
      cycle_node_ids: Array.from(cycleInfo.cycleNodeIds),
      parse_errors_count: Array.isArray(graphData.parse_errors) ? graphData.parse_errors.length : 0,
      runtime_enriched: Boolean(graphData.runtime_enriched),
      orientation,
    },
  };
}

function detectStronglyConnectedComponents(nodes, edges) {
  const ids = nodes.map((node) => node.id);
  const adjacency = new Map(ids.map((id) => [id, []]));
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

    const neighbors = adjacency.get(nodeId) || [];
    neighbors.forEach((neighborId) => {
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

  ids.forEach((id) => { if (!indexMap.has(id)) strongConnect(id); });

  const cycleNodeIds = new Set();
  const cycleEdgeKeys = new Set();
  components.forEach((component) => {
    if (component.length > 1) {
      component.forEach((nodeId) => cycleNodeIds.add(nodeId));
      return;
    }
    const only = component[0];
    if (edges.some((edge) => edge.source === only && edge.target === only)) cycleNodeIds.add(only);
  });
  edges.forEach((edge) => {
    if (cycleNodeIds.has(edge.source) && cycleNodeIds.has(edge.target)) cycleEdgeKeys.add(`${edge.source}->${edge.target}`);
  });
  const sccCount = components.filter((component) => component.length > 1 || edges.some((edge) => edge.source === component[0] && edge.target === component[0])).length;
  return { cycleNodeIds, cycleEdgeKeys, sccCount };
}

function buildLayers(nodesMap, nodeRanks) {
  const layers = new Map();
  nodesMap.forEach((node, id) => {
    const rank = nodeRanks.get(id) || 0;
    node.rank = rank;
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(node);
  });
  return Array.from(layers.keys()).sort((a, b) => a - b).map((rank) => ({ rank, nodes: layers.get(rank) }));
}

function minimizeCrossings(layers, edges, nodesMap, iterations) {
  if (layers.length <= 1) return;
  const outgoing = new Map();
  const incoming = new Map();
  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge.source);
  });

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 1; i < layers.length; i += 1) {
      const prevLayer = layers[i - 1];
      const currLayer = layers[i];
      prevLayer.nodes.forEach((node, pos) => { node.layerPosition = pos; });
      currLayer.nodes.forEach((node) => {
        const sources = incoming.get(node.id) || [];
        if (sources.length === 0) { node.barycenter = node.layerPosition || 0; return; }
        const positions = sources.map((sourceId) => nodesMap.get(sourceId)?.layerPosition).filter((position) => position !== undefined);
        if (positions.length > 0) node.barycenter = positions.reduce((a, b) => a + b, 0) / positions.length;
      });
      currLayer.nodes.sort((a, b) => a.barycenter - b.barycenter);
      currLayer.nodes.forEach((node, pos) => { node.layerPosition = pos; });
    }

    for (let i = layers.length - 2; i >= 0; i -= 1) {
      const currLayer = layers[i];
      currLayer.nodes.forEach((node) => {
        const targets = outgoing.get(node.id) || [];
        if (targets.length === 0) return;
        const positions = targets.map((targetId) => nodesMap.get(targetId)?.layerPosition).filter((position) => position !== undefined);
        if (positions.length > 0) node.barycenter = positions.reduce((a, b) => a + b, 0) / positions.length;
      });
      currLayer.nodes.sort((a, b) => a.barycenter - b.barycenter);
      currLayer.nodes.forEach((node, pos) => { node.layerPosition = pos; });
    }
  }
}

function buildLayerGapDemand(layers, nodesMap, edges, config) {
  const baseLayerGap = Math.max(40, config.FLOW_LAYER_GAP || Math.round(config.NODE_MARGIN_X * 1.1));
  const demandByRank = new Map();

  edges.forEach((edge) => {
    const sourceRank = nodesMap.get(edge.source)?.rank ?? 0;
    const targetRank = nodesMap.get(edge.target)?.rank ?? sourceRank;
    const minRank = Math.min(sourceRank, targetRank);
    const maxRank = Math.max(sourceRank, targetRank);
    for (let rank = minRank; rank < maxRank; rank += 1) {
      const entry = demandByRank.get(rank) || { edges: 0, backEdges: 0, spanSum: 0 };
      entry.edges += 1;
      entry.spanSum += Math.max(1, maxRank - minRank);
      if (targetRank <= sourceRank || edge.is_cycle) entry.backEdges += 1;
      demandByRank.set(rank, entry);
    }
  });

  const gapByRank = new Map();
  layers.forEach((layer, index) => {
    const entry = demandByRank.get(layer.rank) || { edges: 0, backEdges: 0, spanSum: 0 };
    const isLast = index === layers.length - 1;
    if (isLast) {
      gapByRank.set(layer.rank, 0);
      return;
    }
    const demandGap = Math.min(
      config.largeGraphMode ? 420 : 260,
      entry.edges * (config.largeGraphMode ? 9 : 7)
        + entry.backEdges * (config.largeGraphMode ? 22 : 16)
        + Math.max(0, entry.spanSum - entry.edges) * (config.largeGraphMode ? 8 : 6),
    );
    gapByRank.set(layer.rank, baseLayerGap + demandGap);
  });

  return gapByRank;
}
function applyOrderToContainers(rootNodes, nodeRanks) {
  function sortChildren(node) {
    if (node.children.length === 0) return;
    node.children.sort((a, b) => {
      const rankA = nodeRanks.get(a.id) || 0;
      const rankB = nodeRanks.get(b.id) || 0;
      if (rankA !== rankB) return rankA - rankB;
      return (a.barycenter || 0) - (b.barycenter || 0);
    });
    node.children.forEach(sortChildren);
  }
  rootNodes.forEach(sortChildren);
}

function computeColumnMetrics(children, config) {
  const verticalGap = config.NODE_MARGIN_Y + Math.min(18, Math.max(...children.map((child) => (child.inDegree || 0) + (child.outDegree || 0))) * 2);
  const width = Math.max(...children.map((child) => child.width));
  const height = children.reduce((sum, child) => sum + child.height, 0) + Math.max(0, children.length - 1) * verticalGap;
  return { width, height, verticalGap };
}

function computeRowMetrics(children, config) {
  const horizontalGap = config.NODE_MARGIN_X + Math.min(24, Math.max(...children.map((child) => child.outDegree || 0)) * 2);
  const width = children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, children.length - 1) * horizontalGap;
  const height = Math.max(...children.map((child) => child.height));
  return { width, height, horizontalGap };
}

function computeSizes(rootNodes, nodeRanks, config) {
  const isHorizontal = (config.ORIENTATION || 'LR') === 'LR';
  function computeSize(node) {
    if (node.children.length === 0) {
      node.width = node.baseWidth;
      node.height = node.baseHeight;
      return;
    }

    node.children.forEach(computeSize);
    const childrenByRank = new Map();
    node.children.forEach((child) => {
      const rank = nodeRanks.get(child.id) || 0;
      if (!childrenByRank.has(rank)) childrenByRank.set(rank, []);
      childrenByRank.get(rank).push(child);
    });

    const sortedRanks = Array.from(childrenByRank.keys()).sort((a, b) => a - b);
    if (isHorizontal) {
      let totalWidth = 0;
      let maxColumnHeight = 0;
      sortedRanks.forEach((rank, idx) => {
        const metrics = computeColumnMetrics(childrenByRank.get(rank), config);
        totalWidth += metrics.width + (idx > 0 ? config.NODE_MARGIN_X : 0);
        maxColumnHeight = Math.max(maxColumnHeight, metrics.height);
      });
      node.width = Math.max(node.baseWidth, totalWidth + config.CONTAINER_PADDING.left + config.CONTAINER_PADDING.right);
      node.height = Math.max(node.baseHeight, maxColumnHeight + config.CONTAINER_PADDING.top + config.CONTAINER_PADDING.bottom);
      return;
    }

    let totalHeight = 0;
    let maxRowWidth = 0;
    sortedRanks.forEach((rank, idx) => {
      const metrics = computeRowMetrics(childrenByRank.get(rank), config);
      totalHeight += metrics.height + (idx > 0 ? config.NODE_MARGIN_Y : 0);
      maxRowWidth = Math.max(maxRowWidth, metrics.width);
    });
    node.width = Math.max(node.baseWidth, maxRowWidth + config.CONTAINER_PADDING.left + config.CONTAINER_PADDING.right);
    node.height = Math.max(node.baseHeight, totalHeight + config.CONTAINER_PADDING.top + config.CONTAINER_PADDING.bottom);
  }
  rootNodes.forEach(computeSize);
}

function positionRootNodes(rootNodes, nodeRanks, config) {
  const isHorizontal = (config.ORIENTATION || 'LR') === 'LR';
  function positionNode(node, startX, startY) {
    node.x = startX;
    node.y = startY;
    if (node.children.length === 0) return;

    const childrenByRank = new Map();
    node.children.forEach((child) => {
      const rank = nodeRanks.get(child.id) || 0;
      if (!childrenByRank.has(rank)) childrenByRank.set(rank, []);
      childrenByRank.get(rank).push(child);
    });
    const sortedRanks = Array.from(childrenByRank.keys()).sort((a, b) => a - b);

    if (isHorizontal) {
      let currentX = config.CONTAINER_PADDING.left;
      sortedRanks.forEach((rank) => {
        const childrenInRank = childrenByRank.get(rank);
        const metrics = computeColumnMetrics(childrenInRank, config);
        let currentY = config.CONTAINER_PADDING.top + (node.height - config.CONTAINER_PADDING.top - config.CONTAINER_PADDING.bottom - metrics.height) / 2;
        currentY = Math.max(currentY, config.CONTAINER_PADDING.top);
        childrenInRank.forEach((child) => {
          const childX = currentX + (metrics.width - child.width) / 2;
          positionNode(child, childX, currentY);
          currentY += child.height + metrics.verticalGap;
        });
        currentX += metrics.width + config.NODE_MARGIN_X;
      });
      return;
    }

    let currentY = config.CONTAINER_PADDING.top;
    sortedRanks.forEach((rank) => {
      const childrenInRank = childrenByRank.get(rank);
      const metrics = computeRowMetrics(childrenInRank, config);
      let currentX = config.CONTAINER_PADDING.left + (node.width - config.CONTAINER_PADDING.left - config.CONTAINER_PADDING.right - metrics.width) / 2;
      currentX = Math.max(currentX, config.CONTAINER_PADDING.left);
      childrenInRank.forEach((child) => {
        positionNode(child, currentX, currentY);
        currentX += child.width + metrics.horizontalGap;
      });
      currentY += metrics.height + config.NODE_MARGIN_Y;
    });
  }

  let currentX = 50;
  let currentY = 50;
  rootNodes.forEach((node) => {
    positionNode(node, currentX, currentY);
    if (isHorizontal) currentY += node.height + config.NODE_MARGIN_Y;
    else currentX += node.width + config.NODE_MARGIN_X;
  });
}

function positionFlatLayers(layers, nodesMap, edges, config) {
  if (!layers?.length) return;

  const minGap = Math.max(16, config.FLOW_MIN_GAP || Math.round(config.NODE_MARGIN_X * 0.5));
  const layerGapByRank = buildLayerGapDemand(layers, nodesMap, edges, config);
  const sweeps = config.FLOW_SWEEPS || 4;
  const isHorizontal = (config.ORIENTATION || 'LR') === 'LR';
  const incoming = new Map();
  const outgoing = new Map();

  edges.forEach((edge) => {
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    incoming.get(edge.target).push(edge.source);
    outgoing.get(edge.source).push(edge.target);
  });

  layers.forEach((layer) => {
    layer.nodes.sort((a, b) => (a.barycenter || 0) - (b.barycenter || 0));
    let cursor = 0;
    layer.nodes.forEach((node) => {
      const localGap = minGap + Math.min(28, ((node.inDegree || 0) + (node.outDegree || 0)) * 2);
      if (isHorizontal) {
        node.y = cursor;
        cursor += node.height + localGap;
      } else {
        node.x = cursor;
        cursor += node.width + localGap;
      }
    });
  });

  const alignLayer = (layerNodes, neighborMap) => {
    if (!layerNodes?.length) return;
    const items = layerNodes.map((node) => {
      const neighbors = neighborMap.get(node.id) || [];
      const centers = neighbors.map((id) => {
        const neighborNode = nodesMap.get(id);
        if (!neighborNode) return null;
        return isHorizontal ? neighborNode.y + neighborNode.height / 2 : neighborNode.x + neighborNode.width / 2;
      }).filter((value) => value !== null);
      const desiredCenter = centers.length ? centers.reduce((a, b) => a + b, 0) / centers.length : (isHorizontal ? node.y + node.height / 2 : node.x + node.width / 2);
      return { node, desiredCenter };
    });

    items.sort((a, b) => {
      const diff = a.desiredCenter - b.desiredCenter;
      if (diff !== 0) return diff;
      return (a.node.barycenter || 0) - (b.node.barycenter || 0);
    });

    items.forEach((item, index) => {
      const desiredPosition = item.desiredCenter - (isHorizontal ? item.node.height / 2 : item.node.width / 2);
      if (index === 0) {
        if (isHorizontal) item.node.y = desiredPosition;
        else item.node.x = desiredPosition;
        return;
      }
      const prev = items[index - 1].node;
      if (isHorizontal) item.node.y = Math.max(desiredPosition, prev.y + prev.height + minGap);
      else item.node.x = Math.max(desiredPosition, prev.x + prev.width + minGap);
    });

    const desiredAvg = items.reduce((sum, item) => sum + item.desiredCenter, 0) / items.length;
    const minPosition = Math.min(...items.map((item) => (isHorizontal ? item.node.y : item.node.x)));
    const maxPosition = Math.max(...items.map((item) => isHorizontal ? item.node.y + item.node.height : item.node.x + item.node.width));
    const shift = desiredAvg - ((minPosition + maxPosition) / 2);
    items.forEach((item) => {
      if (isHorizontal) item.node.y += shift;
      else item.node.x += shift;
    });
    layerNodes.splice(0, layerNodes.length, ...items.map((item) => item.node));
  };

  for (let i = 0; i < sweeps; i += 1) {
    for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) alignLayer(layers[layerIndex].nodes, incoming);
    for (let layerIndex = layers.length - 2; layerIndex >= 0; layerIndex -= 1) alignLayer(layers[layerIndex].nodes, outgoing);
  }

  if (isHorizontal) {
    let currentX = 50;
    layers.forEach((layer, index) => {
      const maxWidth = Math.max(...layer.nodes.map((node) => node.width));
      layer.nodes.forEach((node) => { node.x = currentX + (maxWidth - node.width) / 2; });
      const gap = index === layers.length - 1 ? 0 : (layerGapByRank.get(layer.rank) || minGap);
      currentX += maxWidth + gap;
    });
  } else {
    let currentY = 50;
    layers.forEach((layer, index) => {
      const maxHeight = Math.max(...layer.nodes.map((node) => node.height));
      layer.nodes.forEach((node) => { node.y = currentY + (maxHeight - node.height) / 2; });
      const gap = index === layers.length - 1 ? 0 : (layerGapByRank.get(layer.rank) || minGap);
      currentY += maxHeight + gap;
    });
  }

  const allNodes = Array.from(nodesMap.values());
  if (allNodes.length === 0) return;
  const minX = Math.min(...allNodes.map((node) => node.x));
  const minY = Math.min(...allNodes.map((node) => node.y));
  const shiftX = minX < 50 ? 50 - minX : 0;
  const shiftY = minY < 50 ? 50 - minY : 0;
  allNodes.forEach((node) => {
    node.x += shiftX;
    node.y += shiftY;
  });
}
function computeAbsolutePositions(rootNodes) {
  function compute(node, offsetX, offsetY) {
    node.absoluteX = offsetX + node.x;
    node.absoluteY = offsetY + node.y;
    node.children.forEach((child) => compute(child, node.absoluteX, node.absoluteY));
  }
  rootNodes.forEach((node) => compute(node, 0, 0));
}

function collectPositionedNodes(rootNodes, collapsedSet, cycleNodeIds = new Set()) {
  const positionedNodes = [];
  function collect(node, depth) {
    positionedNodes.push({
      id: node.id,
      x: node.absoluteX,
      y: node.absoluteY,
      width: node.width,
      height: node.height,
      depth,
      data: node.data,
      isContainer: node.data.is_container,
      isCollapsed: Boolean(node.data?.ui_is_collapsed || (collapsedSet ? collapsedSet.has(node.id) : false)),
      isCycle: cycleNodeIds.has(node.id),
      parentId: node.parent?.id || null,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      rank: Number.isFinite(node.rank) ? node.rank : 0,
    });
    node.children.forEach((child) => collect(child, depth + 1));
  }
  rootNodes.forEach((node) => collect(node, 0));
  return positionedNodes;
}

function buildFallbackPorts(edge, nodesMap, config) {
  const isHorizontal = (config.ORIENTATION || 'LR') === 'LR';
  const sourceNode = nodesMap.get(edge.source);
  const targetNode = nodesMap.get(edge.target);
  return {
    sourcePort: edge.sourcePort || {
      x: isHorizontal ? (sourceNode?.x || 0) + (sourceNode?.width || 0) : (sourceNode?.x || 0) + (sourceNode?.width || 0) / 2,
      y: isHorizontal ? (sourceNode?.y || 0) + (sourceNode?.height || 0) / 2 : (sourceNode?.y || 0) + (sourceNode?.height || 0),
      side: isHorizontal ? 'right' : 'bottom',
    },
    targetPort: edge.targetPort || {
      x: isHorizontal ? (targetNode?.x || 0) : (targetNode?.x || 0) + (targetNode?.width || 0) / 2,
      y: isHorizontal ? (targetNode?.y || 0) + (targetNode?.height || 0) / 2 : (targetNode?.y || 0),
      side: isHorizontal ? 'left' : 'top',
    },
  };
}

function buildFallbackPath(sourcePort, targetPort) {
  if (sourcePort.side === 'right' && targetPort.side === 'left') {
    const midX = (sourcePort.x + targetPort.x) / 2;
    return `M ${sourcePort.x} ${sourcePort.y} L ${midX} ${sourcePort.y} L ${midX} ${targetPort.y} L ${targetPort.x} ${targetPort.y}`;
  }
  if (sourcePort.side === 'left' && targetPort.side === 'right') {
    const midX = (sourcePort.x + targetPort.x) / 2;
    return `M ${sourcePort.x} ${sourcePort.y} L ${midX} ${sourcePort.y} L ${midX} ${targetPort.y} L ${targetPort.x} ${targetPort.y}`;
  }
  const midY = (sourcePort.y + targetPort.y) / 2;
  return `M ${sourcePort.x} ${sourcePort.y} L ${sourcePort.x} ${midY} L ${targetPort.x} ${midY} L ${targetPort.x} ${targetPort.y}`;
}

function computeOptimizedEdges(rawEdges, positionedNodes, config, metadata = {}) {
  const nodesMap = new Map(positionedNodes.map((node) => [node.id, {
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rank: node.rank,
  }]));
  const nodes = Array.from(nodesMap.values());
  const cycleEdgeKeys = metadata?.cycleEdgeKeys || new Set();
  const validEdges = rawEdges
    .filter((edge) => nodesMap.has(edge.source) && nodesMap.has(edge.target))
    .map((edge, idx) => ({ ...edge, id: edge.id || `edge-${edge.source}-${edge.target}-${idx}` }));
  if (validEdges.length === 0) return [];

  const ensuredEdges = (config.ENABLE_PORTS ? assignPortsToEdges(validEdges, nodesMap, { orientation: config.ORIENTATION }) : validEdges)
    .map((edge) => {
      const ports = buildFallbackPorts(edge, nodesMap, config);
      return { ...edge, sourcePort: ports.sourcePort, targetPort: ports.targetPort };
    });

  let routedEdges = config.ENABLE_ROUTING
    ? routeAllEdges(ensuredEdges, nodes, { strategy: 'orthogonal-bus', avoidCollisions: true, orientation: config.ORIENTATION })
    : ensuredEdges;

  routedEdges = routedEdges.map((edge) => ({ ...edge, path: edge.path || buildFallbackPath(edge.sourcePort, edge.targetPort) }));

  return routedEdges.map((edge, idx) => {
    const relation = typeof edge.relation === 'string' ? edge.relation : null;
    const relations = Array.isArray(edge.relations) ? edge.relations : (relation ? [relation] : []);
    return {
      id: edge.id || `edge-${edge.source}-${edge.target}-${idx}`,
      source: edge.source,
      target: edge.target,
      path: edge.path || buildFallbackPath(edge.sourcePort, edge.targetPort),
      sourcePort: edge.sourcePort,
      targetPort: edge.targetPort,
      hasObstacles: Boolean(edge.hasObstacles),
      isBundled: Boolean(edge.isBundled || edge.shared_trunk_id),
      relation,
      relations,
      ab_status: typeof edge.ab_status === 'string' ? edge.ab_status : null,
      aggregated_count: Number.isFinite(edge.aggregated_count) ? edge.aggregated_count : 1,
      original_pairs: Array.isArray(edge.original_pairs) ? edge.original_pairs : [],
      originalSource: edge.originalSource ?? edge.source,
      originalTarget: edge.originalTarget ?? edge.target,
      route_type: edge.route?.type || 'orthogonal-fallback',
      lane_id: edge.lane_id || null,
      shared_trunk_id: edge.shared_trunk_id || null,
      routing_scope: edge.routing_scope || (edge.route?.type === 'orthogonal-detour' ? 'external' : 'local'),
      is_cycle: Boolean(edge.is_cycle || cycleEdgeKeys.has(`${edge.source}->${edge.target}`)),
    };
  });
}

function computeRanks(graphData) {
  const ranks = new Map();
  const inDegree = new Map();
  const adjacency = new Map();
  const incoming = new Map();
  graphData.nodes.forEach((node) => {
    ranks.set(node.id, 0);
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    incoming.set(node.id, []);
  });
  graphData.edges.forEach((edge) => {
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    adjacency.get(edge.source).push(edge.target);
    incoming.get(edge.target).push(edge.source);
  });

  const queue = [];
  graphData.nodes.forEach((node) => { if (inDegree.get(node.id) === 0) queue.push(node.id); });
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentRank = ranks.get(currentId) || 0;
    const nextNodes = adjacency.get(currentId) || [];
    nextNodes.forEach((targetId) => {
      ranks.set(targetId, Math.max(ranks.get(targetId) || 0, currentRank + 1));
      inDegree.set(targetId, (inDegree.get(targetId) || 0) - 1);
      if (inDegree.get(targetId) === 0) queue.push(targetId);
    });
  }

  const unresolved = graphData.nodes.map((node) => node.id).filter((nodeId) => (inDegree.get(nodeId) || 0) > 0);
  if (unresolved.length > 0) {
    const resolvedRanks = Array.from(ranks.values());
    const baseRank = resolvedRanks.length > 0 ? Math.max(...resolvedRanks) + 1 : 1;
    unresolved.sort((a, b) => ((incoming.get(b)?.length || 0) - (incoming.get(a)?.length || 0))).forEach((nodeId, idx) => {
      const predecessors = incoming.get(nodeId) || [];
      const predecessorMax = predecessors.reduce((maxRank, predecessorId) => Math.max(maxRank, ranks.get(predecessorId) || 0), 0);
      ranks.set(nodeId, Math.max(predecessorMax, baseRank + (idx % 3)));
    });
  }
  return ranks;
}

export function computeDagreLayout(graphData, options = {}) {
  return computeHierarchicalLayout(graphData, options);
}

export { LAYOUT_CONFIG };
