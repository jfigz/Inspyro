import {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    LevelFormat,
    PageNumber,
    PageOrientation,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
} from 'docx';
import { renderAsync } from 'docx-preview';
import JSZip from 'jszip';
import {
    getEffectiveStyleFont,
    getEffectiveStyleParagraph,
    readFontName,
    readFontSize,
} from './fontUtils';

export const SAMPLE_DOCX_PREVIEW_RENDER_OPTIONS = {
    className: 'template-sample-docx-render',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    useBase64URL: true,
    renderFootnotes: true,
    renderEndnotes: true,
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SAMPLE_SECTIONS = [
    { key: 'heading', slot: 'heading_1', category: 'headings', focusText: 'Titulo 1. Informe de ejemplo' },
    { key: 'body', slot: 'body', category: 'body', focusText: 'El texto normal revisa fuente, color, espaciado y alineacion.' },
    { key: 'caption', slot: 'caption', category: 'captions', focusText: 'Figura 1. Caption de ejemplo generado por el Template Editor.' },
    { key: 'code', slot: 'code', category: 'code', focusText: 'for carga in cargas:' },
    { key: 'list', slot: 'list_bullet', category: 'lists', focusText: 'Primer item de lista con el estilo configurado.' },
    { key: 'table', slot: 'table_default', category: 'tables', focusText: 'Tabla 1. Estilo de tabla de ejemplo.' },
    { key: 'direct_table', slot: null, category: 'tables', focusText: 'Tabla directa tomada del documento.' },
];

const ACTIVE_SECTION_BY_SLOT = {
    body: 'body',
    heading_1: 'heading',
    heading_2: 'heading',
    heading_3: 'heading',
    heading_4: 'heading',
    heading_5: 'heading',
    heading_6: 'heading',
    list_bullet: 'list',
    list_number: 'list',
    caption: 'caption',
    code: 'code',
    table_default: 'table',
};

const ACTIVE_SECTION_BY_CATEGORY = {
    body: 'body',
    headings: 'heading',
    titles: 'heading',
    lists: 'list',
    captions: 'caption',
    code: 'code',
    tables: 'table',
};

const ptToTwip = (value, fallback = 0) => {
    const parsed = Number(value);
    return Math.round((Number.isFinite(parsed) ? parsed : fallback) * 20);
};

const inchToTwip = (value, fallback = 0) => {
    const parsed = Number(value);
    return Math.round((Number.isFinite(parsed) ? parsed : fallback) * 1440);
};

const normalizeHexColor = (value, fallback = '000000') => {
    const cleaned = String(value || '').replace('#', '').trim().toUpperCase();
    return /^[0-9A-F]{6}$/.test(cleaned) ? cleaned : fallback;
};

const normalizeStyleKey = (entry) => (
    entry?.selection_key
    || entry?.style?.selection_key
    || entry?.style?.style_id
    || entry?.style_id
    || entry?.style?.name
    || entry?.display_name
    || entry?.name
    || null
);

const getDisplayName = (entry, fallback = '') => (
    entry?.display_name
    || entry?.style?.display_name
    || entry?.style?.name
    || entry?.name
    || fallback
);

const getTableFormat = (entry) => (
    entry?.style?.resolved_table_format
    || entry?.style?.xml_table_format
    || entry?.style?.table_format
    || {}
);

const findFirstCategoryEntry = (category, categorySelections = {}, browserCategories = {}) => (
    categorySelections?.[category]
    || (Array.isArray(browserCategories?.[category]) ? browserCategories[category][0] : null)
    || null
);

const hashString = (value) => {
    let hash = 5381;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash) + text.charCodeAt(index);
        hash &= 0xffffffff;
    }
    return Math.abs(hash).toString(36);
};

const xmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const xmlAttrEscape = (value) => xmlEscape(value).replace(/"/g, '&quot;');

const cleanBase64 = (value) => String(value || '').split(',').pop().replace(/\s+/g, '');

const base64ToUint8Array = (value) => {
    const clean = cleanBase64(value);
    if (!clean) return null;
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        const binary = window.atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }
    throw new Error('No se pudo decodificar el DOCX base64 en este entorno.');
};

const getWordStyleId = (entry, fallback = null) => (
    entry?.style?.style_id
    || entry?.style_id
    || entry?.style?.id
    || fallback
);

