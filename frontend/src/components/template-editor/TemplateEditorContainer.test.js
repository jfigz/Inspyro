import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TemplateEditorContainer from './TemplateEditorContainer';

const readBlobText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error || new Error('No fue posible leer el blob.'));
  reader.readAsText(blob);
});

const renderEditor = (overrides = {}) => {
  const props = {
    templateInfo: null,
    kernelId: 'kernel-template',
    sendMessage: jest.fn(),
    lastMessage: null,
    onClose: jest.fn(),
    onTemplateChange: jest.fn(),
    onStatusMessage: jest.fn(),
    onTemplateUpload: jest.fn(),
    ...overrides,
  };

  const view = render(<TemplateEditorContainer {...props} />);
  const fileInput = view.container.querySelector('input[type="file"]');
  return { ...view, props, fileInput };
};

const buildTemplateInfo = () => ({
  headers: [
    'CRITERIOS DE DISEÑO DE DESNIVELACIÓN FERROVIARIA\nCod: 0134-FDD-0-2025/01',
  ],
  footers: [
    'GIN-DI-226492-1002650-GEN-INF-0009_E\nPágina 1 de 2',
  ],
  font_catalog: ['Century Gothic'],
  system_font_catalog: ['Century Gothic'],
  default_font: { name: 'Century Gothic', font_name: 'Century Gothic' },
  document_defaults: {
    font: { font_name: 'Calibri', name: 'Calibri', font_size_pt: 11, size_pt: 11 },
    paragraph: { alignment: 'LEFT', space_after_pt: 8 },
    font_source: { kind: 'theme', scope: 'docDefaults', theme_key: 'minorHAnsi', font_name: 'Calibri' },
    paragraph_source: { kind: 'explicit', scope: 'docDefaults' },
  },
  xml_details: {
    styles: [],
  },
  document_captions: [
    {
      index: 0,
      object_type: 'figure',
      object_index: 0,
      position: 'after',
      text: 'Figura 1. Diagrama',
      plain_text: 'Figura 1. Diagrama',
      style_name: 'Caption',
      style_id: 'Caption',
      uses_caption_style: true,
      has_seq_field: true,
      sequence_name: 'Figura',
    },
  ],
  style_coverage: {
    categories: {
      captions: [
        {
          name: 'Caption',
          display_name: 'Caption',
          status: 'defined',
          description: 'Leyendas de figuras o tablas',
          category: 'captions',
          style_type: 'paragraph',
          style: {
            name: 'Caption',
            display_name: 'Caption',
            style_id: 'Caption',
            type: 'paragraph',
            font: {},
            paragraph_format: {},
            resolved_font: {
              font_name: 'Century Gothic',
              name: 'Century Gothic',
              font_size_pt: 10,
              size_pt: 10,
            },
            resolved_paragraph_format: {},
          },
        },
      ],
      body: [
        {
          name: 'Normal',
          display_name: 'Normal',
          status: 'defined',
          description: 'Texto base',
          category: 'body',
          style_type: 'paragraph',
          style: {
            name: 'Normal',
            display_name: 'Normal',
            style_id: 'Normal',
            type: 'paragraph',
            font: {},
            paragraph_format: {},
            resolved_font: {
              font_name: 'Century Gothic',
              name: 'Century Gothic',
              font_size_pt: 11,
              size_pt: 11,
            },
            resolved_paragraph_format: {},
          },
        },
      ],
    },
    summary: { defined: 1, inherited: 0, missing: 0, total: 1 },
  },
  style_browser: {
    category_order: ['titles', 'headings', 'body', 'lists', 'tables', 'code', 'captions', 'other'],
    auto_selected: {
      body: 'body|Normal|Normal',
      captions: 'captions|Caption|Caption',
    },
    counts: {
      titles: 0,
      headings: 0,
      body: 2,
      lists: 0,
      tables: 0,
      code: 0,
      captions: 1,
      other: 0,
    },
    categories: {
      titles: [],
      headings: [],
      body: [
        {
          name: 'Normal',
          display_name: 'Normal',
          status: 'defined',
          description: 'Texto base',
          category: 'body',
          style_type: 'paragraph',
          selection_key: 'body|Normal|Normal',
          style: {
            name: 'Normal',
            display_name: 'Normal',
            style_id: 'Normal',
            type: 'paragraph',
            font: {},
            paragraph_format: {},
            resolved_font: {
              font_name: 'Century Gothic',
              name: 'Century Gothic',
              font_size_pt: 11,
              size_pt: 11,
            },
            resolved_paragraph_format: {},
          },
        },
        {
          name: 'Body Text',
          display_name: 'Body Text',
          status: 'defined',
          description: 'Texto de cuerpo alternativo',
          category: 'body',
          style_type: 'paragraph',
          selection_key: 'body|BodyText|Body Text',
          style: {
            name: 'Body Text',
            display_name: 'Body Text',
            style_id: 'BodyText',
            type: 'paragraph',
            font: {},
            paragraph_format: {},
            resolved_font: {
              font_name: 'Century Gothic',
              name: 'Century Gothic',
              font_size_pt: 11,
              size_pt: 11,
            },
            resolved_paragraph_format: {},
          },
        },
      ],
      lists: [],
      tables: [],
      code: [],
      captions: [
        {
          name: 'Caption',
          display_name: 'Caption',
          status: 'defined',
          description: 'Leyendas de figuras o tablas',
          category: 'captions',
          style_type: 'paragraph',
          selection_key: 'captions|Caption|Caption',
          style: {
            name: 'Caption',
            display_name: 'Caption',
            style_id: 'Caption',
            type: 'paragraph',
            font: {},
            paragraph_format: {},
            resolved_font: {
              font_name: 'Century Gothic',
              name: 'Century Gothic',
              font_size_pt: 10,
              size_pt: 10,
            },
            resolved_paragraph_format: {},
          },
        },
      ],
      other: [],
    },
  },
  semantic_style_slots: {
    body: {
      slot_name: 'body',
      category: 'body',
      selection_key: 'body|BodyText|Body Text',
      style_id: 'BodyText',
      style_name: 'Body Text',
      display_name: 'Body Text',
      style_type: 'paragraph',
    },
    caption: {
      slot_name: 'caption',
      category: 'captions',
      selection_key: 'captions|Caption|Caption',
      style_id: 'Caption',
      style_name: 'Caption',
      display_name: 'Caption',
      style_type: 'paragraph',
    },
    table_default: {
      slot_name: 'table_default',
      category: 'tables',
      selection_key: null,
      style_id: null,
      style_name: null,
      display_name: null,
      style_type: 'table',
    },
  },
});

