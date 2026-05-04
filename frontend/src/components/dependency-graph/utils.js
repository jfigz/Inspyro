/**
 * Funciones de utilidad para el grafo de dependencias
 */

/**
 * Verifica si un valor está dentro del rango válido
 * @param {number} value - Valor a verificar
 * @param {[number, number]} validRange - Rango [min, max]
 * @returns {'ok'|'warning'|'error'|null} Estado del rango
 */
export function checkValueInRange(value, validRange) {
    if (!validRange || validRange.length !== 2) return null;
    const [min, max] = validRange;
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;

    // Fuera de rango
    if ((min !== null && numValue < min) || (max !== null && numValue > max)) {
        return 'error';
    }

    // Cerca del límite (10% de margen)
    if (min !== null && max !== null) {
        const rangeSize = max - min;
        const margin = rangeSize * 0.1;
        if (numValue < min + margin || numValue > max - margin) {
            return 'warning';
        }
    }

    return 'ok';
}

/**
 * Formatea el valor de runtime para mostrarlo de forma legible
 * @param {object} runtimeValue - Objeto con tipo, valor, repr, len
 * @returns {string|null} Valor formateado
 */
export function formatRuntimeValue(runtimeValue) {
    if (!runtimeValue) return null;

    const { type, value, repr, len, magnitude, unit, unit_display, is_quantity } = runtimeValue;

    // Quantity: preservar representación completa para evitar truncado de unidades.
    if (type === 'Quantity' || is_quantity === true) {
        if (repr) return String(repr);
        const resolvedUnit = unit_display || unit;
        if (magnitude !== undefined || resolvedUnit) {
            return `${magnitude ?? ''} ${resolvedUnit ?? ''}`.trim();
        }
    }

    // Valores simples: mostrar directamente
    if (type === 'int' || type === 'float' || type === 'bool') {
        if (type === 'float' && value) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
                if (Math.abs(numVal) > 1e6 || (Math.abs(numVal) < 1e-4 && numVal !== 0)) {
                    return numVal.toExponential(4);
                }
                return numVal.toFixed(4).replace(/\.?0+$/, '');
            }
        }
        return value || repr;
    }

    // Strings: mostrar abreviado
    if (type === 'str') {
        const strVal = value || repr || '';
        if (strVal.length > 25) {
            return strVal.substring(0, 22) + '...';
        }
        return strVal;
    }

    // Listas, tuplas, sets, dicts: mostrar tipo y longitud
    if (['list', 'tuple', 'set', 'dict'].includes(type)) {
        return `${type}[${len}]`;
    }

    // None
    if (type === 'NoneType' || value === 'None') {
        return 'None';
    }

    // Otros: mostrar repr abreviado
    if (repr) {
        return repr.length > 20 ? repr.substring(0, 17) + '...' : repr;
    }

    return `<${type}>`;
}