const getEntryStyle = (entry) => {
    if (!entry || typeof entry !== 'object') return {};
    return entry.style && typeof entry.style === 'object' ? entry.style : entry;
};

const pickFirstObject = (...values) => values.find((value) => value && typeof value === 'object') || {};

const mergeStyleObjects = (...values) => Object.assign({}, ...values.filter((value) => value && typeof value === 'object'));

const getEffectiveEntryFont = (entry, defaultFont = {}) => {
    const style = getEntryStyle(entry);
    return mergeStyleObjects(
        defaultFont,
        style.resolved_font,
        entry?.resolved_font,
        style.font,
        entry?.font,
    );
};

const getEffectiveEntryParagraph = (entry, defaultParagraph = {}) => {
    const style = getEntryStyle(entry);
    return mergeStyleObjects(
        defaultParagraph,
        style.resolved_paragraph_format,
        entry?.resolved_paragraph_format,
        style.paragraph_format,
        entry?.paragraph_format,
    );
};

const sanitizeStyleId = (value, fallback) => {
    const base = String(value || fallback || 'style')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 42);
    return `TplPreview_${base || hashString(fallback || 'style')}`;
};

const styleFingerprint = (entry) => {
    if (!entry) return null;
    const style = entry.style || entry;
    return {
        key: normalizeStyleKey(entry),
        name: getDisplayName(entry),
        type: style?.type || entry?.style_type || null,
        category: entry?.category || style?.category || null,
        font: getEffectiveStyleFont(style),
        paragraph: getEffectiveStyleParagraph(style),
        table: getTableFormat(entry),
    };
};

export const resolveSamplePreviewSection = ({
    selectedStyle,
    selectedSemanticSlotName,
    showTableDirectPanel = false,
} = {}) => {
    if (showTableDirectPanel) return 'direct_table';
    if (selectedSemanticSlotName && ACTIVE_SECTION_BY_SLOT[selectedSemanticSlotName]) {
        return ACTIVE_SECTION_BY_SLOT[selectedSemanticSlotName];
    }
    const styleType = String(selectedStyle?.style?.type || selectedStyle?.style_type || '').toLowerCase();
    if (styleType === 'table') return 'table';
    const category = String(selectedStyle?.category || selectedStyle?.style?.category || '').toLowerCase();
    return ACTIVE_SECTION_BY_CATEGORY[category] || 'body';
};

export const createTemplateSamplePreviewModel = ({
    templateInfo,
    resolvedSemanticSlotEntries = {},
    resolvedCategorySelections = {},
    browserCategories = {},
    selectedStyle = null,
    selectedSemanticSlotName = 'body',
    showTableDirectPanel = false,
    selectedDirectTable = null,
    documentTables = [],
    templateResetFingerprint = '',
    templateSourceFingerprint = '',
} = {}) => {
    const documentDefaults = templateInfo?.document_defaults || {};
    const defaultFont = pickFirstObject(documentDefaults.font, templateInfo?.default_font);
    const defaultParagraph = pickFirstObject(documentDefaults.paragraph);
    const sectionEntry = (section) => (
        (section.slot ? resolvedSemanticSlotEntries?.[section.slot] : null)
        || findFirstCategoryEntry(section.category, resolvedCategorySelections, browserCategories)
    );
    const sections = SAMPLE_SECTIONS.map((section) => {
        const entry = sectionEntry(section);
        const style = entry?.style || null;
        return {
            ...section,
            entry,
            styleName: getDisplayName(entry, section.key),
            styleType: style?.type || entry?.style_type || null,
            category: entry?.category || style?.category || section.category,
            font: getEffectiveEntryFont(entry, defaultFont),
            paragraph: getEffectiveEntryParagraph(entry, defaultParagraph),
            table: getTableFormat(entry),
            styleKey: normalizeStyleKey(entry),
            wordStyleId: getWordStyleId(entry, null),
            previewStyleId: sanitizeStyleId(normalizeStyleKey(entry), section.key),
        };
    });

    const directTableIndex = Number.isInteger(selectedDirectTable) ? selectedDirectTable : 0;
    const directTable = Array.isArray(documentTables) && documentTables.length
        ? (documentTables[directTableIndex] || documentTables[0])
        : null;
    const activeSection = resolveSamplePreviewSection({
        selectedStyle,
        selectedSemanticSlotName,
        showTableDirectPanel,
    });
    const fingerprint = {
        template: templateResetFingerprint || templateInfo?.metadata?.sha256 || templateInfo?.sha256 || null,
        templateSource: templateSourceFingerprint || null,
        activeSection,
        selectedSemanticSlotName,
        selectedStyle: normalizeStyleKey(selectedStyle),
        directTable: directTable ? {
            index: directTable.index,
            rows: directTable.rows,
            cols: directTable.cols,
            style: directTable.style_id || directTable.style_name || directTable.source_style_display_name || null,
            keys: directTable.direct_format_keys || [],
        } : null,
        sections: sections.map((section) => styleFingerprint(section.entry)),
        defaults: templateInfo?.document_defaults || null,
        pageSetup: templateInfo?.page_setup || null,
        headers: templateInfo?.headers || null,
        footers: templateInfo?.footers || null,
    };

    return {
        previewKey: `sample-docx:${hashString(JSON.stringify(fingerprint))}`,
        activeSection,
        sections,
        directTable,
        metadata: {
            templateName: templateInfo?.file_name || templateInfo?.name || 'template.docx',
            headerText: Array.isArray(templateInfo?.headers) && templateInfo.headers[0]
                ? String(templateInfo.headers[0]).slice(0, 120)
                : 'Header de ejemplo del Template Editor',
            footerText: Array.isArray(templateInfo?.footers) && templateInfo.footers[0]
                ? String(templateInfo.footers[0]).slice(0, 120)
                : 'Footer de ejemplo',
        },
        documentDefaults: {
            font: defaultFont,
            paragraph: defaultParagraph,
        },
        pageSetup: templateInfo?.page_setup || null,
    };
};

