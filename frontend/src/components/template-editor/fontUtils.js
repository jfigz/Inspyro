export const readFontName = (font = {}) => font?.name || font?.font_name || '';

export const readFontSize = (font = {}) => {
  const value = font?.size_pt ?? font?.font_size_pt;
  return value ?? '';
};

export const getEffectiveStyleFont = (style = {}) => style?.resolved_font || style?.font || {};

export const getEffectiveStyleParagraph = (style = {}) => (
  style?.resolved_paragraph_format || style?.paragraph_format || {}
);

export const TEMPLATE_FONT_SUGGESTIONS = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Bahnschrift',
  'Book Antiqua',
  'Bookman Old Style',
  'Calibri',
  'Calibri Light',
  'Cambria',
  'Candara',
  'Century',
  'Century Gothic',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Book',
  'Franklin Gothic Medium',
  'Garamond',
  'Georgia',
  'Gill Sans MT',
  'Helvetica',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

export const resolveThemeFont = (themeDetails, themeKey) => {
  if (!themeDetails || !themeKey) return '';
  const fontScheme = themeDetails?.font_scheme || {};
  const normalizedKey = String(themeKey).toLowerCase();
  const group = normalizedKey.startsWith('major')
    ? fontScheme.major || {}
    : normalizedKey.startsWith('minor')
      ? fontScheme.minor || {}
      : {};
  if (!group || typeof group !== 'object') return '';
  if (normalizedKey.includes('cs')) return group.cs || group.latin || '';
  if (normalizedKey.includes('eastasia') || normalizedKey.includes('ea')) return group.ea || group.latin || '';
  return group.latin || '';
};

export const parseRprToFont = (rPrNodes, themeDetails = null) => {
  if (!Array.isArray(rPrNodes)) return {};
  const font = {};
  rPrNodes.forEach(node => {
    if (!node?.tag) return;
    const attrs = node.attrs || {};
    switch (node.tag) {
      case 'rFonts': {
        font.font_name = attrs.ascii || attrs.hAnsi || attrs.cs || attrs.eastAsia
          || resolveThemeFont(themeDetails, attrs.asciiTheme || attrs.hAnsiTheme || attrs.csTheme || attrs.eastAsiaTheme)
          || '';
        break;
      }
      case 'sz': {
        const numeric = Number(attrs.val);
        font.font_size_pt = Number.isFinite(numeric) ? numeric / 2 : '';
        break;
      }
      case 'b':
        font.bold = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'i':
        font.italic = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'u': {
        const value = String(attrs.val || '').toLowerCase();
        if (value === 'none' || value === '0' || value === 'false') {
          font.underline = false;
          font.underline_style = '';
        } else {
          font.underline = true;
          font.underline_style = attrs.val ? attrs.val.toUpperCase() : 'SINGLE';
        }
        break;
      }
      case 'color':
        if (attrs.val && attrs.val !== 'auto') font.color_rgb = attrs.val.toUpperCase();
        break;
      case 'highlight':
        if (attrs.val) font.highlight_color = attrs.val.toUpperCase();
        break;
      case 'strike':
        font.strike = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'dstrike':
        font.double_strike = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'caps':
        font.all_caps = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'smallCaps':
        font.small_caps = attrs.val !== '0' && attrs.val !== 'false';
        break;
      case 'vertAlign':
        if (attrs.val === 'superscript') font.superscript = true;
        if (attrs.val === 'subscript') font.subscript = true;
        break;
      default:
        break;
    }
  });
  return font;
};

export const fontToRpr = (font = {}) => {
  if (!font || typeof font !== 'object') return [];

  const nodes = [];
  if (font.font_name) {
    nodes.push({
      tag: 'rFonts',
      attrs: {
        ascii: font.font_name,
        hAnsi: font.font_name,
        cs: font.font_name,
        eastAsia: font.font_name,
      },
    });
  }
  if (font.font_size_pt) {
    const szVal = String(Math.round(Number(font.font_size_pt) * 2));
    nodes.push({ tag: 'sz', attrs: { val: szVal } });
  }
  if (font.bold) nodes.push({ tag: 'b', attrs: {} });
  if (font.italic) nodes.push({ tag: 'i', attrs: {} });
  if (font.underline || font.underline_style) {
    nodes.push({ tag: 'u', attrs: { val: (font.underline_style || 'single').toLowerCase() } });
  }
  if (font.color_rgb) nodes.push({ tag: 'color', attrs: { val: String(font.color_rgb).replace('#', '').toUpperCase() } });
  if (font.highlight_color) nodes.push({ tag: 'highlight', attrs: { val: String(font.highlight_color).toLowerCase() } });
  if (font.strike) nodes.push({ tag: 'strike', attrs: {} });
  if (font.double_strike) nodes.push({ tag: 'dstrike', attrs: {} });
  if (font.all_caps) nodes.push({ tag: 'caps', attrs: {} });
  if (font.small_caps) nodes.push({ tag: 'smallCaps', attrs: {} });
  if (font.superscript) nodes.push({ tag: 'vertAlign', attrs: { val: 'superscript' } });
  if (font.subscript) nodes.push({ tag: 'vertAlign', attrs: { val: 'subscript' } });
  return nodes;
};

