import { PortSide } from './edgePorts';

export const ROUTING_CONFIG = {
    NODE_PADDING: 15,
    EDGE_SPACING: 8,
    EXIT_STUB: 18,
    EXTERNAL_LANE_SPACING: 34,
    EXTERNAL_LANE_COUNT: 4,
    LANE_SEPARATION: 24,
    ENVELOPE_MARGIN: 28,
    SHARED_TRUNK_MIN_LENGTH: 18,
};

export const RoutingType = {
    DIRECT: 'direct',
    ORTHOGONAL: 'orthogonal',
    CURVED: 'curved',
    BUNDLED: 'bundled',
    ORTHOGONAL_BUS: 'orthogonal-bus',
    ORTHOGONAL_DETOUR: 'orthogonal-detour',
    ORTHOGONAL_FALLBACK: 'orthogonal-fallback',
};

function expandRect(rect, padding) {
    return {
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + 2 * padding,
        height: rect.height + 2 * padding,
    };
}

function pointInRect(point, rect) {
    return (
        point.x >= rect.x
        && point.x <= rect.x + rect.width
        && point.y >= rect.y
        && point.y <= rect.y + rect.height
    );
}

function direction(p1, p2, p3) {
    return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

function onSegment(p1, p2, p) {
    return (
        Math.min(p1.x, p2.x) <= p.x
        && p.x <= Math.max(p1.x, p2.x)
        && Math.min(p1.y, p2.y) <= p.y
        && p.y <= Math.max(p1.y, p2.y)
    );
}

function segmentsIntersect(a1, a2, b1, b2) {
    const d1 = direction(b1, b2, a1);
    const d2 = direction(b1, b2, a2);
    const d3 = direction(a1, a2, b1);
    const d4 = direction(a1, a2, b2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    if (d1 === 0 && onSegment(b1, b2, a1)) return true;
    if (d2 === 0 && onSegment(b1, b2, a2)) return true;
    if (d3 === 0 && onSegment(a1, a2, b1)) return true;
    if (d4 === 0 && onSegment(a1, a2, b2)) return true;

    return false;
}

function lineIntersectsRect(p1, p2, rect) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    if (Math.max(p1.x, p2.x) < left || Math.min(p1.x, p2.x) > right) return false;
    if (Math.max(p1.y, p2.y) < top || Math.min(p1.y, p2.y) > bottom) return false;
    if (pointInRect(p1, rect) || pointInRect(p2, rect)) return true;

    const sides = [
        [{ x: left, y: top }, { x: right, y: top }],
        [{ x: right, y: top }, { x: right, y: bottom }],
        [{ x: right, y: bottom }, { x: left, y: bottom }],
        [{ x: left, y: bottom }, { x: left, y: top }],
    ];

    return sides.some(([s1, s2]) => segmentsIntersect(p1, p2, s1, s2));
}

function collectObstacleRects(obstacles = []) {
    return obstacles.map((obstacle) => (
        obstacle?.expanded
            ? obstacle.expanded
            : expandRect(obstacle, 0)
    ));
}

function normalizeWaypoints(waypoints) {
    const compact = [];
    waypoints.forEach((point) => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        const previous = compact[compact.length - 1];
        if (previous && previous.x === point.x && previous.y === point.y) return;
        compact.push({ x: point.x, y: point.y });
    });

    if (compact.length <= 2) return compact;

    const normalized = [compact[0]];
    for (let index = 1; index < compact.length - 1; index += 1) {
        const prev = normalized[normalized.length - 1];
        const curr = compact[index];
        const next = compact[index + 1];
        const sameVertical = prev.x === curr.x && curr.x === next.x;
        const sameHorizontal = prev.y === curr.y && curr.y === next.y;
        if (sameVertical || sameHorizontal) continue;
        normalized.push(curr);
    }
    normalized.push(compact[compact.length - 1]);
    return normalized;
}

function manhattanDistance(waypoints) {
    return waypoints.slice(1).reduce((sum, point, index) => {
        const prev = waypoints[index];
        return sum + Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y);
    }, 0);
}

