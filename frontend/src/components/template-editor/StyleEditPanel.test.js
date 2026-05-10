import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StyleEditPanel from './StyleEditPanel';

const buildStyleInfo = (overrides = {}) => ({
  name: 'Normal',
  display_name: 'Normal',
  status: 'defined',
  description: 'Texto base',
  style_type: 'paragraph',
  style: {
    name: 'Normal',
    display_name: 'Normal',
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
    xml_font: {},
    xml_paragraph_format: {},
    ...overrides.style,
  },
  ...overrides,
});

describe('StyleEditPanel font handling', () => {
  it('shows the broad shared picker options even when the current value is Calibri', () => {
    const { container } = render(
      <StyleEditPanel
        styleInfo={buildStyleInfo({
          style: {
            resolved_font: {
              font_name: 'Calibri',
              name: 'Calibri',
              font_size_pt: 11,
              size_pt: 11,
            },
          },
        })}
        onUpdate={jest.fn()}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{}}
        onStatusMessage={jest.fn()}
      />
    );

    const input = screen.getByDisplayValue('Calibri');
    fireEvent.focus(input);

    expect(input).toBeTruthy();
    expect(container.querySelector('[data-font-option="Century Gothic"]')).toBeTruthy();
    expect(container.querySelector('[data-font-option="Book Antiqua"]')).toBeTruthy();
  });

  it('warns when the selected template font is not detected in the host catalog', () => {
    const previousFonts = document.fonts;
    document.fonts = { check: () => false };
    try {
      render(
        <StyleEditPanel
          styleInfo={buildStyleInfo()}
          onUpdate={jest.fn()}
          onRequestPreview={jest.fn()}
          previewImage={null}
          isUpdating={false}
          isPreviewLoading={false}
          advancedDetails={null}
          templateDetails={{
            font_catalog: ['Century Gothic'],
            system_font_catalog: ['Arial'],
            theme: {
              font_scheme: {
                minor: { latin: 'Century Gothic' },
              },
            },
          }}
          onStatusMessage={jest.fn()}
        />
      );

      expect(screen.getByText(/Fuente no detectada en este equipo/i)).toBeTruthy();
    } finally {
      document.fonts = previousFonts;
    }
  });

  it('shows an installed Word fallback for a missing legacy template font', () => {
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo({
          style: {
            resolved_font: {
              font_name: 'CG Times (W1)',
              name: 'CG Times (W1)',
              font_size_pt: 13,
              size_pt: 13,
            },
            xml_font: {
              font_name: 'CG Times (W1)',
              name: 'CG Times (W1)',
            },
          },
        })}
        onUpdate={jest.fn()}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{
          font_catalog: ['CG Times (W1)'],
          system_font_catalog: ['Arial', 'Times New Roman'],
          font_table: {
            fonts: [
              { name: 'CG Times (W1)', alt_name: 'Times New Roman' },
            ],
          },
        }}
        onStatusMessage={jest.fn()}
      />
    );

    expect(screen.getByText(/Fuente no detectada en este equipo/i)).toBeTruthy();
    expect(screen.getByText(/Fallback Word detectado: Times New Roman/i)).toBeTruthy();
  });

  it('preserves a dirty font draft when equivalent style props are rehydrated', async () => {
    const baseStyleInfo = buildStyleInfo({
      name: 'Body Text',
      display_name: 'Body Text',
      style_id: 'Textoindependiente',
      category: 'body',
      selection_key: 'body|Textoindependiente|Body Text',
      style: {
        name: 'Body Text',
        display_name: 'Body Text',
        style_id: 'Textoindependiente',
        resolved_font: {
          font_name: 'CG Times (W1)',
          name: 'CG Times (W1)',
          font_size_pt: 13,
          size_pt: 13,
        },
        xml_font: {
          font_name: 'CG Times (W1)',
          name: 'CG Times (W1)',
        },
      },
    });
    const advancedDetails = {
      r_pr: [
        {
          tag: 'rFonts',
          attrs: {
            ascii: 'CG Times (W1)',
            hAnsi: 'CG Times (W1)',
            cs: 'CG Times (W1)',
            eastAsia: 'CG Times (W1)',
          },
        },
      ],
      p_pr: [],
    };
    const templateDetails = {
      font_catalog: ['CG Times (W1)'],
      system_font_catalog: ['Arial', 'Times New Roman'],
      font_table: {
        fonts: [
          { name: 'CG Times (W1)', alt_name: 'Times New Roman' },
        ],
      },
    };
    const onUpdate = jest.fn();
    const { rerender } = render(
      <StyleEditPanel
        styleInfo={baseStyleInfo}
        onUpdate={onUpdate}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={advancedDetails}
        templateDetails={templateDetails}
        onStatusMessage={jest.fn()}
      />
    );

    fireEvent.change(screen.getByDisplayValue('CG Times (W1)'), {
      target: { value: 'Arial' },
    });

    rerender(
      <StyleEditPanel
        styleInfo={JSON.parse(JSON.stringify(baseStyleInfo))}
        onUpdate={onUpdate}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={JSON.parse(JSON.stringify(advancedDetails))}
        templateDetails={JSON.parse(JSON.stringify(templateDetails))}
        onStatusMessage={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Arial')).toBeTruthy());
    expect(screen.getByText(/Guardar Cambios/i).closest('button').disabled).toBe(false);
  });

  it('edits and saves document defaults from the global panel', () => {
    const onUpdateDocumentDefaults = jest.fn();
    render(
      <StyleEditPanel
        styleInfo={{
          kind: 'global',
          name: 'global',
          display_name: 'Documento (Global)',
          status: 'defined',
          description: 'Propiedades globales del documento',
        }}
        onUpdate={jest.fn()}
        onUpdateDocumentDefaults={onUpdateDocumentDefaults}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{
          document_defaults: {
            font: {
              font_name: 'Calibri',
              name: 'Calibri',
              font_size_pt: 11,
              size_pt: 11,
            },
            paragraph: {
              alignment: 'LEFT',
              space_after_pt: 8,
            },
            font_source: {
              kind: 'theme',
              scope: 'docDefaults',
              theme_key: 'minorHAnsi',
              font_name: 'Calibri',
            },
          },
          font_catalog: ['Century Gothic', 'Calibri'],
          system_font_catalog: ['Century Gothic', 'Calibri'],
        }}
        onStatusMessage={jest.fn()}
      />
    );

    expect(screen.getByText(/Afecta texto base y estilos heredados/i)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Calibri'), {
      target: { value: 'Century Gothic' },
    });
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    expect(onUpdateDocumentDefaults).toHaveBeenCalledWith({
      font: {
        font_name: 'Century Gothic',
      },
    });
  });

  it('saves a free-typed font name as a style font update', () => {
    const onUpdate = jest.fn();
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo({
          style_id: 'Textoindependiente',
        })}
        onUpdate={onUpdate}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{
          font_catalog: ['Century Gothic'],
          system_font_catalog: ['Century Gothic'],
        }}
        onStatusMessage={jest.fn()}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Century Gothic'), {
      target: { value: 'Aptos Narrow' },
    });
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    expect(onUpdate).toHaveBeenCalledWith('Normal', expect.objectContaining({
      font_name: 'Aptos Narrow',
      style_id: 'Textoindependiente',
    }));
  });

  it('saves a clicked picker font option without blocking on host availability', () => {
    const onUpdate = jest.fn();
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo()}
        onUpdate={onUpdate}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{
          font_catalog: ['Century Gothic', 'Book Antiqua'],
          system_font_catalog: ['Century Gothic'],
        }}
        onStatusMessage={jest.fn()}
      />
    );

    fireEvent.focus(screen.getByDisplayValue('Century Gothic'));
    fireEvent.mouseDown(document.querySelector('[data-font-option="Book Antiqua"]'));
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    expect(onUpdate).toHaveBeenCalledWith('Normal', expect.objectContaining({
      font_name: 'Book Antiqua',
    }));
  });

  it('keeps save in the sticky header and collapses inspection by default', () => {
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo()}
        onUpdate={jest.fn()}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{}}
        onStatusMessage={jest.fn()}
      />
    );

    expect(screen.getByText(/Guardar Cambios/i).closest('.edit-panel-header')).toBeTruthy();
    expect(screen.getByText(/Inspección: valores efectivos/i)).toBeTruthy();
    expect(screen.getByText(/Inspección OOXML/i)).toBeTruthy();
  });

  it('can defer the Word preview to the workbench rail', () => {
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo()}
        onUpdate={jest.fn()}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{}}
        onStatusMessage={jest.fn()}
        showInlinePreview={false}
      />
    );

    expect(screen.queryByText(/Vista Previa \(Word\)/i)).toBeNull();
    expect(screen.getByText(/Guardar Cambios/i)).toBeTruthy();
  });

  it('shows detected captions and a caption-specific preview for the Caption style', () => {
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo({
          name: 'Caption',
          display_name: 'Caption',
          category: 'captions',
          style: {
            name: 'Caption',
            display_name: 'Caption',
            style_id: 'Caption',
            type: 'paragraph',
          },
        })}
        onUpdate={jest.fn()}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={null}
        templateDetails={{
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
        }}
        onStatusMessage={jest.fn()}
      />
    );

    expect(screen.getByText('Captions detectados')).toBeTruthy();
    expect(screen.getByText(/Figura 1\. Texto de ejemplo/i)).toBeTruthy();
    expect(screen.getByText(/FIGURE #1 · after/i)).toBeTruthy();
    expect(screen.getByText(/Figura 1\. Diagrama/i)).toBeTruthy();
  });

  it('saves structured Word-complete style updates without using raw OOXML only', () => {
    const onUpdate = jest.fn();
    render(
      <StyleEditPanel
        styleInfo={buildStyleInfo({
          style: {
            style_id: 'Normal',
            word_style: {
              metadata: { ui_priority: 1 },
              visibility: { q_format: true },
              font: { complex_script_font_name: 'Arial' },
              paragraph: { contextual_spacing: false },
            },
          },
        })}
        onUpdate={onUpdate}
        onRequestPreview={jest.fn()}
        previewImage={null}
        isUpdating={false}
        isPreviewLoading={false}
        advancedDetails={{
          style_id: 'Normal',
          display_name: 'Normal',
          word_style: {
            metadata: { ui_priority: 1 },
            visibility: { q_format: true },
            font: { complex_script_font_name: 'Arial' },
            paragraph: { contextual_spacing: false },
          },
        }}
        templateDetails={{}}
        onStatusMessage={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('template-word-complete-toggle'));
    fireEvent.click(screen.getByTestId('template-word-tab-font'));
    fireEvent.change(screen.getByTestId('template-word-font-complex-script'), {
      target: { value: 'Aptos' },
    });
    fireEvent.change(screen.getByTestId('template-word-font-spacing'), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByTestId('template-word-tab-paragraph'));
    fireEvent.click(screen.getByTestId('template-word-paragraph-contextual-spacing'));
    fireEvent.change(screen.getByTestId('template-word-paragraph-tab-pos'), {
      target: { value: '4320' },
    });
    fireEvent.change(screen.getByTestId('template-word-paragraph-tab-val'), {
      target: { value: 'right' },
    });
    fireEvent.change(screen.getByTestId('template-word-paragraph-tab-leader'), {
      target: { value: 'dot' },
    });
    fireEvent.click(screen.getByText(/Guardar Cambios/i));

    expect(onUpdate).toHaveBeenCalledWith('Normal', expect.objectContaining({
      word_style: expect.objectContaining({
        font: {
          complex_script_font_name: 'Aptos',
          character_spacing_twips: '20',
        },
        paragraph: {
          contextual_spacing: true,
          tabs: [{ val: 'right', leader: 'dot', pos_twips: '4320' }],
        },
      }),
    }));
  });
});
