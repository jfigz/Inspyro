export function normalizeFitPadding(padding = 32) {
    if (typeof padding === 'number') {
        return {
            x: padding,
            y: padding,
        };
    }

    return {
        x: Math.max(0, Number(padding?.x) || 0),
        y: Math.max(0, Number(padding?.y) || 0),
    };
}

export function normalizeBounds(bounds = {}) {
    return {
        x: Number(bounds?.x) || 0,
        y: Number(bounds?.y) || 0,
        width: Math.max(1, Number(bounds?.width) || 0),
        height: Math.max(1, Number(bounds?.height) || 0),
    };
}

export function expandBounds(bounds = {}, padding = 0) {
    const normalizedBounds = normalizeBounds(bounds);
    const safePadding = Math.max(0, Number(padding) || 0);
    return {
        x: normalizedBounds.x - safePadding,
        y: normalizedBounds.y - safePadding,
        width: normalizedBounds.width + safePadding * 2,
        height: normalizedBounds.height + safePadding * 2,
    };
}

export function getAutoFitPadding(nodeCount = 0) {
    if (nodeCount <= 4) {
        return { x: 24, y: 24 };
    }
    if (nodeCount <= 12) {
        return { x: 30, y: 30 };
    }
    return { x: 36, y: 36 };
}

export function computeAutoFitTransform({
    viewportWidth = 0,
    viewportHeight = 0,
    bounds = {},
    padding = 32,
    minScale = 0.1,
    maxScale = 2.6,
} = {}) {
    const safeWidth = Math.max(1, Number(viewportWidth) || 0);
    const safeHeight = Math.max(1, Number(viewportHeight) || 0);
    const normalizedBounds = normalizeBounds(bounds);
    const normalizedPadding = normalizeFitPadding(padding);

    const availableWidth = Math.max(1, safeWidth - normalizedPadding.x * 2);
    const availableHeight = Math.max(1, safeHeight - normalizedPadding.y * 2);
    const unclampedScale = Math.min(
        availableWidth / normalizedBounds.width,
        availableHeight / normalizedBounds.height,
    );
    const scale = Math.min(
        Math.max(unclampedScale, minScale),
        maxScale,
    );

    return {
        scale,
        translateX: (safeWidth - normalizedBounds.width * scale) / 2 - normalizedBounds.x * scale,
        translateY: (safeHeight - normalizedBounds.height * scale) / 2 - normalizedBounds.y * scale,
    };
}

export function sanitizeZoomTransform(transform, {
    minScale = 0.1,
    maxScale = 4,
} = {}) {
    if (!transform) return null;

    const x = Number(transform.x ?? transform.translateX);
    const y = Number(transform.y ?? transform.translateY);
    const k = Number(transform.k ?? transform.scale);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(k)) {
        return null;
    }

    return {
        x,
        y,
        k: Math.min(Math.max(k, minScale), maxScale),
    };
}

export function getTransformedBounds(bounds = {}, transform = {}) {
    const normalizedBounds = normalizeBounds(bounds);
    const safeTransform = sanitizeZoomTransform(transform) || { x: 0, y: 0, k: 1 };
    return {
        left: safeTransform.x + normalizedBounds.x * safeTransform.k,
        top: safeTransform.y + normalizedBounds.y * safeTransform.k,
        right: safeTransform.x + (normalizedBounds.x + normalizedBounds.width) * safeTransform.k,
        bottom: safeTransform.y + (normalizedBounds.y + normalizedBounds.height) * safeTransform.k,
        width: normalizedBounds.width * safeTransform.k,
        height: normalizedBounds.height * safeTransform.k,
    };
}

export function hasVisibleViewportOverlap({
    viewportWidth = 0,
    viewportHeight = 0,
    bounds = {},
    transform = {},
    minVisibleWidth = 16,
    minVisibleHeight = 16,
} = {}) {
    const safeWidth = Math.max(1, Number(viewportWidth) || 0);
    const safeHeight = Math.max(1, Number(viewportHeight) || 0);
    const transformedBounds = getTransformedBounds(bounds, transform);

    const overlapWidth = Math.min(transformedBounds.right, safeWidth) - Math.max(transformedBounds.left, 0);
    const overlapHeight = Math.min(transformedBounds.bottom, safeHeight) - Math.max(transformedBounds.top, 0);

    return overlapWidth >= minVisibleWidth && overlapHeight >= minVisibleHeight;
}

export function resolveViewportTransform({
    viewportWidth = 0,
    viewportHeight = 0,
    bounds = {},
    padding = 32,
    previousTransform = null,
    preservePreviousTransform = false,
    fitMinScale = 0.1,
    fitMaxScale = 2.6,
    zoomMinScale = 0.1,
    zoomMaxScale = 4,
} = {}) {
    const fitTransformData = computeAutoFitTransform({
        viewportWidth,
        viewportHeight,
        bounds,
        padding,
        minScale: fitMinScale,
        maxScale: fitMaxScale,
    });
    const fitTransform = {
        x: fitTransformData.translateX,
        y: fitTransformData.translateY,
        k: fitTransformData.scale,
    };

    if (!preservePreviousTransform) {
        return {
            fitTransform,
            transform: fitTransform,
            usedPreviousTransform: false,
        };
    }

    const safePreviousTransform = sanitizeZoomTransform(previousTransform, {
        minScale: zoomMinScale,
        maxScale: zoomMaxScale,
    });

    if (!safePreviousTransform || !hasVisibleViewportOverlap({
        viewportWidth,
        viewportHeight,
        bounds,
        transform: safePreviousTransform,
    })) {
        return {
            fitTransform,
            transform: fitTransform,
            usedPreviousTransform: false,
        };
    }

    return {
        fitTransform,
        transform: safePreviousTransform,
        usedPreviousTransform: true,
    };
}