function countCollisionsForWaypoints(waypoints, obstacleRects) {
    let collisions = 0;
    for (let index = 1; index < waypoints.length; index += 1) {
        const p1 = waypoints[index - 1];
        const p2 = waypoints[index];
        if (obstacleRects.some((rect) => lineIntersectsRect(p1, p2, rect))) {
            collisions += 1;
        }
    }
    return collisions;
}

function scoreWaypoints(waypoints, obstacleRects) {
    const points = normalizeWaypoints(waypoints);
    return {
        points,
        collisions: countCollisionsForWaypoints(points, obstacleRects),
        distance: manhattanDistance(points),
    };
}

function generateOrthogonalPath(waypoints) {
    const points = normalizeWaypoints(waypoints);
    if (points.length < 2) return '';
    return points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');
}

export function findObstacles(sourcePoint, targetPoint, nodes, excludeIds = []) {
    const obstacles = [];

    nodes.forEach((node) => {
        if (excludeIds.includes(node.id)) return;
        const expandedRect = expandRect(node, ROUTING_CONFIG.NODE_PADDING);
        if (lineIntersectsRect(sourcePoint, targetPoint, expandedRect)) {
            obstacles.push({
                ...node,
                expanded: expandedRect,
            });
        }
    });

    return obstacles;
}

function buildSimpleOrthogonalWaypoints(source, target, sourceSide, targetSide) {
    const points = [source];

    if (sourceSide === PortSide.RIGHT && targetSide === PortSide.LEFT) {
        const midX = (source.x + target.x) / 2;
        points.push({ x: midX, y: source.y });
        points.push({ x: midX, y: target.y });
    } else if (sourceSide === PortSide.LEFT && targetSide === PortSide.RIGHT) {
        const midX = (source.x + target.x) / 2;
        points.push({ x: midX, y: source.y });
        points.push({ x: midX, y: target.y });
    } else {
        const midY = (source.y + target.y) / 2;
        points.push({ x: source.x, y: midY });
        points.push({ x: target.x, y: midY });
    }

    points.push(target);
    return normalizeWaypoints(points);
}

function buildVerticalDetour(source, target, sourceSide, targetSide, detourX, margin) {
    const sourceOffsetY = sourceSide === PortSide.BOTTOM
        ? margin
        : (sourceSide === PortSide.TOP ? -margin : 0);
    const targetOffsetY = targetSide === PortSide.TOP
        ? -margin
        : (targetSide === PortSide.BOTTOM ? margin : 0);
    return normalizeWaypoints([
        source,
        { x: source.x, y: source.y + sourceOffsetY },
        { x: detourX, y: source.y + sourceOffsetY },
        { x: detourX, y: target.y + targetOffsetY },
        { x: target.x, y: target.y + targetOffsetY },
        target,
    ]);
}

function buildHorizontalDetour(source, target, sourceSide, targetSide, detourY, margin) {
    const sourceOffsetX = sourceSide === PortSide.RIGHT
        ? margin
        : (sourceSide === PortSide.LEFT ? -margin : 0);
    const targetOffsetX = targetSide === PortSide.LEFT
        ? -margin
        : (targetSide === PortSide.RIGHT ? margin : 0);
    return normalizeWaypoints([
        source,
        { x: source.x + sourceOffsetX, y: source.y },
        { x: source.x + sourceOffsetX, y: detourY },
        { x: target.x + targetOffsetX, y: detourY },
        { x: target.x + targetOffsetX, y: target.y },
        target,
    ]);
}