const buildTemplateInfoWithTableSlot = () => {
  const template = buildTemplateInfo();
  const tableEntry = {
    name: 'Table Grid',
    display_name: 'Table Grid',
    status: 'defined',
    description: 'Tabla base',
    category: 'tables',
    style_type: 'table',
    selection_key: 'tables|TableGrid|Table Grid',
    style: {
      name: 'Table Grid',
      display_name: 'Table Grid',
      style_id: 'TableGrid',
      type: 'table',
      resolved_font: {
        font_name: 'Century Gothic',
        name: 'Century Gothic',
        font_size_pt: 9,
        size_pt: 9,
      },
      resolved_paragraph_format: {},
      resolved_table_format: {},
      resolved_cell_format: {},
      table_variants: {},
    },
  };

  template.document_tables = [
    {
      index: 0,
      rows: 2,
      columns: 2,
      style_id: 'TableGrid',
      style_name: 'Table Grid',
      preview_label: 'Tabla 1',
    },
  ];
  template.style_browser = {
    ...template.style_browser,
    auto_selected: {
      ...template.style_browser.auto_selected,
      tables: 'tables|TableGrid|Table Grid',
    },
    counts: {
      ...template.style_browser.counts,
      tables: 1,
    },
    categories: {
      ...template.style_browser.categories,
      tables: [tableEntry],
    },
  };
  template.semantic_style_slots = {
    ...template.semantic_style_slots,
    table_default: {
      slot_name: 'table_default',
      category: 'tables',
      selection_key: 'tables|TableGrid|Table Grid',
      style_id: 'TableGrid',
      style_name: 'Table Grid',
      display_name: 'Table Grid',
      style_type: 'table',
    },
  };
  return template;
};

const buildHttpErrorResponse = (status, detail) => ({
  ok: false,
  status,
  headers: {
    get: () => 'application/json',
  },
  json: async () => ({ detail }),
  text: async () => detail,
});

describe('TemplateEditorContainer upload fallback policy', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it.each([
    [400, 'Payload inválido'],
    [413, 'Archivo demasiado grande'],
  ])('does not fallback to websocket when REST upload returns HTTP %s', async (status, detail) => {
    global.fetch.mockResolvedValue(buildHttpErrorResponse(status, detail));
    const { fileInput, props } = renderEditor();
    const file = new File(['demo'], 'plantilla.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.onStatusMessage).toHaveBeenCalledWith(detail, 'error'));

    expect(props.sendMessage).not.toHaveBeenCalled();
  });
});

