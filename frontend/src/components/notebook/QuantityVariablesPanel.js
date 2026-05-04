import React, { useEffect, useMemo, useRef, useState } from 'react';
import UnitBadge from './UnitBadge';
import { getCompatibleUnitsFromCatalog, loadUnitCatalog, normalizeUnitToken } from './unitTokens';
import { buildApiUrl } from '../../config/endpoints';
import './QuantityVariablesPanel.css';

const CATEGORY_ICONS = {
  fuerza: '⚡',
  'presion / esfuerzo': '🧱',
  longitud: '📏',
  masa: '⚖️',
  tiempo: '⏱️',
  temperatura: '🌡️',
  potencia: '🔌',
  'energia / trabajo': '🔋',
  frecuencia: '🔄',
  otra: '📐',
};

function normalizeCategory(category) {
  return String(category || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeUnit(unit) {
  return normalizeUnitToken(unit || '');
}

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function getCategoryIcon(category) {
  const normalized = normalizeCategory(category);
  return CATEGORY_ICONS[normalized] || CATEGORY_ICONS.otra;
}

function resolveSourceUnit(variable) {
  return normalizeUnit(variable?.unit_canonical || variable?.unit_display || variable?.unit || variable?.unit_full || '');
}

function getDisplayValue(variable, conversionState) {
  if (conversionState?.status === 'success' && conversionState.result) {
    return {
      magnitude: conversionState.result.converted_magnitude,
      unit: conversionState.targetUnit || conversionState.result?.canonical?.to_unit || resolveSourceUnit(variable),
      metadata: conversionState.result.metadata || variable.metadata || null,
      repr: conversionState.result.repr || null,
    };
  }
  return {
    magnitude: variable.magnitude,
    unit: resolveSourceUnit(variable),
    metadata: variable.metadata || null,
    repr: variable.repr || null,
  };
}

export default function QuantityVariablesPanel({ variables = {}, onStatusMessage }) {
  const quantityEntries = useMemo(
    () =>
      Object.entries(variables || {}).filter(([, value]) => {
        if (!value || typeof value !== 'object') return false;
        return value.type === 'Quantity' || value.is_quantity === true;
      }),
    [variables]
  );

  const [rowState, setRowState] = useState({});
  const requestedCompatibilityRef = useRef(new Set());

  const updateRowState = (name, patch) => {
    setRowState((prev) => ({
      ...prev,
      [name]: {
        ...(prev[name] || {}),
        ...patch,
      },
    }));
  };

  useEffect(() => {
    if (quantityEntries.length === 0) return;
    let cancelled = false;

    const fetchCompatibleUnits = async (name, variable) => {
      const sourceUnit = resolveSourceUnit(variable);
      if (!sourceUnit) return;
      const compatibilityKey = `${name}:${sourceUnit}`;
      if (requestedCompatibilityRef.current.has(compatibilityKey)) return;
      requestedCompatibilityRef.current.add(compatibilityKey);

      const fallbackUnits = getCompatibleUnitsFromCatalog(sourceUnit);
      updateRowState(name, {
        compatibleUnits: dedupe(fallbackUnits),
        compatibleStatus: 'loading',
      });

      try {
        const response = await fetch(buildApiUrl('/api/units/compatible'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: sourceUnit,
            output_style: 'engineering',
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || 'No se pudieron obtener unidades compatibles');
        }
        const compatibleUnits = dedupe(
          (payload.compatible_units || [])
            .map((unit) => normalizeUnit(unit))
            .filter((unit) => unit && unit !== sourceUnit)
        );
        if (!cancelled) {
          updateRowState(name, {
            compatibleUnits,
            compatibleStatus: 'ready',
            targetUnit: compatibleUnits[0] || '',
          });
        }
      } catch (error) {
        if (!cancelled) {
          updateRowState(name, {
            compatibleUnits: dedupe(fallbackUnits),
            compatibleStatus: 'fallback',
            compatibilityError: String(error?.message || error),
          });
        }
      }
    };

    (async () => {
      await loadUnitCatalog().catch(() => null);
      for (const [name, variable] of quantityEntries) {
        await fetchCompatibleUnits(name, variable);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quantityEntries]);

  const handleTargetChange = (name, value) => {
    updateRowState(name, { targetUnit: value, status: 'idle', error: null });
  };

  const handleConvert = async (name, variable) => {
    const sourceUnit = resolveSourceUnit(variable);
    const currentState = rowState[name] || {};
    const compatibleUnits = dedupe(currentState.compatibleUnits || getCompatibleUnitsFromCatalog(sourceUnit));
    const targetUnit = currentState.targetUnit || compatibleUnits[0];
    if (!targetUnit) return;

    updateRowState(name, { status: 'loading', error: null, targetUnit });

    try {
      const response = await fetch(buildApiUrl('/api/units/convert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magnitude: variable.magnitude,
          from_unit: sourceUnit,
          to_unit: targetUnit,
          options: {
            output_style: 'engineering',
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Error de conversión');
      }
      updateRowState(name, { status: 'success', result: payload, error: null, targetUnit });
      onStatusMessage?.(`Conversión ${name}: ${payload.repr}`, 'success');
    } catch (error) {
      updateRowState(name, { status: 'error', error: String(error.message || error) });
      onStatusMessage?.(`Error de conversión en ${name}`, 'error');
    }
  };

  if (quantityEntries.length === 0) {
    return (
      <div className="variables-empty-state">
        <div className="variables-empty-state__icon">∑</div>
        <p>No hay variables de tipo Quantity disponibles aún.</p>
      </div>
    );
  }

  return (
    <div className="quantity-vars">
      {quantityEntries.map(([name, variable]) => {
        const sourceUnit = resolveSourceUnit(variable);
        const category = variable.category || variable.metadata?.category || 'Otra';
        const dimension = variable.dimensionality || variable.dimension || variable.metadata?.dimension || null;
        const state = rowState[name] || {};
        const compatibleUnits = dedupe(state.compatibleUnits || getCompatibleUnitsFromCatalog(sourceUnit));
        const display = getDisplayValue(variable, state);
        const selectedUnit = state.targetUnit || compatibleUnits[0] || '';
        const canConvert = compatibleUnits.length > 0 && Boolean(selectedUnit);

        return (
          <article className="quantity-vars__card" key={name} data-testid="quantity-variable-card">
            <div className="quantity-vars__header">
              <span className="quantity-vars__name">{name}</span>
              <span className="quantity-vars__category">
                <span>{getCategoryIcon(category)}</span>
                <span>{category}</span>
              </span>
            </div>

            <div className="quantity-vars__value">
              <UnitBadge magnitude={display.magnitude} unit={display.unit} metadata={display.metadata} format="badge" />
            </div>

            {dimension && (
              <div className="quantity-vars__dimension" title={dimension}>
                {dimension}
              </div>
            )}

            <div className="quantity-vars__convert">
              <select
                value={selectedUnit}
                onChange={(event) => handleTargetChange(name, event.target.value)}
                disabled={compatibleUnits.length === 0 || state.status === 'loading'}
                data-testid="quantity-variable-target-unit"
              >
                {compatibleUnits.length === 0 ? (
                  <option value="">Sin unidades compatibles</option>
                ) : (
                  compatibleUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => handleConvert(name, variable)}
                disabled={!canConvert || state.status === 'loading'}
                data-testid="quantity-variable-convert"
              >
                {state.status === 'loading' ? 'Convirtiendo…' : 'Convertir'}
              </button>
            </div>

            {state.status === 'success' && display.repr && (
              <div className="quantity-vars__feedback quantity-vars__feedback--success">
                {display.repr}
              </div>
            )}
            {state.status === 'error' && (
              <div className="quantity-vars__feedback quantity-vars__feedback--error">
                {state.error}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
