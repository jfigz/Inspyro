import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UnitTooltip from './UnitTooltip';
import { getUnitMetadata, needsBackendMetadataResolution, normalizeUnitToken, resolveUnitMetadata } from './unitTokens';
import './UnitBadge.css';

/**
 * Renderiza una magnitud con unidad de ingeniería en formato inline/badge.
 */
export default function UnitBadge({ unit, magnitude, metadata, format = 'inline' }) {
    const rootRef = useRef(null);
    const [showTooltip, setShowTooltip] = useState(false);
    const [anchorRect, setAnchorRect] = useState(null);
    const [resolvedRemoteMetadata, setResolvedRemoteMetadata] = useState(null);
    const localMetadata = useMemo(() => getUnitMetadata(unit), [unit]);
    const baseMetadata = useMemo(() => {
        const normalizedUnit = normalizeUnitToken(unit);
        const merged = {
            ...(localMetadata || {}),
            ...((metadata && typeof metadata === 'object') ? metadata : {}),
        };

        if (!Object.keys(merged).length) {
            return localMetadata || null;
        }

        if (!merged.symbol) merged.symbol = unit || normalizedUnit;
        if (!merged.display) merged.display = unit || normalizedUnit;
        if (!merged.canonical) merged.canonical = normalizedUnit || unit;
        return merged;
    }, [metadata, localMetadata, unit]);

    const updateAnchorRect = useCallback(() => {
        const node = rootRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        setAnchorRect({
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
        });
    }, []);

    useEffect(() => {
        if (!showTooltip) return undefined;
        const updatePosition = () => updateAnchorRect();
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [showTooltip, updateAnchorRect]);

    const handleMouseEnter = useCallback(() => {
        updateAnchorRect();
        setShowTooltip(true);
    }, [updateAnchorRect]);

    const handleMouseLeave = useCallback(() => {
        setShowTooltip(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (!needsBackendMetadataResolution(unit, baseMetadata)) {
            setResolvedRemoteMetadata(null);
            return undefined;
        }
        resolveUnitMetadata(unit)
            .then((resolved) => {
                if (!cancelled) {
                    setResolvedRemoteMetadata(resolved || null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setResolvedRemoteMetadata(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [unit, baseMetadata]);

    const resolvedMetadata = useMemo(
        () => resolvedRemoteMetadata || baseMetadata,
        [resolvedRemoteMetadata, baseMetadata]
    );

    return (
        <span
            ref={rootRef}
            className={`unit-badge unit-badge--${format}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span className="unit-badge__magnitude">{String(magnitude)}</span>
            <span className="unit-badge__unit">{unit}</span>
            {showTooltip && resolvedMetadata && (
                <UnitTooltip metadata={resolvedMetadata} anchorRect={anchorRect} />
            )}
        </span>
    );
}
