const DEFAULT_NODE_RADIUS = 12;
const DEFAULT_SEARCH_STEPS = 24;
const DEFAULT_SEARCH_TOLERANCE = 0.2;

function clampLength(length, totalLength) {
    return Math.min(Math.max(Number(length) || 0, 0), Math.max(Number(totalLength) || 0, 0));
}

function safeRect(rect = {}) {
    return {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Math.max(0, Number(rect.width) || 0),
        height: Math.max(0, Number(rect.height) || 0),
    };
}

export function pointInRoundedRect(point = {}, rect = {}, radius = DEFAULT_NODE_RADIUS) {
    const safePoint = {
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
    };
    const safe = safeRect(rect);
    if (safe.width <= 0 || safe.height <= 0) return false;

    const r = Math.min(
        Math.max(0, Number(radius) || 0),
        safe.width / 2,
        safe.height / 2,
    );

    const left = safe.x;
    const right = safe.x + safe.width;
    const top = safe.y;
    const bottom = safe.y + safe.height;

    if (safePoint.x < left || safePoint.x > right || safePoint.y < top || safePoint.y > bottom) {
        return false;
    }

    if (r <= 0) return true;

    if (safePoint.x >= left + r && safePoint.x <= right - r) return true;
    if (safePoint.y >= top + r && safePoint.y <= bottom - r) return true;

    const corners = [
        { x: left + r, y: top + r },
        { x: right - r, y: top + r },
        { x: right - r, y: bottom - r },
        { x: left + r, y: bottom - r },
    ];

    return corners.some((corner) => {
        const dx = safePoint.x - corner.x;
        const dy = safePoint.y - corner.y;
        return (dx * dx) + (dy * dy) <= (r * r);
    });
}

export function normalizeDirection(vector = {}) {
    const x = Number(vector.x) || 0;
    const y = Number(vector.y) || 0;
    const length = Math.hypot(x, y);
    if (length <= 1e-9) {
        return { x: 0, y: -1 };
    }
    return {
        x: x / length,
        y: y / length,
    };
}

export function buildArrowPath({ tip, baseCenter, direction, width }) {
    if (!tip || !baseCenter) return '';

    const dir = normalizeDirection(direction);
    const safeWidth = Math.max(0, Number(width) || 0);
    const halfWidth = safeWidth / 2;
    const normal = { x: -dir.y, y: dir.x };

    const left = {
        x: baseCenter.x + normal.x * halfWidth,
        y: baseCenter.y + normal.y * halfWidth,
    };
    const right = {
        x: baseCenter.x - normal.x * halfWidth,
        y: baseCenter.y - normal.y * halfWidth,
    };

    return `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`;
}

export function samplePathRange(getPointAtLength, startLength, endLength, totalLength, sampleCount = 24) {
    if (typeof getPointAtLength !== 'function') return [];

    const start = clampLength(startLength, totalLength);
    const end = clampLength(endLength, totalLength);
    if (end <= start) return [];

    const steps = Math.max(2, Math.floor(sampleCount));
    const points = [];

    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const length = start + ((end - start) * t);
        const point = getPointAtLength(length);
        points.push({
            x: Number(point?.x) || 0,
            y: Number(point?.y) || 0,
        });
    }

    return points;
}

export function buildPathFromPoints(points = []) {
    const validPoints = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (validPoints.length === 0) return '';
    if (validPoints.length === 1) {
        return `M ${validPoints[0].x} ${validPoints[0].y}`;
    }

    return validPoints.reduce((path, point, index) => (
        index === 0 ? `M ${point.x} ${point.y}` : `${path} L ${point.x} ${point.y}`
    ), '');
}

export function computeWorldSize(pxValue, zoomScale, minimumWorld = 0.4) {
    const safeZoom = Math.max(Number(zoomScale) || 1, 0.05);
    return Math.max((Number(pxValue) || 0) / safeZoom, minimumWorld);
}

