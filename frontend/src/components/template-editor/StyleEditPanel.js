/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import '../TemplateEditor.css';
import { IconRefresh, IconSave, IconX } from '../Icons';
import { mapLocalTableToTemplateUpdates } from './templateEditorMappers';
import {
    collectTemplateFontOptions as collectTemplateFontOptionsShared,
    fontToRpr,
    formatFontSourceLabel,
    getEffectiveStyleFont,
    getFontAvailabilityInfo,
    parseRprToFont as parseRprToFontShared,
    readFontName,
    readFontSize,
} from './fontUtils';

// === CONFIGURATION CONSTANTS ===
const MAX_TEMPLATE_SIZE_MB = 6.5;  // Maximum DOCX upload size in MB (FIX #2)
const PREVIEW_DEBOUNCE_MS = 1000;  // Debounce delay for auto-preview (FIX #12: increased from 350ms)
const PREVIEW_TIMEOUT_MS = 45000;  // Timeout for style preview generation
const TABLE_PREVIEW_TIMEOUT_MS = 60000; // Timeout per table preview request on large templates
const PREVIEW_CACHE_MAX = 48;  // Maximum number of cached preview images

// Category labels in Spanish
const CATEGORY_LABELS = {
    titles: { label: 'Títulos' },
    headings: { label: 'Encabezados' },
    body: { label: 'Cuerpo' },
    lists: { label: 'Listas' },
    tables: { label: 'Tablas' },
    code: { label: 'Código' },
};

const UNDERLINE_OPTIONS = [
    { value: '', label: '— Ninguno —' },
    { value: 'SINGLE', label: 'Simple' },
    { value: 'DOUBLE', label: 'Doble' },
    { value: 'DOTTED', label: 'Punteado' },
    { value: 'DASH', label: 'Guiones' },
    { value: 'WAVY', label: 'Ondulado' },
];

const HIGHLIGHT_OPTIONS = [
    { value: '', label: '— Ninguno —' },
    { value: 'YELLOW', label: 'Amarillo' },
    { value: 'BRIGHT_GREEN', label: 'Verde' },
    { value: 'TURQUOISE', label: 'Turquesa' },
    { value: 'PINK', label: 'Rosa' },
    { value: 'BLUE', label: 'Azul' },
    { value: 'RED', label: 'Rojo' },
    { value: 'DARK_BLUE', label: 'Azul oscuro' },
    { value: 'DARK_RED', label: 'Rojo oscuro' },
    { value: 'DARK_YELLOW', label: 'Amarillo oscuro' },
    { value: 'DARK_GREEN', label: 'Verde oscuro' },
    { value: 'DARK_CYAN', label: 'Cian oscuro' },
    { value: 'DARK_MAGENTA', label: 'Magenta oscuro' },
    { value: 'GRAY_50', label: 'Gris 50%' },
    { value: 'GRAY_25', label: 'Gris 25%' },
    { value: 'BLACK', label: 'Negro' },
    { value: 'WHITE', label: 'Blanco' },
];

const LINE_SPACING_RULES = [
    { value: '', label: '— Auto —' },
    { value: 'SINGLE', label: 'Sencillo' },
    { value: 'ONE_POINT_FIVE', label: '1.5 líneas' },
    { value: 'DOUBLE', label: 'Doble' },
    { value: 'AT_LEAST', label: 'Al menos' },
    { value: 'EXACTLY', label: 'Exacto' },
    { value: 'MULTIPLE', label: 'Múltiple' },
];

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toBoolOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    return Boolean(value);
};

const normalizeColor = (value) => {
    if (!value) return null;
    const cleaned = String(value).replace('#', '').toUpperCase();
    return cleaned ? cleaned : null;
};

const normalizePreviewProps = (props = {}) => ({
    font_name: props.font_name || props.name || null,
    font_size_pt: toNumberOrNull(props.font_size_pt ?? props.size_pt),
    bold: toBoolOrNull(props.bold),
    italic: toBoolOrNull(props.italic),
    underline: toBoolOrNull(props.underline),
    underline_style: props.underline_style || null,
    color_rgb: normalizeColor(props.color_rgb),
    highlight_color: props.highlight_color || null,
    strike: toBoolOrNull(props.strike),
    double_strike: toBoolOrNull(props.double_strike),
    all_caps: toBoolOrNull(props.all_caps),
    small_caps: toBoolOrNull(props.small_caps),
    superscript: toBoolOrNull(props.superscript),
    subscript: toBoolOrNull(props.subscript),
    space_before_pt: toNumberOrNull(props.space_before_pt),
    space_after_pt: toNumberOrNull(props.space_after_pt),
    alignment: props.alignment || null,
    line_spacing: toNumberOrNull(props.line_spacing),
    line_spacing_rule: props.line_spacing_rule || null,
    first_line_indent_inches: toNumberOrNull(props.first_line_indent_inches),
    left_indent_inches: toNumberOrNull(props.left_indent_inches),
    right_indent_inches: toNumberOrNull(props.right_indent_inches),
    keep_with_next: toBoolOrNull(props.keep_with_next),
    keep_together: toBoolOrNull(props.keep_together),
    page_break_before: toBoolOrNull(props.page_break_before),
    widow_control: toBoolOrNull(props.widow_control),
    outline_level: toNumberOrNull(props.outline_level),
    style_type: props.style_type || null,
    category: props.category || null,
    style_id: props.style_id || null,
    table_signature: props.table_signature || null,
    changed_keys: Array.isArray(props.changed_keys) ? props.changed_keys : null,
});

const formatJson = (value) => {
    if (!value) return '—';
    try {
        return JSON.stringify(value, null, 2);
    } catch (err) {
        return String(value);
    }
};

const stripRawXml = (value) => {
    if (!value || typeof value !== 'object') return value;
    const { raw_xml, ...rest } = value;
    return rest;
};

const buildStyleMeta = (details) => {
    if (!details) return null;
    return {
        style_id: details.style_id ?? null,
        display_name: details.display_name ?? null,
        type: details.type ?? null,
        based_on: details.based_on ?? null,
        next: details.next ?? null,
        link: details.link ?? null,
        ui_priority: details.ui_priority ?? null,
        default: details.default ?? null,
        custom: details.custom ?? null,
        hidden: details.hidden ?? null,
        semi_hidden: details.semi_hidden ?? null,
        q_format: details.q_format ?? null,
        unhide_when_used: details.unhide_when_used ?? null,
        outline_level: details.outline_level ?? null,
    };
};

// Helper to format table style variant names for UI display
const formatVariantName = (varType) => {
    const variantLabels = {
        firstRow: 'Fila de Encabezado',
        lastRow: 'Fila de Totales',
        firstCol: 'Primera Columna',
        lastCol: 'Última Columna',
        band1Horz: 'Banda Horizontal 1',
        band2Horz: 'Banda Horizontal 2',
        band1Vert: 'Banda Vertical 1',
        band2Vert: 'Banda Vertical 2',
        neCell: 'Celda NE',
        nwCell: 'Celda NO',
        seCell: 'Celda SE',
        swCell: 'Celda SO',
        wholeTable: 'Tabla Completa',
    };
    return variantLabels[varType] || varType;
};

// =============================================================================
// BIDIRECTIONAL SYNC: OOXML nodes <-> UI state
// =============================================================================

const VALID_RPR_TAGS = new Set([
    'rFonts', 'sz', 'szCs', 'b', 'bCs', 'i', 'iCs', 'u', 'color', 'highlight',
    'strike', 'dstrike', 'caps', 'smallCaps', 'vertAlign', 'spacing', 'w', 'kern',
]);
const VALID_PPR_TAGS = new Set([
    'jc', 'spacing', 'ind', 'keepNext', 'keepLines', 'pageBreakBefore', 'widowControl',
    'outlineLvl', 'pStyle', 'numPr', 'tabs', 'pBdr', 'shd',
]);

const parsePprToParagraph = (pPrNodes) => {
    if (!Array.isArray(pPrNodes)) return {};
    const para = {};
    pPrNodes.forEach(node => {
        if (!node?.tag) return;
        const attrs = node.attrs || {};
        switch (node.tag) {
            case 'jc':
                if (attrs.val) {
                    const normalizedAlignment = String(attrs.val).toUpperCase();
                    para.alignment = normalizedAlignment === 'BOTH' ? 'JUSTIFY' : normalizedAlignment;
                }
                break;
            case 'spacing':
                if (attrs.before !== undefined) { const v = toNumberOrNull(attrs.before); para.space_before_pt = v !== null ? v / 20 : ''; }
                if (attrs.after !== undefined) { const v = toNumberOrNull(attrs.after); para.space_after_pt = v !== null ? v / 20 : ''; }
                if (attrs.line !== undefined) {
                    const lineVal = toNumberOrNull(attrs.line);
                    const rule = attrs.lineRule ? String(attrs.lineRule).toLowerCase() : '';
                    if (rule === 'exact' || rule === 'atleast') {
                        para.line_spacing = lineVal !== null ? lineVal / 20 : '';
                        para.line_spacing_rule = rule === 'exact' ? 'EXACTLY' : 'AT_LEAST';
                    } else if (lineVal !== null) {
                        para.line_spacing = lineVal / 240;
                        if (rule === 'auto') para.line_spacing_rule = 'MULTIPLE';
                        else para.line_spacing_rule = rule ? rule.toUpperCase() : '';
                    }
                }
                break;
            case 'ind': {
                const left = toNumberOrNull(attrs.left);
                const right = toNumberOrNull(attrs.right);
                const first = toNumberOrNull(attrs.firstLine);
                const hanging = toNumberOrNull(attrs.hanging);
                if (left !== null) para.left_indent_inches = left / 1440;
                if (right !== null) para.right_indent_inches = right / 1440;
                if (hanging !== null) para.first_line_indent_inches = -(hanging / 1440);
                else if (first !== null) para.first_line_indent_inches = first / 1440;
                break;
            }
            case 'keepNext': para.keep_with_next = attrs.val !== '0' && attrs.val !== 'false'; break;
            case 'keepLines': para.keep_together = attrs.val !== '0' && attrs.val !== 'false'; break;
            case 'pageBreakBefore': para.page_break_before = attrs.val !== '0' && attrs.val !== 'false'; break;
            case 'widowControl': para.widow_control = attrs.val !== '0' && attrs.val !== 'false'; break;
            case 'outlineLvl': {
                const outlineVal = toNumberOrNull(attrs.val);
                if (outlineVal !== null) para.outline_level = outlineVal;
                break;
            }
            default: break;
        }
    });
    return para;
};

