export const PORT_CONFIG = {
    TOP_PORTS: 5,
    BOTTOM_PORTS: 5,
    LEFT_PORTS: 3,
    RIGHT_PORTS: 3,
    HORIZONTAL_MARGIN: 0.15,
    VERTICAL_MARGIN: 0.2,
    CORNER_PADDING: 10,
    EDGE_ENDPOINT_OFFSET: 0,
    OVERFLOW_JITTER: 4,
};

export const PortSide = {
    TOP: 'top',
    BOTTOM: 'bottom',
    LEFT: 'left',
    RIGHT: 'right',
};

function applyPortJitter(port, side, cycleIndex, totalCycles) {
    if (!port || totalCycles <= 1) return port;
    const center = (totalCycles - 1) / 2;
    const jitter = (cycleIndex - center) * PORT_CONFIG.OVERFLOW_JITTER;
    if (!Number.isFinite(jitter) || jitter === 0) return port;

    if (side === PortSide.TOP || side === PortSide.BOTTOM) {
        return {
            ...port,
            id: `${port.id}-j${cycleIndex}`,
            x: port.x + jitter,
            jitter_cycle: cycleIndex,
        };
    }

    return {
        ...port,
        id: `${port.id}-j${cycleIndex}`,
        y: port.y + jitter,
        jitter_cycle: cycleIndex,
    };
}

export function calculateNodePorts(node) {
    const { x, y, width, height } = node;
    const endpointOffset = PORT_CONFIG.EDGE_ENDPOINT_OFFSET;
    const ports = {
        [PortSide.TOP]: [],
        [PortSide.BOTTOM]: [],
        [PortSide.LEFT]: [],
        [PortSide.RIGHT]: [],
    };

    const topMargin = width * PORT_CONFIG.HORIZONTAL_MARGIN;
    const topSpacing = (width - 2 * topMargin) / (PORT_CONFIG.TOP_PORTS - 1);
    for (let index = 0; index < PORT_CONFIG.TOP_PORTS; index += 1) {
        ports[PortSide.TOP].push({
            id: `${node.id}-top-${index}`,
            x: x + topMargin + index * topSpacing,
            y: y - endpointOffset,
            side: PortSide.TOP,
            index,
            nodeId: node.id,
        });
    }

    const bottomMargin = width * PORT_CONFIG.HORIZONTAL_MARGIN;
    const bottomSpacing = (width - 2 * bottomMargin) / (PORT_CONFIG.BOTTOM_PORTS - 1);
    for (let index = 0; index < PORT_CONFIG.BOTTOM_PORTS; index += 1) {
        ports[PortSide.BOTTOM].push({
            id: `${node.id}-bottom-${index}`,
            x: x + bottomMargin + index * bottomSpacing,
            y: y + height + endpointOffset,
            side: PortSide.BOTTOM,
            index,
            nodeId: node.id,
        });
    }

    const leftMargin = height * PORT_CONFIG.VERTICAL_MARGIN;
    const leftSpacing = (height - 2 * leftMargin) / (PORT_CONFIG.LEFT_PORTS - 1);
    for (let index = 0; index < PORT_CONFIG.LEFT_PORTS; index += 1) {
        ports[PortSide.LEFT].push({
            id: `${node.id}-left-${index}`,
            x: x - endpointOffset,
            y: y + leftMargin + index * leftSpacing,
            side: PortSide.LEFT,
            index,
            nodeId: node.id,
        });
    }

    const rightMargin = height * PORT_CONFIG.VERTICAL_MARGIN;
    const rightSpacing = (height - 2 * rightMargin) / (PORT_CONFIG.RIGHT_PORTS - 1);
    for (let index = 0; index < PORT_CONFIG.RIGHT_PORTS; index += 1) {
        ports[PortSide.RIGHT].push({
            id: `${node.id}-right-${index}`,
            x: x + width + endpointOffset,
            y: y + rightMargin + index * rightSpacing,
            side: PortSide.RIGHT,
            index,
            nodeId: node.id,
        });
    }

    return ports;
}

