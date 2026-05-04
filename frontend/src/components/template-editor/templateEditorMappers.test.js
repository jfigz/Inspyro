import { mapLocalTableToTemplateUpdates } from './templateEditorMappers';

describe('templateEditorMappers', () => {
  it('maps local table keys to backend table_* keys', () => {
    const updates = mapLocalTableToTemplateUpdates({
      border_style: 'single',
      border_size_pt: '1.5',
      border_color: '#00aaFF',
      look_first_row: true,
      cell_vertical_align: 'center',
    });

    expect(updates.table_border_style).toBe('single');
    expect(updates.table_border_size_pt).toBe(1.5);
    expect(updates.table_border_color).toBe('00AAFF');
    expect(updates.table_look_first_row).toBe(true);
    expect(updates.table_cell_vertical_align).toBe('center');
  });

  it('filters payload to changed keys when provided', () => {
    const updates = mapLocalTableToTemplateUpdates(
      {
        border_style: 'single',
        border_color: 'AA0000',
        look_no_h_band: false,
      },
      ['border_color']
    );

    expect(updates).toEqual({
      table_border_color: 'AA0000',
    });
  });
});
