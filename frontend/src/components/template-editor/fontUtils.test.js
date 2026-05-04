import {
  TEMPLATE_FONT_SUGGESTIONS,
  collectTemplateFontOptions,
  fontToRpr,
} from './fontUtils';

describe('fontUtils', () => {
  it('merges base suggestions with template/theme/system catalogs without case-insensitive duplicates', () => {
    const options = collectTemplateFontOptions(
      {
        default_font: { name: 'Century Gothic' },
        font_catalog: ['century gothic', 'Gill Sans MT', 'Custom Sans'],
        system_font_catalog: ['Book Antiqua', 'CUSTOM SANS'],
        font_table: {
          fonts: [
            { name: 'Palatino Linotype' },
            { alt_name: 'Custom Serif' },
          ],
        },
        theme: {
          font_scheme: {
            major: {
              latin: 'Gill Sans MT',
              script: { Arab: 'Amiri' },
            },
            minor: {
              latin: 'Century Gothic',
              ea: 'MS Gothic',
              cs: 'Arial',
            },
          },
        },
      },
      ['book antiqua', 'Custom Sans']
    );

    expect(options).toContain('Century Gothic');
    expect(options).toContain('Book Antiqua');
    expect(options).toContain('Gill Sans MT');
    expect(options).toContain('Custom Sans');
    expect(options).toContain('Custom Serif');
    expect(options).toContain('Amiri');
    expect(options).toContain('MS Gothic');
    expect(options.filter((value) => value.toLowerCase() === 'century gothic')).toHaveLength(1);
    expect(options.filter((value) => value.toLowerCase() === 'custom sans')).toHaveLength(1);
  });

  it('serializes explicit font_name to all Word family slots', () => {
    expect(TEMPLATE_FONT_SUGGESTIONS).toContain('Century Gothic');

    expect(fontToRpr({
      font_name: 'Century Gothic',
      font_size_pt: 11,
      bold: true,
    })).toEqual([
      {
        tag: 'rFonts',
        attrs: {
          ascii: 'Century Gothic',
          hAnsi: 'Century Gothic',
          cs: 'Century Gothic',
          eastAsia: 'Century Gothic',
        },
      },
      { tag: 'sz', attrs: { val: '22' } },
      { tag: 'b', attrs: {} },
    ]);
  });
});