export function calculateOrthogonalWaypoints(source, target, obstacles, sourceSide, targetSide) {
    const margin = ROUTING_CONFIG.NODE_PADDING + ROUTING_CONFIG.EDGE_SPACING;
    const obstacleRects = collectObstacleRects(obstacles);
    const simpleScore = scoreWaypoints(
        buildSimpleOrthogonalWaypoints(source, target, sourceSide, targetSide),
        obstacleRects,
    );

    if (simpleScore.collisions === 0 || obstacleRects.length === 0) {
        return simpleScore.points;
    }

    const minObstacleX = Math.min(...obstacleRects.map((rect) => rect.x));
    const maxObstacleX = Math.max(...obstacleRects.map((rect) => rect.x + rect.width));
    const minObstacleY = Math.min(...obstacleRects.map((rect) => rect.y));
    const maxObstacleY = Math.max(...obstacleRects.map((rect) => rect.y + rect.height));

    const mostlyHorizontal = (
        (sourceSide === PortSide.LEFT || sourceSide === PortSide.RIGHT)
        && (targetSide === PortSide.LEFT || targetSide === PortSide.RIGHT)
    );

    const candidates = [simpleScore];
    if (mostlyHorizontal) {
        candidates.push(
            scoreWaypoints(
                buildHorizontalDetour(source, target, sourceSide, targetSide, minObstacleY - margin, margin),
                obstacleRects,
            ),
        );
        candidates.push(
            scoreWaypoints(
                buildHorizontalDetour(source, target, sourceSide, targetSide, maxObstacleY + margin, margin),
                obstacleRects,
            ),
        );
    } else {
        candidates.push(
            scoreWaypoints(
                buildVerticalDetour(source, target, sourceSide, targetSide, minObstacleX - margin, margin),
                obstacleRects,
            ),
        );
        candidates.push(
            scoreWaypoints(
                buildVerticalDetour(source, target, sourceSide, targetSide, maxObstacleX + margin, margin),
                obstacleRects,
            ),
        );
    }

    candidates.sort((a, b) => {
        if (a.collisions !== b.collisions) return a.collisions - b.collisions;
        return a.distance - b.distance;
    });

    return candidates[0].points;
}

export function routeOrthogonal(sourcePort, targetPort, obstacles = []) {
    const source = { x: sourcePort.x, y: sourcePort.y };
    const target = { x: targetPort.x, y: targetPort.y };
    const waypoints = calculateOrthogonalWaypoints(
        source,
        target,
        obstacles,
        sourcePort.side,
        targetPort.side,
    );

    return {
        type: RoutingType.ORTHOGONAL,
        waypoints,
        path: generateOrthogonalPath(waypoints),
    };
}

export function routeDirect(sourcePort, targetPort) {
    const route = routeOrthogonal(sourcePort, targetPort, []);
    return {
        ...route,
        type: RoutingType.DIRECT,
    };
}

export function routeCurved(sourcePort, targetPort, obstacles = []) {
    const route = routeOrthogonal(sourcePort, targetPort, obstacles);
    return {
        ...route,
        type: RoutingType.CURVED,
    };
}

