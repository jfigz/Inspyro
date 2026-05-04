export const LOCAL_TABLE_TO_BACKEND_KEY = {
  border_style: 'table_border_style',
  border_size_pt: 'table_border_size_pt',
  border_color: 'table_border_color',
  shading_color: 'table_shading_color',
  alignment: 'table_alignment',
  width_type: 'table_width_type',
  width_value: 'table_width_value',
  layout_type: 'table_layout_type',
  cell_spacing_pt: 'table_cell_spacing_pt',
  cell_margin_top_pt: 'table_cell_margin_top_pt',
  cell_margin_bottom_pt: 'table_cell_margin_bottom_pt',
  cell_margin_left_pt: 'table_cell_margin_left_pt',
  cell_margin_right_pt: 'table_cell_margin_right_pt',
  look_first_row: 'table_look_first_row',
  look_last_row: 'table_look_last_row',
  look_first_column: 'table_look_first_column',
  look_last_column: 'table_look_last_column',
  look_no_h_band: 'table_look_no_h_band',
  look_no_v_band: 'table_look_no_v_band',
  cell_shading_color: 'table_cell_shading_color',
  cell_vertical_align: 'table_cell_vertical_align',
};

const HEX_COLOR_RE = /[^0-9a-fA-F]/g;

const normalizeHexColor = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).replace('#', '').replace(HEX_COLOR_RE, '').toUpperCase();
  return normalized;
};

const normalizeNumberOrPassthrough = (value) => {
  if (value === '' || value === null || value === undefined) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const normalizeForBackend = (key, value) => {
  if (key.includes('color')) return normalizeHexColor(value);
  if (key.includes('size') || key.includes('spacing') || key.includes('width_value') || key.includes('margin')) {
    return normalizeNumberOrPassthrough(value);
  }
  return value;
};

export const mapLocalTableToTemplateUpdates = (localTable = {}, changedKeys = null) => {
  if (!localTable || typeof localTable !== 'object') return {};

  const changedSet = Array.isArray(changedKeys) ? new Set(changedKeys) : null;
  const payload = {};

  Object.entries(LOCAL_TABLE_TO_BACKEND_KEY).forEach(([localKey, backendKey]) => {
    if (changedSet && !changedSet.has(localKey)) return;
    if (!Object.prototype.hasOwnProperty.call(localTable, localKey)) return;
    payload[backendKey] = normalizeForBackend(backendKey, localTable[localKey]);
  });

  return payload;
};