export function determineOptimalSides(source, target, options = {}) {
    const sourceCenter = {
        x: source.x + source.width / 2,
        y: source.y + source.height / 2,
    };
    const targetCenter = {
        x: target.x + target.width / 2,
        y: target.y + target.height / 2,
    };

    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;
    const orientation = options.orientation || 'LR';

    if (orientation === 'LR') {
        if (dx > source.width * 0.45) {
            return { sourceSide: PortSide.RIGHT, targetSide: PortSide.LEFT };
        }
        if (dx < -target.width * 0.45) {
            return { sourceSide: PortSide.LEFT, targetSide: PortSide.RIGHT };
        }
        if (dy >= 0) {
            return { sourceSide: PortSide.BOTTOM, targetSide: PortSide.TOP };
        }
        return { sourceSide: PortSide.TOP, targetSide: PortSide.BOTTOM };
    }

    if (dy > source.height * 0.5) {
        return { sourceSide: PortSide.BOTTOM, targetSide: PortSide.TOP };
    }
    if (dy < -target.height * 0.5) {
        return { sourceSide: PortSide.TOP, targetSide: PortSide.BOTTOM };
    }
    if (dx > 0) {
        return { sourceSide: PortSide.RIGHT, targetSide: PortSide.LEFT };
    }
    return { sourceSide: PortSide.LEFT, targetSide: PortSide.RIGHT };
}

function getConnectedCenter(entry, role) {
    const node = role === 'source' ? entry.source : entry.target;
    return {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
    };
}

function buildEntrySorter(side, role, orientation) {
    return (a, b) => {
        const aCenter = getConnectedCenter(a, role);
        const bCenter = getConnectedCenter(b, role);
        const aRank = role === 'source' ? (a.source.rank ?? 0) : (a.target.rank ?? 0);
        const bRank = role === 'source' ? (b.source.rank ?? 0) : (b.target.rank ?? 0);

        if (orientation === 'LR') {
            if (side === PortSide.LEFT || side === PortSide.RIGHT) {
                if (aCenter.y !== bCenter.y) return aCenter.y - bCenter.y;
                if (aCenter.x !== bCenter.x) return aCenter.x - bCenter.x;
            } else {
                if (aCenter.x !== bCenter.x) return aCenter.x - bCenter.x;
                if (aCenter.y !== bCenter.y) return aCenter.y - bCenter.y;
            }
        } else if (side === PortSide.TOP || side === PortSide.BOTTOM) {
            if (aCenter.x !== bCenter.x) return aCenter.x - bCenter.x;
            if (aCenter.y !== bCenter.y) return aCenter.y - bCenter.y;
        } else {
            if (aCenter.y !== bCenter.y) return aCenter.y - bCenter.y;
            if (aCenter.x !== bCenter.x) return aCenter.x - bCenter.x;
        }

        if (aRank !== bRank) return aRank - bRank;
        return a.edgeIndex - b.edgeIndex;
    };
}

export function assignPortsToEdges(edges, nodesMap, options = {}) {
    const orientation = options.orientation || 'LR';
    const nodePorts = new Map();
    nodesMap.forEach((node, id) => {
        nodePorts.set(id, calculateNodePorts(node));
    });

    const edgesBySourceSide = new Map();
    const edgesByTargetSide = new Map();

    edges.forEach((edge, edgeIndex) => {
        const source = nodesMap.get(edge.source);
        const target = nodesMap.get(edge.target);
        if (!source || !target) return;

        const { sourceSide, targetSide } = determineOptimalSides(source, target, options);
        const sourceKey = `${edge.source}-${sourceSide}`;
        const targetKey = `${edge.target}-${targetSide}`;

        if (!edgesBySourceSide.has(sourceKey)) edgesBySourceSide.set(sourceKey, []);
        if (!edgesByTargetSide.has(targetKey)) edgesByTargetSide.set(targetKey, []);

        edgesBySourceSide.get(sourceKey).push({ edge, edgeIndex, source, target });
        edgesByTargetSide.get(targetKey).push({ edge, edgeIndex, source, target });
    });

    const assignedEdges = edges.map((edge) => ({
        ...edge,
        sourcePort: null,
        targetPort: null,
    }));

    edgesBySourceSide.forEach((edgeList, key) => {
        const parts = key.split('-');
        const side = parts.pop();
        const nodeId = parts.join('-');
        const ports = nodePorts.get(nodeId)?.[side];
        if (!ports?.length) return;

        edgeList.sort(buildEntrySorter(side, 'target', orientation));
        const useRoundRobin = edgeList.length > ports.length;
        const overflowCycles = Math.ceil(edgeList.length / ports.length);
        const step = ports.length / edgeList.length;

        edgeList.forEach((item, index) => {
            const portIndex = useRoundRobin
                ? (index % ports.length)
                : Math.min(Math.floor(index * step + step / 2), ports.length - 1);
            const cycleIndex = useRoundRobin ? Math.floor(index / ports.length) : 0;
            assignedEdges[item.edgeIndex].sourcePort = applyPortJitter(
                ports[portIndex],
                side,
                cycleIndex,
                overflowCycles,
            );
            assignedEdges[item.edgeIndex].sourceSide = side;
        });
    });

    edgesByTargetSide.forEach((edgeList, key) => {
        const parts = key.split('-');
        const side = parts.pop();
        const nodeId = parts.join('-');
        const ports = nodePorts.get(nodeId)?.[side];
        if (!ports?.length) return;

        edgeList.sort(buildEntrySorter(side, 'source', orientation));
        const useRoundRobin = edgeList.length > ports.length;
        const overflowCycles = Math.ceil(edgeList.length / ports.length);
        const step = ports.length / edgeList.length;

        edgeList.forEach((item, index) => {
            const portIndex = useRoundRobin
                ? (index % ports.length)
                : Math.min(Math.floor(index * step + step / 2), ports.length - 1);
            const cycleIndex = useRoundRobin ? Math.floor(index / ports.length) : 0;
            assignedEdges[item.edgeIndex].targetPort = applyPortJitter(
                ports[portIndex],
                side,
                cycleIndex,
                overflowCycles,
            );
            assignedEdges[item.edgeIndex].targetSide = side;
        });
    });

    return assignedEdges;
}