function getNodeCenter(node) {
    return {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
    };
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

function buildRankData(nodesById) {
    const nodesByRank = new Map();
    nodesById.forEach((node) => {
        const rank = Number.isFinite(node.rank) ? node.rank : 0;
        if (!nodesByRank.has(rank)) nodesByRank.set(rank, []);
        nodesByRank.get(rank).push(node);
    });

    const rankBounds = new Map();
    const sortedRanks = Array.from(nodesByRank.keys()).sort((a, b) => a - b);
    sortedRanks.forEach((rank) => {
        const rankNodes = nodesByRank.get(rank);
        rankBounds.set(rank, {
            left: Math.min(...rankNodes.map((node) => node.x)),
            right: Math.max(...rankNodes.map((node) => node.x + node.width)),
            top: Math.min(...rankNodes.map((node) => node.y)),
            bottom: Math.max(...rankNodes.map((node) => node.y + node.height)),
        });
    });

    const corridorXByRank = new Map();
    for (let index = 0; index < sortedRanks.length - 1; index += 1) {
        const rank = sortedRanks[index];
        const nextRank = sortedRanks[index + 1];
        const left = rankBounds.get(rank)?.right ?? 0;
        const right = rankBounds.get(nextRank)?.left ?? left + ROUTING_CONFIG.EXIT_STUB * 2;
        corridorXByRank.set(rank, left < right ? (left + right) / 2 : left + ROUTING_CONFIG.EXIT_STUB);
    }

    return { nodesByRank, rankBounds, corridorXByRank };
}

function buildLocalEnvelope(sourcePort, targetPort) {
    const margin = ROUTING_CONFIG.NODE_PADDING + ROUTING_CONFIG.EDGE_SPACING + ROUTING_CONFIG.ENVELOPE_MARGIN;
    return {
        top: Math.min(sourcePort.y, targetPort.y) - margin,
        bottom: Math.max(sourcePort.y, targetPort.y) + margin,
    };
}

function addUniqueCandidate(candidates, y, kind = 'internal') {
    if (!Number.isFinite(y)) return;
    if (candidates.some((candidate) => Math.abs(candidate.y - y) < 2)) return;
    candidates.push({ y, kind });
}

function mergeVerticalIntervals(nodes) {
    const padding = ROUTING_CONFIG.NODE_PADDING + ROUTING_CONFIG.EDGE_SPACING;
    const intervals = (nodes || [])
        .map((node) => ({
            top: node.y - padding,
            bottom: node.y + node.height + padding,
        }))
        .sort((a, b) => a.top - b.top);

    const merged = [];
    intervals.forEach((interval) => {
        const previous = merged[merged.length - 1];
        if (!previous || interval.top > previous.bottom) {
            merged.push({ ...interval });
        } else {
            previous.bottom = Math.max(previous.bottom, interval.bottom);
        }
    });
    return merged;
}

function buildRankCrossingCandidates(rankNodes, envelope, desiredY, allowExternal = false) {
    const intervals = mergeVerticalIntervals(rankNodes);
    const candidates = [];
    const lowerBound = envelope.top;
    const upperBound = envelope.bottom;

    let cursor = lowerBound;
    intervals.forEach((interval) => {
        const gapTop = cursor;
        const gapBottom = Math.min(interval.top, upperBound);
        if (gapBottom - gapTop >= 8) {
            const clamped = Math.min(Math.max(desiredY, gapTop + 4), gapBottom - 4);
            addUniqueCandidate(candidates, clamped, 'internal');
            addUniqueCandidate(candidates, (gapTop + gapBottom) / 2, 'internal');
        }
        cursor = Math.max(cursor, interval.bottom);
    });

    if (upperBound - cursor >= 8) {
        const clamped = Math.min(Math.max(desiredY, cursor + 4), upperBound - 4);
        addUniqueCandidate(candidates, clamped, 'internal');
        addUniqueCandidate(candidates, (cursor + upperBound) / 2, 'internal');
    }

    if (candidates.length > 0 || !allowExternal) {
        return candidates;
    }

    for (let index = 1; index <= ROUTING_CONFIG.EXTERNAL_LANE_COUNT; index += 1) {
        const offset = ROUTING_CONFIG.EXTERNAL_LANE_SPACING * index;
        addUniqueCandidate(candidates, envelope.top - offset, 'external-top');
        addUniqueCandidate(candidates, envelope.bottom + offset, 'external-bottom');
    }

    return candidates;
}

function buildAdjacentLaneCandidates(sourcePort, targetPort, envelope) {
    const candidates = [];
    const desiredY = (sourcePort.y + targetPort.y) / 2;
    const offsets = [0, -ROUTING_CONFIG.LANE_SEPARATION, ROUTING_CONFIG.LANE_SEPARATION];

    offsets.forEach((offset) => {
        addUniqueCandidate(
            candidates,
            Math.min(Math.max(desiredY + offset, envelope.top), envelope.bottom),
            'internal',
        );
    });

    addUniqueCandidate(candidates, sourcePort.y, 'internal');
    addUniqueCandidate(candidates, targetPort.y, 'internal');
    return candidates;
}

function getUsageValues(usageMap, key) {
    return usageMap.get(key) || [];
}

function pushUsageValue(usageMap, key, y) {
    if (!usageMap.has(key)) usageMap.set(key, []);
    usageMap.get(key).push(y);
}

function scoreCandidate(candidate, {
    desiredY,
    currentY,
    envelope,
    usageValues,
}) {
    const overshoot = candidate.y < envelope.top
        ? envelope.top - candidate.y
        : (candidate.y > envelope.bottom ? candidate.y - envelope.bottom : 0);
    const reusePenalty = usageValues.reduce((sum, usedY) => {
        const distance = Math.abs(usedY - candidate.y);
        if (distance < ROUTING_CONFIG.LANE_SEPARATION * 0.7) return sum + 320;
        if (distance < ROUTING_CONFIG.LANE_SEPARATION * 1.4) return sum + 90;
        return sum;
    }, 0);
    const externalPenalty = candidate.kind.startsWith('external') ? 1800 : 0;

    return (
        externalPenalty
        + reusePenalty
        + overshoot * 40
        + Math.abs(candidate.y - desiredY) * 1.4
        + Math.abs(candidate.y - currentY) * 0.85
    );
}

function chooseCandidate(candidates, context) {
    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
        const score = scoreCandidate(candidate, context);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    });

    return best;
}