export const collectTemplateFontOptions = (templateDetails, extraFonts = []) => {
  const fonts = new Map();
  const addFont = (value) => {
    if (value === null || value === undefined || value === '') return;
    const normalized = String(value).trim();
    if (!normalized) return;
    const key = normalized.toLocaleLowerCase();
    if (!fonts.has(key)) {
      fonts.set(key, normalized);
    }
  };

  TEMPLATE_FONT_SUGGESTIONS.forEach(addFont);
  (extraFonts || []).forEach(addFont);
  addFont(templateDetails?.default_font?.name);
  addFont(templateDetails?.default_font?.font_name);
  if (Array.isArray(templateDetails?.font_catalog)) {
    templateDetails.font_catalog.forEach(addFont);
  }
  if (Array.isArray(templateDetails?.system_font_catalog)) {
    templateDetails.system_font_catalog.forEach(addFont);
  }

  const fontTable = templateDetails?.font_table?.fonts;
  if (Array.isArray(fontTable)) {
    fontTable.forEach((entry) => {
      addFont(entry?.name);
      addFont(entry?.alt_name);
    });
  }

  const fontScheme = templateDetails?.theme?.font_scheme || {};
  ['major', 'minor'].forEach((groupKey) => {
    const group = fontScheme[groupKey] || {};
    addFont(group.latin);
    addFont(group.ea);
      addFont(group.cs);
      const scriptFonts = group.script || {};
      Object.values(scriptFonts).forEach(addFont);
  });

  return Array.from(fonts.values()).sort((left, right) => (
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  ));
};

const normalizeFontCatalogKey = (value) => {
  const fontName = readFontName({ font_name: value });
  return fontName ? fontName.trim().toLowerCase() : '';
};

export const getFontAvailabilityInfo = (fontName, systemFontCatalog = [], templateDetails = null) => {
  const normalizedName = String(fontName || '').trim();
  if (!normalizedName) {
    return { available: null, reason: 'empty' };
  }

  const systemKey = normalizeFontCatalogKey(normalizedName);
  const hasSystemCatalog = Array.isArray(systemFontCatalog) && systemFontCatalog.length > 0;
  const systemSet = new Set(
    hasSystemCatalog
      ? systemFontCatalog.map(normalizeFontCatalogKey).filter(Boolean)
      : []
  );
  const findFallback = (catalog = null) => {
    const fonts = catalog?.font_table?.fonts;
    if (!Array.isArray(fonts)) return null;
    const entry = fonts.find((fontEntry) => (
      normalizeFontCatalogKey(fontEntry?.name) === systemKey
    ));
    const fallbackName = entry?.alt_name || entry?.altName || entry?.fallback || '';
    const normalizedFallback = normalizeFontCatalogKey(fallbackName);
    if (!normalizedFallback) return null;
    return {
      fallback_font_name: String(fallbackName).trim(),
      fallback_available: hasSystemCatalog ? systemSet.has(normalizedFallback) : null,
    };
  };

  const fallbackInfo = findFallback(templateDetails);
  if (hasSystemCatalog) {
    if (systemSet.has(systemKey)) {
      return { available: true, reason: 'system_catalog' };
    }
    return { available: false, reason: 'system_catalog', ...(fallbackInfo || {}) };
  }

  try {
    if (typeof document !== 'undefined' && document.fonts?.check) {
      const available = document.fonts.check(`12px "${normalizedName}"`);
      if (fallbackInfo?.fallback_font_name && fallbackInfo.fallback_available === null) {
        const fallbackAvailable = document.fonts.check(`12px "${fallbackInfo.fallback_font_name}"`);
        fallbackInfo.fallback_available = Boolean(fallbackAvailable);
      }
      return { available: Boolean(available), reason: 'browser_fonts_api', ...(fallbackInfo || {}) };
    }
  } catch (error) {
    // Ignore browser font API failures and fall back to catalog-only behavior.
  }

  return { available: null, reason: 'unknown', ...(fallbackInfo || {}) };
};

export const formatFontSourceLabel = (fontSource) => {
  if (!fontSource || typeof fontSource !== 'object') return '';

  const inheritedSuffix = fontSource.inherited_from ? ` vía ${fontSource.inherited_from}` : '';
  switch (fontSource.kind) {
    case 'explicit':
      return `Fuente explícita${fontSource.style_name ? ` en ${fontSource.style_name}` : ''}`;
    case 'theme':
      return `Fuente heredada del tema${fontSource.theme_key ? ` (${fontSource.theme_key})` : ''}${inheritedSuffix}`;
    default:
      if (fontSource.scope === 'docDefaults') return `Fuente heredada de docDefaults${inheritedSuffix}`;
      return fontSource.scope ? `Fuente heredada de ${fontSource.scope}${inheritedSuffix}` : '';
  }
};
