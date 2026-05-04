/**
 * nodeSizing.js - Shared sizing rules for D3 dependency nodes.
 */

import { getNodeVisualProfile } from './nodeVisualProfile';

export const NODE_LINE_HEIGHT = 16;
export const NODE_BASE_HEIGHT = 34;
export const NODE_MIN_HEIGHT = 78;
export const NODE_MIN_WIDTH = 196;
export const NODE_MAX_WIDTH = 360;

const WIDTH_FACTORS = Object.freeze({
    title: 7.3,
    badge: 6.1,
    value: 7.1,
    expression: 6.6,
    description: 5.9,
    range: 6.1,
    reference: 6.1,
    origin: 6.4,
    generic: 6.1,
});

function estimateTextWidth(text, kind = 'generic') {
    if (!text) return 0;
    const factor = WIDTH_FACTORS[kind] || WIDTH_FACTORS.generic;
    return Math.ceil(text.length * factor);
}

function computeBadgeRows(badges, contentWidth, badgeGap = 6) {
    if (!Array.isArray(badges) || badges.length === 0) return 0;
    let rows = 1;
    let cursor = 0;
    badges.forEach((badge) => {
        const badgeWidth = Math.max(28, estimateTextWidth(badge?.text || '', 'badge') + 14);
        if (cursor > 0 && cursor + badgeWidth > contentWidth) {
            rows += 1;
            cursor = 0;
        }
        cursor += badgeWidth + (cursor > 0 ? badgeGap : 0);
    });
    return rows;
}

function computeLineWidth(line) {
    if (!line?.text) return 0;
    if (line.kind === 'value') return estimateTextWidth(line.text, 'value');
    if (line.kind === 'expression') return estimateTextWidth(line.text, 'expression');
    if (line.kind === 'description') return estimateTextWidth(line.text, 'description');
    if (line.kind === 'range') return estimateTextWidth(line.text, 'range');
    if (line.kind === 'reference') return estimateTextWidth(line.text, 'reference');
    if (line.kind === 'origin') return estimateTextWidth(line.text, 'origin');
    return estimateTextWidth(line.text, 'generic');
}

export function countNodeLines(data, overrides = {}) {
    const profile = getNodeVisualProfile(data, overrides);
    return 1 + profile.lines.length + (profile.locationLabel ? 1 : 0);
}

export function getNodeDimensions(data, overrides = {}) {
    const lineHeight = overrides.lineHeight || NODE_LINE_HEIGHT;
    const baseHeight = overrides.baseHeight || NODE_BASE_HEIGHT;
    const minHeight = overrides.minHeight || NODE_MIN_HEIGHT;
    const minWidth = overrides.minWidth || NODE_MIN_WIDTH;
    const maxWidth = overrides.maxWidth || NODE_MAX_WIDTH;
    const paddingX = overrides.paddingX || 12;
    const paddingY = overrides.paddingY || 12;
    const badgeHeight = overrides.badgeHeight || 14;
    const badgeRowGap = overrides.badgeRowGap || 4;

    const profile = getNodeVisualProfile(data, overrides);

    const contentWidths = [
        estimateTextWidth(data?.name || data?.id || '', 'title') + (profile.displayUnit ? estimateTextWidth(` [${profile.displayUnit}]`, 'title') : 0) + 28,
        profile.badges.reduce((maxWidthSeen, badge) => Math.max(maxWidthSeen, estimateTextWidth(badge?.text || '', 'badge') + 16), 0),
        ...profile.lines.map((line) => computeLineWidth(line)),
        profile.locationLabel ? estimateTextWidth(profile.locationLabel, 'generic') : 0,
    ];

    const unclampedWidth = Math.max(minWidth, Math.max(...contentWidths, 0) + paddingX * 2);
    const width = Math.max(minWidth, Math.min(maxWidth, unclampedWidth));
    const innerWidth = Math.max(120, width - paddingX * 2);
    const badgeRows = computeBadgeRows(profile.badges, innerWidth);

    const headerHeight = 24;
    const dividerHeight = 6;
    const badgesBlockHeight = badgeRows > 0
        ? (badgeRows * badgeHeight) + ((badgeRows - 1) * badgeRowGap) + 6
        : 0;
    const linesHeight = profile.lines.length > 0
        ? (profile.lines.length * lineHeight)
        : 0;
    const footerHeight = profile.locationLabel ? 14 : 0;

    const height = Math.max(
        minHeight,
        baseHeight + headerHeight + dividerHeight + badgesBlockHeight + linesHeight + footerHeight + paddingY
    );

    return {
        width,
        height,
        profile,
    };
}

export function getNodeWidth(data, overrides = {}) {
    return getNodeDimensions(data, overrides).width;
}

export function getNodeHeight(data, overrides = {}) {
    return getNodeDimensions(data, overrides).height;
}