function buildSourceStub(port, corridorX) {
    const moved = movePointFromPort(port, ROUTING_CONFIG.EXIT_STUB);
    if (port.side === PortSide.RIGHT) {
        return { x: Math.min(moved.x, corridorX), y: moved.y };
    }
    if (port.side === PortSide.LEFT) {
        return { x: Math.max(moved.x, corridorX), y: moved.y };
    }
    return moved;
}

function buildTargetStub(port, corridorX) {
    const moved = movePointFromPort(port, ROUTING_CONFIG.EXIT_STUB);
    if (port.side === PortSide.LEFT) {
        return { x: Math.max(moved.x, corridorX), y: moved.y };
    }
    if (port.side === PortSide.RIGHT) {
        return { x: Math.min(moved.x, corridorX), y: moved.y };
    }
    return moved;
}

function countEdgeObstacleCollisions(edge, waypoints, nodesById, nodes) {
    const obstacleRects = nodes
        .filter((node) => node.id !== edge.source && node.id !== edge.target)
        .map((node) => expandRect(node, ROUTING_CONFIG.NODE_PADDING));
    return countCollisionsForWaypoints(waypoints, obstacleRects);
}

function buildForwardLocalWaypoints(edge, sourceNode, targetNode, rankData, usageMap) {
    const sourceRank = Number.isFinite(sourceNode.rank) ? sourceNode.rank : 0;
    const targetRank = Number.isFinite(targetNode.rank) ? targetNode.rank : sourceRank;
    const span = targetRank - sourceRank;
    const envelope = buildLocalEnvelope(edge.sourcePort, edge.targetPort);
    const firstCorridorX = rankData.corridorXByRank.get(sourceRank)
        ?? ((edge.sourcePort.x + edge.targetPort.x) / 2);
    const lastCorridorX = rankData.corridorXByRank.get(targetRank - 1) ?? firstCorridorX;
    const sourceStub = buildSourceStub(edge.sourcePort, firstCorridorX);
    const targetStub = buildTargetStub(edge.targetPort, lastCorridorX);
    const points = [
        { x: edge.sourcePort.x, y: edge.sourcePort.y },
    ];

    if (sourceStub.x !== edge.sourcePort.x || sourceStub.y !== edge.sourcePort.y) {
        points.push(sourceStub);
    }

    let currentX = sourceStub.x;
    let currentY = sourceStub.y;
    const laneSignature = [];
    let usedExternalLane = false;

    if (span <= 1) {
        const corridorKey = `corridor:${sourceRank}`;
        const laneY = chooseCandidate(
            buildAdjacentLaneCandidates(edge.sourcePort, edge.targetPort, envelope),
            {
                desiredY: (edge.sourcePort.y + edge.targetPort.y) / 2,
                currentY,
                envelope,
                usageValues: getUsageValues(usageMap, corridorKey),
            },
        );
        pushUsageValue(usageMap, corridorKey, laneY.y);
        laneSignature.push(`${sourceRank}:${Math.round(laneY.y)}`);

        if (currentX !== firstCorridorX) {
            points.push({ x: firstCorridorX, y: currentY });
            currentX = firstCorridorX;
        }
        if (laneY.y !== currentY) {
            points.push({ x: currentX, y: laneY.y });
            currentY = laneY.y;
        }
    } else {
        if (currentX !== firstCorridorX) {
            points.push({ x: firstCorridorX, y: currentY });
            currentX = firstCorridorX;
        }

        for (let rank = sourceRank + 1; rank < targetRank; rank += 1) {
            const desiredY = edge.sourcePort.y
                + ((edge.targetPort.y - edge.sourcePort.y) * (rank - sourceRank) / span);
            let candidates = buildRankCrossingCandidates(
                rankData.nodesByRank.get(rank) || [],
                envelope,
                desiredY,
                false,
            );
            if (candidates.length === 0) {
                candidates = buildRankCrossingCandidates(
                    rankData.nodesByRank.get(rank) || [],
                    envelope,
                    desiredY,
                    true,
                );
            }

            const chosen = chooseCandidate(candidates, {
                desiredY,
                currentY,
                envelope,
                usageValues: getUsageValues(usageMap, `cross:${rank}`),
            });

            pushUsageValue(usageMap, `cross:${rank}`, chosen.y);
            laneSignature.push(`${rank}:${Math.round(chosen.y)}`);
            usedExternalLane = usedExternalLane || chosen.kind.startsWith('external');

            if (chosen.y !== currentY) {
                points.push({ x: currentX, y: chosen.y });
                currentY = chosen.y;
            }

            const nextX = rankData.corridorXByRank.get(rank) ?? lastCorridorX;
            if (nextX !== currentX) {
                points.push({ x: nextX, y: currentY });
                currentX = nextX;
            }
        }
    }

    if (currentY !== targetStub.y) {
        points.push({ x: currentX, y: targetStub.y });
        currentY = targetStub.y;
    }
    if (targetStub.x !== currentX || targetStub.y !== currentY) {
        points.push(targetStub);
    }
    points.push({ x: edge.targetPort.x, y: edge.targetPort.y });

    return {
        waypoints: normalizeWaypoints(points),
        routeType: usedExternalLane ? RoutingType.ORTHOGONAL_FALLBACK : RoutingType.ORTHOGONAL_BUS,
        routingScope: usedExternalLane ? 'external' : 'local',
        laneId: `local:${sourceRank}->${targetRank}:${laneSignature.join('|') || Math.round((edge.sourcePort.y + edge.targetPort.y) / 2)}`,
    };
}

