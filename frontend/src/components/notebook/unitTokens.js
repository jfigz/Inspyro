/**
 * Unit tokens and helpers for engineering units.
 *
 * Shared by:
 * - Output rendering (quantity styling)
 * - Monaco decoration pass (unit token highlighting)
 * - Quantity conversion panel (catalog + compatibility)
 */

import { buildApiUrl } from '../../config/endpoints';

const FALLBACK_UNIT_TOKENS = [
  // Length
  'mm', 'cm', 'm', 'km', 'in', 'inch', 'ft',
  // Mass
  'g', 'kg', 't', 'ton', 'lb',
  // Time
  's', 'min', 'minute', 'h', 'hr',
  // Force
  'N', 'kN', 'MN', 'lbf', 'kgf', 'tf', 'tonf',
  // Pressure / stress
  'Pa', 'kPa', 'MPa', 'GPa', 'bar', 'atm', 'psi',
  // Energy / work
  'J', 'kJ', 'MJ', 'cal', 'kcal', 'Wh', 'kWh',
  // Power
  'W', 'kW', 'MW', 'hp',
  // Temperature
  'K', 'degC', 'degF', '°C', '°F',
  // Angle
  'rad', 'deg', '°',
  // Electricity / frequency
  'A', 'V', 'ohm', 'Ω', 'F', 'F_', 'Hz',
  // Rotation / torque
  'rpm', 'turn/min', 'Nm', 'kNm', 'm·N', 'kN·m', 'N·m',
  // Common compounds
  'm/s', 'm/s²', 'm/s³', 'kg/m³', 'N/m²', 'kN/m²',
];

const FALLBACK_METADATA = {
  kN: { symbol: 'kN', category: 'Fuerza', description: 'Kilonewton', dimension: '[mass] * [length] / [time] ** 2' },
  N: { symbol: 'N', category: 'Fuerza', description: 'Newton', dimension: '[mass] * [length] / [time] ** 2' },
  MPa: { symbol: 'MPa', category: 'Presión / Esfuerzo', description: 'Megapascal', dimension: '[mass] / [length] / [time] ** 2' },
  kPa: { symbol: 'kPa', category: 'Presión / Esfuerzo', description: 'Kilopascal', dimension: '[mass] / [length] / [time] ** 2' },
  Pa: { symbol: 'Pa', category: 'Presión / Esfuerzo', description: 'Pascal', dimension: '[mass] / [length] / [time] ** 2' },
  kg: { symbol: 'kg', category: 'Masa', description: 'Kilogramo', dimension: '[mass]' },
  m: { symbol: 'm', category: 'Longitud', description: 'Metro', dimension: '[length]' },
  s: { symbol: 's', category: 'Tiempo', description: 'Segundo', dimension: '[time]' },
  degC: { symbol: '°C', category: 'Temperatura', description: 'Grado Celsius', dimension: '[temperature]' },
  degF: { symbol: '°F', category: 'Temperatura', description: 'Grado Fahrenheit', dimension: '[temperature]' },
  K: { symbol: 'K', category: 'Temperatura', description: 'Kelvin', dimension: '[temperature]' },
  Nm: { symbol: 'N·m', category: 'Momento / Torque', description: 'Newton-metro', dimension: '[mass] * [length] ** 2 / [time] ** 2' },
  kNm: { symbol: 'kN·m', category: 'Momento / Torque', description: 'Kilonewton-metro', dimension: '[mass] * [length] ** 2 / [time] ** 2' },
  rpm: { symbol: 'turn/min', category: 'Frecuencia', description: 'Revoluciones por minuto', dimension: '1 / [time]' },
  tf: { symbol: 'tf', category: 'Fuerza', description: 'Tonelada-fuerza métrica', dimension: '[mass] * [length] / [time] ** 2' },
  'turn/min': { symbol: 'turn/min', category: 'Frecuencia', description: 'Revoluciones por minuto', dimension: '1 / [time]' },
  Ω: { symbol: 'Ω', category: 'Electricidad', description: 'Ohmio', dimension: '[mass] * [length] ** 2 / [time] ** 3 / [current] ** 2' },
};

