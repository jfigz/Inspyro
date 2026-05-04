import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUnitMetadata } from './unitTokens';

const TOOLTIP_OFFSET_PX = 10;
const VIEWPORT_MARGIN_PX = 8;

const FUNDAMENTAL_DIMENSIONS = {
  mass: { label: 'Masa', symbol: 'M' },
  length: { label: 'Longitud', symbol: 'L' },
  time: { label: 'Tiempo', symbol: 'T' },
  current: { label: 'Corriente', symbol: 'I' },
  temperature: { label: 'Temperatura', symbol: 'Θ' },
  substance: { label: 'Sustancia', symbol: 'N' },
  luminosity: { label: 'Intensidad luminosa', symbol: 'J' },
};

const DIMENSION_ORDER = ['mass', 'length', 'time', 'current', 'temperature', 'substance', 'luminosity'];
const SUPERSCRIPT_DIGITS = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
const SUPERSCRIPT_TO_ASCII = {
  '⁻': '-',
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

function toSuperscript(value) {
  const raw = String(value);
  return raw
    .split('')
    .map((ch) => SUPERSCRIPT_DIGITS[ch] || ch)
    .join('');
}

function superscriptToAscii(text) {
  return String(text || '')
    .split('')
    .map((ch) => SUPERSCRIPT_TO_ASCII[ch] || ch)
    .join('');
}

function normalizeExpressionForParsing(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const normalized = (typeof raw.normalize === 'function' ? raw.normalize('NFC') : raw)
    .replace(/Â°/g, '°')
    .replace(/Â²/g, '²')
    .replace(/Â³/g, '³')
    .replace(/Î©/g, 'Ω')
    .replace(/Â/g, '')
    .replace(/[∙⋅·]/g, '*')
    .replace(/\^/g, '**')
    .replace(/\s+/g, '');

  return normalized.replace(
    /([A-Za-z°Ωµ_\])])([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g,
    (_match, baseToken, superscriptRun) => `${baseToken}**${superscriptToAscii(superscriptRun)}`
  );
}

function parseDimensionMap(dimensionText) {
  const input = normalizeExpressionForParsing(dimensionText);
  if (!input) return null;
  const re = /([*/]?)(\[[a-z_]+\]|1)(?:\*\*(-?\d+))?/gi;
  const map = new Map();
  let found = false;
  let match;
  while ((match = re.exec(input)) !== null) {
    const op = match[1] || '*';
    const token = match[2];
    if (token === '1') continue;
    const key = token.replace(/^\[|\]$/g, '').toLowerCase();
    if (!key) continue;
    const exponent = Number.isFinite(Number(match[3])) ? Number(match[3]) : 1;
    const signedExponent = op === '/' ? -exponent : exponent;
    map.set(key, (map.get(key) || 0) + signedExponent);
    found = true;
  }
  if (!found) return null;
  for (const [key, value] of [...map.entries()]) {
    if (!value) map.delete(key);
  }
  return map.size ? map : null;
}

function parseUnitTokenMap(unitText) {
  const normalizedInput = normalizeExpressionForParsing(unitText);
  if (!normalizedInput) return null;
  // Avoid incorrect inference for grouped denominators (e.g. kg/(m*s**2)).
  if (/\/\(/.test(normalizedInput)) return null;
  const input = normalizedInput.replace(/[()]/g, '');

  const map = new Map();
  const re = /([*/]?)([A-Za-z°Ωµ_][A-Za-z0-9_°Ωµ]*)(?:\*\*(-?\d+))?/g;
  let found = false;
  let match;
  while ((match = re.exec(input)) !== null) {
    const op = match[1] || '*';
    const token = String(match[2] || '').trim();
    if (!token) continue;
    const exponent = Number.isFinite(Number(match[3])) ? Number(match[3]) : 1;
    const signedExponent = op === '/' ? -exponent : exponent;
    map.set(token, (map.get(token) || 0) + signedExponent);
    found = true;
  }

  if (!found) return null;
  for (const [key, value] of [...map.entries()]) {
    if (!value) map.delete(key);
  }
  return map.size ? map : null;
}

function getOrderedDimensionKeys(map) {
  const keys = [...map.keys()];
  const ordered = DIMENSION_ORDER.filter((key) => keys.includes(key));
  const custom = keys.filter((key) => !DIMENSION_ORDER.includes(key)).sort();
  return [...ordered, ...custom];
}

function formatDimensionSymbolLine(map) {
  const keys = getOrderedDimensionKeys(map);
  return keys
    .map((key) => {
      const exponent = map.get(key);
      const symbol = FUNDAMENTAL_DIMENSIONS[key]?.symbol || `[${key}]`;
      return exponent === 1 ? symbol : `${symbol}${toSuperscript(exponent)}`;
    })
    .join(' · ');
}

function formatFundamentalLine(map) {
  const keys = getOrderedDimensionKeys(map);
  return keys
    .map((key) => {
      const exponent = map.get(key);
      const label = FUNDAMENTAL_DIMENSIONS[key]?.label || key;
      return exponent === 1 ? label : `${label}${toSuperscript(exponent)}`;
    })
    .join(' · ');
}

function formatDimensionRawFactor(key, exponent) {
  return exponent === 1 ? `[${key}]` : `[${key}] ** ${exponent}`;
}

function formatRawDimension(map) {
  const keys = getOrderedDimensionKeys(map);
  const numerators = [];
  const denominators = [];

  keys.forEach((key) => {
    const exponent = map.get(key);
    if (!exponent) return;
    if (exponent > 0) {
      numerators.push(formatDimensionRawFactor(key, exponent));
    } else {
      denominators.push(formatDimensionRawFactor(key, Math.abs(exponent)));
    }
  });

  if (!numerators.length && !denominators.length) return '';
  const numeratorText = numerators.length ? numerators.join(' * ') : '1';
  if (!denominators.length) return numeratorText;
  return `${numeratorText} / ${denominators.join(' / ')}`;
}

function inferDimensionMapFromUnitText(unitText) {
  const unitMap = parseUnitTokenMap(unitText);
  if (!unitMap) return null;

  const resolved = new Map();
  for (const [token, exponent] of unitMap.entries()) {
    const metadata = getUnitMetadata(token);
    const tokenDimensionMap = parseDimensionMap(metadata?.dimension || '');
    if (!tokenDimensionMap) {
      return null;
    }
    for (const [key, baseExponent] of tokenDimensionMap.entries()) {
      const contribution = baseExponent * exponent;
      resolved.set(key, (resolved.get(key) || 0) + contribution);
    }
  }

  for (const [key, value] of [...resolved.entries()]) {
    if (!value) resolved.delete(key);
  }
  return resolved.size ? resolved : null;
}

function inferDimensionFromMetadata(metadata) {
  const candidates = [
    metadata?.canonical,
    metadata?.display,
    metadata?.symbol,
    ...(Array.isArray(metadata?.aliases) ? metadata.aliases : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const inferredMap = inferDimensionMapFromUnitText(candidate);
    if (inferredMap) {
      return {
        raw: formatRawDimension(inferredMap),
        parsed: inferredMap,
      };
    }
  }
  return null;
}

function buildDimensionPresentation(metadata) {
  const raw = String(metadata?.dimension || '').trim();
  let parsed = parseDimensionMap(raw);

  if (!parsed) {
    const inferred = inferDimensionFromMetadata(metadata);
    if (inferred) {
      parsed = inferred.parsed;
      if (!raw) {
        return {
          raw: inferred.raw,
          formatted: formatDimensionSymbolLine(inferred.parsed),
          fundamentals: formatFundamentalLine(inferred.parsed),
        };
      }
    }
  }

  if (!raw && !parsed) return null;
  if (!parsed) {
    return { raw, formatted: raw, fundamentals: null };
  }
  return {
    raw: raw || formatRawDimension(parsed),
    formatted: formatDimensionSymbolLine(parsed),
    fundamentals: formatFundamentalLine(parsed),
  };
}

export default function UnitTooltip({ metadata, anchorRect }) {
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState(null);
  const dimensionInfo = useMemo(() => buildDimensionPresentation(metadata), [metadata]);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !anchorRect || typeof window === 'undefined') return;

    const width = node.offsetWidth || 260;
    const height = node.offsetHeight || 96;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorRect.left + anchorRect.width / 2 - width / 2;
    left = Math.max(VIEWPORT_MARGIN_PX, Math.min(left, viewportWidth - width - VIEWPORT_MARGIN_PX));

    let top = anchorRect.top - height - TOOLTIP_OFFSET_PX;
    let placement = 'top';

    if (top < VIEWPORT_MARGIN_PX) {
      top = anchorRect.bottom + TOOLTIP_OFFSET_PX;
      placement = 'bottom';
    }

    if (top + height > viewportHeight - VIEWPORT_MARGIN_PX) {
      top = Math.max(VIEWPORT_MARGIN_PX, viewportHeight - height - VIEWPORT_MARGIN_PX);
    }

    setPosition({ top, left, placement });
  }, [anchorRect, dimensionInfo?.formatted, dimensionInfo?.fundamentals]);

  if (!metadata || !anchorRect) return null;

  const tooltipNode = (
    <span
      ref={tooltipRef}
      className={`unit-tooltip unit-tooltip--${position?.placement || 'top'}`}
      role="tooltip"
      style={position ? { top: `${position.top}px`, left: `${position.left}px` } : undefined}
    >
      {metadata.category && <span className="unit-tooltip__category">{metadata.category}</span>}
      {metadata.symbol && <span className="unit-tooltip__name">{metadata.symbol}</span>}
      {metadata.description && <span className="unit-tooltip__description">{metadata.description}</span>}
      {metadata.equivalent && <span className="unit-tooltip__equivalent">{metadata.equivalent}</span>}
      {dimensionInfo?.formatted && (
        <span className="unit-tooltip__dimension" title={dimensionInfo.raw}>
          Dimensión: {dimensionInfo.formatted}
        </span>
      )}
      {dimensionInfo?.fundamentals && (
        <span className="unit-tooltip__fundamentals">
          Fundamentales: {dimensionInfo.fundamentals}
        </span>
      )}
    </span>
  );

  if (typeof document === 'undefined') return tooltipNode;
  return createPortal(tooltipNode, document.body);
}
