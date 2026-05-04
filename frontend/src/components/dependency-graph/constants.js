/**
 * Constantes compartidas para el grafo de dependencias
 */

// Iconos por tipo de nodo
export const NODE_ICONS = {
    variable: '📦',
    function: '⚡',
    class: '🏗️',
    import: '📥',
    parameter: '🔧',
    constant: '🔒',
    attribute: '🔗',
    check: '✅',
    unknown: '❓',
};

// Labels legibles para tipos de nodo
export const NODE_TYPE_LABELS = {
    variable: 'Variable',
    function: 'Función',
    class: 'Clase',
    import: 'Import',
    parameter: 'Parámetro',
    constant: 'Constante',
    attribute: 'Atributo',
    check: 'Verificación',
    unknown: 'Desconocido',
};

// Colores por categoría de ingeniería
export const CATEGORY_COLORS = {
    material: { bg: 'rgba(230, 126, 34, 0.2)', border: '#e67e22', icon: '🧱' },
    geometry: { bg: 'rgba(52, 152, 219, 0.2)', border: '#3498db', icon: '📏' },
    load: { bg: 'rgba(231, 76, 60, 0.2)', border: '#e74c3c', icon: '⬇️' },
    result: { bg: 'rgba(46, 204, 113, 0.2)', border: '#2ecc71', icon: '📊' },
    factor: { bg: 'rgba(155, 89, 182, 0.2)', border: '#9b59b6', icon: '⚖️' },
    input: { bg: 'rgba(241, 196, 15, 0.2)', border: '#f1c40f', icon: '📥' },
    output: { bg: 'rgba(26, 188, 156, 0.2)', border: '#1abc9c', icon: '📤' },
    check: { bg: 'rgba(39, 174, 96, 0.2)', border: '#27ae60', icon: '✔️' },
};