function buildExternalCandidates(envelope) {
    const candidates = [];
    for (let index = 1; index <= ROUTING_CONFIG.EXTERNAL_LANE_COUNT; index += 1) {
        const offset = ROUTING_CONFIG.EXTERNAL_LANE_SPACING * index;
        addUniqueCandidate(candidates, envelope.top - offset, 'external-top');
        addUniqueCandidate(candidates, envelope.bottom + offset, 'external-bottom');
    }
    return candidates;
}

function buildExternalLocalRoute(edge, sourceNode, targetNode, nodesById, nodes, usageMap) {
    const sourceStub = movePointFromPort(edge.sourcePort, ROUTING_CONFIG.EXIT_STUB);
    const targetStub = movePointFromPort(edge.targetPort, ROUTING_CONFIG.EXIT_STUB);
    const envelope = buildLocalEnvelope(edge.sourcePort, edge.targetPort);
    const desiredY = (edge.sourcePort.y + edge.targetPort.y) / 2;
    const graphMidY = (getNodeCenter(sourceNode).y + getNodeCenter(targetNode).y) / 2;
    const preferredBand = desiredY <= graphMidY ? 'top' : 'bottom';
    const usageKey = `external:${Math.min(sourceNode.rank ?? 0, targetNode.rank ?? 0)}:${Math.max(sourceNode.rank ?? 0, targetNode.rank ?? 0)}`;

    let bestCandidate = null;
    let bestScore = Number.POSITIVE_INFINITY;
    buildExternalCandidates(envelope).forEach((candidate) => {
        const waypoints = normalizeWaypoints([
            { x: edge.sourcePort.x, y: edge.sourcePort.y },
            sourceStub,
            { x: sourceStub.x, y: candidate.y },
            { x: targetStub.x, y: candidate.y },
            { x: targetStub.x, y: targetStub.y },
            { x: edge.targetPort.x, y: edge.targetPort.y },
        ]);
        const collisions = countEdgeObstacleCollisions(edge, waypoints, nodesById, nodes);
        const bandMismatch = preferredBand === 'top'
            ? (candidate.kind === 'external-bottom' ? 120 : 0)
            : (candidate.kind === 'external-top' ? 120 : 0);
        const score = (
            collisions * 100000
            + bandMismatch * 100
            + scoreCandidate(candidate, {
                desiredY,
                currentY: edge.sourcePort.y,
                envelope,
                usageValues: getUsageValues(usageMap, usageKey),
            })
        );

        if (score < bestScore) {
            bestScore = score;
            bestCandidate = { candidate, waypoints, collisions };
        }
    });

    pushUsageValue(usageMap, usageKey, bestCandidate.candidate.y);
    return {
        waypoints: bestCandidate.waypoints,
        routeType: RoutingType.ORTHOGONAL_DETOUR,
        routingScope: 'external',
        laneId: `${bestCandidate.candidate.kind}:${Math.round(bestCandidate.candidate.y)}`,
        collisions: bestCandidate.collisions,
    };
}