const mapAlignment = (value) => {
    const normalized = String(value || '').toLowerCase();
    if (['center', 'centre'].includes(normalized)) return AlignmentType.CENTER;
    if (['right', 'end'].includes(normalized)) return AlignmentType.END;
    if (['justify', 'both', 'distribute'].includes(normalized)) return AlignmentType.BOTH;
    return AlignmentType.START;
};

const buildParagraphOptions = (section, overrides = {}) => {
    const paragraph = section?.paragraph || {};
    const lineSpacing = Number(paragraph.line_spacing);
    const {
        beforePt,
        afterPt,
        leftTwips,
        rightTwips,
        firstLineTwips,
        hangingTwips,
        ...paragraphOverrides
    } = overrides || {};
    return {
        alignment: mapAlignment(paragraph.alignment),
        spacing: {
            before: ptToTwip(paragraph.space_before_pt, beforePt || 0),
            after: ptToTwip(paragraph.space_after_pt, afterPt ?? 8),
            ...(Number.isFinite(lineSpacing) && lineSpacing > 0
                ? { line: Math.round(lineSpacing * 240) }
                : {}),
        },
        indent: {
            left: leftTwips ?? inchToTwip(paragraph.left_indent_inches),
            right: rightTwips ?? inchToTwip(paragraph.right_indent_inches),
            firstLine: firstLineTwips ?? inchToTwip(paragraph.first_line_indent_inches),
            hanging: hangingTwips ?? inchToTwip(paragraph.hanging_indent_inches),
        },
        ...paragraphOverrides,
    };
};

const buildTextRunOptions = (section, overrides = {}) => {
    const font = section?.font || {};
    const { sizePt: overrideSizePt, ...runOverrides } = overrides || {};
    const sizePt = readFontSize(font) || overrideSizePt || 11;
    const underline = font.underline || font.underline_style;
    return {
        font: readFontName(font) || overrides.font || 'Calibri',
        size: Math.max(12, Math.round(Number(sizePt) * 2)),
        color: normalizeHexColor(font.color_rgb, overrides.color || '111827'),
        bold: Boolean(font.bold || overrides.bold),
        italics: Boolean(font.italic || overrides.italics),
        strike: Boolean(font.strike),
        smallCaps: Boolean(font.small_caps),
        allCaps: Boolean(font.all_caps),
        ...(underline ? { underline: { type: 'single' } } : {}),
        ...runOverrides,
    };
};

const run = (section, text, overrides = {}) => new TextRun({
    text,
    ...buildTextRunOptions(section, overrides),
});

