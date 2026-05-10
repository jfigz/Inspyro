const { TextDecoder, TextEncoder } = require('util');

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

jest.mock('docx-preview', () => ({
  renderAsync: jest.fn(async () => undefined),
}));

const JSZip = require('jszip');
const { renderAsync } = require('docx-preview');
const {
  SAMPLE_DOCX_PREVIEW_RENDER_OPTIONS,
  buildTemplateSampleDocxBlob,
  createTemplateSamplePreviewModel,
  renderTemplateSampleDocxPreview,
} = require('./sampleDocxPreview');

const blobToArrayBuffer = (blob) => {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
};

const buildTemplatePackageBase64 = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="REAL_STYLE_PACKAGE Heading 1"/><w:rPr><w:rFonts w:ascii="Century Gothic"/><w:color w:val="0070C0"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="REAL_STYLE_PACKAGE Caption"/></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="REAL_STYLE_PACKAGE Code"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="REAL_STYLE_PACKAGE List"/></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="REAL_STYLE_PACKAGE Table"/></w:style>
</w:styles>`);
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>REAL HEADER FROM TEMPLATE</w:t></w:r></w:p></w:hdr>`);
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>REAL FOOTER FROM TEMPLATE</w:t></w:r></w:p></w:ftr>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>ORIGINAL BODY MUST BE REPLACED</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>DIRECT_TEMPLATE_TABLE</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHeader1"/>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
};

const styleEntry = (category, name, styleId, type = 'paragraph') => ({
  name,
  display_name: name,
  category,
  style_type: type,
  selection_key: `${category}|${styleId}|${name}`,
  style: {
    name,
    display_name: name,
    style_id: styleId,
    type,
    resolved_font: {
      font_name: category === 'code' ? 'Consolas' : 'Aptos',
      font_size_pt: category === 'headings' ? 18 : 11,
      bold: category === 'headings',
      italic: category === 'captions',
      color_rgb: category === 'headings' ? '1F4E79' : '111827',
    },
    resolved_paragraph_format: {
      alignment: category === 'headings' ? 'CENTER' : 'LEFT',
      space_after_pt: 8,
    },
    resolved_table_format: type === 'table'
      ? {
        border_color: '1F4E79',
        shading_color: 'D9EAF7',
        cell_shading_color: 'FFFFFF',
      }
      : undefined,
  },
});

const buildModel = (overrides = {}) => createTemplateSamplePreviewModel({
  templateInfo: {
    file_name: 'fixture.docx',
    headers: ['Header contractual'],
    footers: ['Footer contractual'],
    document_defaults: {
      font: { font_name: 'Aptos', font_size_pt: 11 },
      paragraph: { alignment: 'LEFT' },
    },
  },
  resolvedSemanticSlotEntries: {
    body: styleEntry('body', 'Normal', 'Normal'),
    heading_1: styleEntry('headings', 'Heading 1', 'Heading1'),
    caption: styleEntry('captions', 'Caption', 'Caption'),
    code: styleEntry('code', 'Code', 'Code'),
    list_bullet: styleEntry('lists', 'List Paragraph', 'ListParagraph'),
    table_default: styleEntry('tables', 'Table Grid', 'TableGrid', 'table'),
  },
  resolvedCategorySelections: {},
  browserCategories: {},
  documentTables: [
    {
      index: 0,
      rows: 2,
      cols: 2,
      style_name: 'Grid Table 1 Light',
      sample_cells: [
        { row: 0, col: 0, text: 'Col A' },
        { row: 0, col: 1, text: 'Col B' },
        { row: 1, col: 0, text: 'Valor A' },
        { row: 1, col: 1, text: 'Valor B' },
      ],
    },
  ],
  templateResetFingerprint: 'fixture-v1',
  ...overrides,
});