function routeOrthogonalFallback(edge, nodesById, nodes) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!edge.sourcePort || !edge.targetPort || !sourceNode || !targetNode) {
        return {
            ...edge,
            route: {
                type: RoutingType.ORTHOGONAL_FALLBACK,
                waypoints: [],
            },
            path: '',
            lane_id: null,
            shared_trunk_id: null,
            routing_scope: 'external',
            hasObstacles: false,
            isBundled: false,
        };
    }

    const obstacles = findObstacles(
        { x: edge.sourcePort.x, y: edge.sourcePort.y },
        { x: edge.targetPort.x, y: edge.targetPort.y },
        nodes,
        [edge.source, edge.target],
    );
    const route = routeOrthogonal(edge.sourcePort, edge.targetPort, obstacles);
    return {
        ...edge,
        route: {
            ...route,
            type: RoutingType.ORTHOGONAL_FALLBACK,
        },
        path: route.path,
        lane_id: null,
        shared_trunk_id: null,
        routing_scope: 'external',
        hasObstacles: obstacles.length > 0,
        isBundled: false,
    };
}

function extractHorizontalSegments(edge) {
    const points = normalizeWaypoints(edge.route?.waypoints || []);
    const segments = [];

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start.y !== end.y) continue;
        const x1 = Math.min(start.x, end.x);
        const x2 = Math.max(start.x, end.x);
        if ((x2 - x1) < ROUTING_CONFIG.SHARED_TRUNK_MIN_LENGTH) continue;
        segments.push({
            edgeId: edge.id,
            y: start.y,
            x1,
            x2,
        });
    }

    return segments;
}

function annotateSharedTrunks(routedEdges) {
    const segmentsByRow = new Map();
    routedEdges.forEach((edge) => {
        extractHorizontalSegments(edge).forEach((segment) => {
            const rowKey = Math.round(segment.y / 4);
            if (!segmentsByRow.has(rowKey)) segmentsByRow.set(rowKey, []);
            segmentsByRow.get(rowKey).push(segment);
        });
    });

    const sharedByEdgeId = new Map();
    let trunkCounter = 0;

    const flushCluster = (cluster) => {
        const uniqueEdges = Array.from(new Set(cluster.map((segment) => segment.edgeId)));
        if (uniqueEdges.length <= 1) return;
        const trunkId = `trunk-${trunkCounter}`;
        trunkCounter += 1;
        uniqueEdges.forEach((edgeId) => {
            if (!sharedByEdgeId.has(edgeId)) sharedByEdgeId.set(edgeId, trunkId);
        });
    };

    segmentsByRow.forEach((segments) => {
        const ordered = [...segments].sort((a, b) => a.x1 - b.x1);
        let cluster = [];
        let clusterEnd = Number.NEGATIVE_INFINITY;

        ordered.forEach((segment) => {
            if (cluster.length === 0) {
                cluster = [segment];
                clusterEnd = segment.x2;
                return;
            }

            if (segment.x1 <= clusterEnd - ROUTING_CONFIG.SHARED_TRUNK_MIN_LENGTH) {
                cluster.push(segment);
                clusterEnd = Math.max(clusterEnd, segment.x2);
                return;
            }

            flushCluster(cluster);
            cluster = [segment];
            clusterEnd = segment.x2;
        });

        flushCluster(cluster);
    });

    return routedEdges.map((edge) => {
        const sharedTrunkId = edge.shared_trunk_id || sharedByEdgeId.get(edge.id) || null;
        return {
            ...edge,
            shared_trunk_id: sharedTrunkId,
            isBundled: Boolean(sharedTrunkId),
        };
    });
}