const paragraphToPpr = (para) => {
    if (!para) return [];
    const nodes = [];
    if (para.alignment) nodes.push({ tag: 'jc', attrs: { val: para.alignment.toLowerCase() } });
    const spacingAttrs = {};
    if (para.space_before_pt) spacingAttrs.before = String(Math.round(Number(para.space_before_pt) * 20));
    if (para.space_after_pt) spacingAttrs.after = String(Math.round(Number(para.space_after_pt) * 20));
    if (para.line_spacing) {
        const rule = para.line_spacing_rule || '';
        if (rule === 'EXACTLY' || rule === 'AT_LEAST') {
            spacingAttrs.line = String(Math.round(Number(para.line_spacing) * 20));
            spacingAttrs.lineRule = rule === 'EXACTLY' ? 'exact' : 'atLeast';
        } else if (rule === 'SINGLE') {
            spacingAttrs.line = '240';
            spacingAttrs.lineRule = 'auto';
        } else if (rule === 'ONE_POINT_FIVE') {
            spacingAttrs.line = '360';
            spacingAttrs.lineRule = 'auto';
        } else if (rule === 'DOUBLE') {
            spacingAttrs.line = '480';
            spacingAttrs.lineRule = 'auto';
        } else {
            spacingAttrs.line = String(Math.round(Number(para.line_spacing) * 240));
            if (rule) spacingAttrs.lineRule = rule === 'MULTIPLE' ? 'auto' : rule.toLowerCase();
        }
    }
    if (Object.keys(spacingAttrs).length > 0) nodes.push({ tag: 'spacing', attrs: spacingAttrs });
    const indAttrs = {};
    if (para.left_indent_inches) indAttrs.left = String(Math.round(Number(para.left_indent_inches) * 1440));
    if (para.right_indent_inches) indAttrs.right = String(Math.round(Number(para.right_indent_inches) * 1440));
    if (para.first_line_indent_inches) {
        const firstLineValue = Number(para.first_line_indent_inches);
        if (firstLineValue < 0) indAttrs.hanging = String(Math.round(Math.abs(firstLineValue) * 1440));
        else indAttrs.firstLine = String(Math.round(firstLineValue * 1440));
    }
    if (Object.keys(indAttrs).length > 0) nodes.push({ tag: 'ind', attrs: indAttrs });
    if (para.keep_with_next) nodes.push({ tag: 'keepNext', attrs: {} });
    if (para.keep_together) nodes.push({ tag: 'keepLines', attrs: {} });
    if (para.page_break_before) nodes.push({ tag: 'pageBreakBefore', attrs: {} });
    if (para.widow_control) nodes.push({ tag: 'widowControl', attrs: {} });
    if (para.outline_level !== '' && para.outline_level !== null && para.outline_level !== undefined) {
        nodes.push({ tag: 'outlineLvl', attrs: { val: String(para.outline_level) } });
    }
    return nodes;
};

const validateOOXMLNodes = (nodes, validTags, label) => {
    const result = { valid: true, errors: [], warnings: [] };
    if (!Array.isArray(nodes)) { result.valid = false; result.errors.push(`${label} debe ser una lista JSON.`); return result; }
    nodes.forEach((node, idx) => {
        if (!node || typeof node !== 'object') { result.errors.push(`${label}[${idx}]: debe ser un objeto.`); result.valid = false; return; }
        if (!node.tag || typeof node.tag !== 'string') { result.errors.push(`${label}[${idx}]: falta 'tag' string.`); result.valid = false; return; }
        if (!validTags.has(node.tag)) result.warnings.push(`${label}[${idx}]: tag '${node.tag}' no reconocido.`);
    });
    return result;
};

const getHighlightCssColor = (highlight) => {
    const colorMap = {
        'YELLOW': '#ffff00', 'BRIGHT_GREEN': '#00ff00', 'TURQUOISE': '#00ffff',
        'PINK': '#ff00ff', 'BLUE': '#0000ff', 'RED': '#ff0000',
        'GRAY_50': '#808080', 'GRAY_25': '#c0c0c0',
    };
    return colorMap[highlight?.toUpperCase()] || 'transparent';
};

const NUMERIC_KEYS = new Set([
    'font_size_pt',
    'space_before_pt',
    'space_after_pt',
    'line_spacing',
    'first_line_indent_inches',
    'left_indent_inches',
    'right_indent_inches',
    'outline_level',
]);

const normalizeForCompare = (key, value) => {
    if (value === '' || value === null || value === undefined) return '';
    if (NUMERIC_KEYS.has(key)) return Number(value);
    return value;
};

const diffKeys = (current = {}, baseline = {}) => {
    return Object.keys(current).filter(key => (
        normalizeForCompare(key, current[key]) !== normalizeForCompare(key, baseline[key])
    ));
};

const buildPreviewKey = (styleName, props) => {
    const normalized = normalizePreviewProps(props);
    return JSON.stringify({
        style_name: styleName || '',
        font_name: normalized.font_name || '',
        font_size_pt: normalized.font_size_pt,
        bold: normalized.bold,
        italic: normalized.italic,
        underline: normalized.underline,
        underline_style: normalized.underline_style || '',
        color_rgb: normalized.color_rgb || '',
        highlight_color: normalized.highlight_color || '',
        strike: normalized.strike,
        double_strike: normalized.double_strike,
        all_caps: normalized.all_caps,
        small_caps: normalized.small_caps,
        superscript: normalized.superscript,
        subscript: normalized.subscript,
        space_before_pt: normalized.space_before_pt,
        space_after_pt: normalized.space_after_pt,
        alignment: normalized.alignment || '',
        line_spacing: normalized.line_spacing,
        line_spacing_rule: normalized.line_spacing_rule || '',
        first_line_indent_inches: normalized.first_line_indent_inches,
        left_indent_inches: normalized.left_indent_inches,
        right_indent_inches: normalized.right_indent_inches,
        keep_with_next: normalized.keep_with_next,
        keep_together: normalized.keep_together,
        page_break_before: normalized.page_break_before,
        widow_control: normalized.widow_control,
        outline_level: normalized.outline_level,
        style_type: normalized.style_type || '',
        category: normalized.category || '',
        style_id: normalized.style_id || '',
        table_signature: normalized.table_signature || '',
    });
};

const buildTablePreviewSignature = (stylePayload = null) => {
    if (!stylePayload || typeof stylePayload !== 'object') return null;
    try {
        return JSON.stringify({
            style_id: stylePayload.style_id || null,
            table: stylePayload.table || stylePayload.resolved_table_format || stylePayload.xml_table_format || null,
            cell: stylePayload.cell || stylePayload.resolved_cell_format || stylePayload.xml_cell_format || null,
            variants: stylePayload.table_variants || stylePayload.xml_table_variants || null,
        });
    } catch (err) {
        return null;
    }
};

const StatusBadge = ({ status }) => {
    const config = {
        defined: { color: '#4ade80', bg: '#14532d', icon: '✓', label: 'Definido' },
        inherited: { color: '#facc15', bg: '#422006', icon: '~', label: 'Heredado' },
        missing: { color: '#f87171', bg: '#450a0a', icon: '✗', label: 'Sin definir' },
    };
    const c = config[status] || config.missing;

    return (
        <span
            className="status-badge"
            style={{ color: c.color, background: c.bg }}
            title={c.label}
        >
            {c.icon}
        </span>
    );
};

const StyleCard = ({ styleInfo, isSelected, onClick }) => {
    const { name, status, description, style } = styleInfo;
    const font = getEffectiveStyleFont(style);
    const displayName = styleInfo.display_name || style?.display_name || style?.name || name;
    const isGlobal = styleInfo.kind === 'global';

    return (
        <div
            className={`style-card ${isSelected ? 'selected' : ''} status-${status} ${isGlobal ? 'global' : ''}`}
            onClick={onClick}
        >
            <div className="style-card-header">
                <span className="style-name">{displayName}</span>
                <StatusBadge status={status} />
            </div>
            {!isGlobal && status !== 'missing' && font && (
                <div
                    className="style-preview"
                    style={{
                                fontFamily: readFontName(font) || 'inherit',
                                fontSize: readFontSize(font) ? `${Math.min(readFontSize(font), 14)}px` : '12px',
                        fontWeight: font.bold ? 'bold' : 'normal',
                        fontStyle: font.italic ? 'italic' : 'normal',
                        color: font.color_rgb ? `#${font.color_rgb}` : '#ccc',
                    }}
                >
                    Abc
                </div>
            )}
            {isGlobal && (
                <div className="style-global-hint">Global</div>
            )}
            {status === 'missing' && (
                <div className="style-missing-hint">Click para definir</div>
            )}
        </div>
    );
};