const FALLBACK_FAMILIES = [
  ['N', 'kN', 'MN', 'lbf', 'kgf', 'tf', 'tonf'],
  ['Pa', 'kPa', 'MPa', 'GPa', 'psi', 'bar', 'atm'],
  ['mm', 'cm', 'm', 'km', 'in', 'ft'],
  ['g', 'kg', 'lb', 't', 'ton'],
  ['s', 'min', 'h'],
  ['degC', 'degF', '°C', '°F', 'K'],
  ['W', 'kW', 'MW', 'hp'],
  ['J', 'kJ', 'MJ', 'Wh', 'kWh'],
  ['Nm', 'kNm', 'N·m', 'kN·m', 'm·N'],
  ['rpm', 'turn/min', 'Hz'],
];

export const UNIT_TOKENS = new Set(FALLBACK_UNIT_TOKENS);

const UNIT_METADATA = { ...FALLBACK_METADATA };
const UNIT_IDENTIFIER_SET = new Set(
  [...UNIT_TOKENS].filter((token) => /^[A-Za-z_]+$/.test(token))
);
const DYNAMIC_ALIAS_TO_ENTRY = new Map();
const DYNAMIC_DIMENSION_INDEX = new Map();
const REMOTE_METADATA_CACHE = new Map();
const REMOTE_METADATA_PROMISES = new Map();

let catalogPromise = null;

function normalizeSuperscripts(token) {
  return String(token || '')
    .replace(/\*\*2/g, '²')
    .replace(/\*\*3/g, '³')
    .replace(/\^2/g, '²')
    .replace(/\^3/g, '³');
}

export function normalizeUnitToken(token) {
  return normalizeSuperscripts(token)
    .replace(/\s+/g, '')
    .replace(/[∙⋅]/g, '·')
    .replace(/Ω/g, 'Ω')
    .trim();
}

function normalizeForMathToken(token) {
  return normalizeUnitToken(token).replace(/·/g, '*');
}

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function addEntryAlias(alias, entry) {
  const normalized = normalizeUnitToken(alias);
  if (!normalized) return;
  DYNAMIC_ALIAS_TO_ENTRY.set(normalized, entry);
}

function addCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return;
  const canonical = normalizeUnitToken(entry.canonical || entry.display || entry.pint_symbol || '');
  if (!canonical) return;
  const display = normalizeUnitToken(entry.display || entry.canonical || canonical);
  const metadata = {
    symbol: entry.display || entry.canonical || canonical,
    category: entry.category || 'Otra',
    description: entry.description || `Unidad de ingeniería (${entry.display || canonical})`,
    dimension: entry.dimension || '',
    canonical: entry.canonical || canonical,
    display: entry.display || display,
    pint: entry.pint || '',
    aliases: dedupe(entry.aliases || []),
  };

  UNIT_METADATA[canonical] = metadata;
  UNIT_METADATA[display] = metadata;
  UNIT_TOKENS.add(canonical);
  UNIT_TOKENS.add(display);
  UNIT_IDENTIFIER_SET.add(canonical);
  UNIT_IDENTIFIER_SET.add(display);

  const aliases = dedupe([
    canonical,
    display,
    metadata.canonical,
    metadata.display,
    ...(metadata.aliases || []),
    entry.pint_symbol,
  ]);
  aliases.forEach((alias) => {
    UNIT_TOKENS.add(normalizeUnitToken(alias));
    UNIT_IDENTIFIER_SET.add(normalizeUnitToken(alias));
    addEntryAlias(alias, metadata);
  });

  const dimension = String(metadata.dimension || '');
  if (dimension) {
    const existing = DYNAMIC_DIMENSION_INDEX.get(dimension) || [];
    const updated = [...existing.filter((item) => normalizeUnitToken(item.canonical || '') !== canonical), metadata];
    DYNAMIC_DIMENSION_INDEX.set(dimension, updated);
  }
}

function ingestCatalogPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  const entries = Array.isArray(payload.units) ? payload.units : [];
  entries.forEach(addCatalogEntry);
}

export async function loadUnitCatalog() {
  if (catalogPromise) return catalogPromise;

  if (typeof fetch !== 'function') {
    return Promise.resolve({ loaded: false, reason: 'fetch_unavailable' });
  }

  catalogPromise = fetch(buildApiUrl('/api/units/catalog'))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`catalog_http_${response.status}`);
      }
      const payload = await response.json();
      ingestCatalogPayload(payload);
      return { loaded: true };
    })
    .catch((error) => {
      console.warn('[units] catalog load failed, will retry on next call:', error);
      catalogPromise = null;  // Reset so next call retries
      return { loaded: false, reason: String(error) };
    });

  return catalogPromise;
}

function splitUnitFactors(token) {
  return token
    .split(/[/*]/)
    .map((part) => part.replace(/[()\u2070-\u2079²³^0-9+-]/g, '').trim())
    .filter(Boolean);
}

function isCompoundUnitToken(token) {
  const normalized = normalizeUnitToken(token);
  return /[/*·²³^]/.test(normalized);
}

function findCatalogMetadata(token) {
  const normalized = normalizeUnitToken(token);
  if (!normalized) return null;
  if (DYNAMIC_ALIAS_TO_ENTRY.has(normalized)) {
    return DYNAMIC_ALIAS_TO_ENTRY.get(normalized);
  }
  return null;
}

export function isUnitToken(token) {
  const normalized = normalizeUnitToken(token);
  if (!normalized) return false;
  if (UNIT_TOKENS.has(normalized)) return true;
  if (findCatalogMetadata(normalized)) return true;

  const mathLike = normalizeForMathToken(normalized);
  if (!/[/*]/.test(mathLike)) return false;
  const factors = splitUnitFactors(mathLike);
  if (!factors.length) return false;

  return factors.every(
    (factor) => UNIT_IDENTIFIER_SET.has(factor) || UNIT_TOKENS.has(factor) || Boolean(findCatalogMetadata(factor))
  );
}

export function getUnitMetadata(token) {
  const normalized = normalizeUnitToken(token);
  if (!normalized) return null;
  if (UNIT_METADATA[normalized]) return UNIT_METADATA[normalized];

  const dynamic = findCatalogMetadata(normalized);
  if (dynamic) return dynamic;

  if (!isCompoundUnitToken(normalized)) return null;

  return {
    symbol: token,
    category: 'Unidad compuesta',
    description: `Unidad compuesta: ${token}`,
    dimension: '',
    canonical: normalized,
    display: token,
    aliases: [token, normalized],
  };
}

export function getUnitDescription(token) {
  const metadata = getUnitMetadata(token);
  return metadata?.description || `Unidad de ingeniería (${token})`;
}

export function getCompatibleUnitsFromCatalog(unit) {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return [];

  const metadata = getUnitMetadata(normalized);
  const dimension = metadata?.dimension || '';
  if (dimension && DYNAMIC_DIMENSION_INDEX.has(dimension)) {
    const currentCanonical = normalizeUnitToken(metadata?.canonical || normalized);
    const values = (DYNAMIC_DIMENSION_INDEX.get(dimension) || [])
      .filter((entry) => normalizeUnitToken(entry?.canonical || '') !== currentCanonical)
      .map((entry) => normalizeUnitToken(entry?.display || entry?.canonical || ''))
      .filter(Boolean);
    return dedupe(values);
  }

  const fallbackFamily = FALLBACK_FAMILIES.find((family) =>
    family.map((item) => normalizeUnitToken(item)).includes(normalized)
  );
  if (!fallbackFamily) return [];
  return fallbackFamily
    .map((item) => normalizeUnitToken(item))
    .filter((item) => item && item !== normalized);
}

function shouldResolveFromBackend(unit, metadata) {
  const normalized = normalizeUnitToken(unit);
  if (!normalized || !isCompoundUnitToken(normalized)) return false;
  if (!metadata) return true;
  const dimension = String(metadata.dimension || '').trim();
  if (!dimension) return true;
  if (!/[/*]/.test(dimension) && isCompoundUnitToken(normalized)) return true;
  return false;
}

export function needsBackendMetadataResolution(unit, metadata = null) {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return false;
  return shouldResolveFromBackend(normalized, metadata || getUnitMetadata(normalized));
}

function registerResolvedMetadata(unit, metadata) {
  if (!metadata || typeof metadata !== 'object') return;
  const normalizedUnit = normalizeUnitToken(unit);
  if (!normalizedUnit) return;

  const aliases = dedupe([
    normalizedUnit,
    metadata.canonical,
    metadata.display,
    ...(metadata.aliases || []),
  ]);
  aliases.forEach((alias) => {
    const key = normalizeUnitToken(alias);
    if (!key) return;
    UNIT_METADATA[key] = metadata;
    addEntryAlias(alias, metadata);
    UNIT_TOKENS.add(key);
    UNIT_IDENTIFIER_SET.add(key);
  });

  const dimension = String(metadata.dimension || '');
  if (dimension) {
    const canonical = normalizeUnitToken(metadata.canonical || normalizedUnit);
    const existing = DYNAMIC_DIMENSION_INDEX.get(dimension) || [];
    const updated = [...existing.filter((item) => normalizeUnitToken(item?.canonical || '') !== canonical), metadata];
    DYNAMIC_DIMENSION_INDEX.set(dimension, updated);
  }
}

function buildMetadataFromCompatibilityPayload(unit, payload) {
  const normalizedUnit = normalizeUnitToken(unit);
  const canonical = (payload && payload.canonical) || {};
  return {
    symbol: canonical.display || canonical.canonical || normalizedUnit,
    category: canonical.category || 'Unidad compuesta',
    description: canonical.description || `Unidad compuesta: ${normalizedUnit}`,
    dimension: payload?.dimension || canonical.dimension || '',
    canonical: canonical.canonical || normalizedUnit,
    display: canonical.display || normalizedUnit,
    pint: canonical.pint || '',
    aliases: dedupe(canonical.aliases || [normalizedUnit]),
  };
}

export async function resolveUnitMetadata(unit) {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return null;

  const local = getUnitMetadata(normalized);
  if (!shouldResolveFromBackend(normalized, local)) return local;

  if (REMOTE_METADATA_CACHE.has(normalized)) {
    return REMOTE_METADATA_CACHE.get(normalized);
  }
  if (typeof fetch !== 'function') return local;

  if (!REMOTE_METADATA_PROMISES.has(normalized)) {
    const task = (async () => {
      try {
        await loadUnitCatalog().catch(() => null);
        const response = await fetch(buildApiUrl('/api/units/compatible'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: normalized,
            output_style: 'engineering',
          }),
        });
        if (!response.ok) {
          throw new Error(`unit_metadata_http_${response.status}`);
        }
        const payload = await response.json();
        const resolved = buildMetadataFromCompatibilityPayload(normalized, payload);
        registerResolvedMetadata(normalized, resolved);
        REMOTE_METADATA_CACHE.set(normalized, resolved);
        return resolved;
      } catch (error) {
        console.warn('[units] metadata resolve failed, caching fallback:', error);
        REMOTE_METADATA_CACHE.set(normalized, local);  // Cache failure to prevent re-requesting
        return local;
      } finally {
        REMOTE_METADATA_PROMISES.delete(normalized);
      }
    })();
    REMOTE_METADATA_PROMISES.set(normalized, task);
  }

  return REMOTE_METADATA_PROMISES.get(normalized);
}

function maskStringLiterals(line) {
  if (typeof line !== 'string' || !line) return '';
  // Efficient regex to match Python single and double quoted string literals,
  // including escape sequences, replacing them with spaces of the same length
  // to maintain column alignment for Monaco.
  return line.replace(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/g, (match) => ' '.repeat(match.length));
}

export function findUnitTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split(/\r?\n/);
  const matches = [];
  const seen = new Set();

  const addMatch = (lineNumber, startColumn, endColumn, unit) => {
    const key = `${lineNumber}:${startColumn}:${endColumn}:${unit}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ lineNumber, startColumn, endColumn, unit });
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // Mask strings first so '#' inside literals does not truncate valid code.
    const maskedLine = maskStringLiterals(line);
    // Then strip Python comments based on the masked line.
    const commentIdx = maskedLine.indexOf('#');
    const codePart = commentIdx >= 0 ? maskedLine.slice(0, commentIdx) : maskedLine;

    // Find all potential unit tokens, ignoring those used as function calls or left-hand assignments.
    // Avoid matching inside other words.
    const tokenPattern = /(?:^|[^A-Za-z0-9_])([A-Za-z°Ωµ_][A-Za-z0-9_°Ωµ]*)(?!\s*[=(A-Za-z0-9_])/g;
    let match;
    while ((match = tokenPattern.exec(codePart)) !== null) {
      const token = match[1];
      if (!isUnitToken(token)) continue;

      const tokenOffset = match[0].lastIndexOf(token);
      const startColumn = match.index + tokenOffset + 1;
      const endColumn = startColumn + token.length;
      addMatch(lineNumber, startColumn, endColumn, normalizeUnitToken(token));

      // Since tokenPattern can overlap due to the lookbehind-like non-capturing group, 
      // we need to slightly step back `lastIndex` if the matched token ends with an operator and next token starts immediately.
      // But standard matches won't overlap letters, so it's mostly fine.
    }

    // Q_(25, degC)
    const qPattern = /Q_\s*\(\s*[^,]+,\s*([A-Za-z°Ωµ_][A-Za-z0-9_°Ωµ]*)/g;
    let qMatch;
    while ((qMatch = qPattern.exec(codePart)) !== null) {
      const token = qMatch[1];
      if (!isUnitToken(token)) continue;
      const tokenOffset = qMatch[0].lastIndexOf(token);
      const startColumn = qMatch.index + tokenOffset + 1;
      const endColumn = startColumn + token.length;
      addMatch(lineNumber, startColumn, endColumn, normalizeUnitToken(token));
    }
  });

  return matches;
}

export function splitQuantitiesInText(text) {
  if (typeof text !== 'string' || !text) {
    return [{ type: 'text', value: text || '' }];
  }

  const chunks = [];
  let lastIndex = 0;
  // Adjusted to allow (\s*) instead of (\s+) to support formatting like 14.5kN without spaces
  const pattern = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(\s*)([A-Za-z°Ωµ_][A-Za-z0-9_°Ωµ/*^²³·\u2070-\u2079-]*)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const magnitudeRaw = match[1];
    const unitRaw = match[3] || '';
    const unitClean = unitRaw.replace(/[),.;:!?]+$/g, '');
    const trailingPunctuation = unitRaw.slice(unitClean.length);
    const normalizedUnit = normalizeUnitToken(unitClean);

    if (!isUnitToken(normalizedUnit)) continue;

    if (match.index > lastIndex) {
      chunks.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    const magnitude = Number(magnitudeRaw);
    chunks.push({
      type: 'quantity',
      magnitude: Number.isFinite(magnitude) ? magnitude : magnitudeRaw,
      unit: normalizedUnit,
      metadata: getUnitMetadata(normalizedUnit),
    });

    if (trailingPunctuation) {
      chunks.push({ type: 'text', value: trailingPunctuation });
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    chunks.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (!chunks.length) {
    return [{ type: 'text', value: text }];
  }

  return chunks;
}
