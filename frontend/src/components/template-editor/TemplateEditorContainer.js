/* eslint-disable no-unused-vars */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import '../TemplateEditor.css';
import DropdownMenu from '../DropdownMenu';
import {
    IconDocument,
    IconDownload,
    IconEye,
    IconFolderOpen,
    IconKebab,
    IconQuality,
    IconRefresh,
    IconSettings,
    IconSource,
    IconTable,
    IconTemplate,
    IconTrash,
    IconUpload,
    IconX,
} from '../Icons';
import StyleEditPanel from './StyleEditPanel';
import TableDirectFormatPanel from './TableDirectFormatPanel';
import useStylePreviewPipeline from './hooks/useStylePreviewPipeline';
import useTablePreviewQueue from './hooks/useTablePreviewQueue';
import { WS_MESSAGE_TYPES as WS_MSG } from '../../contracts/wsMessageTypes.generated';
import { API_BASE } from '../../config/endpoints';
import { createFrontendLogger } from '../../utils/frontendLogger';
import {
    getEffectiveStyleFont,
    getEffectiveStyleParagraph,
    readFontName,
    readFontSize,
} from './fontUtils';

const logger = createFrontendLogger('TemplateEditor');

// === CONFIGURATION CONSTANTS ===
const MAX_TEMPLATE_SIZE_MB = 20;  // REST upload supports larger templates
const LEGACY_TEMPLATE_FALLBACK_MAX_MB = 6.5;  // WS fallback remains constrained by base64/JSON overhead
const PREVIEW_DEBOUNCE_MS = 1000;  // Debounce delay for auto-preview (FIX #12: increased from 350ms)
const PREVIEW_TIMEOUT_MS = 45000;  // Timeout for style preview generation
const TABLE_PREVIEW_TIMEOUT_MS = 60000; // Timeout per table preview request on large templates
const PREVIEW_CACHE_MAX = 48;  // Maximum number of cached preview images
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEMPLATE_EXPORT_COMPAT_VERSIONS = new Set(['1.0', '1.1']);
const STYLE_BROWSER_ORDER = ['titles', 'headings', 'body', 'lists', 'tables', 'code', 'captions', 'other'];

const extractUploadErrorMessage = async (response, fallbackLabel = 'Error al subir plantilla') => {
    try {
        const contentType = response.headers?.get?.('content-type') || '';
        if (contentType.includes('application/json')) {
            const payload = await response.json();
            if (typeof payload === 'string' && payload.trim()) return payload.trim();
            if (payload?.detail) return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
            if (payload?.message) return payload.message;
        } else {
            const text = await response.text();
            if (text?.trim()) return text.trim();
        }
    } catch (error) {
        // Ignore parsing failures and fall back to the generic HTTP message.
    }

    return `${fallbackLabel} (HTTP ${response.status})`;
};

// Category labels in Spanish
const CATEGORY_LABELS = {
    titles: { icon: <IconDocument />, label: 'Títulos' },
    headings: { icon: <IconTemplate />, label: 'Encabezados' },
    body: { icon: <IconDocument />, label: 'Cuerpo' },
    lists: { icon: <IconSource />, label: 'Listas' },
    tables: { icon: <IconTable />, label: 'Tablas' },
    code: { icon: <IconSource />, label: 'Código' },
};

CATEGORY_LABELS.captions = { icon: <IconQuality />, label: 'Captions' };
CATEGORY_LABELS.other = { icon: <IconSettings />, label: 'Otros' };

const SEMANTIC_SLOT_DEFS = [
    { name: 'body', label: 'Cuerpo', category: 'body', styleType: 'paragraph' },
    { name: 'heading_1', label: 'Encabezado 1', category: 'headings', styleType: 'paragraph' },
    { name: 'heading_2', label: 'Encabezado 2', category: 'headings', styleType: 'paragraph' },
    { name: 'heading_3', label: 'Encabezado 3', category: 'headings', styleType: 'paragraph' },
    { name: 'heading_4', label: 'Encabezado 4', category: 'headings', styleType: 'paragraph' },
    { name: 'heading_5', label: 'Encabezado 5', category: 'headings', styleType: 'paragraph' },
    { name: 'heading_6', label: 'Encabezado 6', category: 'headings', styleType: 'paragraph' },
    { name: 'list_bullet', label: 'Lista con viñetas', category: 'lists', styleType: 'paragraph' },
    { name: 'list_number', label: 'Lista numerada', category: 'lists', styleType: 'paragraph' },
    { name: 'caption', label: 'Caption', category: 'captions', styleType: 'paragraph' },
    { name: 'code', label: 'Código', category: 'code', styleType: 'paragraph' },
    { name: 'table_default', label: 'Tabla por defecto', category: 'tables', styleType: 'table' },
];

const SEMANTIC_SLOT_BY_NAME = Object.fromEntries(
    SEMANTIC_SLOT_DEFS.map((slot) => [slot.name, slot])
);

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
    table_border_style: props.table_border_style || null,
    table_border_size_pt: toNumberOrNull(props.table_border_size_pt),
    table_border_color: normalizeColor(props.table_border_color),
    table_shading_color: normalizeColor(props.table_shading_color),
    table_alignment: props.table_alignment || null,
    table_layout_type: props.table_layout_type || null,
    table_cell_spacing_pt: toNumberOrNull(props.table_cell_spacing_pt),
    table_width_type: props.table_width_type || null,
    table_width_value: toNumberOrNull(props.table_width_value),
    table_look_first_row: toBoolOrNull(props.table_look_first_row),
    table_look_last_row: toBoolOrNull(props.table_look_last_row),
    table_look_first_column: toBoolOrNull(props.table_look_first_column),
    table_look_last_column: toBoolOrNull(props.table_look_last_column),
    table_look_no_h_band: toBoolOrNull(props.table_look_no_h_band),
    table_look_no_v_band: toBoolOrNull(props.table_look_no_v_band),
    table_cell_margin_top_pt: toNumberOrNull(props.table_cell_margin_top_pt),
    table_cell_margin_bottom_pt: toNumberOrNull(props.table_cell_margin_bottom_pt),
    table_cell_margin_left_pt: toNumberOrNull(props.table_cell_margin_left_pt),
    table_cell_margin_right_pt: toNumberOrNull(props.table_cell_margin_right_pt),
    table_cell_shading_color: normalizeColor(props.table_cell_shading_color),
    table_cell_vertical_align: props.table_cell_vertical_align || null,
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

const buildTemplateResetFingerprint = (templateInfo) => {
    if (!templateInfo) return '';
    try {
        return JSON.stringify({
            template_hash: templateInfo.template_hash || templateInfo.hash || null,
            template_token: templateInfo.template_token || templateInfo.templateToken || null,
            source_path: templateInfo.source_path || templateInfo.sourcePath || null,
            file_name: templateInfo.file_name || templateInfo.filename || templateInfo.name || null,
            updated_at: templateInfo.updated_at || templateInfo.template_updated_at || null,
            style_count: templateInfo.style_count || null,
            semantic_style_slots: templateInfo.semantic_style_slots || null,
            document_defaults: templateInfo.document_defaults || null,
            style_browser: templateInfo.style_browser || null,
            style_coverage: templateInfo.style_coverage || null,
            document_tables: templateInfo.document_tables || null,
        });
    } catch (err) {
        return [
            templateInfo.template_hash || templateInfo.hash || '',
            templateInfo.template_token || templateInfo.templateToken || '',
            templateInfo.source_path || templateInfo.sourcePath || '',
            templateInfo.file_name || templateInfo.filename || templateInfo.name || '',
            templateInfo.updated_at || templateInfo.template_updated_at || '',
        ].join('|');
    }
};