const paragraph = (section, text, overrides = {}) => new Paragraph({
    ...(section?.previewStyleId ? { style: section.previewStyleId } : {}),
    ...buildParagraphOptions(section, overrides.paragraph || {}),
    children: [run(section, text, overrides.run || {})],
});

const buildStyleRunOptions = (section) => buildTextRunOptions(section, {});

const buildDocumentStyles = (model) => {
    const seen = new Set();
    const paragraphStyles = (model.sections || [])
        .filter((section) => section.previewStyleId && !seen.has(section.previewStyleId))
        .map((section) => {
            seen.add(section.previewStyleId);
            return {
                id: section.previewStyleId,
                name: section.styleName || section.key,
                basedOn: 'Normal',
                next: section.previewStyleId,
                quickFormat: true,
                run: buildStyleRunOptions(section),
                paragraph: buildParagraphOptions(section),
            };
        });
    return {
        default: {
            document: {
                run: buildTextRunOptions({ font: model.documentDefaults?.font || {} }, {}),
                paragraph: buildParagraphOptions({ paragraph: model.documentDefaults?.paragraph || {} }),
            },
        },
        paragraphStyles,
    };
};

const buildPageProperties = (pageSetup = {}) => {
    const setup = pageSetup && typeof pageSetup === 'object' ? pageSetup : {};
    const width = inchToTwip(setup.page_width_inches, 8.5);
    const height = inchToTwip(setup.page_height_inches, 11);
    const orientation = String(setup.orientation || '').toLowerCase() === 'landscape'
        ? PageOrientation.LANDSCAPE
        : PageOrientation.PORTRAIT;
    return {
        size: { width, height, orientation },
        margin: {
            top: inchToTwip(setup.top_margin_inches, 0.5),
            right: inchToTwip(setup.right_margin_inches, 0.5),
            bottom: inchToTwip(setup.bottom_margin_inches, 0.5),
            left: inchToTwip(setup.left_margin_inches, 0.5),
            header: inchToTwip(setup.header_distance_inches, 0.3),
            footer: inchToTwip(setup.footer_distance_inches, 0.3),
        },
    };
};

const borderFromStyle = (tableFormat = {}) => {
    const borderColor = normalizeHexColor(tableFormat.border_color || tableFormat.table_border_color, '64748B');
    const borderSize = Math.max(1, Math.round(Number(tableFormat.border_size_pt ?? tableFormat.table_border_size_pt ?? 0.75) * 8));
    const borderValue = String(tableFormat.border_style || tableFormat.table_border_style || '').toLowerCase().includes('dash')
        ? BorderStyle.DASHED
        : BorderStyle.SINGLE;
    const border = { style: borderValue, size: borderSize, color: borderColor };
    return { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
};

const buildCell = (section, text, options = {}) => {
    const tableFormat = section?.table || {};
    const fill = normalizeHexColor(
        options.header
            ? (tableFormat.shading_color || tableFormat.table_shading_color || 'D9EAF7')
            : (tableFormat.cell_shading_color || tableFormat.table_cell_shading_color || 'FFFFFF'),
        options.header ? 'D9EAF7' : 'FFFFFF',
    );
    const verticalAlign = String(tableFormat.cell_vertical_align || tableFormat.table_cell_vertical_align || '').toLowerCase();
    return new TableCell({
        verticalAlign: verticalAlign === 'bottom' ? VerticalAlign.BOTTOM : (verticalAlign === 'top' ? VerticalAlign.TOP : VerticalAlign.CENTER),
        shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
        margins: {
            top: ptToTwip(tableFormat.cell_margin_top_pt ?? tableFormat.table_cell_margin_top_pt, 4),
            bottom: ptToTwip(tableFormat.cell_margin_bottom_pt ?? tableFormat.table_cell_margin_bottom_pt, 4),
            left: ptToTwip(tableFormat.cell_margin_left_pt ?? tableFormat.table_cell_margin_left_pt, 6),
            right: ptToTwip(tableFormat.cell_margin_right_pt ?? tableFormat.table_cell_margin_right_pt, 6),
        },
        children: [
            new Paragraph({
                alignment: mapAlignment(tableFormat.cell_alignment || tableFormat.alignment || tableFormat.table_alignment),
                children: [run(section, text, { bold: options.header })],
            }),
        ],
    });
};

const buildStyledTable = (section) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: borderFromStyle(section.table),
    rows: [
        new TableRow({ tableHeader: true, children: ['Columna 1', 'Columna 2', 'Columna 3'].map((text) => buildCell(section, text, { header: true })) }),
        new TableRow({ children: ['Dato A1', 'Dato A2', 'Dato A3'].map((text) => buildCell(section, text)) }),
        new TableRow({ children: ['Dato B1', 'Dato B2', 'Dato B3'].map((text) => buildCell(section, text)) }),
    ],
});