describe('TemplateEditorContainer empty state', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('keeps empty-template actions in one primary area', () => {
    renderEditor();

    expect(screen.getByTestId('template-empty-upload')).toBeTruthy();
    expect(screen.getByTestId('template-empty-import-json')).toBeTruthy();
    expect(screen.queryByTestId('template-upload-button')).toBeNull();
    expect(screen.queryByTestId('template-footer-upload')).toBeNull();
    expect(screen.queryByTestId('template-footer-import-json')).toBeNull();
  });

  it('shows a loading state while a persisted template is reattached', () => {
    renderEditor({ isOpeningPersistedTemplate: true });

    expect(screen.getAllByText('Cargando plantilla...').length).toBeGreaterThan(0);
    expect(screen.queryByText('No hay plantilla activa.')).toBeNull();
    expect(screen.queryByTestId('template-empty-upload')).toBeNull();
    expect(screen.queryByTestId('template-empty-import-json')).toBeNull();
  });
});

describe('TemplateEditorContainer effective font rendering', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    global.URL.createObjectURL = jest.fn(() => 'blob:template-export');
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders style cards using resolved_font instead of explicit font only', () => {
    const { container } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    const preview = container.querySelector('.style-preview');
    expect(preview).toBeTruthy();
    expect(preview.style.fontFamily).toContain('Century Gothic');
  });

  it('renders detected header and footer summary from template metadata', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.click(screen.getByTestId('template-sidebar-diagnostics'));

    expect(screen.getByTestId('template-header-footer-summary')).toBeTruthy();
    expect(screen.getByText(/Encabezados \(1\)/i)).toBeTruthy();
    expect(screen.getByText(/Pies \(1\)/i)).toBeTruthy();
    expect(screen.getByText(/CRITERIOS DE DISEÑO DE DESNIVELACIÓN FERROVIARIA/i)).toBeTruthy();
    expect(screen.getByText(/GIN-DI-226492-1002650-GEN-INF-0009_E/i)).toBeTruthy();
  });

  it('renders content controls and warns about unwrapped placeholders', () => {
    renderEditor({
      templateInfo: {
        ...buildTemplateInfo(),
        content_controls: {
          control_count: 1,
          placeholder_count: 2,
          unwrapped_placeholder_count: 1,
          controls: [
            { tag: 'CLIENTE', alias: 'Cliente', text: 'ACME' },
          ],
          placeholders: [
            { tag: 'CLIENTE', placeholder: '{{CLIENTE}}', wrapped: true },
            { tag: 'OBRA', placeholder: '{{OBRA}}', wrapped: false },
          ],
        },
      },
    });

    fireEvent.click(screen.getByTestId('template-sidebar-diagnostics'));

    expect(screen.getByTestId('template-content-controls-summary')).toBeTruthy();
    expect(screen.getByText('CLIENTE')).toBeTruthy();
    expect(screen.getByText(/1 sueltos/i)).toBeTruthy();
    expect(screen.getByText(/Placeholders sin envolver: \{\{OBRA\}\}/i)).toBeTruthy();
  });

  it('sends the dedicated document defaults update message from Documento (Global)', async () => {
    const { props } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.click(screen.getByTestId('template-sidebar-styles'));
    fireEvent.click(screen.getByText('Documento (Global)'));
    fireEvent.change(screen.getByDisplayValue('Calibri'), {
      target: { value: 'Century Gothic' },
    });
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    await waitFor(() => expect(props.sendMessage).toHaveBeenCalledTimes(1));
    expect(props.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_update_document_defaults',
      kernel_id: 'kernel-template',
      updates: {
        font: {
          font_name: 'Century Gothic',
        },
      },
    }));
  });

  it('renders the caption style category from style coverage', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.click(screen.getByTestId('template-sidebar-styles'));
    const captionsSelect = screen.getByTestId('template-category-select-captions');
    expect(captionsSelect).toBeTruthy();
    expect(captionsSelect.value).toBe('captions|Caption|Caption');
  });

  it('rehydrates semantic slots on load and uses them for the initial style selection', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    expect(screen.getByTestId('template-slot-select-body').value).toBe('body|BodyText|Body Text');
    expect(screen.getByTestId('template-slot-card-body').getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByTestId('template-slot-context')).getByText('Slot: Cuerpo')).toBeTruthy();
    expect(within(screen.getByTestId('template-slot-context')).getByText('Body Text')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Body Text' }).length).toBeGreaterThan(0);
  });

  it('starts in Slots and keeps secondary actions inside the More menu', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    expect(screen.getByTestId('template-slots-panel')).toBeTruthy();
    expect(screen.getByTestId('template-sidebar-slots').getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByTestId('template-slot-context')).getByText('El editor modifica el estilo Word asignado a este slot.')).toBeTruthy();
    expect(screen.queryByTestId('template-footer-upload')).toBeNull();
    expect(screen.queryByTestId('template-footer-import-json')).toBeNull();

    fireEvent.click(screen.getByTestId('template-more-actions'));

    expect(document.body.querySelector('.dropdown-panel.template-actions-menu')).toBeTruthy();
    expect(screen.getByTestId('template-import-json')).toBeTruthy();
    expect(screen.getByTestId('template-export-json')).toBeTruthy();
    expect(screen.getByTestId('template-delete-button')).toBeTruthy();
  });

  it('selects a semantic slot card and updates the central style context', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.click(screen.getByTestId('template-slot-card-caption'));

    expect(screen.getByTestId('template-slot-card-caption').getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByTestId('template-slot-context')).getByText('Slot: Caption')).toBeTruthy();
    expect(within(screen.getByTestId('template-slot-context')).getByText('Caption')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Caption' }).length).toBeGreaterThan(0);
  });

  it('does not reset preview state repeatedly when stable template metadata rerenders', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { props, rerender } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    try {
      for (let index = 0; index < 8; index += 1) {
        rerender(
          <TemplateEditorContainer
            {...props}
            sendMessage={jest.fn()}
            templateInfo={buildTemplateInfo()}
          />,
        );
      }

      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Maximum update depth exceeded'),
        expect.anything(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('handles the same template websocket message only once across rerenders', () => {
    const lastMessage = {
      type: 'template_uploaded',
      template: buildTemplateInfo(),
    };
    const onStatusMessage = jest.fn();
    const { props, rerender } = renderEditor({
      templateInfo: buildTemplateInfo(),
      lastMessage,
      onStatusMessage,
    });

    for (let index = 0; index < 5; index += 1) {
      rerender(
        <TemplateEditorContainer
          {...props}
          sendMessage={jest.fn()}
          lastMessage={lastMessage}
          onStatusMessage={onStatusMessage}
        />,
      );
    }

    expect(onStatusMessage).toHaveBeenCalledTimes(1);
  });

  it('sends template_update_semantic_slots when a semantic slot changes', async () => {
    const { props } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.change(screen.getByTestId('template-slot-select-body'), {
      target: { value: 'body|Normal|Normal' },
    });

    await waitFor(() => expect(props.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_update_semantic_slots',
      kernel_id: 'kernel-template',
      semantic_style_slots: expect.objectContaining({
        body: expect.objectContaining({
          selection_key: 'body|Normal|Normal',
          style_id: 'Normal',
          style_name: 'Normal',
        }),
      }),
    })));
    expect(within(screen.getByTestId('template-slot-context')).getByText('Normal')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Normal' }).length).toBeGreaterThan(0);
  });

  it('allows switching the active style inside a detected category', () => {
    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.click(screen.getByTestId('template-sidebar-styles'));
    fireEvent.change(screen.getByTestId('template-category-select-body'), {
      target: { value: 'body|BodyText|Body Text' },
    });

    expect(screen.getByTestId('template-category-select-body').value).toBe('body|BodyText|Body Text');
    expect(screen.getAllByRole('heading', { name: 'Body Text' }).length).toBeGreaterThan(0);
  });

  it('keeps direct table formatting hidden in Slots but available from Styles', () => {
    renderEditor({
      templateInfo: buildTemplateInfoWithTableSlot(),
    });

    fireEvent.click(screen.getByTestId('template-slot-card-table_default'));

    expect(within(screen.getByTestId('template-slot-context')).getByText('Slot: Tabla por defecto')).toBeTruthy();
    expect(within(screen.getByTestId('template-slot-context')).getByText('Table Grid')).toBeTruthy();
    expect(screen.queryByTestId('template-tab-direct')).toBeNull();

    fireEvent.click(screen.getByTestId('template-sidebar-styles'));

    expect(screen.getByTestId('template-tab-direct')).toBeTruthy();
  });

  it('uses style_id in template_update_style for duplicate-safe updates', async () => {
    const duplicateTemplate = buildTemplateInfo();
    duplicateTemplate.style_browser.categories.body[1] = {
      ...duplicateTemplate.style_browser.categories.body[1],
      name: 'Normal',
      display_name: 'Normal',
      selection_key: 'body|BodyText|Normal',
      style: {
        ...duplicateTemplate.style_browser.categories.body[1].style,
        name: 'Normal',
        display_name: 'Normal',
      },
    };
    const { props } = renderEditor({
      templateInfo: duplicateTemplate,
    });

    fireEvent.click(screen.getByTestId('template-sidebar-styles'));
    fireEvent.change(screen.getByTestId('template-category-select-body'), {
      target: { value: 'body|BodyText|Normal' },
    });
    fireEvent.change(screen.getByDisplayValue('Century Gothic'), {
      target: { value: 'Arial' },
    });
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    await waitFor(() => expect(props.sendMessage).toHaveBeenCalledTimes(1));
    expect(props.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_update_style',
      updates: expect.objectContaining({
        style_id: 'BodyText',
        font_name: 'Arial',
      }),
    }));
  });

  it('imports a portable template JSON v1.1 and attaches the uploaded token', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        template_token: 'template-import-token',
        size_bytes: 12,
        sha256: 'abc123',
      }),
    });
    const { container, props } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });
    const jsonInput = container.querySelector('input[accept=".json,application/json"]');
    const portableJson = new File([
      JSON.stringify({
        schema_version: '1.1',
        file_name: 'portable.docx',
        docx_base64: btoa('docx-bytes'),
        semantic_style_slots: {
          body: {
            selection_key: 'body|BodyText|Body Text',
            style_id: 'BodyText',
            style_name: 'Body Text',
          },
        },
      }),
    ], 'portable.json', { type: 'application/json' });

    fireEvent.change(jsonInput, { target: { files: [portableJson] } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_attach',
      template_token: 'template-import-token',
    })));
  });

  it('accepts legacy portable template JSON v1.0 with category_overrides', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        template_token: 'template-import-token',
        size_bytes: 12,
        sha256: 'abc123',
      }),
    });
    const { container, props } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });
    const jsonInput = container.querySelector('input[accept=".json,application/json"]');
    const portableJson = new File([
      JSON.stringify({
        schema_version: '1.0',
        file_name: 'portable.docx',
        docx_base64: btoa('docx-bytes'),
        category_overrides: {
          body: 'body|BodyText|Body Text',
        },
      }),
    ], 'portable.json', { type: 'application/json' });

    fireEvent.change(jsonInput, { target: { files: [portableJson] } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_attach',
      template_token: 'template-import-token',
    })));
  });

  it('rejects invalid portable JSON imports', async () => {
    const { container, props } = renderEditor({
      templateInfo: buildTemplateInfo(),
    });
    const jsonInput = container.querySelector('input[accept=".json,application/json"]');
    const invalidJson = new File(['{'], 'broken.json', { type: 'application/json' });

    fireEvent.change(jsonInput, { target: { files: [invalidJson] } });

    await waitFor(() => expect(props.onStatusMessage).toHaveBeenCalledWith('El archivo JSON no es válido.', 'error'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exports portable JSON v1.1 including semantic style slots', async () => {
    let capturedBlob = null;
    const anchorClickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.URL.createObjectURL = jest.fn((blob) => {
      capturedBlob = blob;
      return 'blob:template-export';
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: '1.1',
        exported_at: '2026-03-25T12:00:00Z',
        kernel_id: 'kernel-template',
        template: buildTemplateInfo(),
        docx_base64: btoa('docx-bytes'),
        file_name: 'portable.docx',
      }),
    });

    renderEditor({
      templateInfo: buildTemplateInfo(),
    });

    fireEvent.change(screen.getByTestId('template-slot-select-body'), {
      target: { value: 'body|Normal|Normal' },
    });
    fireEvent.click(screen.getByTestId('template-more-actions'));
    fireEvent.click(screen.getByTestId('template-export-json'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(1));
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:template-export');
    const exportedPayload = JSON.parse(await readBlobText(capturedBlob));
    expect(exportedPayload.schema_version).toBe('1.1');
    expect(exportedPayload.semantic_style_slots).toEqual(expect.objectContaining({
      body: expect.objectContaining({
        selection_key: 'body|Normal|Normal',
        style_id: 'Normal',
        style_name: 'Normal',
      }),
      caption: expect.objectContaining({
        selection_key: 'captions|Caption|Caption',
      }),
    }));
  });
});
