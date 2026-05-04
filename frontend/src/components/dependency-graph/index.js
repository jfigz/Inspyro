/**
 * Dependency Graph components index
 * 
 * Re-exports all components for easy importing
 */

// Constants
export { NODE_ICONS, NODE_TYPE_LABELS, CATEGORY_COLORS } from './constants';

// Utilities
export { checkValueInRange, formatRuntimeValue } from './utils';
export {
    computeHierarchicalLayout,
    computeDagreLayout,
    getAdaptiveLayoutOptions,
    LAYOUT_CONFIG,
} from './d3Layout';
export {
    getGraphComplexity,
    getLargeGraphAutoSummary,
    shouldUseLargeGraphMode,
    LARGE_GRAPH_LIMITS,
} from './graphComplexity';

// Edge System (new)
export * from './edgePorts';
export * from './edgeRouter';
export * from './edgeBundler';

// Components (pipeline D3 principal)
export { Legend, InfoPanel, TraceTable, IOSidebar } from './Panels';
export { default as SensitivityPanel } from './SensitivityPanel';
export { default as OptimizationPanel } from './OptimizationPanel';
export { default as D3DependencyGraph } from './D3DependencyGraph';