export function findFirstOutsideLength({
    getPointAtLength,
    totalLength,
    rect,
    radius = DEFAULT_NODE_RADIUS,
    steps = DEFAULT_SEARCH_STEPS,
    tolerance = DEFAULT_SEARCH_TOLERANCE,
} = {}) {
    if (typeof getPointAtLength !== 'function' || !rect) return 0;

    const total = Math.max(Number(totalLength) || 0, 0);
    const startPoint = getPointAtLength(0);
    const startInside = pointInRoundedRect(startPoint, rect, radius);
    if (!startInside) return 0;

    let low = 0;
    let high = total;
    let foundOutside = false;

    for (let step = 1; step <= steps; step += 1) {
        const candidate = (total * step) / steps;
        if (!pointInRoundedRect(getPointAtLength(candidate), rect, radius)) {
            high = candidate;
            low = (total * (step - 1)) / steps;
            foundOutside = true;
            break;
        }
    }

    if (!foundOutside) return total;

    while ((high - low) > tolerance) {
        const mid = (low + high) / 2;
        if (pointInRoundedRect(getPointAtLength(mid), rect, radius)) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return clampLength(high, total);
}

export function findLastOutsideLength({
    getPointAtLength,
    totalLength,
    rect,
    radius = DEFAULT_NODE_RADIUS,
    steps = DEFAULT_SEARCH_STEPS,
    tolerance = DEFAULT_SEARCH_TOLERANCE,
} = {}) {
    if (typeof getPointAtLength !== 'function' || !rect) return Math.max(Number(totalLength) || 0, 0);

    const total = Math.max(Number(totalLength) || 0, 0);
    const endPoint = getPointAtLength(total);
    const endInside = pointInRoundedRect(endPoint, rect, radius);
    if (!endInside) return total;

    let low = 0;
    let high = total;
    let foundOutside = false;

    for (let step = 1; step <= steps; step += 1) {
        const candidate = total - ((total * step) / steps);
        if (!pointInRoundedRect(getPointAtLength(candidate), rect, radius)) {
            low = candidate;
            high = total - ((total * (step - 1)) / steps);
            foundOutside = true;
            break;
        }
    }

    if (!foundOutside) return 0;

    while ((high - low) > tolerance) {
        const mid = (low + high) / 2;
        if (pointInRoundedRect(getPointAtLength(mid), rect, radius)) {
            high = mid;
        } else {
            low = mid;
        }
    }

    return clampLength(low, total);
}

export function estimatePathDirection(getPointAtLength, totalLength, atLength, lookback = 1) {
    if (typeof getPointAtLength !== 'function') {
        return { x: 0, y: -1 };
    }

    const total = Math.max(Number(totalLength) || 0, 0);
    const end = clampLength(atLength, total);
    const start = clampLength(end - Math.max(Number(lookback) || 0, 0.1), total);
    const startPoint = getPointAtLength(start);
    const endPoint = getPointAtLength(end);

    return normalizeDirection({
        x: (Number(endPoint?.x) || 0) - (Number(startPoint?.x) || 0),
        y: (Number(endPoint?.y) || 0) - (Number(startPoint?.y) || 0),
    });
}

export function computeVisibleArrowGeometry({
    getPointAtLength,
    totalLength,
    sourceRect,
    targetRect,
    radius = DEFAULT_NODE_RADIUS,
    zoomScale = 1,
    headLengthPx = 14,
    headWidthPx = 10,
    directionLookbackPx = 10,
} = {}) {
    if (typeof getPointAtLength !== 'function') return null;

    const total = Math.max(Number(totalLength) || 0, 0);
    if (total <= 0) return null;

    const visibleStartLength = sourceRect
        ? findFirstOutsideLength({ getPointAtLength, totalLength: total, rect: sourceRect, radius })
        : 0;
    const visibleBoundaryLength = targetRect
        ? findLastOutsideLength({ getPointAtLength, totalLength: total, rect: targetRect, radius })
        : total;
    const visibleEndLength = total;

    if (visibleEndLength <= visibleStartLength) {
        return null;
    }

    const headLength = computeWorldSize(headLengthPx, zoomScale, 0.6);
    const headWidth = computeWorldSize(headWidthPx, zoomScale, 0.6);
    const directionLookback = computeWorldSize(directionLookbackPx, zoomScale, 0.4);
    const bodyEndLength = Math.max(
        visibleStartLength,
        Math.min(visibleBoundaryLength, visibleEndLength) - headLength,
    );

    const tip = getPointAtLength(visibleEndLength);
    const baseCenter = getPointAtLength(bodyEndLength);
    const direction = estimatePathDirection(
        getPointAtLength,
        total,
        visibleEndLength,
        Math.max(headLength, directionLookback),
    );

    return {
        visibleStartLength,
        visibleEndLength,
        visibleBoundaryLength,
        bodyEndLength,
        headLength,
        headWidth,
        tip: {
            x: Number(tip?.x) || 0,
            y: Number(tip?.y) || 0,
        },
        baseCenter: {
            x: Number(baseCenter?.x) || 0,
            y: Number(baseCenter?.y) || 0,
        },
        direction,
        arrowPath: buildArrowPath({
            tip,
            baseCenter,
            direction,
            width: headWidth,
        }),
    };
}

export const EDGE_VISIBILITY_DEFAULTS = Object.freeze({
    nodeRadius: DEFAULT_NODE_RADIUS,
    searchSteps: DEFAULT_SEARCH_STEPS,
    searchTolerance: DEFAULT_SEARCH_TOLERANCE,
});