describe('sample DOCX preview builder', () => {
  beforeEach(() => {
    renderAsync.mockClear();
  });

  it('builds one complete sample DOCX with header, footer, text, captions, code, lists and tables', async () => {
    const model = buildModel();
    const blob = await buildTemplateSampleDocxBlob(model);
    expect(blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const documentXml = await zip.file('word/document.xml').async('string');
    const headerXml = await zip.file('word/header1.xml').async('string');
    const footerXml = await zip.file('word/footer1.xml').async('string');
    const stylesXml = await zip.file('word/styles.xml').async('string');
    const numberingXml = await zip.file('word/numbering.xml').async('string');

    expect(headerXml).toContain('Header contractual');
    expect(footerXml).toContain('Footer contractual');
    expect(stylesXml).toContain('TplPreview_');
    expect(stylesXml).toContain('Heading 1');
    expect(stylesXml).toContain('Aptos');
    expect(documentXml).toContain('w:pStyle');
    expect(numberingXml).toContain('w:numFmt w:val="bullet"');
    expect(documentXml).toContain('w:numPr');
    expect(documentXml).toContain('Titulo 1. Informe de ejemplo');
    expect(documentXml).toContain('El texto normal revisa fuente');
    expect(documentXml).toContain('Figura 1. Caption de ejemplo');
    expect(documentXml).toContain('for carga in cargas:');
    expect(documentXml).toContain('Primer item de lista');
    expect(documentXml).toContain('Tabla 1. Estilo de tabla de ejemplo.');
    expect(documentXml).toContain('Tabla directa tomada del documento.');
    expect(documentXml).toContain('Col A');
    expect(documentXml).toContain('Valor B');
  });

  it('patches the active DOCX package so real Word styles and headers are preserved', async () => {
    const model = buildModel();
    const templateDocxBase64 = await buildTemplatePackageBase64();
    const blob = await buildTemplateSampleDocxBlob(model, { templateDocxBase64 });
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const documentXml = await zip.file('word/document.xml').async('string');
    const headerXml = await zip.file('word/header1.xml').async('string');
    const footerXml = await zip.file('word/footer1.xml').async('string');
    const stylesXml = await zip.file('word/styles.xml').async('string');

    expect(headerXml).toContain('REAL HEADER FROM TEMPLATE');
    expect(footerXml).toContain('REAL FOOTER FROM TEMPLATE');
    expect(stylesXml).toContain('REAL_STYLE_PACKAGE Heading 1');
    expect(stylesXml).toContain('Century Gothic');
    expect(documentXml).toContain('<w:headerReference w:type="default" r:id="rIdHeader1"/>');
    expect(documentXml).not.toContain('ORIGINAL BODY MUST BE REPLACED');
    expect(documentXml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(documentXml).toContain('<w:pStyle w:val="Normal"/>');
    expect(documentXml).toContain('<w:tblStyle w:val="TableGrid"/>');
    expect(documentXml).toContain('DIRECT_TEMPLATE_TABLE');
    expect(documentXml).toContain('Tabla directa tomada del documento.');
  });

  it('changes preview_key and active section when selection changes', () => {
    const bodyModel = buildModel({ selectedSemanticSlotName: 'body' });
    const captionModel = buildModel({ selectedSemanticSlotName: 'caption' });
    const directTableModel = buildModel({ showTableDirectPanel: true });

    expect(bodyModel.activeSection).toBe('body');
    expect(captionModel.activeSection).toBe('caption');
    expect(directTableModel.activeSection).toBe('direct_table');
    expect(captionModel.previewKey).not.toBe(bodyModel.previewKey);
  });

  it('renders through docx-preview with paginated header/footer options', async () => {
    const model = buildModel();
    const blob = new Blob(['mock-docx']);
    const container = document.createElement('div');

    await renderTemplateSampleDocxPreview(blob, container, model);

    expect(renderAsync).toHaveBeenCalledWith(
      blob,
      container,
      null,
      expect.objectContaining({
        ...SAMPLE_DOCX_PREVIEW_RENDER_OPTIONS,
        renderHeaders: true,
        renderFooters: true,
        breakPages: true,
        useBase64URL: true,
      }),
    );
  });
});