const StyleEditPanel = ({
    styleInfo,
    onUpdate,
    onUpdateDocumentDefaults,
    onRequestPreview,
    previewImage,
    isUpdating,
    isPreviewLoading,
    advancedDetails,
    templateDetails,
    onStatusMessage,
    showInlinePreview = true,
}) => {
    const [localFont, setLocalFont] = useState({});
    const [localParagraph, setLocalParagraph] = useState({});
    const [hasChanges, setHasChanges] = useState(false);
    const [baselineFont, setBaselineFont] = useState({});
    const [baselineParagraph, setBaselineParagraph] = useState({});
    const [advancedEditMode, setAdvancedEditMode] = useState(false);
    const [advancedJson, setAdvancedJson] = useState({
        r_pr: '',
        p_pr: '',
        tbl_pr: '',
        tc_pr: '',
        tbl_style_pr: '',
    });
    const [advancedOriginal, setAdvancedOriginal] = useState({
        r_pr: '',
        p_pr: '',
        tbl_pr: '',
        tc_pr: '',
        tbl_style_pr: '',
    });
    const [hasAdvancedChanges, setHasAdvancedChanges] = useState(false);

    // Helper to check if selection is global (used throughout component)
    const isGlobalSelection = styleInfo?.kind === 'global' || styleInfo?.name === 'global';
    const documentDefaults = useMemo(() => ({
        font: templateDetails?.document_defaults?.font || {},
        paragraph: templateDetails?.document_defaults?.paragraph || {},
        font_source: templateDetails?.document_defaults?.font_source || templateDetails?.default_font_source || null,
        paragraph_source: templateDetails?.document_defaults?.paragraph_source || null,
    }), [templateDetails]);

    const resolvedStyleName = isGlobalSelection ? null : (styleInfo?.style?.name || styleInfo?.name);
    const displayStyleName = styleInfo?.display_name || styleInfo?.style?.display_name || styleInfo?.style?.name || styleInfo?.name;
    const resolvedFont = isGlobalSelection ? (documentDefaults.font || {}) : (styleInfo?.style?.resolved_font || {});
    const resolvedParagraph = isGlobalSelection ? (documentDefaults.paragraph || {}) : (styleInfo?.style?.resolved_paragraph_format || {});
    const explicitFont = isGlobalSelection ? (documentDefaults.font || {}) : (styleInfo?.style?.xml_font || {});
    const explicitParagraph = isGlobalSelection ? (documentDefaults.paragraph || {}) : (styleInfo?.style?.xml_paragraph_format || {});
    const resolvedFontSource = isGlobalSelection
        ? (documentDefaults.font_source || null)
        : (styleInfo?.style?.resolved_font_source || styleInfo?.style?.font_source || null);
    const listInfo = styleInfo?.style?.list_info || null;
    const isCaptionStyle = !isGlobalSelection && (
        styleInfo?.category === 'captions'
        || styleInfo?.style?.style_id === 'Caption'
        || resolvedStyleName === 'Caption'
    );
    const detectedCaptions = useMemo(
        () => (Array.isArray(templateDetails?.document_captions) ? templateDetails.document_captions : []),
        [templateDetails]
    );

    // Table properties for table-type styles
    const resolvedTable = styleInfo?.style?.resolved_table_format || {};
    const resolvedCell = styleInfo?.style?.resolved_cell_format || {};
    const tableVariants = styleInfo?.style?.table_variants || {};
    const explicitTable = styleInfo?.style?.xml_table_format || {};
    const explicitCell = styleInfo?.style?.xml_cell_format || {};
    const isTableStyle = styleInfo?.style?.type === 'table';

    const [localTable, setLocalTable] = useState({});
    const [baselineTable, setBaselineTable] = useState({});
    const fontPickerRef = useRef(null);
    const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
    const [fontMenuQuery, setFontMenuQuery] = useState('');

    const styleMeta = useMemo(() => ({
        style_type: styleInfo?.style?.type || styleInfo?.style_type || null,
        category: styleInfo?.category || styleInfo?.style?.category || null,
        style_id: styleInfo?.style?.style_id || styleInfo?.style_id || null,
        table_signature: (styleInfo?.style?.type || styleInfo?.style_type) === 'table'
            ? buildTablePreviewSignature(styleInfo?.style)
            : null,
    }), [styleInfo]);

    const resolvedFontJson = useMemo(() => (
        resolvedFont && Object.keys(resolvedFont).length ? formatJson(resolvedFont) : null
    ), [resolvedFont]);
    const resolvedParagraphJson = useMemo(() => (
        resolvedParagraph && Object.keys(resolvedParagraph).length ? formatJson(resolvedParagraph) : null
    ), [resolvedParagraph]);

    const hasExplicit = (obj, key) => obj && Object.prototype.hasOwnProperty.call(obj, key);

    const isFontExplicit = (key) => {
        if (!explicitFont || !key) return false;
        if (key === 'font_name') {
            return hasExplicit(explicitFont, 'font_name') || hasExplicit(explicitFont, 'name');
        }
        if (key === 'font_size_pt') {
            return hasExplicit(explicitFont, 'font_size_pt') || hasExplicit(explicitFont, 'size_pt');
        }
        if (key === 'underline') {
            return hasExplicit(explicitFont, 'underline') || hasExplicit(explicitFont, 'underline_style');
        }
        return hasExplicit(explicitFont, key);
    };

    const isParagraphExplicit = (key) => {
        if (!explicitParagraph || !key) return false;
        return hasExplicit(explicitParagraph, key);
    };

    const renderOriginBadge = (group, key) => {
        if (isGlobalSelection || !styleInfo?.style) return null;
        const isExplicit = group === 'font' ? isFontExplicit(key) : isParagraphExplicit(key);
        const label = isExplicit ? 'Explícito' : 'Efectivo';
        const title = isExplicit
            ? 'Definido en este estilo'
            : 'Heredado de basedOn/docDefaults/tema';
        return (
            <span className={`field-origin ${isExplicit ? 'explicit' : 'effective'}`} title={title}>
                {label}
            </span>
        );
    };

    const fontChangedKeys = useMemo(
        () => diffKeys(localFont, baselineFont),
        [localFont, baselineFont]
    );
    const paragraphChangedKeys = useMemo(
        () => diffKeys(localParagraph, baselineParagraph),
        [localParagraph, baselineParagraph]
    );
    const tableChangedLocalKeys = useMemo(
        () => diffKeys(localTable, baselineTable),
        [localTable, baselineTable]
    );
    const tableChangedBackendKeys = useMemo(
        () => Object.keys(mapLocalTableToTemplateUpdates(localTable, tableChangedLocalKeys)),
        [localTable, tableChangedLocalKeys]
    );
    const changedKeys = useMemo(
        () => [...fontChangedKeys, ...paragraphChangedKeys, ...tableChangedBackendKeys],
        [fontChangedKeys, paragraphChangedKeys, tableChangedBackendKeys]
    );

    const effectiveFont = useMemo(() => {
        const merged = { ...resolvedFont };
        Object.keys(localFont || {}).forEach((key) => {
            const localValue = localFont[key];
            const useLocal = changedKeys.includes(key)
                || merged[key] === undefined
                || merged[key] === null
                || merged[key] === '';
            if (useLocal) {
                merged[key] = localValue;
            }
        });
        return merged;
    }, [resolvedFont, localFont, changedKeys]);

    const previewText = useMemo(() => {
        if (isCaptionStyle) return 'Figura 1. Texto de ejemplo';
        if (!listInfo) return 'El veloz murciélago hindú comía feliz cardillo y kiwi';
        const format = String(listInfo.list_format || '').toLowerCase();
        const start = Number.isFinite(Number(listInfo.list_start)) ? Number(listInfo.list_start) : 1;
        let prefix = '';
        let suffix = '. ';
        if (!format && listInfo.lvl_text) {
            const raw = String(listInfo.lvl_text);
            prefix = raw.replace(/%\d+/g, String(start)).trim();
            suffix = prefix.endsWith('.') ? ' ' : '. ';
        }
        if (format === 'bullet') {
            prefix = listInfo.list_bullet_char || '•';
            suffix = ' ';
        } else if (format === 'upperletter') {
            prefix = String.fromCharCode(64 + Math.max(1, start));
        } else if (format === 'lowerletter') {
            prefix = String.fromCharCode(96 + Math.max(1, start));
        } else if (format === 'upperroman') {
            prefix = 'I';
        } else if (format === 'lowerroman') {
            prefix = 'i';
        } else if (format === 'decimal') {
            prefix = String(start);
        }
        const withPrefix = prefix ? `${prefix}${suffix}` : '';
        return `${withPrefix}El veloz murciélago hindú comía feliz cardillo y kiwi`;
    }, [isCaptionStyle, listInfo]);

    const styleMetaJson = useMemo(
        () => (advancedDetails ? formatJson(buildStyleMeta(advancedDetails)) : null),
        [advancedDetails]
    );
    const styleRunJson = useMemo(
        () => (advancedDetails?.r_pr ? formatJson(advancedDetails.r_pr) : null),
        [advancedDetails]
    );
    const styleParagraphJson = useMemo(
        () => (advancedDetails?.p_pr ? formatJson(advancedDetails.p_pr) : null),
        [advancedDetails]
    );
    const styleTableJson = useMemo(
        () => (advancedDetails?.tbl_pr ? formatJson(advancedDetails.tbl_pr) : null),
        [advancedDetails]
    );
    const styleCellJson = useMemo(
        () => (advancedDetails?.tc_pr ? formatJson(advancedDetails.tc_pr) : null),
        [advancedDetails]
    );
    const styleTableVariantsJson = useMemo(
        () => (advancedDetails?.tbl_style_pr ? formatJson(advancedDetails.tbl_style_pr) : null),
        [advancedDetails]
    );
    const advancedStyleXml = useMemo(() => advancedDetails?.raw_xml || null, [advancedDetails]);
    const docDefaultsRunJson = useMemo(
        () => (templateDetails?.doc_defaults?.r_pr ? formatJson(templateDetails.doc_defaults.r_pr) : null),
        [templateDetails]
    );
    const docDefaultsParagraphJson = useMemo(
        () => (templateDetails?.doc_defaults?.p_pr ? formatJson(templateDetails.doc_defaults.p_pr) : null),
        [templateDetails]
    );
    const docDefaultsXml = useMemo(() => templateDetails?.doc_defaults?.raw_xml || null, [templateDetails]);
    const numberingAbstractJson = useMemo(
        () => (templateDetails?.numbering?.abstract_nums?.length ? formatJson(templateDetails.numbering.abstract_nums) : null),
        [templateDetails]
    );
    const numberingNumsJson = useMemo(
        () => (templateDetails?.numbering?.nums?.length ? formatJson(templateDetails.numbering.nums) : null),
        [templateDetails]
    );
    const numberingXml = useMemo(() => templateDetails?.numbering?.raw_xml || null, [templateDetails]);
    const themeFontJson = useMemo(
        () => (templateDetails?.theme?.font_scheme ? formatJson(templateDetails.theme.font_scheme) : null),
        [templateDetails]
    );
    const themeColorJson = useMemo(
        () => (templateDetails?.theme?.color_scheme ? formatJson(templateDetails.theme.color_scheme) : null),
        [templateDetails]
    );
    const themeXml = useMemo(() => templateDetails?.theme?.raw_xml || null, [templateDetails]);
    const fontOptions = useMemo(
        () => collectTemplateFontOptionsShared(templateDetails, [
            localFont.font_name,
            resolvedFont.font_name,
            resolvedFont.name,
            explicitFont.font_name,
            explicitFont.name,
            templateDetails?.default_font?.name,
            templateDetails?.default_font?.font_name,
        ]),
        [templateDetails, localFont.font_name, resolvedFont, explicitFont]
    );
    const visibleFontOptions = useMemo(() => {
        const query = String(fontMenuQuery || '').trim().toLowerCase();
        const candidates = query
            ? fontOptions.filter(fontName => fontName.toLowerCase().includes(query))
            : fontOptions;
        return candidates.slice(0, query ? 100 : 40);
    }, [fontMenuQuery, fontOptions]);
    const fontAvailability = useMemo(
        () => getFontAvailabilityInfo(
            effectiveFont.font_name || resolvedFont.font_name || resolvedFont.name,
            templateDetails?.system_font_catalog || [],
        ),
        [effectiveFont.font_name, resolvedFont.font_name, resolvedFont.name, templateDetails]
    );
    const fontSourceLabel = useMemo(
        () => formatFontSourceLabel(resolvedFontSource),
        [resolvedFontSource]
    );
    const sectionsJson = useMemo(
        () => (templateDetails?.sections?.length ? formatJson(templateDetails.sections.map(section => stripRawXml(section))) : null),
        [templateDetails]
    );
    const sectionsXml = useMemo(
        () => (templateDetails?.sections?.length ? formatJson(templateDetails.sections.map(section => section.raw_xml)) : null),
        [templateDetails]
    );
    const headingStylesJson = useMemo(
        () => (templateDetails?.heading_styles?.length ? formatJson(templateDetails.heading_styles) : null),
        [templateDetails]
    );
    const metaJson = useMemo(() => (templateDetails?.meta ? formatJson(templateDetails.meta) : formatJson({})), [templateDetails]);

    const buildAdvancedJsonState = useCallback((details) => ({
        r_pr: details?.r_pr ? formatJson(details.r_pr) : '',
        p_pr: details?.p_pr ? formatJson(details.p_pr) : '',
        tbl_pr: details?.tbl_pr ? formatJson(details.tbl_pr) : '',
        tc_pr: details?.tc_pr ? formatJson(details.tc_pr) : '',
        tbl_style_pr: details?.tbl_style_pr ? formatJson(details.tbl_style_pr) : '',
    }), []);

    const computeAdvancedChanges = useCallback(
        (nextState) => Object.keys(nextState).some(
            key => (nextState[key] || '').trim() !== (advancedOriginal[key] || '').trim()
        ),
        [advancedOriginal]
    );

    useEffect(() => {
        if (isGlobalSelection) return;
        const nextState = buildAdvancedJsonState(advancedDetails);
        setAdvancedJson(nextState);
        setAdvancedOriginal(nextState);
        setHasAdvancedChanges(false);
        setAdvancedEditMode(false);
    }, [advancedDetails, buildAdvancedJsonState, isGlobalSelection]);

    const handleAdvancedChange = (key, value) => {
        setAdvancedJson(prev => {
            const nextState = { ...prev, [key]: value };
            setHasAdvancedChanges(computeAdvancedChanges(nextState));
            return nextState;
        });

        // Issue 2: Sync JSON textarea changes back to UI controls
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                if (key === 'r_pr') {
                    const fontFromJson = parseRprToFontShared(parsed, templateDetails?.theme || null);
                    if (Object.keys(fontFromJson).length > 0) {
                        setLocalFont(prev => ({ ...prev, ...fontFromJson }));
                    }
                } else if (key === 'p_pr') {
                    const paraFromJson = parsePprToParagraph(parsed);
                    if (Object.keys(paraFromJson).length > 0) {
                        setLocalParagraph(prev => ({ ...prev, ...paraFromJson }));
                    }
                }
            }
        } catch (e) {
            // Invalid JSON - ignore
        }
    };

    const toggleAdvancedEditMode = () => {
        if (advancedEditMode) {
            setAdvancedJson(advancedOriginal);
            setHasAdvancedChanges(false);
        }
        setAdvancedEditMode(prev => !prev);
    };

    // Auto-trigger preview with debounce when UI controls change (Issue 3)
    const buildPreviewPropsFromState = useCallback(() => {
        const tablePreviewPayload = mapLocalTableToTemplateUpdates(localTable);
        return {
            ...localFont,
            ...localParagraph,
            ...tablePreviewPayload,
            changed_keys: changedKeys,
            style_type: styleMeta.style_type,
            category: styleMeta.category,
            style_id: styleMeta.style_id,
            table_signature: styleMeta.table_signature,
        };
    }, [localFont, localParagraph, localTable, changedKeys, styleMeta]);

    useEffect(() => {
        if (!styleInfo || isGlobalSelection || !onRequestPreview || styleInfo.status === 'missing' || !resolvedStyleName) return;
        // Keep preview debounce centralized in TemplateEditor request pipeline.
        onRequestPreview(resolvedStyleName, buildPreviewPropsFromState(), { immediate: !hasChanges });
    }, [localFont, localParagraph, hasChanges, resolvedStyleName, isGlobalSelection, onRequestPreview, buildPreviewPropsFromState, styleInfo]);

    useEffect(() => {
        if (!styleInfo) {
            setLocalFont({});
            setLocalParagraph({});
            setHasChanges(false);
            setBaselineFont({});
            setBaselineParagraph({});
            setLocalTable({});
            setBaselineTable({});
            setAdvancedEditMode(false);
            setHasAdvancedChanges(false);
            return;
        }
        if (isGlobalSelection) {
            const nextFont = {
                font_name: documentDefaults.font?.font_name || documentDefaults.font?.name || '',
                font_size_pt: documentDefaults.font?.font_size_pt ?? documentDefaults.font?.size_pt ?? '',
                bold: documentDefaults.font?.bold ?? false,
                italic: documentDefaults.font?.italic ?? false,
                underline: documentDefaults.font?.underline ?? false,
                underline_style: documentDefaults.font?.underline_style || '',
                color_rgb: documentDefaults.font?.color_rgb || '',
                highlight_color: documentDefaults.font?.highlight_color || '',
                strike: documentDefaults.font?.strike ?? false,
                double_strike: documentDefaults.font?.double_strike ?? false,
                all_caps: documentDefaults.font?.all_caps ?? false,
                small_caps: documentDefaults.font?.small_caps ?? false,
                superscript: documentDefaults.font?.superscript ?? false,
                subscript: documentDefaults.font?.subscript ?? false,
            };
            const nextParagraph = {
                space_before_pt: documentDefaults.paragraph?.space_before_pt ?? '',
                space_after_pt: documentDefaults.paragraph?.space_after_pt ?? '',
                alignment: documentDefaults.paragraph?.alignment || '',
                line_spacing: documentDefaults.paragraph?.line_spacing ?? '',
                line_spacing_rule: documentDefaults.paragraph?.line_spacing_rule || '',
                first_line_indent_inches: documentDefaults.paragraph?.first_line_indent_inches ?? '',
                left_indent_inches: documentDefaults.paragraph?.left_indent_inches ?? '',
                right_indent_inches: documentDefaults.paragraph?.right_indent_inches ?? '',
                keep_with_next: documentDefaults.paragraph?.keep_with_next ?? false,
                keep_together: documentDefaults.paragraph?.keep_together ?? false,
                page_break_before: documentDefaults.paragraph?.page_break_before ?? false,
                widow_control: documentDefaults.paragraph?.widow_control ?? false,
                outline_level: '',
            };
            setLocalFont(nextFont);
            setLocalParagraph(nextParagraph);
            setBaselineFont(nextFont);
            setBaselineParagraph(nextParagraph);
            setLocalTable({});
            setBaselineTable({});
            setAdvancedEditMode(false);
            setHasAdvancedChanges(false);
            setHasChanges(false);
            return;
        }
        const font = styleInfo?.style?.font || {};
        const paragraph = styleInfo?.style?.paragraph_format || {};
        const resolvedFontValues = styleInfo?.style?.resolved_font || {};
        const resolvedParagraphValues = styleInfo?.style?.resolved_paragraph_format || {};

        // Parse advanced details for bidirectional sync (XML -> UI)
        const advFont = parseRprToFontShared(advancedDetails?.r_pr, templateDetails?.theme || null);
        const advPara = parsePprToParagraph(advancedDetails?.p_pr);

        const nextFont = {
            font_name: advFont.font_name || font.name || font.font_name || resolvedFontValues.font_name || resolvedFontValues.name || '',
            font_size_pt: advFont.font_size_pt ?? font.size_pt ?? font.font_size_pt ?? resolvedFontValues.font_size_pt ?? resolvedFontValues.size_pt ?? '',
            bold: advFont.bold ?? font.bold ?? resolvedFontValues.bold ?? false,
            italic: advFont.italic ?? font.italic ?? resolvedFontValues.italic ?? false,
            underline: advFont.underline ?? font.underline ?? resolvedFontValues.underline ?? false,
            underline_style: advFont.underline_style || font.underline_style || resolvedFontValues.underline_style || '',
            color_rgb: advFont.color_rgb || font.color_rgb || resolvedFontValues.color_rgb || '',
            highlight_color: advFont.highlight_color || font.highlight_color || resolvedFontValues.highlight_color || '',
            strike: advFont.strike ?? font.strike ?? resolvedFontValues.strike ?? false,
            double_strike: advFont.double_strike ?? font.double_strike ?? resolvedFontValues.double_strike ?? false,
            all_caps: advFont.all_caps ?? font.all_caps ?? resolvedFontValues.all_caps ?? false,
            small_caps: advFont.small_caps ?? font.small_caps ?? resolvedFontValues.small_caps ?? false,
            superscript: advFont.superscript ?? font.superscript ?? resolvedFontValues.superscript ?? false,
            subscript: advFont.subscript ?? font.subscript ?? resolvedFontValues.subscript ?? false,
        };
        const nextParagraph = {
            space_before_pt: advPara.space_before_pt ?? paragraph.space_before_pt ?? resolvedParagraphValues.space_before_pt ?? '',
            space_after_pt: advPara.space_after_pt ?? paragraph.space_after_pt ?? resolvedParagraphValues.space_after_pt ?? '',
            alignment: advPara.alignment || paragraph.alignment || resolvedParagraphValues.alignment || '',
            line_spacing: advPara.line_spacing ?? paragraph.line_spacing ?? resolvedParagraphValues.line_spacing ?? '',
            line_spacing_rule: advPara.line_spacing_rule || paragraph.line_spacing_rule || resolvedParagraphValues.line_spacing_rule || '',
            first_line_indent_inches: advPara.first_line_indent_inches ?? paragraph.first_line_indent_inches ?? resolvedParagraphValues.first_line_indent_inches ?? '',
            left_indent_inches: advPara.left_indent_inches ?? paragraph.left_indent_inches ?? resolvedParagraphValues.left_indent_inches ?? '',
            right_indent_inches: advPara.right_indent_inches ?? paragraph.right_indent_inches ?? resolvedParagraphValues.right_indent_inches ?? '',
            keep_with_next: advPara.keep_with_next ?? paragraph.keep_with_next ?? resolvedParagraphValues.keep_with_next ?? false,
            keep_together: advPara.keep_together ?? paragraph.keep_together ?? resolvedParagraphValues.keep_together ?? false,
            page_break_before: advPara.page_break_before ?? paragraph.page_break_before ?? resolvedParagraphValues.page_break_before ?? false,
            widow_control: advPara.widow_control ?? paragraph.widow_control ?? resolvedParagraphValues.widow_control ?? false,
            outline_level: advPara.outline_level ?? paragraph.outline_level ?? resolvedParagraphValues.outline_level ?? '',
        };
        setLocalFont(nextFont);
        setLocalParagraph(nextParagraph);
        setBaselineFont(nextFont);
        setBaselineParagraph(nextParagraph);

        // Initialize table properties for table-type styles
        const tableFormat = styleInfo?.style?.resolved_table_format || styleInfo?.style?.xml_table_format || {};
        const cellFormat = styleInfo?.style?.resolved_cell_format || styleInfo?.style?.xml_cell_format || {};
        const nextTable = {
            border_style: tableFormat.borders?.top?.style || tableFormat.borders?.left?.style || 'single',
            border_size_pt: tableFormat.borders?.top?.size_pt || tableFormat.borders?.left?.size_pt || 0.5,
            border_color: tableFormat.borders?.top?.color || tableFormat.borders?.left?.color || '000000',
            shading_color: tableFormat.shading_color || '',
            alignment: tableFormat.alignment || 'left',
            width_type: tableFormat.width_type || 'auto',
            width_value: tableFormat.width_value || 100,
            layout_type: tableFormat.layout_type || 'autofit',
            cell_spacing_pt: tableFormat.cell_spacing_pt ?? 0,
            cell_margin_top_pt: tableFormat.cell_margins?.top ?? 0,
            cell_margin_bottom_pt: tableFormat.cell_margins?.bottom ?? 0,
            cell_margin_left_pt: tableFormat.cell_margins?.left ?? 5.4,
            cell_margin_right_pt: tableFormat.cell_margins?.right ?? 5.4,
            // tblLook options
            look_first_row: tableFormat.look?.firstRow ?? true,
            look_last_row: tableFormat.look?.lastRow ?? false,
            look_first_column: tableFormat.look?.firstColumn ?? true,
            look_last_column: tableFormat.look?.lastColumn ?? false,
            look_no_h_band: tableFormat.look?.noHBand ?? false,
            look_no_v_band: tableFormat.look?.noVBand ?? true,
            // Cell properties
            cell_shading_color: cellFormat.shading_color || '',
            cell_vertical_align: cellFormat.vertical_align || 'top',
        };
        setLocalTable(nextTable);
        setBaselineTable(nextTable);

        setHasChanges(false);
    }, [styleInfo, isGlobalSelection, advancedDetails, documentDefaults]);

    useEffect(() => {
        setIsFontMenuOpen(false);
        setFontMenuQuery('');
    }, [resolvedStyleName]);

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (!fontPickerRef.current?.contains(event.target)) {
                setIsFontMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    useEffect(() => {
        const changed = diffKeys(localFont, baselineFont).length > 0
            || diffKeys(localParagraph, baselineParagraph).length > 0
            || diffKeys(localTable, baselineTable).length > 0;
        setHasChanges(changed);
    }, [localFont, localParagraph, localTable, baselineFont, baselineParagraph, baselineTable, isGlobalSelection]);

    // Auto-sync UI changes -> JSON display (Issue 1 part 2)
    useEffect(() => {
        if (!hasChanges || advancedEditMode || isGlobalSelection) return;
        const newRpr = formatJson(fontToRpr(localFont));
        const newPpr = formatJson(paragraphToPpr(localParagraph));
        setAdvancedJson(prev => ({
            ...prev,
            r_pr: newRpr !== '[]' ? newRpr : prev.r_pr,
            p_pr: newPpr !== '[]' ? newPpr : prev.p_pr,
        }));
    }, [localFont, localParagraph, hasChanges, advancedEditMode, isGlobalSelection]);

    const handleTableChange = (key, value) => {
        setLocalTable(prev => ({ ...prev, [key]: value }));
    };

    const handleChange = (key, value) => {
        if (key in localFont) {
            setLocalFont(prev => {
                const next = { ...prev, [key]: value };
                if (key === 'underline' && !value) {
                    next.underline_style = '';
                }
                if (key === 'underline_style') {
                    next.underline = value !== '' ? true : prev.underline;
                }
                if (key === 'superscript' && value) {
                    next.subscript = false;
                }
                if (key === 'subscript' && value) {
                    next.superscript = false;
                }
                return next;
            });
        } else {
            setLocalParagraph(prev => ({ ...prev, [key]: value }));
        }
    };

    const handleFontInputFocus = () => {
        setFontMenuQuery('');
        setIsFontMenuOpen(true);
    };

    const handleFontInputChange = (value) => {
        handleChange('font_name', value);
        setFontMenuQuery(value);
        setIsFontMenuOpen(true);
    };

    const handleFontOptionSelect = (fontName) => {
        handleChange('font_name', fontName);
        setFontMenuQuery(fontName);
        setIsFontMenuOpen(false);
    };

    const toggleFontMenu = () => {
        setFontMenuQuery('');
        setIsFontMenuOpen(prev => !prev);
    };

    const parseJsonSection = (label, value) => {
        const trimmed = (value || '').trim();
        if (!trimmed) return { value: null };
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) {
                return { error: `${label} debe ser una lista JSON.` };
            }
            return { value: parsed };
        } catch (error) {
            return { error: `${label} contiene JSON inválido.` };
        }
    };

    const buildAdvancedPayload = () => {
        if (!hasAdvancedChanges) return {};
        const changedKeys = Object.keys(advancedJson).filter(
            key => (advancedJson[key] || '').trim() !== (advancedOriginal[key] || '').trim()
        );
        if (!changedKeys.length) return {};
        const payload = {};
        const labels = {
            r_pr: 'Texto (rPr)',
            p_pr: 'Párrafo (pPr)',
            tbl_pr: 'Tabla (tblPr)',
            tc_pr: 'Celda (tcPr)',
            tbl_style_pr: 'Variantes de tabla',
        };
        for (const key of changedKeys) {
            const label = labels[key] || key;
            const result = parseJsonSection(label, advancedJson[key]);
            if (result.error) {
                onStatusMessage?.(result.error, 'error');
                return null;
            }
            payload[key] = result.value;
        }
        return payload;
    };

    const handleSave = () => {
        const fontChanges = diffKeys(localFont, baselineFont);
        const paraChanges = diffKeys(localParagraph, baselineParagraph);
        const tableChanges = diffKeys(localTable, baselineTable);
        const hasDiff = fontChanges.length > 0 || paraChanges.length > 0 || tableChanges.length > 0;
        if (!hasDiff && !hasAdvancedChanges) return;
        if (isGlobalSelection) {
            const updates = {};
            if (fontChanges.length > 0) {
                updates.font = fontChanges.reduce((acc, key) => {
                    acc[key] = localFont[key];
                    return acc;
                }, {});
                if (Object.prototype.hasOwnProperty.call(updates.font, 'underline') && !localFont.underline) {
                    updates.font.underline_style = '';
                }
            }
            if (paraChanges.length > 0) {
                updates.paragraph = paraChanges.reduce((acc, key) => {
                    if (key !== 'outline_level') {
                        acc[key] = localParagraph[key];
                    }
                    return acc;
                }, {});
            }
            if (!Object.keys(updates).length) return;
            onUpdateDocumentDefaults?.(updates);
            return;
        }
        if (!resolvedStyleName) return;
        const updates = {};
        if (hasDiff) {
            fontChanges.forEach(key => { updates[key] = localFont[key]; });
            paraChanges.forEach(key => { updates[key] = localParagraph[key]; });
            const tableUpdates = mapLocalTableToTemplateUpdates(localTable, tableChanges);
            Object.assign(updates, tableUpdates);
            if (tableChanges.length > 0) {
                updates.table = tableChanges.reduce((acc, key) => {
                    acc[key] = localTable[key];
                    return acc;
                }, {});
            }
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'underline') && !localFont.underline) {
            updates.underline_style = '';
        }
        if (styleMeta.style_id) {
            updates.style_id = styleMeta.style_id;
        }
        if (styleMeta.style_type) {
            updates.style_type = styleMeta.style_type;
        }
        if (styleMeta.category) {
            updates.category = styleMeta.category;
        }
        if (hasAdvancedChanges) {
            const advancedPayload = buildAdvancedPayload();
            if (advancedPayload === null) return;
            if (Object.keys(advancedPayload).length) {
                updates.advanced_props = advancedPayload;
            }
        }
        if (!Object.keys(updates).length) return;
        onUpdate(resolvedStyleName, updates);
    };

    const handleManualPreview = () => {
        if (!styleInfo || isGlobalSelection || !onRequestPreview || !resolvedStyleName) return;
        onRequestPreview(resolvedStyleName, buildPreviewPropsFromState(), { immediate: true, force: true });
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if ((hasChanges || hasAdvancedChanges) && !isUpdating) {
                    handleSave();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isGlobalSelection, hasChanges, hasAdvancedChanges, isUpdating, handleSave]);

    const previewStatusLabel = isPreviewLoading
        ? (previewImage ? 'Actualizando render de Word...' : 'Renderizando vista real en Word...')
        : (previewImage ? 'Renderizado real de Word' : 'Vista CSS aproximada (temporal)');

    if (!styleInfo) {
        return (
            <div className="style-edit-panel empty">
                <p>Selecciona un estilo de la lista para editarlo</p>
            </div>
        );
    }

    return (
        <div className="style-edit-panel">
            <div className="edit-panel-header">
                <div className="style-panel-title">
                    <div className="style-panel-title-row">
                        <h3>{displayStyleName}</h3>
                        <StatusBadge status={styleInfo.status} />
                        {(hasChanges || hasAdvancedChanges) && <span className="unsaved-indicator">Sin guardar</span>}
                    </div>
                    <div className="style-panel-meta">
                        {isGlobalSelection ? 'Documento global' : `${styleMeta.category || styleInfo.category || 'estilo'} · ${styleMeta.style_type || styleInfo.style_type || styleInfo.style?.type || 'paragraph'}`}
                    </div>
                </div>
                <button
                    className="save-button sticky-save-button"
                    onClick={handleSave}
                    disabled={!(hasChanges || hasAdvancedChanges) || isUpdating}
                >
                    {isUpdating ? <LoadingSpinner size="small" /> : <IconSave />}
                    <span>Guardar Cambios</span>
                </button>
            </div>

            <p className="style-description">{styleInfo.description}</p>

            {isCaptionStyle && (
                <div className="edit-section">
                    <h4>Captions detectados</h4>
                    <div className="advanced-note">
                        Lectura estructural del template para identificar captions asociados a tablas o figuras.
                    </div>
                    {detectedCaptions.length > 0 ? (
                        detectedCaptions.map((captionInfo) => (
                            <details
                                key={`${captionInfo.index}-${captionInfo.object_type || 'unknown'}-${captionInfo.object_index ?? 'na'}`}
                                className="advanced-block"
                            >
                                <summary>
                                    {(captionInfo.object_type || 'caption').toUpperCase()}
                                    {typeof captionInfo.object_index === 'number' ? ` #${captionInfo.object_index + 1}` : ''}
                                    {captionInfo.position ? ` · ${captionInfo.position}` : ''}
                                </summary>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Texto</div>
                                    <pre>{captionInfo.plain_text || captionInfo.text || '—'}</pre>
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Metadata</div>
                                    <pre>{formatJson({
                                        style_name: captionInfo.style_name,
                                        style_id: captionInfo.style_id,
                                        uses_caption_style: captionInfo.uses_caption_style,
                                        has_seq_field: captionInfo.has_seq_field,
                                        sequence_name: captionInfo.sequence_name,
                                    })}</pre>
                                </div>
                            </details>
                        ))
                    ) : (
                        <div className="advanced-empty">No se detectaron captions en el documento actual.</div>
                    )}
                </div>
            )}

            {!isGlobalSelection && (
                <div className="origin-legend">
                    <span className="field-origin explicit" title="Definido en este estilo">Explícito</span>
                    <span className="field-origin effective" title="Heredado de basedOn/docDefaults/tema">Efectivo</span>
                    <span className="origin-note">Editar un valor efectivo lo convierte en explícito en este estilo.</span>
                </div>
            )}
            {isGlobalSelection && (
                <div className="advanced-note global-defaults-note">
                    Afecta texto base y estilos heredados; no pisa estilos con fuente o párrafo explícitos del template.
                </div>
            )}

            <div className="edit-section">
                <h4>Fuente</h4>

                <div className="edit-row">
                    <label>
                        <span>Familia:</span>
                        {renderOriginBadge('font', 'font_name')}
                    </label>
                    <div className="font-picker" ref={fontPickerRef}>
                        <div className="font-picker-input">
                            <input
                                type="text"
                                value={localFont.font_name || ''}
                                onFocus={handleFontInputFocus}
                                onChange={e => handleFontInputChange(e.target.value)}
                                placeholder="Fuente del template o de Word"
                                autoComplete="off"
                            />
                            <button
                                type="button"
                                className="font-picker-toggle"
                                onMouseDown={e => e.preventDefault()}
                                onClick={toggleFontMenu}
                                aria-label="Mostrar fuentes"
                            >
                                ▾
                            </button>
                        </div>
                        {isFontMenuOpen && (
                            <div className="font-picker-menu">
                                {visibleFontOptions.length > 0 ? (
                                    visibleFontOptions.map(fontName => (
                                        <button
                                            key={fontName}
                                            type="button"
                                            className={`font-picker-option ${fontName === localFont.font_name ? 'selected' : ''}`}
                                            data-font-option={fontName}
                                            onMouseDown={e => {
                                                e.preventDefault();
                                                handleFontOptionSelect(fontName);
                                            }}
                                        >
                                            {fontName}
                                        </button>
                                    ))
                                ) : (
                                    <div className="font-picker-empty">Sin coincidencias.</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {fontSourceLabel && (
                    <div className="font-source-hint">{fontSourceLabel}</div>
                )}
                {fontAvailability.available === false && (
                    <div className="font-availability-warning">
                        Fuente no detectada en este equipo. Se conservará el nombre del template y Word/LibreOffice podría sustituirla visualmente.
                    </div>
                )}

                <div className="edit-row">
                    <label>
                        <span>Tamaño:</span>
                        {renderOriginBadge('font', 'font_size_pt')}
                    </label>
                    <input
                        type="number"
                        value={localFont.font_size_pt ?? ''}
                        onChange={e => handleChange('font_size_pt', e.target.value)}
                        min="6"
                        max="72"
                        step="0.5"
                        placeholder="pt"
                    />
                    <span className="unit">pt</span>
                </div>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.bold)}
                            onChange={e => handleChange('bold', e.target.checked)}
                        />
                        <strong>B</strong> Negrita
                        {renderOriginBadge('font', 'bold')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.italic)}
                            onChange={e => handleChange('italic', e.target.checked)}
                        />
                        <em>I</em> Cursiva
                        {renderOriginBadge('font', 'italic')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.underline)}
                            onChange={e => handleChange('underline', e.target.checked)}
                        />
                        <u>U</u> Subrayado
                        {renderOriginBadge('font', 'underline')}
                    </label>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Estilo subrayado:</span>
                        {renderOriginBadge('font', 'underline_style')}
                    </label>
                    <select
                        value={localFont.underline_style || ''}
                        onChange={e => handleChange('underline_style', e.target.value)}
                        disabled={!localFont.underline}
                    >
                        {UNDERLINE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Color:</span>
                        {renderOriginBadge('font', 'color_rgb')}
                    </label>
                    <input
                        type="color"
                        value={localFont.color_rgb ? `#${localFont.color_rgb}` : '#000000'}
                        onChange={e => handleChange('color_rgb', e.target.value.replace('#', ''))}
                    />
                    {localFont.color_rgb && (
                        <span className="color-value">#{localFont.color_rgb}</span>
                    )}
                </div>

                <div className="edit-row">
                    <label>
                        <span>Resaltado:</span>
                        {renderOriginBadge('font', 'highlight_color')}
                    </label>
                    <select
                        value={localFont.highlight_color || ''}
                        onChange={e => handleChange('highlight_color', e.target.value)}
                    >
                        {HIGHLIGHT_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="edit-section">
                <h4>Efectos de texto</h4>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.strike)}
                            onChange={e => handleChange('strike', e.target.checked)}
                        />
                        Tachado
                        {renderOriginBadge('font', 'strike')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.double_strike)}
                            onChange={e => handleChange('double_strike', e.target.checked)}
                        />
                        Doble tachado
                        {renderOriginBadge('font', 'double_strike')}
                    </label>
                </div>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.all_caps)}
                            onChange={e => handleChange('all_caps', e.target.checked)}
                        />
                        Mayúsculas
                        {renderOriginBadge('font', 'all_caps')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.small_caps)}
                            onChange={e => handleChange('small_caps', e.target.checked)}
                        />
                        Pequeñas mayúsculas
                        {renderOriginBadge('font', 'small_caps')}
                    </label>
                </div>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.superscript)}
                            onChange={e => handleChange('superscript', e.target.checked)}
                        />
                        Superíndice
                        {renderOriginBadge('font', 'superscript')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localFont.subscript)}
                            onChange={e => handleChange('subscript', e.target.checked)}
                        />
                        Subíndice
                        {renderOriginBadge('font', 'subscript')}
                    </label>
                </div>
            </div>

            <div className="edit-section">
                <h4>Párrafo</h4>

                <div className="edit-row">
                    <label>
                        <span>Antes:</span>
                        {renderOriginBadge('paragraph', 'space_before_pt')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.space_before_pt ?? ''}
                        onChange={e => handleChange('space_before_pt', e.target.value)}
                        min="0"
                        max="72"
                        step="1"
                    />
                    <span className="unit">pt</span>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Después:</span>
                        {renderOriginBadge('paragraph', 'space_after_pt')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.space_after_pt ?? ''}
                        onChange={e => handleChange('space_after_pt', e.target.value)}
                        min="0"
                        max="72"
                        step="1"
                    />
                    <span className="unit">pt</span>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Interlineado:</span>
                        {renderOriginBadge('paragraph', 'line_spacing')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.line_spacing ?? ''}
                        onChange={e => handleChange('line_spacing', e.target.value)}
                        min="0.8"
                        max="3"
                        step="0.05"
                        placeholder="ej: 1.15"
                    />
                </div>

                <div className="edit-row">
                    <label>
                        <span>Regla interlineado:</span>
                        {renderOriginBadge('paragraph', 'line_spacing_rule')}
                    </label>
                    <select
                        value={localParagraph.line_spacing_rule || ''}
                        onChange={e => handleChange('line_spacing_rule', e.target.value)}
                    >
                        {LINE_SPACING_RULES.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Alineación:</span>
                        {renderOriginBadge('paragraph', 'alignment')}
                    </label>
                    <select
                        value={localParagraph.alignment || ''}
                        onChange={e => handleChange('alignment', e.target.value)}
                    >
                        <option value="">— Heredado —</option>
                        <option value="LEFT">Izquierda</option>
                        <option value="CENTER">Centro</option>
                        <option value="RIGHT">Derecha</option>
                        <option value="JUSTIFY">Justificado</option>
                    </select>
                </div>
            </div>

            <div className="edit-section">
                <h4>Sangría</h4>

                <div className="edit-row">
                    <label>
                        <span>Primera línea:</span>
                        {renderOriginBadge('paragraph', 'first_line_indent_inches')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.first_line_indent_inches ?? ''}
                        onChange={e => handleChange('first_line_indent_inches', e.target.value)}
                        min="-1"
                        max="2"
                        step="0.05"
                        placeholder="in"
                    />
                    <span className="unit">in</span>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Izquierda:</span>
                        {renderOriginBadge('paragraph', 'left_indent_inches')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.left_indent_inches ?? ''}
                        onChange={e => handleChange('left_indent_inches', e.target.value)}
                        min="-1"
                        max="3"
                        step="0.05"
                        placeholder="in"
                    />
                    <span className="unit">in</span>
                </div>

                <div className="edit-row">
                    <label>
                        <span>Derecha:</span>
                        {renderOriginBadge('paragraph', 'right_indent_inches')}
                    </label>
                    <input
                        type="number"
                        value={localParagraph.right_indent_inches ?? ''}
                        onChange={e => handleChange('right_indent_inches', e.target.value)}
                        min="-1"
                        max="3"
                        step="0.05"
                        placeholder="in"
                    />
                    <span className="unit">in</span>
                </div>
            </div>

            <div className="edit-section">
                <h4>Párrafo avanzado</h4>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localParagraph.keep_with_next)}
                            onChange={e => handleChange('keep_with_next', e.target.checked)}
                        />
                        Mantener con siguiente
                        {renderOriginBadge('paragraph', 'keep_with_next')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localParagraph.keep_together)}
                            onChange={e => handleChange('keep_together', e.target.checked)}
                        />
                        Mantener líneas juntas
                        {renderOriginBadge('paragraph', 'keep_together')}
                    </label>
                </div>

                <div className="edit-row toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localParagraph.page_break_before)}
                            onChange={e => handleChange('page_break_before', e.target.checked)}
                        />
                        Salto de página antes
                        {renderOriginBadge('paragraph', 'page_break_before')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={Boolean(localParagraph.widow_control)}
                            onChange={e => handleChange('widow_control', e.target.checked)}
                        />
                        Control de viudas
                        {renderOriginBadge('paragraph', 'widow_control')}
                    </label>
                </div>

                {!isGlobalSelection && (
                    <div className="edit-row">
                        <label>
                            <span>Nivel de esquema:</span>
                            {renderOriginBadge('paragraph', 'outline_level')}
                        </label>
                        <select
                            value={localParagraph.outline_level ?? ''}
                            onChange={e => handleChange('outline_level', e.target.value)}
                        >
                            <option value="">— Normal —</option>
                            {Array.from({ length: 9 }, (_, idx) => (
                                <option key={idx} value={idx}>{`Nivel ${idx + 1}`}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Table Style Panel - only shown for table-type styles */}
            {isTableStyle && (
                <div className="edit-section table-style-section">
                    <h4>Estilo de Tabla</h4>
                    <p className="section-hint">Propiedades aplicadas a tablas con este estilo</p>

                    <div className="edit-subsection">
                        <h5>Bordes</h5>
                        <div className="edit-row">
                            <label><span>Estilo:</span></label>
                            <select
                        value={localTable.border_style || ''}
                                onChange={e => handleTableChange('border_style', e.target.value)}
                            >
                                <option value="none">Sin borde</option>
                                <option value="single">Línea simple</option>
                                <option value="double">Línea doble</option>
                                <option value="dashed">Discontinuo</option>
                                <option value="dotted">Punteado</option>
                                <option value="thick">Grueso</option>
                                <option value="wave">Ola</option>
                                <option value="dashSmallGap">Guiones cortos</option>
                            </select>
                        </div>
                        <div className="edit-row">
                            <label><span>Grosor:</span></label>
                            <select
                        value={localTable.border_size_pt ?? ''}
                                onChange={e => handleTableChange('border_size_pt', parseFloat(e.target.value))}
                            >
                                <option value="0.25">0.25 pt</option>
                                <option value="0.5">0.5 pt</option>
                                <option value="0.75">0.75 pt</option>
                                <option value="1">1 pt</option>
                                <option value="1.5">1.5 pt</option>
                                <option value="2">2 pt</option>
                                <option value="3">3 pt</option>
                                <option value="4.5">4.5 pt</option>
                                <option value="6">6 pt</option>
                            </select>
                        </div>
                        <div className="edit-row">
                            <label><span>Color borde:</span></label>
                            <input
                                type="color"
                                value={localTable.border_color ? `#${localTable.border_color}` : '#000000'}
                                onChange={e => handleTableChange('border_color', e.target.value.replace('#', ''))}
                            />
                            {localTable.border_color && (
                                <span className="color-value">#{localTable.border_color}</span>
                            )}
                        </div>
                    </div>

                    <div className="edit-subsection">
                        <h5>Sombreado</h5>
                        <div className="edit-row">
                            <label><span>Color fondo:</span></label>
                            <input
                                type="color"
                                value={localTable.shading_color ? `#${localTable.shading_color}` : '#FFFFFF'}
                                onChange={e => handleTableChange('shading_color', e.target.value.replace('#', ''))}
                            />
                            {localTable.shading_color && (
                                <span className="color-value">#{localTable.shading_color}</span>
                            )}
                            <button
                                type="button"
                                className="clear-btn"
                                onClick={() => handleTableChange('shading_color', '')}
                                title="Sin color de fondo"
                            >
                                <IconX />
                            </button>
                        </div>
                    </div>

                    <div className="edit-subsection">
                        <h5>Diseño de tabla</h5>
                        <div className="edit-row">
                            <label><span>Alineación:</span></label>
                            <select
                        value={localTable.alignment || ''}
                                onChange={e => handleTableChange('alignment', e.target.value)}
                            >
                                <option value="left">Izquierda</option>
                                <option value="center">Centro</option>
                                <option value="right">Derecha</option>
                            </select>
                        </div>
                        <div className="edit-row">
                            <label><span>Layout:</span></label>
                            <select
                        value={localTable.layout_type || ''}
                                onChange={e => handleTableChange('layout_type', e.target.value)}
                            >
                                <option value="autofit">Autoajuste</option>
                                <option value="fixed">Fijo</option>
                            </select>
                        </div>
                        <div className="edit-row">
                            <label><span>Espaciado celdas:</span></label>
                            <input
                                type="number"
                        value={localTable.cell_spacing_pt ?? ''}
                                onChange={e => handleTableChange('cell_spacing_pt', parseFloat(e.target.value) || 0)}
                                min="0"
                                max="50"
                                step="0.5"
                            />
                            <span className="unit">pt</span>
                        </div>
                    </div>

                    <div className="edit-subsection">
                        <h5>Márgenes de celda</h5>
                        <div className="edit-row margins-row">
                            <label><span>Superior:</span></label>
                            <input
                                type="number"
                        value={localTable.cell_margin_top_pt ?? ''}
                                onChange={e => handleTableChange('cell_margin_top_pt', parseFloat(e.target.value) || 0)}
                                min="0"
                                max="50"
                                step="0.1"
                            />
                            <span className="unit">pt</span>
                        </div>
                        <div className="edit-row margins-row">
                            <label><span>Inferior:</span></label>
                            <input
                                type="number"
                        value={localTable.cell_margin_bottom_pt ?? ''}
                                onChange={e => handleTableChange('cell_margin_bottom_pt', parseFloat(e.target.value) || 0)}
                                min="0"
                                max="50"
                                step="0.1"
                            />
                            <span className="unit">pt</span>
                        </div>
                        <div className="edit-row margins-row">
                            <label><span>Izquierdo:</span></label>
                            <input
                                type="number"
                        value={localTable.cell_margin_left_pt ?? ''}
                                onChange={e => handleTableChange('cell_margin_left_pt', parseFloat(e.target.value) || 0)}
                                min="0"
                                max="50"
                                step="0.1"
                            />
                            <span className="unit">pt</span>
                        </div>
                        <div className="edit-row margins-row">
                            <label><span>Derecho:</span></label>
                            <input
                                type="number"
                        value={localTable.cell_margin_right_pt ?? ''}
                                onChange={e => handleTableChange('cell_margin_right_pt', parseFloat(e.target.value) || 0)}
                                min="0"
                                max="50"
                                step="0.1"
                            />
                            <span className="unit">pt</span>
                        </div>
                    </div>

                    <div className="edit-subsection">
                        <h5>Opciones de estilo (tblLook)</h5>
                        <div className="edit-row toggles table-look-toggles">
                            <label>
                                <input
                                    type="checkbox"
                            checked={Boolean(localTable.look_first_row)}
                                    onChange={e => handleTableChange('look_first_row', e.target.checked)}
                                />
                                Fila de encabezado
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                            checked={Boolean(localTable.look_last_row)}
                                    onChange={e => handleTableChange('look_last_row', e.target.checked)}
                                />
                                Fila de totales
                            </label>
                        </div>
                        <div className="edit-row toggles table-look-toggles">
                            <label>
                                <input
                                    type="checkbox"
                            checked={Boolean(localTable.look_first_column)}
                                    onChange={e => handleTableChange('look_first_column', e.target.checked)}
                                />
                                Primera columna
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                            checked={Boolean(localTable.look_last_column)}
                                    onChange={e => handleTableChange('look_last_column', e.target.checked)}
                                />
                                Última columna
                            </label>
                        </div>
                        <div className="edit-row toggles table-look-toggles">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={!localTable.look_no_h_band}
                                    onChange={e => handleTableChange('look_no_h_band', !e.target.checked)}
                                />
                                Bandas horizontales
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={!localTable.look_no_v_band}
                                    onChange={e => handleTableChange('look_no_v_band', !e.target.checked)}
                                />
                                Bandas verticales
                            </label>
                        </div>
                    </div>

                    {/* Table Style Variants - readonly for now but shown */}
                    {Object.keys(tableVariants || {}).length > 0 && (
                        <div className="edit-subsection">
                            <h5>Variantes de estilo</h5>
                            <div className="table-variants-grid">
                                {Object.entries(tableVariants).map(([varType, varData]) => (
                                    <details key={varType} className="variant-block">
                                        <summary>{formatVariantName(varType)}</summary>
                                        <pre>{formatJson(varData)}</pre>
                                    </details>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <details className="template-inspection-panel edit-section">
                <summary>Inspección: valores efectivos</summary>
                <div className="inspection-body">
                <div className="advanced-subblock">
                    <div className="advanced-subtitle">Fuente</div>
                    {resolvedFontJson ? (
                        <pre>{resolvedFontJson}</pre>
                    ) : (
                        <div className="advanced-empty">Sin datos efectivos de fuente.</div>
                    )}
                </div>
                <div className="advanced-subblock">
                    <div className="advanced-subtitle">Párrafo</div>
                    {resolvedParagraphJson ? (
                        <pre>{resolvedParagraphJson}</pre>
                    ) : (
                        <div className="advanced-empty">Sin datos efectivos de párrafo.</div>
                    )}
                </div>
                {listInfo && (
                    <div className="advanced-subblock">
                        <div className="advanced-subtitle">Numeración</div>
                        <pre>{formatJson(listInfo)}</pre>
                    </div>
                )}
                </div>
            </details>

            {showInlinePreview && !isGlobalSelection && (
                <div className="edit-section preview-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h4>
                            Vista Previa (Word)
                            {isPreviewLoading && <span className="preview-status-pill">Renderizando...</span>}
                        </h4>
                        <div className="preview-header-actions">
                            <button
                                className="reload-button"
                                onClick={handleManualPreview}
                                disabled={isPreviewLoading}
                                title="Actualizar vista previa"
                            >
                                {isPreviewLoading ? <LoadingSpinner size="small" /> : <IconRefresh />}
                                <span>Renderizar</span>
                            </button>
                        </div>
                    </div>

                    <div className="live-preview-container">
                        {isPreviewLoading && (
                            <div className="loading-overlay">
                                <div className="loading-overlay-content">
                                    <div className="spinner"></div>
                                    <div className="loading-overlay-text">
                                        {previewImage ? 'Actualizando preview...' : 'Generando preview real de Word...'}
                                    </div>
                                </div>
                            </div>
                        )}

                        {previewImage ? (
                            <img
                                src={`data:image/png;base64,${previewImage}`}
                                alt="Vista previa de Word"
                                className="word-preview-image"
                            />
                        ) : (
                            <div
                                className="live-preview css-fallback"
                                style={{
                                    fontFamily: readFontName(effectiveFont) || 'inherit',
                                    fontSize: effectiveFont.font_size_pt ? `${(effectiveFont.superscript || effectiveFont.subscript) ? Number(effectiveFont.font_size_pt) * 0.7 : effectiveFont.font_size_pt}px` : '12px',
                                    fontWeight: effectiveFont.bold ? 'bold' : 'normal',
                                    fontStyle: effectiveFont.italic ? 'italic' : 'normal',
                                    textDecoration: [effectiveFont.underline ? 'underline' : '', effectiveFont.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
                                    textTransform: effectiveFont.all_caps ? 'uppercase' : 'none',
                                    fontVariant: effectiveFont.small_caps ? 'small-caps' : 'normal',
                                    verticalAlign: effectiveFont.superscript ? 'super' : (effectiveFont.subscript ? 'sub' : 'baseline'),
                                    color: effectiveFont.color_rgb ? `#${effectiveFont.color_rgb}` : '#fff',
                                    backgroundColor: effectiveFont.highlight_color ? getHighlightCssColor(effectiveFont.highlight_color) : 'transparent',
                                }}
                            >
                                {previewText}
                            </div>
                        )}
                    </div>
                    <div
                        className={`preview-status-line ${isPreviewLoading ? 'busy' : ''}`}
                        aria-live="polite"
                    >
                        {previewStatusLabel}
                    </div>
                </div>
            )}

            {templateDetails && (
                <details className="template-inspection-panel edit-section advanced-details">
                    <summary>Inspección OOXML</summary>
                    <div className="inspection-body">
                    {isGlobalSelection ? (
                        <>
                            <h4>Detalles globales</h4>
                            <div className="advanced-note">
                                Este panel refleja el estado real de <code>docDefaults</code>, theme, numbering y secciones del template.
                            </div>

                            <details className="advanced-block" open>
                                <summary>Doc Defaults</summary>
                                <div className="advanced-description">
                                    Valores por defecto aplicados cuando un estilo no define una propiedad.
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Texto (rPr)</div>
                                    <div className="advanced-subdesc">Fuente, tamaño, color, negrita, etc.</div>
                                    {docDefaultsRunJson ? (
                                        <pre>{docDefaultsRunJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">Sin rPr por defecto.</div>
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Párrafo (pPr)</div>
                                    <div className="advanced-subdesc">Alineación, sangrías y espaciado global.</div>
                                    {docDefaultsParagraphJson ? (
                                        <pre>{docDefaultsParagraphJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">Sin pPr por defecto.</div>
                                    )}
                                </div>
                                {docDefaultsXml && (
                                    <details className="advanced-xml">
                                        <summary>XML docDefaults</summary>
                                        <pre>{docDefaultsXml}</pre>
                                    </details>
                                )}
                            </details>

                            <details className="advanced-block">
                                <summary>Numeración y listas</summary>
                                <div className="advanced-description">
                                    Definiciones globales de listas, viñetas y niveles.
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Abstract Numbers</div>
                                    <div className="advanced-subdesc">Plantillas base de listas.</div>
                                    {numberingAbstractJson ? (
                                        <pre>{numberingAbstractJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">No hay abstractNums definidos.</div>
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Nums</div>
                                    <div className="advanced-subdesc">Instancias de listas y overrides.</div>
                                    {numberingNumsJson ? (
                                        <pre>{numberingNumsJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">No hay nums definidos.</div>
                                    )}
                                </div>
                                {numberingXml && (
                                    <details className="advanced-xml">
                                        <summary>XML numbering</summary>
                                        <pre>{numberingXml}</pre>
                                    </details>
                                )}
                            </details>

                            <details className="advanced-block">
                                <summary>Theme (fuentes y colores)</summary>
                                <div className="advanced-description">
                                    Esquema global de fuentes y colores de Word para la plantilla.
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Fuentes</div>
                                    <div className="advanced-subdesc">Fuentes mayor/menor y scripts.</div>
                                    {themeFontJson ? (
                                        <pre>{themeFontJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">No hay esquema de fuentes.</div>
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Colores</div>
                                    <div className="advanced-subdesc">Paleta de colores del theme.</div>
                                    {themeColorJson ? (
                                        <pre>{themeColorJson}</pre>
                                    ) : (
                                        <div className="advanced-empty">No hay esquema de colores.</div>
                                    )}
                                </div>
                                {themeXml && (
                                    <details className="advanced-xml">
                                        <summary>XML theme</summary>
                                        <pre>{themeXml}</pre>
                                    </details>
                                )}
                            </details>

                            <details className="advanced-block">
                                <summary>Secciones del documento</summary>
                                <div className="advanced-description">
                                    Tamaño de página, márgenes y orientación por sección.
                                </div>
                                {sectionsJson ? (
                                    <>
                                        <pre>{sectionsJson}</pre>
                                        <details className="advanced-xml">
                                            <summary>XML de secciones</summary>
                                            <pre>{sectionsXml}</pre>
                                        </details>
                                    </>
                                ) : (
                                    <div className="advanced-empty">No se encontraron secciones.</div>
                                )}
                            </details>

                            <details className="advanced-block">
                                <summary>Mapa de títulos (outline)</summary>
                                <div className="advanced-description">
                                    Relación de estilos con niveles de índice (outlineLvl).
                                </div>
                                {headingStylesJson ? (
                                    <pre>{headingStylesJson}</pre>
                                ) : (
                                    <div className="advanced-empty">No hay estilos con outline level.</div>
                                )}
                            </details>

                            <details className="advanced-block">
                                <summary>Resumen XML</summary>
                                <div className="advanced-description">
                                    Conteos rápidos de estilos, secciones y numeración.
                                </div>
                                <pre>{metaJson}</pre>
                            </details>
                        </>
                    ) : (
                        <>
                            <div className="advanced-header">
                                <h4>Detalles avanzados</h4>
                                <button
                                    className="advanced-toggle"
                                    onClick={toggleAdvancedEditMode}
                                    type="button"
                                >
                                    {advancedEditMode ? 'Cancelar edición' : 'Editar JSON'}
                                </button>
                            </div>
                            {advancedEditMode && (
                                <div className="advanced-edit-hint">
                                    Campo vacío se ignora. Usa <code>[]</code> para limpiar propiedades.
                                </div>
                            )}
                            {!advancedEditMode && (
                                <div className="advanced-edit-hint">
                                    Modo lectura. Activa <strong>Editar JSON</strong> para modificar.
                                </div>
                            )}
                            <div className="advanced-note">
                                Este panel muestra OOXML crudo del DOCX. Para cambios comunes usa los controles
                                de arriba, que aplican los valores al estilo actual.
                            </div>

                            <details className="advanced-block" open>
                                <summary>Estilo seleccionado</summary>
                                <div className="advanced-description">
                                    Definición XML del estilo seleccionado separada por secciones.
                                </div>
                                {advancedDetails ? (
                                    <>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Metadatos</div>
                                    <div className="advanced-subdesc">Nombre, tipo, base, visibilidad, outline.</div>
                                    <pre>{styleMetaJson}</pre>
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Texto (rPr)</div>
                                    <div className="advanced-subdesc">Fuente, tamaño, color, negrita, etc.</div>
                                    {advancedEditMode ? (
                                        <textarea
                                            className="advanced-textarea"
                                            value={advancedJson.r_pr}
                                            onChange={e => handleAdvancedChange('r_pr', e.target.value)}
                                            placeholder="[]"
                                        />
                                    ) : (
                                        styleRunJson ? (
                                            <pre>{styleRunJson}</pre>
                                        ) : (
                                            <div className="advanced-empty">Sin rPr explícito.</div>
                                        )
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Párrafo (pPr)</div>
                                    <div className="advanced-subdesc">Alineación, sangría y espaciado.</div>
                                    {advancedEditMode ? (
                                        <textarea
                                            className="advanced-textarea"
                                            value={advancedJson.p_pr}
                                            onChange={e => handleAdvancedChange('p_pr', e.target.value)}
                                            placeholder="[]"
                                        />
                                    ) : (
                                        styleParagraphJson ? (
                                            <pre>{styleParagraphJson}</pre>
                                        ) : (
                                            <div className="advanced-empty">Sin pPr explícito.</div>
                                        )
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Tabla (tblPr)</div>
                                    <div className="advanced-subdesc">Bordes, sombreado y layout de tabla.</div>
                                    {advancedEditMode ? (
                                        <textarea
                                            className="advanced-textarea"
                                            value={advancedJson.tbl_pr}
                                            onChange={e => handleAdvancedChange('tbl_pr', e.target.value)}
                                            placeholder="[]"
                                        />
                                    ) : (
                                        styleTableJson ? (
                                            <pre>{styleTableJson}</pre>
                                        ) : (
                                            <div className="advanced-empty">No aplica para este estilo.</div>
                                        )
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Celda (tcPr)</div>
                                    <div className="advanced-subdesc">Propiedades de celda en estilos de tabla.</div>
                                    {advancedEditMode ? (
                                        <textarea
                                            className="advanced-textarea"
                                            value={advancedJson.tc_pr}
                                            onChange={e => handleAdvancedChange('tc_pr', e.target.value)}
                                            placeholder="[]"
                                        />
                                    ) : (
                                        styleCellJson ? (
                                            <pre>{styleCellJson}</pre>
                                        ) : (
                                            <div className="advanced-empty">No aplica para este estilo.</div>
                                        )
                                    )}
                                </div>
                                <div className="advanced-subblock">
                                    <div className="advanced-subtitle">Variantes de tabla</div>
                                    <div className="advanced-subdesc">Definiciones por bandas/encabezados.</div>
                                    {advancedEditMode ? (
                                        <textarea
                                            className="advanced-textarea"
                                            value={advancedJson.tbl_style_pr}
                                            onChange={e => handleAdvancedChange('tbl_style_pr', e.target.value)}
                                            placeholder="[]"
                                        />
                                    ) : (
                                        styleTableVariantsJson ? (
                                            <pre>{styleTableVariantsJson}</pre>
                                        ) : (
                                            <div className="advanced-empty">No hay variantes definidas.</div>
                                        )
                                    )}
                                </div>
                                {advancedStyleXml && (
                                    <details className="advanced-xml">
                                        <summary>XML del estilo</summary>
                                        <pre>{advancedStyleXml}</pre>
                                    </details>
                                )}
                            </>
                        ) : (
                            <div className="advanced-empty">Selecciona un estilo para ver sus detalles.</div>
                        )}
                    </details>
                        </>
                    )}
                    </div>
                </details>
            )}
        </div>
    );
};

export default StyleEditPanel;