function movePointFromPort(port, distance) {
    switch (port.side) {
        case PortSide.TOP:
            return { x: port.x, y: port.y - distance };
        case PortSide.BOTTOM:
            return { x: port.x, y: port.y + distance };
        case PortSide.LEFT:
            return { x: port.x - distance, y: port.y };
        case PortSide.RIGHT:
        default:
            return { x: port.x + distance, y: port.y };
    }
}

function generateOrthogonalPath(points) {
    if (!points || points.length < 2) return null;
    const compact = [];
    points.forEach((point) => {
        if (!point) return;
        const previous = compact[compact.length - 1];
        if (previous && previous.x === point.x && previous.y === point.y) return;
        compact.push(point);
    });
    return compact.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function calculateEdgeControlPoints(edge) {
    const { sourcePort, targetPort } = edge;
    if (!sourcePort || !targetPort) return null;

    const sourceStub = movePointFromPort(sourcePort, 18);
    const targetStub = movePointFromPort(targetPort, 18);
    const midY = (sourceStub.y + targetStub.y) / 2;

    return {
        source: { x: sourcePort.x, y: sourcePort.y },
        target: { x: targetPort.x, y: targetPort.y },
        controlPoint1: sourceStub,
        controlPoint2: { x: sourceStub.x, y: midY },
        controlPoint3: { x: targetStub.x, y: midY },
        controlPoint4: targetStub,
    };
}

export function generateEdgePath(controlPoints) {
    if (!controlPoints) return null;
    return generateOrthogonalPath([
        controlPoints.source,
        controlPoints.controlPoint1,
        controlPoints.controlPoint2,
        controlPoints.controlPoint3,
        controlPoints.controlPoint4,
        controlPoints.target,
    ]);
}

function generateFallbackPath(edge, nodesMap) {
    const source = nodesMap.get(edge.source);
    const target = nodesMap.get(edge.target);
    if (!source || !target) return '';

    const sourceX = source.x + source.width / 2;
    const sourceY = source.y + source.height;
    const targetX = target.x + target.width / 2;
    const targetY = target.y;
    const midY = (sourceY + targetY) / 2;
    return `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`;
}

export function computeEdgePaths(edges, nodes) {
    const nodesMap = nodes instanceof Map
        ? nodes
        : new Map(nodes.map((node) => [node.id, node]));

    const edgesWithPorts = assignPortsToEdges(edges, nodesMap);

    return edgesWithPorts.map((edge) => {
        const controlPoints = calculateEdgeControlPoints(edge);
        const path = generateEdgePath(controlPoints);

        return {
            ...edge,
            path: path || generateFallbackPath(edge, nodesMap),
            controlPoints,
        };
    });
}

const edgePorts = {
    calculateNodePorts,
    determineOptimalSides,
    assignPortsToEdges,
    calculateEdgeControlPoints,
    generateEdgePath,
    computeEdgePaths,
    PORT_CONFIG,
    PortSide,
};

export default edgePorts;
