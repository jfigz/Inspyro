import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