function sortEdgesForRouting(edges, nodesById) {
    const scoreForEdge = (edge) => {
        const sourceRank = nodesById.get(edge.source)?.rank ?? 0;
        const targetRank = nodesById.get(edge.target)?.rank ?? sourceRank;
        const span = Math.abs(targetRank - sourceRank);
        const desiredY = ((edge.sourcePort?.y ?? 0) + (edge.targetPort?.y ?? 0)) / 2;
        const isForward = targetRank > sourceRank && !edge.is_cycle;
        return {
            isForward,
            span,
            desiredY,
        };
    };

    return [...edges].sort((a, b) => {
        const aScore = scoreForEdge(a);
        const bScore = scoreForEdge(b);
        if (aScore.isForward !== bScore.isForward) return aScore.isForward ? -1 : 1;
        if (aScore.span !== bScore.span) return aScore.span - bScore.span;
        if (aScore.desiredY !== bScore.desiredY) return aScore.desiredY - bScore.desiredY;
        return (a.id || '').localeCompare(b.id || '');
    });
}

export function routeEdge(edge, nodes, options = {}) {
    const [routedEdge] = routeAllEdges([edge], nodes, options);
    return routedEdge || { ...edge, route: null };
}

export function routeAllEdges(edges, nodes, _options = {}) {
    const nodesById = nodes instanceof Map
        ? nodes
        : new Map((nodes || []).map((node) => [node.id, node]));
    const nodeList = Array.from(nodesById.values());
    if (!edges?.length || !nodeList.length) return [];

    const rankData = buildRankData(nodesById);
    const usageMap = new Map();
    const routedById = new Map();
    const orderedEdges = sortEdgesForRouting(edges, nodesById);

    orderedEdges.forEach((edge, index) => {
        const edgeId = edge.id || `${edge.source}-${edge.target}-${index}`;
        const sourceNode = nodesById.get(edge.source);
        const targetNode = nodesById.get(edge.target);
        if (!sourceNode || !targetNode || !edge.sourcePort || !edge.targetPort) {
            routedById.set(edgeId, routeOrthogonalFallback(edge, nodesById, nodeList));
            return;
        }

        const sourceRank = Number.isFinite(sourceNode.rank) ? sourceNode.rank : 0;
        const targetRank = Number.isFinite(targetNode.rank) ? targetNode.rank : sourceRank;
        const isForward = targetRank > sourceRank && !edge.is_cycle;

        if (!isForward) {
            const route = buildExternalLocalRoute(edge, sourceNode, targetNode, nodesById, nodeList, usageMap);
            routedById.set(edgeId, {
                ...edge,
                route: {
                    type: route.routeType,
                    waypoints: route.waypoints,
                },
                path: generateOrthogonalPath(route.waypoints),
                lane_id: route.laneId,
                shared_trunk_id: null,
                routing_scope: route.routingScope,
                hasObstacles: route.collisions > 0,
                isBundled: false,
            });
            return;
        }

        const forward = buildForwardLocalWaypoints(edge, sourceNode, targetNode, rankData, usageMap);
        const collisions = countEdgeObstacleCollisions(edge, forward.waypoints, nodesById, nodeList);
        routedById.set(edgeId, {
            ...edge,
            route: {
                type: forward.routeType,
                waypoints: forward.waypoints,
            },
            path: generateOrthogonalPath(forward.waypoints),
            lane_id: forward.laneId,
            shared_trunk_id: null,
            routing_scope: forward.routingScope,
            hasObstacles: collisions > 0,
            isBundled: false,
        });
    });

    const routedEdges = edges.map((edge, index) => {
        const edgeId = edge.id || `${edge.source}-${edge.target}-${index}`;
        return routedById.get(edgeId) || routeOrthogonalFallback(edge, nodesById, nodeList);
    });

    return annotateSharedTrunks(routedEdges);
}

const edgeRouter = {
    findObstacles,
    routeDirect,
    routeOrthogonal,
    routeCurved,
    calculateOrthogonalWaypoints,
    routeEdge,
    routeAllEdges,
    ROUTING_CONFIG,
    RoutingType,
};

export default edgeRouter;
