import { formatRuntimeValue } from './utils';

const PROFILE_KEYS = Object.freeze({
    QUANTITY_INPUT: 'quantity-input',
    COMPUTED_RESULT: 'computed-result',
    CHECK_CONSTRAINT: 'check-constraint',
    IMPORT_EXTERNAL: 'import-external',
    CONTAINER: 'container',
    GENERIC: 'generic',
});

function normalizeText(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function trimScope(scopePath = '') {
    const normalized = normalizeText(scopePath);
    if (!normalized || !normalized.includes('.')) return '';
    return normalized.split('.').slice(0, -1).join('.');
}

function resolveFileLabel(filePath = '') {
    const normalized = normalizeText(filePath);
    if (!normalized) return '';
    const segments = normalized.split(/[\\/]/);
    return segments[segments.length - 1] || normalized;
}

export function formatNodeLocationLabel(location = {}) {
    if (!location || typeof location !== 'object') return '';
    const line = Number(location.line) > 0 ? `L${location.line}` : '';
    const fileLabel = resolveFileLabel(location.file);
    let cellLabel = '';
    if (Number.isInteger(location.cell_index)) {
        cellLabel = `Celda ${location.cell_index + 1}`;
    } else if (normalizeText(location.cell_label)) {
        cellLabel = normalizeText(location.cell_label);
    } else if (normalizeText(location.cell_id)) {
        cellLabel = 'Celda del notebook';
    }

    return [fileLabel || cellLabel, line].filter(Boolean).join(' - ');
}

function resolveCheckTone(checkResult) {
    if (checkResult === true) return 'pass';
    if (checkResult === false) return 'fail';
    return 'pending';
}

function buildCheckLabel(data) {
    const tone = resolveCheckTone(data?.check_result);
    if (tone === 'pass') return 'PASS';
    if (tone === 'fail') return 'FAIL';
    return 'PENDING';
}

function buildRangeLabel(validRange) {
    if (!Array.isArray(validRange) || validRange.length !== 2) return '';
    const minVal = validRange[0] ?? 'na';
    const maxVal = validRange[1] ?? 'na';
    return `[${minVal}, ${maxVal}]`;
}

export function getRuntimeQuantity(data) {
    const runtime = data?.runtime_value;
    if (!runtime || typeof runtime !== 'object') return null;
    if (runtime.type === 'Quantity' || runtime.is_quantity === true) return runtime;
    return null;
}

export function getNodeVisualProfile(data, options = {}) {
    const nodeType = data?.node_type || data?.type || 'unknown';
    const runtimeQuantity = getRuntimeQuantity(data);
    const runtimeValue = formatRuntimeValue(data?.runtime_value);
    const displayCategory = normalizeText(runtimeQuantity?.category || data?.category);
    const displayUnit = normalizeText(
        runtimeQuantity?.unit_display
        || runtimeQuantity?.unit
        || data?.unit
    );
    const rawDescription = normalizeText(
        data?.description
        || runtimeQuantity?.metadata?.description
        || runtimeQuantity?.description
    );
    const expression = normalizeText(data?.value_preview);
    const scopeChip = trimScope(data?.scope_path);
    const fullName = normalizeText(data?.full_name);
    const fileLabel = resolveFileLabel(data?.location?.file);
    const locationLabel = formatNodeLocationLabel(data?.location);
    const reference = normalizeText(data?.reference);
    const checkMessage = normalizeText(data?.check_message);
    const rangeLabel = buildRangeLabel(data?.valid_range);
    const isContainer = Boolean(data?.is_container || data?.container_type);
    const isCheck = Boolean(data?.is_check);
    const isImport = nodeType === 'import';
    const isExternal = Boolean(data?.is_external);
    const isInput = Boolean(options.isInput);
    const isOutput = Boolean(options.isOutput);
    const compact = Boolean(options.largeGraphMode);
    const hasQuantitySemantics = Boolean(displayUnit || runtimeQuantity);

    let profileKey = PROFILE_KEYS.GENERIC;
    if (isContainer) {
        profileKey = PROFILE_KEYS.CONTAINER;
    } else if (isCheck) {
        profileKey = PROFILE_KEYS.CHECK_CONSTRAINT;
    } else if (isImport || isExternal) {
        profileKey = PROFILE_KEYS.IMPORT_EXTERNAL;
    } else if (hasQuantitySemantics && isInput && !runtimeValue) {
        profileKey = PROFILE_KEYS.QUANTITY_INPUT;
    } else if (runtimeValue || isOutput || displayCategory === 'result') {
        profileKey = PROFILE_KEYS.COMPUTED_RESULT;
    } else if (hasQuantitySemantics) {
        profileKey = PROFILE_KEYS.QUANTITY_INPUT;
    }

    const badges = [];
    badges.push({ kind: 'type', text: nodeType.toUpperCase().slice(0, 6) || 'NODE' });

    if (scopeChip) {
        badges.push({ kind: 'scope', text: scopeChip });
    }

    if (displayCategory) {
        badges.push({ kind: 'category', text: displayCategory.toUpperCase().slice(0, 7) });
    }

    if (isInput) {
        badges.push({ kind: 'io', text: 'IN' });
    }

    if (isOutput) {
        badges.push({ kind: 'io', text: 'OUT' });
    }

    if (isExternal) {
        badges.push({ kind: 'external', text: 'EXT' });
    }

    if (fileLabel && fileLabel !== normalizeText(data?.name)) {
        badges.push({ kind: 'file', text: fileLabel });
    }

    const description = rawDescription || ((isImport || isExternal) ? fullName : '');

    const lines = [];
    if (profileKey === PROFILE_KEYS.IMPORT_EXTERNAL) {
        if (fullName && fullName !== data?.name) {
            lines.push({ kind: 'origin', text: fullName });
        }
        if (description) {
            lines.push({ kind: 'description', text: description });
        }
        if (fileLabel) {
            lines.push({ kind: 'file', text: `file: ${fileLabel}` });
        }
    } else if (profileKey === PROFILE_KEYS.CHECK_CONSTRAINT) {
        lines.push({ kind: 'check', text: buildCheckLabel(data) });
        if (checkMessage) {
            lines.push({ kind: 'message', text: checkMessage });
        }
        if (expression) {
            lines.push({ kind: 'expression', text: `expr: ${expression}` });
        }
    } else {
        if (runtimeValue) {
            lines.push({ kind: 'value', text: `= ${runtimeValue}` });
        }
        if (description) {
            lines.push({ kind: 'description', text: description });
        }
        if (expression) {
            lines.push({ kind: 'expression', text: `expr: ${expression}` });
        }
        if (rangeLabel) {
            lines.push({ kind: 'range', text: `range: ${rangeLabel}` });
        }
        if (reference) {
            lines.push({ kind: 'reference', text: `ref: ${reference}` });
        }
    }

    const maxVisibleLines = compact ? 2 : 4;
    const visibleLines = lines.slice(0, maxVisibleLines);

    return {
        profileKey,
        compact,
        nodeType,
        displayCategory,
        displayUnit,
        description,
        expression,
        runtimeValue,
        scopeChip,
        fullName,
        locationLabel,
        fileLabel,
        badges,
        lines: visibleLines,
        checkTone: resolveCheckTone(data?.check_result),
        checkLabel: buildCheckLabel(data),
        checkMessage,
        rangeLabel,
        reference,
        isContainer,
        isExternal,
        isImport,
        isCheck,
        isInput,
        isOutput,
    };
}

export { PROFILE_KEYS };