const buildDirectTable = (tableSection, tableInfo) => {
    const sampleCells = Array.isArray(tableInfo?.sample_cells) ? tableInfo.sample_cells : [];
    const cols = Math.max(2, Math.min(4, Number(tableInfo?.cols) || 3));
    const rows = Math.max(2, Math.min(4, Number(tableInfo?.rows) || 3));
    const cellText = (rowIndex, colIndex) => {
        const exact = sampleCells.find((cell) => Number(cell.row) === rowIndex && Number(cell.col) === colIndex);
        return exact?.text || (rowIndex === 0 ? `Header ${colIndex + 1}` : `Celda ${rowIndex}.${colIndex + 1}`);
    };
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: borderFromStyle(tableSection.table),
        rows: Array.from({ length: rows }, (_, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            children: Array.from({ length: cols }, (_, colIndex) => (
                buildCell(tableSection, cellText(rowIndex, colIndex), { header: rowIndex === 0 })
            )),
        })),
    });
};

const getSection = (model, key) => model.sections.find((section) => section.key === key) || {};

const buildGeneratedTemplateSampleDocxBlob = async (model) => {
    const heading = getSection(model, 'heading');
    const body = getSection(model, 'body');
    const caption = getSection(model, 'caption');
    const code = getSection(model, 'code');
    const list = getSection(model, 'list');
    const table = getSection(model, 'table');
    const directTable = getSection(model, 'direct_table');

    const document = new Document({
        creator: 'Inspyro Template Editor',
        title: 'Template Editor sample preview',
        description: 'Generated sample document for Template Editor visual preview',
        styles: buildDocumentStyles(model),
        numbering: {
            config: [{
                reference: 'template-sample-bullet',
                levels: [{
                    level: 0,
                    format: LevelFormat.BULLET,
                    text: '•',
                    alignment: AlignmentType.LEFT,
                    style: {
                        paragraph: { indent: { left: 720, hanging: 360 } },
                    },
                }],
            }],
        },
        sections: [{
            properties: {
                page: buildPageProperties(model.pageSetup),
            },
            headers: {
                default: new Header({
                    children: [paragraph(body, model.metadata.headerText, { paragraph: { afterPt: 4 } })],
                }),
            },
            footers: {
                default: new Footer({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.END,
                            children: [
                                run(body, `${model.metadata.footerText} - Pagina `),
                                new TextRun({ children: [PageNumber.CURRENT] }),
                            ],
                        }),
                    ],
                }),
            },
            children: [
                paragraph(heading, heading.focusText, { paragraph: { beforePt: 0, afterPt: 10 } }),
                paragraph(body, body.focusText),
                paragraph(body, 'Este parrafo permite comparar sangrias, interlineado, color y fuente del cuerpo dentro de una pagina DOCX real.'),
                paragraph(caption, caption.focusText, { paragraph: { beforePt: 6, afterPt: 10 } }),
                paragraph(code, code.focusText, { run: { font: readFontName(code.font) || 'Consolas' }, paragraph: { beforePt: 8, afterPt: 0 } }),
                paragraph(code, '    revisar(carga)', { run: { font: readFontName(code.font) || 'Consolas' }, paragraph: { beforePt: 0, afterPt: 10 } }),
                paragraph(list, list.focusText, { paragraph: { beforePt: 6, afterPt: 2, numbering: { reference: 'template-sample-bullet', level: 0 } } }),
                paragraph(list, 'Segundo item con sangria y espaciado visible.', { paragraph: { beforePt: 0, afterPt: 10, numbering: { reference: 'template-sample-bullet', level: 0 } } }),
                paragraph(table, table.focusText, { paragraph: { beforePt: 10, afterPt: 4 } }),
                buildStyledTable(table),
                paragraph(directTable, directTable.focusText, { paragraph: { beforePt: 12, afterPt: 4 } }),
                buildDirectTable(directTable, model.directTable),
            ],
        }],
    });

    return Packer.toBlob(document);
};