const buildTemplateMessageFingerprint = (message) => {
    if (!message || typeof message !== 'object') return '';
    try {
        return JSON.stringify({
            type: message.type || null,
            request_id: message.request_id || null,
            preview_key: message.preview_key || null,
            style_name: message.style_name || null,
            target_style_name: message.target_style_name || null,
            table_index: Number.isInteger(message.table_index) ? message.table_index : null,
            error: message.error || null,
            message: message.message || null,
            template: message.template ? buildTemplateResetFingerprint(message.template) : null,
        });
    } catch (err) {
        return [
            message.type || '',
            message.request_id || '',
            message.preview_key || '',
            message.style_name || '',
            message.target_style_name || '',
            message.error || '',
            message.message || '',
        ].join('|');
    }
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

const buildStyleBaseKey = (category, styleInfo = {}) => {
    const styleId = styleInfo?.style?.style_id || styleInfo?.style_id || '';
    const displayName = styleInfo?.display_name || styleInfo?.style?.display_name || styleInfo?.style?.name || styleInfo?.name || '';
    return `${category || ''}|${styleId}|${displayName}`;
};

const getStyleSelectionKey = (styleInfo = {}) => {
    return styleInfo?.selection_key || buildStyleBaseKey(styleInfo?.category, styleInfo);
};

const getSemanticSlotOptions = (slotName, styleBrowser) => {
    const slotDef = SEMANTIC_SLOT_BY_NAME[slotName];
    if (!slotDef) return [];
    return styleBrowser?.categories?.[slotDef.category] || [];
};

const getSemanticOptionStyle = (styleInfo = {}) => styleInfo?.style || {};

const getSemanticOptionStyleId = (styleInfo = {}) => (
    styleInfo?.style?.style_id || styleInfo?.style_id || ''
);

const getSemanticOptionName = (styleInfo = {}) => (
    styleInfo?.style?.name
    || styleInfo?.display_name
    || styleInfo?.name
    || ''
);

const getSemanticOptionDisplayName = (styleInfo = {}) => (
    styleInfo?.display_name
    || styleInfo?.style?.display_name
    || getSemanticOptionName(styleInfo)
);

const getSemanticSlotPayload = (slotName, styleInfo = null) => {
    const slotDef = SEMANTIC_SLOT_BY_NAME[slotName];
    if (!slotDef) return null;
    return {
        slot_name: slotName,
        category: slotDef.category,
        selection_key: styleInfo ? getStyleSelectionKey(styleInfo) : null,
        style_id: styleInfo ? (styleInfo?.style?.style_id || styleInfo?.style_id || null) : null,
        style_name: styleInfo ? (styleInfo?.style?.name || styleInfo?.name || styleInfo?.display_name || null) : null,
        display_name: styleInfo ? (styleInfo?.display_name || styleInfo?.style?.display_name || styleInfo?.style?.name || styleInfo?.name || null) : null,
        style_type: styleInfo ? (styleInfo?.style?.type || styleInfo?.style_type || slotDef.styleType) : slotDef.styleType,
    };
};

const getDefaultSemanticSlotEntry = (slotName, options = []) => {
    if (!Array.isArray(options) || !options.length) return null;

    const pickBest = (scorer) => options.reduce((best, option) => {
        if (!best) return option;
        return scorer(option) > scorer(best) ? option : best;
    }, null);

    const scoreBody = (option) => {
        const style = getSemanticOptionStyle(option);
        const styleId = String(getSemanticOptionStyleId(option) || '').toLowerCase();
        const displayName = String(getSemanticOptionDisplayName(option) || '').toLowerCase();
        const outlineLevel = style?.resolved_paragraph_format?.outline_level ?? style?.xml_paragraph_format?.outline_level ?? null;
        const listFormat = String(style?.list_info?.list_format || '').toLowerCase();
        const baseScore = Number(option?.score || 0);
        if (styleId === 'bodytext' || displayName === 'body text') return 500 + baseScore;
        if (styleId === 'normal' || displayName === 'normal') return 400 + baseScore;
        if (outlineLevel !== null || listFormat) return 100 + baseScore;
        return 300 + baseScore;
    };

    const scoreHeading = (option, level) => {
        const style = getSemanticOptionStyle(option);
        const styleId = String(getSemanticOptionStyleId(option) || '').toLowerCase();
        const displayName = String(getSemanticOptionDisplayName(option) || '').toLowerCase();
        const outlineLevel = Number(style?.resolved_paragraph_format?.outline_level ?? style?.xml_paragraph_format?.outline_level);
        const baseScore = Number(option?.score || 0);
        if (styleId === `heading${level}` || displayName === `heading ${level}`) return 500 + baseScore;
        if (Number.isFinite(outlineLevel)) return 400 - (Math.abs((outlineLevel + 1) - level) * 25) + baseScore;
        return 200 + baseScore;
    };

    const scoreList = (option, ordered) => {
        const style = getSemanticOptionStyle(option);
        const styleId = String(getSemanticOptionStyleId(option) || '').toLowerCase();
        const displayName = String(getSemanticOptionDisplayName(option) || '').toLowerCase();
        const listFormat = String(style?.list_info?.list_format || '').toLowerCase();
        const baseScore = Number(option?.score || 0);
        if (ordered) {
            if (styleId.includes('number') || displayName.includes('number')) return 500 + baseScore;
            if (['decimal', 'lowerletter', 'upperletter', 'lowerroman', 'upperroman'].includes(listFormat)) return 450 + baseScore;
        } else {
            if (styleId.includes('bullet') || displayName.includes('bullet')) return 500 + baseScore;
            if (listFormat === 'bullet') return 450 + baseScore;
        }
        return 200 + baseScore;
    };

    const scoreExact = (option, styleIdValue, displayNameValue) => {
        const styleId = String(getSemanticOptionStyleId(option) || '').toLowerCase();
        const displayName = String(getSemanticOptionDisplayName(option) || '').toLowerCase();
        const baseScore = Number(option?.score || 0);
        if (styleId === styleIdValue || displayName === displayNameValue) return 500 + baseScore;
        return 300 + baseScore;
    };

    if (slotName === 'body') return pickBest(scoreBody);
    if (slotName.startsWith('heading_')) {
        const level = Number(slotName.split('_')[1] || 1);
        return pickBest((option) => scoreHeading(option, level));
    }
    if (slotName === 'list_bullet') return pickBest((option) => scoreList(option, false));
    if (slotName === 'list_number') return pickBest((option) => scoreList(option, true));
    if (slotName === 'caption') return pickBest((option) => scoreExact(option, 'caption', 'caption'));
    if (slotName === 'code') return pickBest((option) => scoreExact(option, 'code', 'code'));
    if (slotName === 'table_default') return pickBest((option) => scoreExact(option, 'tablegrid', 'table grid'));
    return options[0];
};

const buildFallbackStyleBrowser = (templateInfo = null) => {
    const categories = {};
    STYLE_BROWSER_ORDER.forEach((category) => {
        const sourceItems = templateInfo?.style_coverage?.categories?.[category] || [];
        categories[category] = sourceItems
            .filter((styleInfo) => Boolean(styleInfo?.style))
            .map((styleInfo, index) => {
                const baseKey = buildStyleBaseKey(category, styleInfo);
                return {
                    ...styleInfo,
                    category: styleInfo.category || category,
                    style_type: styleInfo.style_type || styleInfo?.style?.type || (category === 'tables' ? 'table' : 'paragraph'),
                    selection_key: index === 0 ? baseKey : `${baseKey}#${index + 1}`,
                    score: 0,
                };
            });
    });

    const autoSelected = {};
    const counts = {};
    STYLE_BROWSER_ORDER.forEach((category) => {
        const items = categories[category] || [];
        counts[category] = items.length;
        if (items.length > 0) {
            autoSelected[category] = items[0].selection_key;
        }
    });

    return {
        categories,
        category_order: STYLE_BROWSER_ORDER,
        auto_selected: autoSelected,
        counts,
    };
};

const decodeBase64ToUint8Array = (value) => {
    const cleanValue = typeof value === 'string' ? value.trim() : '';
    if (!cleanValue) {
        throw new Error('El JSON no contiene un docx_base64 válido.');
    }
    const binary = window.atob(cleanValue);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const readFileAsText = async (file) => {
    if (!file) {
        throw new Error('No se recibió ningún archivo.');
    }

    if (typeof file.text === 'function') {
        return file.text();
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('No fue posible leer el archivo.'));
        reader.readAsText(file);
    });
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
            case 'jc': if (attrs.val) para.alignment = attrs.val.toUpperCase(); break;
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
    'table_border_size_pt',
    'table_cell_spacing_pt',
    'table_width_value',
    'table_cell_margin_top_pt',
    'table_cell_margin_bottom_pt',
    'table_cell_margin_left_pt',
    'table_cell_margin_right_pt',
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
        table_border_style: normalized.table_border_style || '',
        table_border_size_pt: normalized.table_border_size_pt,
        table_border_color: normalized.table_border_color || '',
        table_shading_color: normalized.table_shading_color || '',
        table_alignment: normalized.table_alignment || '',
        table_layout_type: normalized.table_layout_type || '',
        table_cell_spacing_pt: normalized.table_cell_spacing_pt,
        table_width_type: normalized.table_width_type || '',
        table_width_value: normalized.table_width_value,
        table_look_first_row: normalized.table_look_first_row,
        table_look_last_row: normalized.table_look_last_row,
        table_look_first_column: normalized.table_look_first_column,
        table_look_last_column: normalized.table_look_last_column,
        table_look_no_h_band: normalized.table_look_no_h_band,
        table_look_no_v_band: normalized.table_look_no_v_band,
        table_cell_margin_top_pt: normalized.table_cell_margin_top_pt,
        table_cell_margin_bottom_pt: normalized.table_cell_margin_bottom_pt,
        table_cell_margin_left_pt: normalized.table_cell_margin_left_pt,
        table_cell_margin_right_pt: normalized.table_cell_margin_right_pt,
        table_cell_shading_color: normalized.table_cell_shading_color || '',
        table_cell_vertical_align: normalized.table_cell_vertical_align || '',
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

const CategoryBrowserCard = ({
    categoryKey,
    options,
    selectedEntry,
    coverageItems = [],
    isActive,
    onActivate,
    onSelectStyle,
}) => {
    const label = CATEGORY_LABELS[categoryKey] || { icon: <IconSettings />, label: categoryKey };
    const font = getEffectiveStyleFont(selectedEntry?.style);
    const missingCount = (coverageItems || []).filter((item) => item?.status === 'missing').length;
    const inheritedCount = (coverageItems || []).filter((item) => item?.status === 'inherited').length;
    const healthLabel = missingCount > 0
        ? `${missingCount} requeridos faltantes`
        : inheritedCount > 0
            ? `${inheritedCount} requeridos heredados`
            : 'Cobertura requerida OK';

    return (
        <div
            className={`category-browser-card ${isActive ? 'active' : ''}`}
            onClick={() => selectedEntry && onActivate?.(selectedEntry)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && selectedEntry) {
                    event.preventDefault();
                    onActivate?.(selectedEntry);
                }
            }}
        >
            <div className="category-browser-header">
                <div className="category-browser-title">
                    <span className="category-browser-icon">{label.icon}</span>
                    <strong>{label.label}</strong>
                </div>
                <span className="category-browser-count">{options.length}</span>
            </div>
            <div className="category-browser-current">
                <div className="category-browser-current-name">
                    {selectedEntry?.display_name || selectedEntry?.name || 'Sin selección'}
                </div>
                {font && (
                    <div
                        className="style-preview category-browser-preview"
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
            </div>
            <div className="category-browser-health">{healthLabel}</div>
            <label className="category-browser-select-label" htmlFor={`style-category-select-${categoryKey}`}>
                Formato activo
            </label>
            <select
                id={`style-category-select-${categoryKey}`}
                className="category-browser-select"
                value={getStyleSelectionKey(selectedEntry)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onSelectStyle?.(categoryKey, event.target.value)}
                data-testid={`template-category-select-${categoryKey}`}
            >
                {options.map((option) => (
                    <option key={option.selection_key} value={option.selection_key}>
                        {option.display_name || option.name}
                    </option>
                ))}
            </select>
        </div>
    );
};

const SemanticSlotCard = ({
    slot,
    options,
    selectedEntry,
    onSelect,
    onActivate,
    isActive = false,
    isDisabled = false,
}) => {
    const font = getEffectiveStyleFont(selectedEntry?.style);
    const handleActivate = () => {
        if (isDisabled) return;
        onActivate?.(slot.name);
    };
    const handleKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleActivate();
    };

    return (
        <div
            className={`category-browser-card semantic-slot-card ${isActive ? 'active' : ''}`}
            role="button"
            tabIndex={isDisabled ? -1 : 0}
            aria-pressed={isActive}
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
            data-testid={`template-slot-card-${slot.name}`}
        >
            <div className="category-browser-header">
                <div className="category-browser-title">
                    <strong>{slot.label}</strong>
                </div>
                <span className="category-browser-count">{options.length}</span>
            </div>
            <div className="category-browser-current">
                <div className="category-browser-current-name">
                    {selectedEntry?.display_name || selectedEntry?.name || 'Sin selección'}
                </div>
                {font && (
                    <div
                        className="style-preview category-browser-preview"
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
            </div>
            <label className="category-browser-select-label" htmlFor={`semantic-slot-select-${slot.name}`}>
                Estilo activo
            </label>
            <select
                id={`semantic-slot-select-${slot.name}`}
                className="category-browser-select"
                value={selectedEntry ? getStyleSelectionKey(selectedEntry) : ''}
                onFocus={handleActivate}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onSelect?.(slot.name, event.target.value)}
                data-testid={`template-slot-select-${slot.name}`}
                disabled={isDisabled || options.length === 0}
            >
                {options.map((option) => (
                    <option key={option.selection_key} value={option.selection_key}>
                        {option.display_name || option.name}
                    </option>
                ))}
            </select>
        </div>
    );
};


const PageSetupPanel = ({ pageSetup, onUpdate }) => {
    if (!pageSetup) return null;

    return (
        <div className="page-setup-panel">
            <h4>Configuración de Página</h4>

            <div className="page-info-grid">
                <div className="page-info-item">
                    <span className="label">Tamaño:</span>
                    <span className="value">
                        {pageSetup.page_width_inches}" × {pageSetup.page_height_inches}"
                    </span>
                </div>

                <div className="page-info-item">
                    <span className="label">Orientación:</span>
                    <span className="value">
                        {pageSetup.orientation === 'landscape' ? 'Horizontal' : 'Vertical'}
                    </span>
                </div>

                <div className="page-info-item margins">
                    <span className="label">Márgenes:</span>
                    <div className="margins-grid">
                        <span>↑ {pageSetup.top_margin_inches}"</span>
                        <span>↓ {pageSetup.bottom_margin_inches}"</span>
                        <span>← {pageSetup.left_margin_inches}"</span>
                        <span>→ {pageSetup.right_margin_inches}"</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TemplateEditor = ({
    templateInfo,
    kernelId,
    sendMessage,
    lastMessage,
    onClose,
    onTemplateChange,
    onStatusMessage,
    onTemplateUpload,
    isOpeningPersistedTemplate = false,
}) => {
    const [selectedStyle, setSelectedStyle] = useState(null);
    const [categoryOverrides, setCategoryOverrides] = useState({});
    const [semanticSlotSelections, setSemanticSlotSelections] = useState({});
    const [isUpdating, setIsUpdating] = useState(false);
    const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [sidebarMode, setSidebarMode] = useState('slots');
    const [selectedSemanticSlotName, setSelectedSemanticSlotName] = useState('body');
    const [searchTerm, setSearchTerm] = useState('');  // FIX #21: Style search

    const templateInputRef = useRef(null);
    const templateJsonInputRef = useRef(null);
    const pendingImportedSemanticSlotsRef = useRef(null);

    const skipNextTemplateInfoResetRef = useRef(false);
    const lastTemplatePreviewResetFingerprintRef = useRef('');
    const lastProcessedTemplateMessageFingerprintRef = useRef('');
    const actionRequestSeqRef = useRef(0);
    const pendingActionRequestsRef = useRef({
        template_update_style: null,
        template_update_document_defaults: null,
        template_update_semantic_slots: null,
        template_upload: null,
        template_delete: null,
        template_apply_table_format: null,
        template_create_style_from_table: null,
    });

    const {
        previewImage,
        setPreviewImage,
        isPreviewLoading,
        setIsPreviewLoading,
        previewInFlightRef,
        previewTimeoutRef,
        resetStylePreviewPipeline,
        cachePreview,
        getCachedPreview,
        handleRequestPreview,
    } = useStylePreviewPipeline({
        sendMessage,
        kernelId,
        normalizePreviewProps,
        buildPreviewKey,
    });

    // Template upload handler
    const handleTemplateUploadClick = useCallback(() => {
        if (templateInputRef.current) {
            templateInputRef.current.click();
        }
    }, []);

    const nextActionRequestId = useCallback((prefix) => {
        actionRequestSeqRef.current += 1;
        return `${prefix}_${Date.now()}_${actionRequestSeqRef.current}`;
    }, []);

    // Keyboard shortcut: Esc closes editor (save shortcut is handled inside StyleEditPanel).
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && onClose) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Parse style coverage from template
    const styleCoverage = templateInfo?.style_coverage || null;
    const styleBrowser = useMemo(
        () => templateInfo?.style_browser || buildFallbackStyleBrowser(templateInfo),
        [templateInfo]
    );
    const templateResetFingerprint = useMemo(
        () => buildTemplateResetFingerprint(templateInfo),
        [templateInfo]
    );
    const xmlDetails = templateInfo?.xml_details || null;
    const stylePanelTemplateDetails = useMemo(() => ({
        ...(xmlDetails || {}),
        font_catalog: templateInfo?.font_catalog || xmlDetails?.font_catalog || [],
        default_font: templateInfo?.default_font || xmlDetails?.default_font || null,
        document_defaults: templateInfo?.document_defaults || null,
        document_captions: templateInfo?.document_captions || [],
        system_font_catalog: templateInfo?.system_font_catalog || xmlDetails?.system_font_catalog || [],
    }), [templateInfo, xmlDetails]);
    const globalStyleInfo = useMemo(() => ({
        name: 'Documento (Global)',
        display_name: 'Documento (Global)',
        kind: 'global',
        status: 'defined',
        description: 'Propiedades globales del documento',
        selection_key: 'global',
        style: null,
    }), []);

    const coverageCategories = useMemo(
        () => styleCoverage?.categories || {},
        [styleCoverage]
    );
    const summary = useMemo(
        () => styleCoverage?.summary || { defined: 0, inherited: 0, missing: 0, total: 0 },
        [styleCoverage]
    );
    const browserCategories = useMemo(
        () => styleBrowser?.categories || {},
        [styleBrowser]
    );
    const browserCategoryOrder = useMemo(
        () => styleBrowser?.category_order || STYLE_BROWSER_ORDER,
        [styleBrowser]
    );
    const browserAutoSelected = useMemo(
        () => styleBrowser?.auto_selected || {},
        [styleBrowser]
    );
    const browserCounts = useMemo(
        () => styleBrowser?.counts || {},
        [styleBrowser]
    );

    const resolveSelectionKeyForCategory = useCallback((categoryKey, requestedKey, sourceTemplate = templateInfo) => {
        if (!categoryKey || !sourceTemplate) return null;
        const sourceBrowser = sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate);
        const options = sourceBrowser?.categories?.[categoryKey] || [];
        if (!options.length) return null;

        if (requestedKey) {
            const exact = options.find((option) => getStyleSelectionKey(option) === requestedKey);
            if (exact) return getStyleSelectionKey(exact);

            const requestedBase = String(requestedKey).split('#')[0];
            const byBase = options.find((option) => buildStyleBaseKey(categoryKey, option) === requestedBase);
            if (byBase) return getStyleSelectionKey(byBase);
        }

        const autoKey = sourceBrowser?.auto_selected?.[categoryKey];
        if (autoKey) {
            const autoMatch = options.find((option) => getStyleSelectionKey(option) === autoKey);
            if (autoMatch) return getStyleSelectionKey(autoMatch);
        }

        return getStyleSelectionKey(options[0]);
    }, [templateInfo]);

    const resolveStyleEntry = useCallback((categoryKey, requestedKey, sourceTemplate = templateInfo) => {
        if (!categoryKey || !sourceTemplate) return null;
        const sourceBrowser = sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate);
        const options = sourceBrowser?.categories?.[categoryKey] || [];
        const resolvedKey = resolveSelectionKeyForCategory(categoryKey, requestedKey, sourceTemplate);
        return options.find((option) => getStyleSelectionKey(option) === resolvedKey) || null;
    }, [resolveSelectionKeyForCategory, templateInfo]);

    const resolveStyleSelection = useCallback((currentSelection, sourceTemplate = templateInfo) => {
        if (!currentSelection || !sourceTemplate) return null;
        if (currentSelection.kind === 'global' || currentSelection.name === 'Documento (Global)' || currentSelection.selection_key === 'global') {
            return globalStyleInfo;
        }

        const categoryKey = currentSelection?.category || currentSelection?.style?.category || null;
        const selectionKey = getStyleSelectionKey(currentSelection);
        if (categoryKey) {
            const matchedInCategory = resolveStyleEntry(categoryKey, selectionKey, sourceTemplate);
            if (matchedInCategory) return matchedInCategory;
        }

        const styleId = currentSelection?.style?.style_id || currentSelection?.style_id || null;
        const byName = currentSelection?.style?.name || currentSelection?.display_name || currentSelection?.name || null;
        const sourceBrowser = sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate);
        for (const [sourceCategory, styles] of Object.entries(sourceBrowser?.categories || {})) {
            const matched = (styles || []).find((styleInfo) => {
                const infoStyleId = styleInfo?.style?.style_id || styleInfo?.style_id || null;
                const infoName = styleInfo?.style?.name || styleInfo?.display_name || styleInfo?.name || null;
                if (styleId && infoStyleId && String(styleId) === String(infoStyleId)) return true;
                return Boolean(byName && infoName && String(byName) === String(infoName));
            });
            if (matched) {
                return {
                    ...matched,
                    category: matched.category || sourceCategory,
                    style_type: matched.style_type || matched.style?.type || (sourceCategory === 'tables' ? 'table' : 'paragraph'),
                };
            }
        }

        return null;
    }, [globalStyleInfo, resolveStyleEntry, templateInfo]);

    const resolveSemanticSlotEntry = useCallback((slotName, slotPayload, sourceTemplate = templateInfo) => {
        const slotDef = SEMANTIC_SLOT_BY_NAME[slotName];
        if (!slotDef || !sourceTemplate) return null;
        const sourceBrowser = sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate);
        const options = getSemanticSlotOptions(slotName, sourceBrowser);
        if (!options.length) return null;

        const requestedSelectionKey = typeof slotPayload === 'string'
            ? slotPayload
            : (slotPayload?.selection_key || null);
        if (requestedSelectionKey) {
            const exact = options.find((option) => getStyleSelectionKey(option) === requestedSelectionKey);
            if (exact) return exact;

            const requestedBase = String(requestedSelectionKey).split('#')[0];
            const byBase = options.find((option) => buildStyleBaseKey(slotDef.category, option) === requestedBase);
            if (byBase) return byBase;
        }

        const requestedStyleId = typeof slotPayload === 'object' && slotPayload
            ? String(slotPayload.style_id || '').trim()
            : '';
        if (requestedStyleId) {
            const byId = options.find((option) => String(getSemanticOptionStyleId(option) || '') === requestedStyleId);
            if (byId) return byId;
        }

        const requestedStyleName = typeof slotPayload === 'object' && slotPayload
            ? String(slotPayload.style_name || slotPayload.display_name || '').trim().toLowerCase()
            : '';
        if (requestedStyleName) {
            const byName = options.find((option) => (
                String(getSemanticOptionName(option) || '').trim().toLowerCase() === requestedStyleName
                || String(getSemanticOptionDisplayName(option) || '').trim().toLowerCase() === requestedStyleName
            ));
            if (byName) return byName;
        }

        return getDefaultSemanticSlotEntry(slotName, options);
    }, [templateInfo]);

    const buildFallbackSemanticSlots = useCallback((sourceTemplate = templateInfo) => {
        if (!sourceTemplate) return {};
        const sourceBrowser = sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate);
        const fallbackSlots = {};
        SEMANTIC_SLOT_DEFS.forEach((slot) => {
            const entry = getDefaultSemanticSlotEntry(slot.name, getSemanticSlotOptions(slot.name, sourceBrowser));
            fallbackSlots[slot.name] = getSemanticSlotPayload(slot.name, entry);
        });
        return fallbackSlots;
    }, [templateInfo]);

    const serializeSemanticSlotSelections = useCallback((slotSelections, sourceTemplate = templateInfo) => {
        const payload = {};
        SEMANTIC_SLOT_DEFS.forEach((slot) => {
            const entry = resolveStyleEntry(slot.category, slotSelections?.[slot.name], sourceTemplate)
                || resolveSemanticSlotEntry(slot.name, sourceTemplate?.semantic_style_slots?.[slot.name], sourceTemplate)
                || getDefaultSemanticSlotEntry(
                    slot.name,
                    getSemanticSlotOptions(slot.name, sourceTemplate?.style_browser || buildFallbackStyleBrowser(sourceTemplate))
                );
            payload[slot.name] = getSemanticSlotPayload(slot.name, entry);
        });
        return payload;
    }, [resolveStyleEntry, resolveSemanticSlotEntry, templateInfo]);

    const persistSemanticSlotSelections = useCallback((nextSelections, sourceTemplate = templateInfo) => {
        if (!sendMessage || !kernelId) return;
        const requestId = nextActionRequestId('tpl_slots');
        pendingActionRequestsRef.current.template_update_semantic_slots = requestId;
        setIsUpdating(true);
        sendMessage({
            type: WS_MSG.TEMPLATE_UPDATE_SEMANTIC_SLOTS,
            request_id: requestId,
            kernel_id: kernelId,
            semantic_style_slots: serializeSemanticSlotSelections(nextSelections, sourceTemplate),
        });
    }, [kernelId, nextActionRequestId, sendMessage, serializeSemanticSlotSelections, templateInfo]);

    const resolveImportedSemanticSlots = useCallback((rawImportPayload, sourceTemplate) => {
        if (!rawImportPayload || !sourceTemplate) return {};

        if (rawImportPayload.semantic_style_slots && typeof rawImportPayload.semantic_style_slots === 'object') {
            return rawImportPayload.semantic_style_slots;
        }

        const legacyOverrides = rawImportPayload.category_overrides && typeof rawImportPayload.category_overrides === 'object'
            ? rawImportPayload.category_overrides
            : {};
        const mapped = {};
        const legacySlotMap = {
            body: 'body',
            captions: 'caption',
            code: 'code',
            tables: 'table_default',
        };
        Object.entries(legacySlotMap).forEach(([legacyCategory, slotName]) => {
            const selectionKey = legacyOverrides?.[legacyCategory];
            if (!selectionKey) return;
            const resolvedEntry = resolveSemanticSlotEntry(
                slotName,
                { selection_key: selectionKey },
                sourceTemplate,
            );
            mapped[slotName] = getSemanticSlotPayload(slotName, resolvedEntry);
        });
        return mapped;
    }, [resolveSemanticSlotEntry]);

    // Document tables - tables found in the uploaded template with direct formatting
    const documentTables = useMemo(() => templateInfo?.document_tables || [], [templateInfo]);
    const templateContentControls = useMemo(
        () => (templateInfo?.content_controls && typeof templateInfo.content_controls === 'object' ? templateInfo.content_controls : null),
        [templateInfo]
    );
    const templateSdtControls = useMemo(
        () => (Array.isArray(templateContentControls?.controls) ? templateContentControls.controls : []),
        [templateContentControls]
    );
    const templatePlaceholders = useMemo(
        () => (Array.isArray(templateContentControls?.placeholders) ? templateContentControls.placeholders : []),
        [templateContentControls]
    );
    const unwrappedTemplatePlaceholders = useMemo(
        () => templatePlaceholders.filter((item) => !item?.wrapped),
        [templatePlaceholders]
    );
    const handleTemplateFieldsAction = useCallback((action) => {
        if (action === 'wrap') {
            if (!unwrappedTemplatePlaceholders.length) {
                onStatusMessage?.('La plantilla no tiene placeholders {{TAG}} sueltos.', 'success');
                return;
            }
            onStatusMessage?.('Abre el DOCX en Workbench > Campos y ejecuta Envolver placeholders para generar una variante SDT.', 'info');
            return;
        }
        if (action === 'fill') {
            if (!templateSdtControls.length) {
                onStatusMessage?.('No hay SDTs con tag para rellenar valores de prueba.', 'warning');
                return;
            }
            onStatusMessage?.(`Campos listos para prueba: ${templateSdtControls.map((item) => item.tag || item.alias).filter(Boolean).slice(0, 6).join(', ')}`, 'info');
            return;
        }
        onStatusMessage?.('Valida campos, estilos y proteccion con Workbench antes de preparar entrega.', 'info');
    }, [onStatusMessage, templateSdtControls, unwrappedTemplatePlaceholders]);
    const detectedHeaders = useMemo(
        () => (Array.isArray(templateInfo?.headers) ? templateInfo.headers.filter((item) => typeof item === 'string' && item.trim()) : []),
        [templateInfo]
    );
    const detectedFooters = useMemo(
        () => (Array.isArray(templateInfo?.footers) ? templateInfo.footers.filter((item) => typeof item === 'string' && item.trim()) : []),
        [templateInfo]
    );
    const hasDetectedHeaderFooter = detectedHeaders.length > 0 || detectedFooters.length > 0;

    // NEW: Tab system for Table Grid section
    const [tableGridTab, setTableGridTab] = useState('styles'); // 'styles' | 'direct'
    const [selectedDirectTable, setSelectedDirectTable] = useState(null);

    // NEW: Modal for enlarged table preview
    const [enlargedTablePreview, setEnlargedTablePreview] = useState(null); // { idx, image }
    const {
        tablePreviewImages,
        loadingTablePreviews,
        loadingAllTablePreviews,
        resetTablePreviewState,
        requestTablePreview,
        handleTablePreviewMessage,
    } = useTablePreviewQueue({
        kernelId,
        sendMessage,
        tableGridTab,
        documentTables,
        onStatusMessage,
    });

    const resolvedCategorySelections = useMemo(() => {
        const nextSelections = {};
        browserCategoryOrder.forEach((categoryKey) => {
            nextSelections[categoryKey] = resolveStyleEntry(categoryKey, categoryOverrides[categoryKey], templateInfo);
        });
        return nextSelections;
    }, [browserCategoryOrder, categoryOverrides, resolveStyleEntry, templateInfo]);

    const resolvedSemanticSlotEntries = useMemo(() => {
        const nextSelections = {};
        SEMANTIC_SLOT_DEFS.forEach((slot) => {
            nextSelections[slot.name] = resolveStyleEntry(slot.category, semanticSlotSelections[slot.name], templateInfo);
        });
        return nextSelections;
    }, [resolveStyleEntry, semanticSlotSelections, templateInfo]);
    const selectedSemanticSlot = useMemo(
        () => SEMANTIC_SLOT_DEFS.find((slot) => slot.name === selectedSemanticSlotName) || SEMANTIC_SLOT_DEFS[0],
        [selectedSemanticSlotName]
    );
    const selectedSemanticSlotEntry = selectedSemanticSlot
        ? resolvedSemanticSlotEntries[selectedSemanticSlot.name] || null
        : null;
    const selectedSemanticSlotStyleName = selectedSemanticSlotEntry?.display_name
        || selectedSemanticSlotEntry?.style?.display_name
        || selectedSemanticSlotEntry?.name
        || null;

    // FIX #21: Filter categories by search term
    const filteredBrowserCategoryKeys = useMemo(() => {
        const categoriesWithOptions = browserCategoryOrder.filter((categoryKey) => (browserCategories[categoryKey] || []).length > 0);
        if (!searchTerm.trim()) return categoriesWithOptions;

        const lowerSearch = searchTerm.toLowerCase();
        return categoriesWithOptions.filter((categoryKey) => {
            const categoryLabel = CATEGORY_LABELS[categoryKey]?.label || categoryKey;
            if (categoryLabel.toLowerCase().includes(lowerSearch)) return true;
            return (browserCategories[categoryKey] || []).some((styleInfo) => (
                styleInfo?.name?.toLowerCase().includes(lowerSearch)
                || styleInfo?.display_name?.toLowerCase().includes(lowerSearch)
                || styleInfo?.description?.toLowerCase().includes(lowerSearch)
            ));
        });
    }, [browserCategories, browserCategoryOrder, searchTerm]);

    useEffect(() => {
        if (!templateInfo) {
            setCategoryOverrides((previous) => (
                previous && Object.keys(previous).length > 0 ? {} : previous
            ));
            return;
        }

        setCategoryOverrides((previous) => {
            if (!previous || typeof previous !== 'object') return {};
            const next = {};
            Object.entries(previous).forEach(([categoryKey, requestedKey]) => {
                const resolvedKey = resolveSelectionKeyForCategory(categoryKey, requestedKey, templateInfo);
                if (resolvedKey && resolvedKey !== browserAutoSelected?.[categoryKey]) {
                    next[categoryKey] = resolvedKey;
                }
            });
            return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
        });
    }, [browserAutoSelected, resolveSelectionKeyForCategory, templateInfo]);

    useEffect(() => {
        if (!templateInfo) {
            setSemanticSlotSelections((previous) => (
                previous && Object.keys(previous).length > 0 ? {} : previous
            ));
            setSelectedSemanticSlotName('body');
            return;
        }

        const sourceSlots = templateInfo?.semantic_style_slots || buildFallbackSemanticSlots(templateInfo);
        const nextSelections = {};
        SEMANTIC_SLOT_DEFS.forEach((slot) => {
            const resolvedEntry = resolveSemanticSlotEntry(slot.name, sourceSlots?.[slot.name], templateInfo);
            if (resolvedEntry) {
                nextSelections[slot.name] = getStyleSelectionKey(resolvedEntry);
            }
        });
        setSemanticSlotSelections((previous) => (
            JSON.stringify(previous) === JSON.stringify(nextSelections) ? previous : nextSelections
        ));
    }, [buildFallbackSemanticSlots, resolveSemanticSlotEntry, templateInfo]);

    // Keep the selected style synced with updated template payloads (e.g. apply direct format)
    useEffect(() => {
        if (!templateInfo) {
            setSelectedStyle(null);
            return;
        }

        if (sidebarMode === 'slots') {
            if (tableGridTab !== 'styles') {
                setTableGridTab('styles');
            }
            if (!selectedSemanticSlotEntry) {
                if (selectedStyle) {
                    setSelectedStyle(null);
                }
                return;
            }

            const activeSlotKey = getStyleSelectionKey(selectedSemanticSlotEntry);
            const activeStyleKey = selectedStyle ? getStyleSelectionKey(selectedStyle) : null;
            const isSameSlotStyle =
                activeSlotKey === activeStyleKey &&
                selectedStyle?.status === selectedSemanticSlotEntry.status &&
                selectedStyle?.display_name === selectedSemanticSlotEntry.display_name &&
                selectedStyle?.style_type === selectedSemanticSlotEntry.style_type &&
                selectedStyle?.category === selectedSemanticSlotEntry.category &&
                selectedStyle?.style === selectedSemanticSlotEntry.style;
            if (!isSameSlotStyle) {
                setSelectedStyle(selectedSemanticSlotEntry);
            }
            return;
        }

        if (!selectedStyle) {
            const semanticSourceSlots = templateInfo?.semantic_style_slots || buildFallbackSemanticSlots(templateInfo);
            const initialSelection = SEMANTIC_SLOT_DEFS
                .map((slot) => resolveSemanticSlotEntry(slot.name, semanticSourceSlots?.[slot.name], templateInfo))
                .find(Boolean)
                || browserCategoryOrder
                    .map((categoryKey) => resolvedCategorySelections[categoryKey])
                    .find(Boolean);
            if (initialSelection) {
                setSelectedStyle(initialSelection);
            }
            return;
        }

        const refreshed = resolveStyleSelection(selectedStyle, templateInfo);
        if (!refreshed) {
            const fallbackSelection = SEMANTIC_SLOT_DEFS
                .map((slot) => resolvedSemanticSlotEntries[slot.name])
                .find(Boolean)
                || browserCategoryOrder
                    .map((categoryKey) => resolvedCategorySelections[categoryKey])
                    .find(Boolean);
            if (fallbackSelection) {
                setSelectedStyle(fallbackSelection);
            }
            return;
        }

        const isSameSelection =
            getStyleSelectionKey(selectedStyle) === getStyleSelectionKey(refreshed) &&
            selectedStyle.status === refreshed.status &&
            selectedStyle.display_name === refreshed.display_name &&
            selectedStyle.style_type === refreshed.style_type &&
            selectedStyle.category === refreshed.category;

        if (!isSameSelection) {
            setSelectedStyle(refreshed);
        }
    }, [
        browserCategoryOrder,
        buildFallbackSemanticSlots,
        resolveSemanticSlotEntry,
        resolvedCategorySelections,
        resolvedSemanticSlotEntries,
        selectedSemanticSlotEntry,
        selectedStyle,
        sidebarMode,
        tableGridTab,
        templateInfo,
        resolveStyleSelection,
    ]);

    const selectedStylePreviewKey = selectedStyle && selectedStyle.kind !== 'global'
        ? buildPreviewKey(selectedStyle.style?.name || selectedStyle.name, {
            ...getEffectiveStyleFont(selectedStyle.style),
            ...getEffectiveStyleParagraph(selectedStyle.style),
            style_type: selectedStyle.style?.type || selectedStyle.style_type || null,
            category: selectedStyle.category || selectedStyle.style?.category || null,
            style_id: selectedStyle.style?.style_id || selectedStyle.style_id || null,
            table_signature: (selectedStyle.style?.type || selectedStyle.style_type) === 'table'
                ? buildTablePreviewSignature(selectedStyle.style)
                : null,
        })
        : null;

    const styleDetailsMap = useMemo(() => {
        const map = new Map();
        if (!xmlDetails?.styles) return map;
        xmlDetails.styles.forEach(style => {
            if (style.style_id) map.set(style.style_id, style);
            if (style.display_name) map.set(style.display_name, style);
        });
        return map;
    }, [xmlDetails]);

    const selectedStyleDetails = useMemo(() => {
        if (!selectedStyle) return null;
        const styleId = selectedStyle.style?.style_id || selectedStyle.style_id;
        return (
            (styleId && styleDetailsMap.get(styleId)) ||
            styleDetailsMap.get(selectedStyle.style?.name) ||
            styleDetailsMap.get(selectedStyle.display_name) ||
            styleDetailsMap.get(selectedStyle.name) ||
            null
        );
    }, [selectedStyle, styleDetailsMap]);

    // FIX #9: Clear preview cache when template changes
    useEffect(() => {
        if (skipNextTemplateInfoResetRef.current) {
            skipNextTemplateInfoResetRef.current = false;
            return;
        }

        if (!templateInfo) {
            lastTemplatePreviewResetFingerprintRef.current = '';
            return;
        }

        if (lastTemplatePreviewResetFingerprintRef.current === templateResetFingerprint) {
            return;
        }

        lastTemplatePreviewResetFingerprintRef.current = templateResetFingerprint;
        // Clear cache to prevent showing previews from old template.
        resetStylePreviewPipeline({ clearCache: true, clearImage: true });
        resetTablePreviewState();
        logger.info('Preview cache cleared due to template change');
    }, [templateInfo, templateResetFingerprint, resetStylePreviewPipeline, resetTablePreviewState]);

    // Listen for preview responses
    useEffect(() => {
        if (!lastMessage) return;
        const messageFingerprint = buildTemplateMessageFingerprint(lastMessage);
        if (lastProcessedTemplateMessageFingerprintRef.current === messageFingerprint) {
            return;
        }
        lastProcessedTemplateMessageFingerprintRef.current = messageFingerprint;

        const messageRequestId = lastMessage.request_id || null;
        const expectedStyleName = selectedStyle && selectedStyle.kind !== 'global'
            ? (selectedStyle.style?.name || selectedStyle.display_name || selectedStyle.name)
            : null;
        const expectedStyleId = selectedStyle && selectedStyle.kind !== 'global'
            ? (selectedStyle.style?.style_id || selectedStyle.style_id || null)
            : null;

        if (lastMessage.type === WS_MSG.TEMPLATE_PREVIEW_READY) {
            const previewKey = lastMessage.preview_key || null;
            const requestId = lastMessage.request_id || null;
            const matchesKey = previewKey && previewInFlightRef.current.previewKey === previewKey;
            const matchesRequest = requestId && previewInFlightRef.current.requestId === requestId;
            const messageStyleId = lastMessage.style_id || null;
            const matchesStyleId = expectedStyleId && messageStyleId && String(expectedStyleId) === String(messageStyleId);
            const matchesStyleName = expectedStyleName && lastMessage.style_name === expectedStyleName;
            const matchesStyle = matchesStyleId || (!expectedStyleId && matchesStyleName) || (expectedStyleId && !messageStyleId && matchesStyleName);
            const hasInFlightPreview = Boolean(previewInFlightRef.current.requestId || previewInFlightRef.current.previewKey);
            const hasCorrelationFields = Boolean(previewKey || requestId);
            const fallbackMatchesStyleOnly = !hasCorrelationFields && hasInFlightPreview && matchesStyle;
            const isActiveResponse = Boolean(matchesKey || matchesRequest || fallbackMatchesStyleOnly);

            const canApplyResponse = isActiveResponse && matchesStyle && Boolean(lastMessage.preview_png_base64);

            // Ignore stale/out-of-flight responses entirely to keep cache/UI coherent.
            if (canApplyResponse && previewKey) {
                cachePreview(previewKey, lastMessage.preview_png_base64);
            }

            if (canApplyResponse) {
                setPreviewImage(lastMessage.preview_png_base64);
                setIsPreviewLoading(false);
            }

            if (isActiveResponse) {
                previewInFlightRef.current = { requestId: null, previewKey: null };
                if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_PREVIEW_ERROR) {
            const previewKey = lastMessage.preview_key || null;
            const requestId = lastMessage.request_id || null;
            const matchesKey = previewKey && previewInFlightRef.current.previewKey === previewKey;
            const matchesRequest = requestId && previewInFlightRef.current.requestId === requestId;
            const messageStyleId = lastMessage.style_id || null;
            const matchesStyleId = expectedStyleId && messageStyleId && String(expectedStyleId) === String(messageStyleId);
            const matchesStyleName = expectedStyleName && lastMessage.style_name === expectedStyleName;
            const matchesStyle = matchesStyleId || (!expectedStyleId && matchesStyleName) || (expectedStyleId && !messageStyleId && matchesStyleName);
            const hasInFlightPreview = Boolean(previewInFlightRef.current.requestId || previewInFlightRef.current.previewKey);
            const hasCorrelationFields = Boolean(previewKey || requestId);
            const fallbackMatchesStyleOnly = !hasCorrelationFields && hasInFlightPreview && matchesStyle;
            const isActiveResponse = Boolean(matchesKey || matchesRequest || fallbackMatchesStyleOnly);

            if (isActiveResponse) {
                setIsPreviewLoading(false);
                onStatusMessage?.(lastMessage.error || 'No fue posible generar la vista previa.', 'warning');
            }

            if (isActiveResponse) {
                previewInFlightRef.current = { requestId: null, previewKey: null };
                if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
            }
        }

        if (handleTablePreviewMessage(lastMessage)) {
            return;
        }

        if (lastMessage.type === WS_MSG.TEMPLATE_UPLOADED) {
            const pendingUploadId = pendingActionRequestsRef.current.template_upload;
            if (!pendingUploadId || !messageRequestId || pendingUploadId === messageRequestId) {
                pendingActionRequestsRef.current.template_upload = null;
                setIsUploadingTemplate(false);
                if (templateInputRef.current) {
                    templateInputRef.current.value = '';
                }
                if (templateJsonInputRef.current) {
                    templateJsonInputRef.current.value = '';
                }
                if (!pendingImportedSemanticSlotsRef.current) {
                    const headerCount = Array.isArray(lastMessage.template?.headers) ? lastMessage.template.headers.filter((item) => typeof item === 'string' && item.trim()).length : 0;
                    const footerCount = Array.isArray(lastMessage.template?.footers) ? lastMessage.template.footers.filter((item) => typeof item === 'string' && item.trim()).length : 0;
                    const detectedParts = [];
                    if (headerCount > 0) detectedParts.push(`${headerCount} encabezado(s)`);
                    if (footerCount > 0) detectedParts.push(`${footerCount} pie(s)`);
                    const detail = detectedParts.length > 0 ? ` Se detectaron ${detectedParts.join(' y ')}.` : '';
                    onStatusMessage?.(`Plantilla aplicada al kernel.${detail} Reejecuta la celda para regenerar DOCX/PDF con el formato actualizado.`, 'success');
                }
            }
            if (pendingImportedSemanticSlotsRef.current && lastMessage.template) {
                const importedSlots = resolveImportedSemanticSlots(
                    pendingImportedSemanticSlotsRef.current,
                    lastMessage.template,
                );
                pendingImportedSemanticSlotsRef.current = null;

                const nextSelections = {};
                SEMANTIC_SLOT_DEFS.forEach((slot) => {
                    const resolvedEntry = resolveSemanticSlotEntry(slot.name, importedSlots?.[slot.name], lastMessage.template);
                    if (resolvedEntry) {
                        nextSelections[slot.name] = getStyleSelectionKey(resolvedEntry);
                    }
                });
                setSemanticSlotSelections(nextSelections);

                const initialSelection = SEMANTIC_SLOT_DEFS
                    .map((slot) => ({
                        slot,
                        entry: resolveStyleEntry(slot.category, nextSelections[slot.name], lastMessage.template),
                    }))
                    .find((item) => item.entry);
                if (initialSelection) {
                    setSelectedSemanticSlotName(initialSelection.slot.name);
                    setSelectedStyle(initialSelection.entry);
                }

                if (Object.keys(nextSelections).length > 0) {
                    persistSemanticSlotSelections(nextSelections, lastMessage.template);
                } else {
                    onStatusMessage?.('Template JSON importado exitosamente', 'success');
                }
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_STYLE_UPDATED) {
            const pendingUpdateId = pendingActionRequestsRef.current.template_update_style;
            if (!pendingUpdateId || !messageRequestId || pendingUpdateId === messageRequestId) {
                pendingActionRequestsRef.current.template_update_style = null;
                setIsUpdating(false);
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED) {
            const pendingUpdateId = pendingActionRequestsRef.current.template_update_document_defaults;
            if (!pendingUpdateId || !messageRequestId || pendingUpdateId === messageRequestId) {
                pendingActionRequestsRef.current.template_update_document_defaults = null;
                setIsUpdating(false);
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_SEMANTIC_SLOTS_UPDATED) {
            const pendingUpdateId = pendingActionRequestsRef.current.template_update_semantic_slots;
            if (!pendingUpdateId || !messageRequestId || pendingUpdateId === messageRequestId) {
                pendingActionRequestsRef.current.template_update_semantic_slots = null;
                setIsUpdating(false);
            }
            onStatusMessage?.('Slots semánticos actualizados', 'success');
        } else if (lastMessage.type === WS_MSG.TEMPLATE_DELETED) {
            const pendingDeleteId = pendingActionRequestsRef.current.template_delete;
            if (!pendingDeleteId || !messageRequestId || pendingDeleteId === messageRequestId) {
                pendingActionRequestsRef.current.template_delete = null;
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_STYLE_CREATED) {
            const pendingCreateId = pendingActionRequestsRef.current.template_create_style_from_table;
            if (!pendingCreateId || !messageRequestId || pendingCreateId === messageRequestId) {
                pendingActionRequestsRef.current.template_create_style_from_table = null;
                setIsUpdating(false);
            }
            onStatusMessage?.(`Estilo de tabla '${lastMessage.style_name}' creado exitosamente.`, 'success');
            if (lastMessage.template && onTemplateChange) {
                onTemplateChange(lastMessage.template);
            }
        } else if (lastMessage.type === WS_MSG.TEMPLATE_FORMAT_APPLIED) {
            const pendingApplyId = pendingActionRequestsRef.current.template_apply_table_format;
            if (!pendingApplyId || !messageRequestId || pendingApplyId === messageRequestId) {
                pendingActionRequestsRef.current.template_apply_table_format = null;
                setIsUpdating(false);
            }
            onStatusMessage?.(lastMessage.message || `Formato aplicado a '${lastMessage.target_style_name}'.`, 'success');
            resetStylePreviewPipeline({ clearCache: true, clearImage: true });
            // The incoming template payload is authoritative for this mutation.
            // Skip the next templateInfo-wide reset to avoid dropping the first post-apply preview request.
            skipNextTemplateInfoResetRef.current = true;

            // Update templateInfo with the new data from backend
            if (lastMessage.template && onTemplateChange) {
                onTemplateChange(lastMessage.template);
                const refreshedSelection = resolveStyleSelection(selectedStyle, lastMessage.template);
                if (refreshedSelection) {
                    setSelectedStyle(refreshedSelection);
                }
            }

        } else if (lastMessage.type === WS_MSG.TEMPLATE_ERROR) {
            if (messageRequestId) {
                if (pendingActionRequestsRef.current.template_update_style === messageRequestId) {
                    pendingActionRequestsRef.current.template_update_style = null;
                    setIsUpdating(false);
                }
                if (pendingActionRequestsRef.current.template_update_document_defaults === messageRequestId) {
                    pendingActionRequestsRef.current.template_update_document_defaults = null;
                    setIsUpdating(false);
                }
                if (pendingActionRequestsRef.current.template_update_semantic_slots === messageRequestId) {
                    pendingActionRequestsRef.current.template_update_semantic_slots = null;
                    setIsUpdating(false);
                }
                if (pendingActionRequestsRef.current.template_upload === messageRequestId) {
                    pendingActionRequestsRef.current.template_upload = null;
                    setIsUploadingTemplate(false);
                    if (templateInputRef.current) {
                        templateInputRef.current.value = '';
                    }
                    if (templateJsonInputRef.current) {
                        templateJsonInputRef.current.value = '';
                    }
                    pendingImportedSemanticSlotsRef.current = null;
                }
                if (pendingActionRequestsRef.current.template_delete === messageRequestId) {
                    pendingActionRequestsRef.current.template_delete = null;
                }
                if (pendingActionRequestsRef.current.template_apply_table_format === messageRequestId) {
                    pendingActionRequestsRef.current.template_apply_table_format = null;
                    setIsUpdating(false);
                }
                if (pendingActionRequestsRef.current.template_create_style_from_table === messageRequestId) {
                    pendingActionRequestsRef.current.template_create_style_from_table = null;
                    setIsUpdating(false);
                }
            } else {
                setIsUpdating(false);
                setIsUploadingTemplate(false);
            }
            onStatusMessage?.(lastMessage.error || lastMessage.message || 'Error en operación de plantilla.', 'error');
        }
    }, [
        lastMessage,
        selectedStyle,
        cachePreview,
        onStatusMessage,
        onTemplateChange,
        persistSemanticSlotSelections,
        resolveImportedSemanticSlots,
        resolveSemanticSlotEntry,
        resolveStyleSelection,
        resolveSelectionKeyForCategory,
        resolveStyleEntry,
        handleTablePreviewMessage,
        resetStylePreviewPipeline,
        previewInFlightRef,
        previewTimeoutRef,
        setIsPreviewLoading,
        setPreviewImage,
    ]);

    useEffect(() => {
        resetStylePreviewPipeline({ clearImage: !selectedStylePreviewKey });

        if (!selectedStylePreviewKey) {
            return;
        }

        const cached = getCachedPreview(selectedStylePreviewKey);
        setPreviewImage(cached);
    }, [selectedStylePreviewKey, getCachedPreview, resetStylePreviewPipeline, setPreviewImage]);

    const handleStyleUpdate = useCallback((styleName, updates) => {
        if (!sendMessage || !kernelId) return;

        const requestId = nextActionRequestId('tpl_update');
        pendingActionRequestsRef.current.template_update_style = requestId;
        setIsUpdating(true);
        const styleId = selectedStyle?.style?.style_id || selectedStyle?.style_id || null;
        const normalizedUpdates = styleId && !updates?.style_id
            ? { ...updates, style_id: styleId }
            : updates;
        sendMessage({
            type: WS_MSG.TEMPLATE_UPDATE_STYLE,
            request_id: requestId,
            kernel_id: kernelId,
            style_name: styleName,
            updates: normalizedUpdates,
        });
    }, [kernelId, nextActionRequestId, selectedStyle, sendMessage]);

    const handleDocumentDefaultsUpdate = useCallback((updates) => {
        if (!sendMessage || !kernelId) return;

        const requestId = nextActionRequestId('tpl_global');
        pendingActionRequestsRef.current.template_update_document_defaults = requestId;
        setIsUpdating(true);
        sendMessage({
            type: WS_MSG.TEMPLATE_UPDATE_DOCUMENT_DEFAULTS,
            request_id: requestId,
            kernel_id: kernelId,
            updates,
        });
    }, [sendMessage, kernelId, nextActionRequestId]);

    const handleSemanticSlotActivate = useCallback((slotName, selectionKeyOverride = null) => {
        const slotDef = SEMANTIC_SLOT_BY_NAME[slotName];
        if (!slotDef) return;

        setSelectedSemanticSlotName(slotName);
        setTableGridTab('styles');

        const resolvedEntry = selectionKeyOverride
            ? resolveStyleEntry(slotDef.category, selectionKeyOverride, templateInfo)
            : resolvedSemanticSlotEntries[slotName];
        setSelectedStyle(resolvedEntry || null);
    }, [resolveStyleEntry, resolvedSemanticSlotEntries, templateInfo]);

    const handleSemanticSlotChange = useCallback((slotName, selectionKey) => {
        const slotDef = SEMANTIC_SLOT_BY_NAME[slotName];
        if (!slotDef) return;

        const nextSelections = {
            ...(semanticSlotSelections || {}),
            [slotName]: selectionKey,
        };
        setSelectedSemanticSlotName(slotName);
        setTableGridTab('styles');
        setSemanticSlotSelections(nextSelections);
        persistSemanticSlotSelections(nextSelections, templateInfo);

        const resolvedEntry = resolveStyleEntry(slotDef.category, selectionKey, templateInfo);
        setSelectedStyle(resolvedEntry || null);
    }, [persistSemanticSlotSelections, resolveStyleEntry, semanticSlotSelections, templateInfo]);

    const resetTemplateInputs = useCallback(() => {
        if (templateInputRef.current) {
            templateInputRef.current.value = '';
        }
        if (templateJsonInputRef.current) {
            templateJsonInputRef.current.value = '';
        }
    }, []);

    const uploadTemplateFile = useCallback(async (file, options = {}) => {
        const importedSemanticSlots = options?.importedSemanticSlots && typeof options.importedSemanticSlots === 'object'
            ? options.importedSemanticSlots
            : null;
        if (!file || !sendMessage || !kernelId) return false;

        const fileName = String(file.name || '').toLowerCase();
        if (!fileName.endsWith('.docx')) {
            onStatusMessage?.('Solo se permiten archivos .docx', 'error');
            resetTemplateInputs();
            return false;
        }

        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > MAX_TEMPLATE_SIZE_MB) {
            onStatusMessage?.(
                `Archivo muy grande (${sizeMB.toFixed(1)}MB). Máximo permitido: ${MAX_TEMPLATE_SIZE_MB}MB.`,
                'error'
            );
            resetTemplateInputs();
            return false;
        }

        pendingImportedSemanticSlotsRef.current = importedSemanticSlots;
        setCategoryOverrides({});
        setSemanticSlotSelections({});
        setSelectedSemanticSlotName('body');
        setSelectedStyle(null);

        const requestId = nextActionRequestId('tpl_upload');
        pendingActionRequestsRef.current.template_upload = requestId;
        setIsUploadingTemplate(true);

        const failUpload = (message, level = 'error') => {
            pendingActionRequestsRef.current.template_upload = null;
            pendingImportedSemanticSlotsRef.current = null;
            setIsUploadingTemplate(false);
            onStatusMessage?.(message, level);
            resetTemplateInputs();
        };

        const attachLegacyViaWs = () => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] : null;
                if (!base64) {
                    failUpload('Error leyendo archivo de plantilla');
                    return;
                }
                onTemplateUpload?.({ legacyBase64: base64 });
                sendMessage({
                    type: WS_MSG.TEMPLATE_UPLOAD,
                    request_id: requestId,
                    kernel_id: kernelId,
                    docx_base64: base64
                });
            };
            reader.onerror = () => {
                failUpload('Error leyendo archivo de plantilla');
            };
            reader.readAsDataURL(file);
        };

        let response;
        try {
            const form = new FormData();
            form.append('file', file);
            response = await fetch(`${API_BASE}/api/templates/upload`, {
                method: 'POST',
                body: form,
            });
        } catch (error) {
            if (sizeMB > LEGACY_TEMPLATE_FALLBACK_MAX_MB) {
                failUpload(`No fue posible contactar el upload REST y el fallback WS solo admite hasta ${LEGACY_TEMPLATE_FALLBACK_MAX_MB}MB.`);
                return false;
            }

            onStatusMessage?.('Upload REST no disponible; usando fallback WS por compatibilidad', 'warning');
            attachLegacyViaWs();
            return true;
        }

        if (!response.ok) {
            failUpload(await extractUploadErrorMessage(response));
            return false;
        }

        let data;
        try {
            data = await response.json();
        } catch (error) {
            failUpload('Respuesta inválida del upload REST para la plantilla.');
            return false;
        }

        const templateToken = data?.template_token;
        if (!templateToken) {
            failUpload('Respuesta inválida del upload REST: falta template_token.');
            return false;
        }

        onTemplateUpload?.({
            templateToken,
            sizeBytes: data?.size_bytes ?? null,
            sha256: data?.sha256 ?? null,
        });
        sendMessage({
            type: WS_MSG.TEMPLATE_ATTACH,
            request_id: requestId,
            kernel_id: kernelId,
            template_token: templateToken,
        });
        return true;
    }, [kernelId, nextActionRequestId, onStatusMessage, onTemplateUpload, resetTemplateInputs, sendMessage]);

    const handleImportJsonClick = useCallback(() => {
        templateJsonInputRef.current?.click();
    }, []);

    const handleImportJSON = useCallback((event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        void (async () => {
            let payload;
            try {
                payload = JSON.parse(await readFileAsText(file));
            } catch (error) {
                onStatusMessage?.('El archivo JSON no es válido.', 'error');
                resetTemplateInputs();
                return;
            }

            if (!payload || typeof payload !== 'object') {
                onStatusMessage?.('El archivo JSON no contiene un objeto portable válido.', 'error');
                resetTemplateInputs();
                return;
            }

            if (!TEMPLATE_EXPORT_COMPAT_VERSIONS.has(String(payload.schema_version || ''))) {
                onStatusMessage?.(`Versión de export JSON no soportada: ${payload.schema_version || 'desconocida'}.`, 'error');
                resetTemplateInputs();
                return;
            }

            let bytes;
            try {
                bytes = decodeBase64ToUint8Array(payload.docx_base64);
            } catch (error) {
                onStatusMessage?.(error.message || 'No fue posible decodificar el DOCX embebido.', 'error');
                resetTemplateInputs();
                return;
            }

            const importedSemanticSlots = {
                semantic_style_slots: payload.semantic_style_slots && typeof payload.semantic_style_slots === 'object'
                    ? payload.semantic_style_slots
                    : null,
                category_overrides: payload.category_overrides && typeof payload.category_overrides === 'object'
                    ? payload.category_overrides
                    : {},
            };
            const fileLabel = String(payload.file_name || 'template-import.docx');
            const normalizedFileName = fileLabel.toLowerCase().endsWith('.docx') ? fileLabel : `${fileLabel}.docx`;
            const docxFile = new File([bytes], normalizedFileName, { type: DOCX_MIME });
            const uploaded = await uploadTemplateFile(docxFile, {
                importedSemanticSlots,
            });
            if (!uploaded) {
                pendingImportedSemanticSlotsRef.current = null;
            }
        })();
    }, [onStatusMessage, resetTemplateInputs, uploadTemplateFile]);

    const handleTemplateUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            void uploadTemplateFile(file);
        }
    };

    const handleDeleteTemplate = useCallback(async () => {
        const confirmed = window.confirm(
            '¿Estás seguro de que quieres eliminar la plantilla activa? Esta acción no se puede deshacer.'
        );
        if (!confirmed || !sendMessage || !kernelId) return;

        const requestId = nextActionRequestId('tpl_delete');
        pendingActionRequestsRef.current.template_delete = requestId;
        sendMessage({
            type: WS_MSG.TEMPLATE_DELETE,
            request_id: requestId,
            kernel_id: kernelId,
        });

        // Reset state
        pendingImportedSemanticSlotsRef.current = null;
        setCategoryOverrides({});
        setSemanticSlotSelections({});
        setSelectedSemanticSlotName('body');
        setSelectedStyle(null);
    }, [kernelId, nextActionRequestId, sendMessage]);

    // FIX #23: Export template JSON
    const handleExportJSON = useCallback(async () => {
        if (!templateInfo || !kernelId) return;

        let response;
        try {
            response = await fetch(`${API_BASE}/api/templates/export?kernel_id=${encodeURIComponent(kernelId)}`);
        } catch (error) {
            onStatusMessage?.('No fue posible exportar el template JSON portable.', 'error');
            return;
        }

        if (!response.ok) {
            onStatusMessage?.(await extractUploadErrorMessage(response, 'No fue posible exportar el template JSON portable'), 'error');
            return;
        }

        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            onStatusMessage?.('La respuesta del export JSON no es válida.', 'error');
            return;
        }

        if (!TEMPLATE_EXPORT_COMPAT_VERSIONS.has(String(payload?.schema_version || ''))) {
            onStatusMessage?.(`El backend devolvió una versión de export no soportada: ${payload?.schema_version || 'desconocida'}.`, 'error');
            return;
        }

        const exportPayload = {
            ...payload,
            semantic_style_slots: serializeSemanticSlotSelections(semanticSlotSelections, templateInfo),
        };
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${String(payload?.file_name || `template_${kernelId}`).replace(/\.docx$/i, '')}.json`;
        anchor.click();
        URL.revokeObjectURL(url);

        onStatusMessage?.('Template JSON exportado exitosamente', 'success');
    }, [kernelId, onStatusMessage, semanticSlotSelections, serializeSemanticSlotSelections, templateInfo]);

    const handleCategorySelectionChange = useCallback((categoryKey, selectionKey) => {
        const resolvedEntry = resolveStyleEntry(categoryKey, selectionKey, templateInfo);
        if (!resolvedEntry) return;

        const autoSelectedKey = browserAutoSelected?.[categoryKey];
        setCategoryOverrides((previous) => {
            const next = { ...(previous || {}) };
            if (!selectionKey || selectionKey === autoSelectedKey) {
                delete next[categoryKey];
            } else {
                next[categoryKey] = selectionKey;
            }
            return next;
        });

        if (!selectedStyle || selectedStyle?.category === categoryKey) {
            setSelectedStyle(resolvedEntry);
        }
    }, [browserAutoSelected, resolveStyleEntry, selectedStyle, templateInfo]);

    // Reset states when template changes
    useEffect(() => {
        setIsUploadingTemplate(false);
        setIsUpdating(false);
    }, [templateInfo]);

    const handleApplyDirectTableFormat = useCallback((tableIndex) => {
        const targetStyleName = selectedStyle?.style?.name || selectedStyle?.display_name || selectedStyle?.name || null;
        const targetStyleId = selectedStyle?.style?.style_id || selectedStyle?.style_id || null;

        if (!sendMessage || !kernelId) return;
        if (!Number.isInteger(tableIndex) || tableIndex < 0) return;

        if (!(targetStyleName || targetStyleId)) {
            alert('Primero selecciona un estilo de tabla en la pestaña "Estilo Word"');
            return;
        }

        const requestId = nextActionRequestId('tpl_apply');
        pendingActionRequestsRef.current.template_apply_table_format = requestId;
        setIsUpdating(true);
        sendMessage({
            type: WS_MSG.TEMPLATE_APPLY_TABLE_FORMAT,
            request_id: requestId,
            kernel_id: kernelId,
            table_index: tableIndex,
            target_style_name: targetStyleName,
            target_style_id: targetStyleId,
        });
        setSelectedDirectTable(tableIndex);
        setTimeout(() => {
            setTableGridTab('styles');
        }, 500);
    }, [selectedStyle, sendMessage, kernelId, nextActionRequestId]);

    const selectedStyleDisplayName = selectedStyle?.display_name || selectedStyle?.style?.display_name || selectedStyle?.style?.name || selectedStyle?.name || '';
    const selectedStyleEffectiveFont = useMemo(
        () => getEffectiveStyleFont(selectedStyle?.style),
        [selectedStyle]
    );
    const selectedStyleEffectiveParagraph = useMemo(
        () => getEffectiveStyleParagraph(selectedStyle?.style),
        [selectedStyle]
    );
    const selectedStylePreviewPayload = useMemo(() => {
        if (!selectedStyle || selectedStyle.kind === 'global') return null;
        return {
            ...selectedStyleEffectiveFont,
            ...selectedStyleEffectiveParagraph,
            style_type: selectedStyle.style?.type || selectedStyle.style_type || null,
            category: selectedStyle.category || selectedStyle.style?.category || null,
            style_id: selectedStyle.style?.style_id || selectedStyle.style_id || null,
            table_signature: (selectedStyle.style?.type || selectedStyle.style_type) === 'table'
                ? buildTablePreviewSignature(selectedStyle.style)
                : null,
        };
    }, [selectedStyle, selectedStyleEffectiveFont, selectedStyleEffectiveParagraph]);
    const selectedStyleNameForPreview = selectedStyle && selectedStyle.kind !== 'global'
        ? (selectedStyle.style?.name || selectedStyle.name || selectedStyle.display_name)
        : null;
    const handleRailPreview = useCallback(() => {
        if (!selectedStyleNameForPreview || !selectedStylePreviewPayload) return;
        handleRequestPreview(selectedStyleNameForPreview, selectedStylePreviewPayload, { immediate: true, force: true });
    }, [handleRequestPreview, selectedStyleNameForPreview, selectedStylePreviewPayload]);

    const templateSecondaryActions = useMemo(() => ([
        {
            id: 'import-json',
            label: 'Importar JSON',
            icon: <IconFolderOpen />,
            onClick: handleImportJsonClick,
            disabled: !templateInfo || isUploadingTemplate,
            dataTestId: 'template-import-json',
        },
        {
            id: 'export-json',
            label: 'Exportar JSON',
            icon: <IconDownload />,
            onClick: handleExportJSON,
            disabled: !templateInfo,
            dataTestId: 'template-export-json',
        },
        { type: 'separator' },
        {
            id: 'delete-template',
            label: 'Eliminar plantilla',
            icon: <IconTrash />,
            onClick: handleDeleteTemplate,
            disabled: !templateInfo,
            dataTestId: 'template-delete-button',
        },
    ]), [handleDeleteTemplate, handleExportJSON, handleImportJsonClick, isUploadingTemplate, templateInfo]);

    const sidebarTabs = [
        { id: 'slots', label: 'Slots', icon: <IconTemplate /> },
        { id: 'styles', label: 'Estilos', icon: <IconDocument /> },
        { id: 'diagnostics', label: 'Diagnóstico', icon: <IconQuality /> },
    ];
    const handleSidebarModeChange = useCallback((mode) => {
        setSidebarMode(mode);
        if (mode !== 'slots') return;
        setTableGridTab('styles');
        setSelectedStyle(selectedSemanticSlotEntry || null);
    }, [selectedSemanticSlotEntry]);
    const isSlotsMode = sidebarMode === 'slots';
    const showTableDirectTabs = !isSlotsMode && selectedStyle?.style_type === 'table' && documentTables.length > 0;
    const showTableDirectPanel = showTableDirectTabs && tableGridTab !== 'styles';
    const slotContextTitle = selectedSemanticSlot ? `Slot: ${selectedSemanticSlot.label}` : 'Slot';
    const previewRailTitle = isSlotsMode && templateInfo
        ? `${selectedSemanticSlot?.label || 'Slot'} -> ${selectedStyleDisplayName || 'Sin estilo asignado'}`
        : (selectedStyleDisplayName || 'Selecciona un estilo');

    return (
        <div className="template-editor-overlay" onClick={onClose}>
            <div className="template-editor" onClick={e => e.stopPropagation()} data-testid="template-editor">
                <div className="template-editor-header">
                    <div className="template-editor-title-group">
                        <div className="template-editor-title-row">
                            <IconTemplate aria-hidden="true" />
                            <h2>Editor de Plantillas</h2>
                        </div>
                        <div className="template-editor-subtitle">
                            {templateInfo
                                ? `${templateInfo.file_name || templateInfo.filename || 'Plantilla activa'} · ${summary.total || summary.defined + summary.inherited + summary.missing} estilos`
                                : 'Sin plantilla activa'}
                        </div>
                        {templateInfo && (
                            <div className="template-header-status" aria-label="Cobertura de estilos">
                                <span className="summary-item defined">
                                    <StatusBadge status="defined" /> {summary.defined} definidos
                                </span>
                                <span className="summary-item inherited">
                                    <StatusBadge status="inherited" /> {summary.inherited} heredados
                                </span>
                                <span className="summary-item missing">
                                    <StatusBadge status="missing" /> {summary.missing} faltantes
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="header-actions">
                        {templateInfo && (
                            <>
                                <button
                                    onClick={handleTemplateUploadClick}
                                    className="upload-btn"
                                    disabled={isUploadingTemplate}
                                    title="Subir una nueva plantilla DOCX"
                                    data-testid="template-upload-button"
                                >
                                    {isUploadingTemplate ? <LoadingSpinner size="small" /> : <IconUpload />}
                                    <span>{isUploadingTemplate ? 'Subiendo...' : 'Reemplazar DOCX'}</span>
                                </button>
                                <button
                                    type="button"
                                    className="template-header-icon-btn"
                                    onClick={() => setShowInfo((value) => !value)}
                                    aria-label="Ver información de herencia"
                                    title="Herencia de estilos"
                                >
                                    <IconSource />
                                </button>
                                <DropdownMenu
                                    options={templateSecondaryActions}
                                    icon={<IconKebab />}
                                    title="Más acciones"
                                    ariaLabel="Más acciones de plantilla"
                                    dataTestId="template-more-actions"
                                    triggerClassName="template-header-icon-btn"
                                    panelClassName="template-actions-menu"
                                />
                            </>
                        )}
                        <button
                            onClick={onClose}
                            className="close-btn"
                            title="Cerrar editor (Esc)"
                            aria-label="Cerrar editor"
                            data-testid="template-close-button"
                        >
                            <IconX />
                        </button>
                    </div>
                </div>

                {showInfo && (
                    <div className="template-info-panel" onClick={e => e.stopPropagation()}>
                        <div className="template-info-header">
                            <div className="template-info-title">Cómo funciona</div>
                            <button
                                className="info-close"
                                onClick={() => setShowInfo(false)}
                                aria-label="Cerrar información"
                            >
                                <IconX />
                            </button>
                        </div>
                        <p>
                            Los estilos pueden definir valores <strong>explícitos</strong> o heredar valores{' '}
                            <strong>efectivos</strong> desde el estilo base (basedOn), los docDefaults o el tema.
                        </p>
                        <p>
                            Cuando editas un valor efectivo en la UI, se guarda como <strong>explícito</strong>
                            en el estilo actual (no modifica el estilo base ni los defaults).
                        </p>
                        <div className="template-info-legend">
                            <span className="field-origin explicit">Explícito</span>
                            <span>Definido en este estilo.</span>
                        </div>
                        <div className="template-info-legend">
                            <span className="field-origin effective">Efectivo</span>
                            <span>Heredado desde basedOn/docDefaults/tema.</span>
                        </div>
                    </div>
                )}

                <div className="template-editor-body">
                    {/* Left Sidebar */}
                    <div className="editor-sidebar">
                        {templateInfo ? (
                            <>
                                <div className="template-sidebar-tabs" role="tablist" aria-label="Navegación de plantilla">
                                    {sidebarTabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={sidebarMode === tab.id}
                                            className={`template-sidebar-tab ${sidebarMode === tab.id ? 'active' : ''}`}
                                            onClick={() => handleSidebarModeChange(tab.id)}
                                            data-testid={`template-sidebar-${tab.id}`}
                                        >
                                            {tab.icon}
                                            <span>{tab.label}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="template-sidebar-panel scroll-surface">
                                    {sidebarMode === 'slots' && (
                                        <div className="sidebar-workflow-section" data-testid="template-slots-panel">
                                            <div className="sidebar-section-label">Slots semánticos</div>
                                            <div className="required-health-card sidebar-intro-card">
                                                <div className="required-health-note">
                                                    El notebook escribe semántica neutral; estos slots la conectan con estilos Word reales.
                                                </div>
                                            </div>
                                            <div className="category-browser-list semantic-slot-list">
                                                {SEMANTIC_SLOT_DEFS.map((slot) => (
                                                    <SemanticSlotCard
                                                        key={slot.name}
                                                        slot={slot}
                                                        options={browserCategories[slot.category] || []}
                                                        selectedEntry={resolvedSemanticSlotEntries[slot.name]}
                                                        onSelect={handleSemanticSlotChange}
                                                        onActivate={handleSemanticSlotActivate}
                                                        isActive={selectedSemanticSlotName === slot.name}
                                                        isDisabled={!templateInfo}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {sidebarMode === 'styles' && (
                                        <div className="sidebar-workflow-section" data-testid="template-styles-panel">
                                            <div className="sidebar-section-label">Buscar estilos detectados</div>
                                            <input
                                                type="search"
                                                className="template-search-input"
                                                placeholder="Buscar estilo, categoría o formato..."
                                                value={searchTerm}
                                                onChange={e => setSearchTerm(e.target.value)}
                                            />

                                            {templateInfo.has_duplicate_styles && (
                                                <div className="template-warning-card">
                                                    <strong>Advertencia:</strong> Esta plantilla contiene estilos duplicados.
                                                    Algunas ediciones dependen de `style_id` para evitar colisiones.
                                                </div>
                                            )}

                                            <div className="style-category global-browser-section">
                                                <div className="category-header">Documento</div>
                                                <StyleCard
                                                    key="global"
                                                    styleInfo={globalStyleInfo}
                                                    isSelected={selectedStyle?.selection_key === globalStyleInfo.selection_key || selectedStyle?.name === globalStyleInfo.name}
                                                    onClick={() => setSelectedStyle(globalStyleInfo)}
                                                />
                                            </div>

                                            <div className="category-browser-list">
                                                {filteredBrowserCategoryKeys.map((categoryKey) => {
                                                    const isActiveCategory = selectedStyle?.category === categoryKey;
                                                    const visibleCategorySelection = isActiveCategory
                                                        ? selectedStyle
                                                        : resolvedCategorySelections[categoryKey];
                                                    return (
                                                        <CategoryBrowserCard
                                                            key={categoryKey}
                                                            categoryKey={categoryKey}
                                                            options={browserCategories[categoryKey] || []}
                                                            selectedEntry={visibleCategorySelection}
                                                            coverageItems={coverageCategories[categoryKey] || []}
                                                            isActive={isActiveCategory}
                                                            onActivate={(entry) => {
                                                                setSelectedStyle(entry);
                                                                setTableGridTab('styles');
                                                            }}
                                                            onSelectStyle={handleCategorySelectionChange}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {sidebarMode === 'diagnostics' && (
                                        <div className="sidebar-workflow-section" data-testid="template-diagnostics-panel">
                                            <div className="sidebar-section-label">Salud de estilos requeridos</div>
                                            <div className="required-health-card">
                                                <div className="required-health-grid">
                                                    <span className="summary-item defined">
                                                        <StatusBadge status="defined" /> {summary.defined}
                                                    </span>
                                                    <span className="summary-item inherited">
                                                        <StatusBadge status="inherited" /> {summary.inherited}
                                                    </span>
                                                    <span className="summary-item missing">
                                                        <StatusBadge status="missing" /> {summary.missing}
                                                    </span>
                                                </div>
                                                <div className="required-health-note">
                                                    Cobertura de estilos canónicos del builder DOCX.
                                                </div>
                                            </div>

                                            <PageSetupPanel pageSetup={templateInfo.page_setup} />

                                            <div className="sidebar-section-label">Campos</div>
                                            <div className="required-health-card template-fields-card" data-testid="template-content-controls-summary">
                                                <div className="required-health-grid">
                                                    <span className="summary-item defined">
                                                        <StatusBadge status="defined" /> {templateSdtControls.length} SDT
                                                    </span>
                                                    <span className={unwrappedTemplatePlaceholders.length ? 'summary-item missing' : 'summary-item inherited'}>
                                                        <StatusBadge status={unwrappedTemplatePlaceholders.length ? 'missing' : 'inherited'} /> {unwrappedTemplatePlaceholders.length} sueltos
                                                    </span>
                                                </div>
                                                <div className="required-health-note">
                                                    Los campos Word-first deben quedar como controles de contenido para poder rellenarse sin tocar texto plano.
                                                </div>
                                                <div className="template-fields-actions">
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => handleTemplateFieldsAction('wrap')}
                                                    >
                                                        Envolver placeholders
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => handleTemplateFieldsAction('fill')}
                                                    >
                                                        Probar relleno
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => handleTemplateFieldsAction('validate')}
                                                    >
                                                        Validar entrega
                                                    </button>
                                                </div>
                                                {templateSdtControls.length > 0 ? (
                                                    <div className="template-fields-list">
                                                        {templateSdtControls.slice(0, 8).map((control, index) => (
                                                            <div className="template-field-chip" key={`${control.tag || control.alias || index}-${index}`}>
                                                                <strong>{control.tag || control.alias || 'SDT sin tag'}</strong>
                                                                {control.text ? <span>{control.text}</span> : null}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="required-health-note">No se detectaron controles de contenido.</div>
                                                )}
                                                {unwrappedTemplatePlaceholders.length > 0 ? (
                                                    <div className="template-warning-card template-fields-warning">
                                                        Placeholders sin envolver: {unwrappedTemplatePlaceholders.map((item) => item.placeholder || `{{${item.tag}}}`).join(', ')}
                                                    </div>
                                                ) : null}
                                            </div>

                                            {hasDetectedHeaderFooter && (
                                                <>
                                                    <div className="sidebar-section-label">Encabezados y pies detectados</div>
                                                    <div className="required-health-card" data-testid="template-header-footer-summary">
                                                        {detectedHeaders.length > 0 && (
                                                            <div className="template-detected-block">
                                                                <div className="required-health-note template-detected-title">
                                                                    Encabezados ({detectedHeaders.length})
                                                                </div>
                                                                {detectedHeaders.map((text, index) => (
                                                                    <div className="template-detected-text" key={`header-${index}`}>
                                                                        {text}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {detectedFooters.length > 0 && (
                                                            <div className="template-detected-block">
                                                                <div className="required-health-note template-detected-title">
                                                                    Pies ({detectedFooters.length})
                                                                </div>
                                                                {detectedFooters.map((text, index) => (
                                                                    <div className="template-detected-text" key={`footer-${index}`}>
                                                                        {text}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="no-template">
                                <div className="no-template__copy">
                                    <strong>{isOpeningPersistedTemplate ? 'Cargando plantilla...' : 'No hay plantilla activa.'}</strong>
                                    <span>
                                        {isOpeningPersistedTemplate
                                            ? 'Reatachando la plantilla persistida del workspace al kernel activo.'
                                            : 'Sube un archivo .docx o importa una configuracion portable para empezar.'}
                                    </span>
                                </div>

                                {isUploadingTemplate || isOpeningPersistedTemplate ? (
                                    <LoadingSpinner message={isOpeningPersistedTemplate ? 'Cargando plantilla...' : 'Extrayendo estilos...'} size="small" />
                                ) : (
                                    <div className="no-template__actions">
                                        <button
                                            className="upload-button"
                                            onClick={() => templateInputRef.current?.click()}
                                            data-testid="template-empty-upload"
                                        >
                                            <IconUpload />
                                            <span>Seleccionar archivo .docx</span>
                                        </button>
                                        <button
                                            className="upload-button secondary"
                                            onClick={handleImportJsonClick}
                                            data-testid="template-empty-import-json"
                                        >
                                            <IconFolderOpen />
                                            <span>Importar JSON</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Right Panel - Style Editor with Tabs for Tables */}
                    <div className="editor-main scroll-surface">
                        {isSlotsMode && templateInfo && (
                            <div className="slot-style-context" data-testid="template-slot-context">
                                <div className="slot-style-context-eyebrow">Slot semántico activo</div>
                                <div className="slot-style-context-main">
                                    <h3>{slotContextTitle}</h3>
                                    <div className="slot-style-context-assignment">
                                        <span>Estilo Word asignado:</span>
                                        <strong>{selectedSemanticSlotStyleName || 'Sin estilo asignado'}</strong>
                                    </div>
                                </div>
                                <p>El editor modifica el estilo Word asignado a este slot.</p>
                            </div>
                        )}

                        {/* Tab system for table styles - shown only when a table style is selected */}
                        {showTableDirectTabs && (
                            <div className="table-editor-tabs">
                                <button
                                    className={`table-editor-tab ${tableGridTab === 'styles' ? 'active' : ''}`}
                                    onClick={() => setTableGridTab('styles')}
                                    data-testid="template-tab-styles"
                                >
                                    <IconTemplate />
                                    <span>Estilo Word</span>
                                </button>
                                <button
                                    className={`table-editor-tab ${tableGridTab === 'direct' ? 'active' : ''}`}
                                    onClick={() => setTableGridTab('direct')}
                                    data-testid="template-tab-direct"
                                >
                                    <IconTable />
                                    <span>Formato Directo ({documentTables.length})</span>
                                </button>
                            </div>
                        )}

                        {/* Tab Content */}
                        {!showTableDirectPanel ? (
                            <StyleEditPanel
                                styleInfo={selectedStyle}
                                onUpdate={handleStyleUpdate}
                                onUpdateDocumentDefaults={handleDocumentDefaultsUpdate}
                                onRequestPreview={handleRequestPreview}
                                previewImage={previewImage}
                                isUpdating={isUpdating}
                                isPreviewLoading={isPreviewLoading}
                                advancedDetails={selectedStyleDetails}
                                templateDetails={stylePanelTemplateDetails}
                                onStatusMessage={onStatusMessage}
                                showInlinePreview={false}
                            />
                        ) : (
                            <TableDirectFormatPanel
                                documentTables={documentTables}
                                selectedDirectTable={selectedDirectTable}
                                tablePreviewImages={tablePreviewImages}
                                loadingTablePreviews={loadingTablePreviews}
                                loadingAllTablePreviews={loadingAllTablePreviews}
                                selectedStyle={selectedStyle}
                                onSelectTable={setSelectedDirectTable}
                                onOpenPreview={(idx, image) => {
                                    if (image) {
                                        setEnlargedTablePreview({ idx, image });
                                    }
                                }}
                                onRetryPreview={(idx) => requestTablePreview(idx, { force: true })}
                                onApplyTableFormat={handleApplyDirectTableFormat}
                            />
                        )}
                    </div>

                    {templateInfo && (
                        <aside className="template-preview-rail scroll-surface" data-testid="template-preview-rail">
                            <div className="template-preview-rail-header">
                                <div>
                                    <div className="sidebar-section-label">Preview Word</div>
                                    <h3>{previewRailTitle}</h3>
                                </div>
                                <button
                                    type="button"
                                    className="reload-button"
                                    onClick={handleRailPreview}
                                    disabled={!selectedStylePreviewPayload || isPreviewLoading}
                                    title="Renderizar vista previa"
                                >
                                    {isPreviewLoading ? <LoadingSpinner size="small" /> : <IconRefresh />}
                                    <span>Renderizar</span>
                                </button>
                            </div>

                            {selectedStylePreviewPayload ? (
                                <>
                                    <div className="live-preview-container preview-rail-frame">
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
                                                    fontFamily: readFontName(selectedStyleEffectiveFont) || 'inherit',
                                                    fontSize: readFontSize(selectedStyleEffectiveFont) ? `${readFontSize(selectedStyleEffectiveFont)}px` : '12px',
                                                    fontWeight: selectedStyleEffectiveFont?.bold ? 'bold' : 'normal',
                                                    fontStyle: selectedStyleEffectiveFont?.italic ? 'italic' : 'normal',
                                                    textDecoration: selectedStyleEffectiveFont?.underline ? 'underline' : 'none',
                                                    color: selectedStyleEffectiveFont?.color_rgb ? `#${selectedStyleEffectiveFont.color_rgb}` : '#111827',
                                                }}
                                            >
                                                AaBbCc 123
                                            </div>
                                        )}
                                    </div>
                                    <div className={`preview-status-line ${isPreviewLoading ? 'busy' : ''}`} aria-live="polite">
                                        {isPreviewLoading
                                            ? 'Renderizando vista real en Word...'
                                            : (previewImage ? 'Renderizado real de Word' : 'Vista CSS aproximada')}
                                    </div>
                                </>
                            ) : (
                                <div className="preview-rail-empty">
                                    <IconEye />
                                    <span>La vista previa se activa al seleccionar un estilo editable.</span>
                                </div>
                            )}
                        </aside>
                    )}
                </div>

                {/* Hidden file input */}
                <input
                    ref={templateInputRef}
                    type="file"
                    accept=".docx"
                    style={{ display: 'none' }}
                    onChange={handleTemplateUpload}
                />
                <input
                    ref={templateJsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleImportJSON}
                />
            </div>

            {/* Modal for enlarged table preview */}
            {enlargedTablePreview && (
                <div
                    className="table-preview-modal-overlay"
                    onClick={() => setEnlargedTablePreview(null)}
                >
                    <div className="table-preview-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="table-preview-modal-header">
                            <h4><IconTable /> Tabla {enlargedTablePreview.idx + 1} - Vista ampliada</h4>
                            <button
                                className="table-preview-modal-close"
                                onClick={() => setEnlargedTablePreview(null)}
                            >
                                <IconX />
                            </button>
                        </div>
                        <div className="table-preview-modal-body">
                            <img
                                src={`data:image/png;base64,${enlargedTablePreview.image}`}
                                alt={`Tabla ${enlargedTablePreview.idx + 1} ampliada`}
                                className="table-preview-modal-img"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TemplateEditor;
