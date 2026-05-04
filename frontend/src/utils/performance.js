// Utilidades para optimización de rendimiento

/**
 * Debounce function para limitar la frecuencia de ejecución
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function para limitar la frecuencia de ejecución
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Lazy loading para componentes React
 */
export const withLazyLoading = (importFunc, fallback = null) => {
  const React = require('react');
  const LazyComponent = React.lazy(importFunc);
  
  return (props) => (
    <React.Suspense fallback={fallback}>
      <LazyComponent {...props} />
    </React.Suspense>
  );
};

/**
 * Memorización profunda de objetos
 */
export const deepMemo = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Verificador de cambios para evitar re-renders innecesarios
 */
export const hasChanged = (prev, current, keys = null) => {
  if (!keys) {
    return JSON.stringify(prev) !== JSON.stringify(current);
  }
  
  return keys.some(key => prev[key] !== current[key]);
};

/**
 * Limitador de tamaño de arrays para evitar problemas de memoria
 */
export const limitArraySize = (array, maxSize = 1000) => {
  if (array.length <= maxSize) return array;
  
  // Mantener los primeros y últimos elementos
  const half = Math.floor(maxSize / 2);
  return [
    ...array.slice(0, half),
    { type: 'truncated', message: `... ${array.length - maxSize} elementos omitidos ...` },
    ...array.slice(-half)
  ];
};

/**
 * Formateo eficiente de números grandes
 */
export const formatNumber = (num) => {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
};

/**
 * Validador de JSON para evitar errores de parsing
 */
export const safeJsonParse = (str, fallback = null) => {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
};

/**
 * Compresión simple de strings largos
 */
export const compressString = (str, maxLength = 1000) => {
  if (str.length <= maxLength) return str;
  
  const half = Math.floor(maxLength / 2);
  return str.slice(0, half) + 
         `\n... [${str.length - maxLength} caracteres omitidos] ...\n` + 
         str.slice(-half);
};