const extractOriginalBodyParts = (documentXml) => {
    const bodyMatch = String(documentXml || '').match(/<w:body\b[^>]*>[\s\S]*<\/w:body>/);
    if (!bodyMatch) {
        throw new Error('El DOCX base no contiene word/document.xml valido.');
    }
    const bodyXml = bodyMatch[0];
    const openMatch = bodyXml.match(/^<w:body\b[^>]*>/);
    if (!openMatch) {
        throw new Error('El DOCX base no contiene w:body valido.');
    }
    const bodyOpen = openMatch[0];
    const innerBody = bodyXml.slice(bodyOpen.length, bodyXml.length - '</w:body>'.length);
    const sectMatches = Array.from(innerBody.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g));
    const sectionProperties = sectMatches.length ? sectMatches[sectMatches.length - 1][0] : '';
    const tables = Array.from(innerBody.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)).map((match) => match[0]);
    return { bodyXml, bodyOpen, sectionProperties, tables };
};

const styleAttr = (section) => {
    const styleId = section?.wordStyleId || getWordStyleId(section?.entry, null);
    return styleId ? `<w:pStyle w:val="${xmlAttrEscape(styleId)}"/>` : '';
};

const tableStyleAttr = (section) => {
    const styleId = section?.wordStyleId || getWordStyleId(section?.entry, null);
    return styleId ? `<w:tblStyle w:val="${xmlAttrEscape(styleId)}"/>` : '';
};

const ooxmlTextRun = (text) => {
    const value = String(text ?? '');
    const needsPreserve = /^\s|\s$|\s{2,}/.test(value);
    return `<w:r><w:t${needsPreserve ? ' xml:space="preserve"' : ''}>${xmlEscape(value)}</w:t></w:r>`;
};

const ooxmlParagraph = (section, text, extraPr = '') => (
    `<w:p><w:pPr>${styleAttr(section)}${extraPr || ''}</w:pPr>${ooxmlTextRun(text)}</w:p>`
);

const ooxmlCell = (text) => (
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${ooxmlTextRun(text)}</w:p></w:tc>`
);

const ooxmlTable = (section, rows) => {
    const tableStyle = tableStyleAttr(section);
    const gridCols = Math.max(1, rows[0]?.length || 1);
    return [
        '<w:tbl>',
        '<w:tblPr>',
        tableStyle,
        '<w:tblW w:w="0" w:type="auto"/>',
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>',
        '</w:tblPr>',
        '<w:tblGrid>',
        ...Array.from({ length: gridCols }, () => '<w:gridCol w:w="2800"/>'),
        '</w:tblGrid>',
        ...rows.map((row, rowIndex) => [
            '<w:tr>',
            rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '',
            ...row.map((cell) => ooxmlCell(cell)),
            '</w:tr>',
        ].join('')),
        '</w:tbl>',
    ].join('');
};

const directTableRows = (tableInfo) => {
    const sampleCells = Array.isArray(tableInfo?.sample_cells) ? tableInfo.sample_cells : [];
    const cols = Math.max(2, Math.min(4, Number(tableInfo?.cols) || 3));
    const rows = Math.max(2, Math.min(4, Number(tableInfo?.rows) || 3));
    const cellText = (rowIndex, colIndex) => {
        const exact = sampleCells.find((cell) => Number(cell.row) === rowIndex && Number(cell.col) === colIndex);
        return exact?.text || (rowIndex === 0 ? `Header ${colIndex + 1}` : `Celda ${rowIndex}.${colIndex + 1}`);
    };
    return Array.from({ length: rows }, (_, rowIndex) => (
        Array.from({ length: cols }, (_, colIndex) => cellText(rowIndex, colIndex))
    ));
};

const buildTemplatePackageSampleBody = (model, sourceTables = []) => {
    const heading = getSection(model, 'heading');
    const body = getSection(model, 'body');
    const caption = getSection(model, 'caption');
    const code = getSection(model, 'code');
    const list = getSection(model, 'list');
    const table = getSection(model, 'table');
    const directTable = getSection(model, 'direct_table');
    const directTableIndex = Number.isInteger(model?.directTable?.index) ? model.directTable.index : 0;
    const sourceDirectTable = sourceTables[directTableIndex] || sourceTables[0] || '';

    return [
        ooxmlParagraph(heading, heading.focusText),
        ooxmlParagraph(body, body.focusText),
        ooxmlParagraph(body, 'Este parrafo permite comparar sangrias, interlineado, color y fuente del cuerpo dentro de una pagina DOCX real.'),
        ooxmlParagraph(caption, caption.focusText),
        ooxmlParagraph(code, code.focusText),
        ooxmlParagraph(code, '    revisar(carga)'),
        ooxmlParagraph(list, list.focusText),
        ooxmlParagraph(list, 'Segundo item con sangria y espaciado visible.'),
        ooxmlParagraph(table, table.focusText),
        ooxmlTable(table, [
            ['Atributo', '#', 'Descripcion'],
            ['Hito - Subhito', '6', 'Criterios de Diseno'],
            ['Apartado', '6.3.6.4', 'Desnivelacion Ferroviaria'],
        ]),
        ooxmlParagraph(directTable, directTable.focusText),
        sourceDirectTable || ooxmlTable(directTable, directTableRows(model.directTable)),
    ].join('');
};

const buildTemplatePackageSampleDocxBlob = async (model, templateDocxBase64) => {
    const sourceBytes = base64ToUint8Array(templateDocxBase64);
    if (!sourceBytes?.length) {
        throw new Error('No hay DOCX base para conservar estilos reales.');
    }
    const zip = await JSZip.loadAsync(sourceBytes);
    const documentPart = zip.file('word/document.xml');
    if (!documentPart) {
        throw new Error('El DOCX base no contiene word/document.xml.');
    }
    const documentXml = await documentPart.async('string');
    const { bodyXml, bodyOpen, sectionProperties, tables } = extractOriginalBodyParts(documentXml);
    const sampleBody = buildTemplatePackageSampleBody(model, tables);
    const nextBody = `${bodyOpen}${sampleBody}${sectionProperties}</w:body>`;
    zip.file('word/document.xml', documentXml.replace(bodyXml, nextBody));
    const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([output], { type: DOCX_MIME });
};

export const buildTemplateSampleDocxBlob = async (model, options = {}) => {
    const templateDocxBase64 = options?.templateDocxBase64 || model?.templateDocxBase64 || '';
    if (templateDocxBase64) {
        try {
            return await buildTemplatePackageSampleDocxBlob(model, templateDocxBase64);
        } catch (error) {
            // Fall back to the generated sample so the editor remains usable if the source package is unreadable.
            // eslint-disable-next-line no-console
            console.warn('Template DOCX package preview failed; using generated fallback.', error);
        }
    }
    return buildGeneratedTemplateSampleDocxBlob(model);
};

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',').pop() : value);
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el DOCX de ejemplo.'));
    reader.readAsDataURL(blob);
});

const findTextElement = (container, text) => {
    if (!container || !text) return null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        if (node.nodeValue && node.nodeValue.includes(text)) {
            return node.parentElement;
        }
        node = walker.nextNode();
    }
    return null;
};

export const focusRenderedSampleSection = (container, model) => {
    if (!container || !model) return;
    container.querySelectorAll('.template-sample-preview-focus').forEach((element) => {
        element.classList.remove('template-sample-preview-focus');
    });
    const active = SAMPLE_SECTIONS.find((section) => section.key === model.activeSection);
    const element = findTextElement(container, active?.focusText);
    if (!element) return;
    const focusTarget = element.closest('p, table, tr, div') || element;
    focusTarget.classList.add('template-sample-preview-focus');
    const scrollContainer = container.closest('.preview-rail-frame') || container;
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = focusTarget.getBoundingClientRect();
    const nextTop = scrollContainer.scrollTop + targetRect.top - containerRect.top - (containerRect.height / 2) + (targetRect.height / 2);
    scrollContainer.scrollTop = Math.max(0, nextTop);
    scrollContainer.scrollLeft = 0;
    container.scrollLeft = 0;
};

export const renderTemplateSampleDocxPreview = async (blob, container, model) => {
    if (!blob || !container) return;
    container.innerHTML = '';
    await renderAsync(blob, container, null, SAMPLE_DOCX_PREVIEW_RENDER_OPTIONS);
    focusRenderedSampleSection(container, model);
};
