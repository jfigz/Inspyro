/**
 * edgeBundler.js - Sistema de Edge Bundling
 * 
 * Agrupa edges que tienen trayectorias similares para reducir
 * el desorden visual y mejorar la legibilidad del grafo.
 * 
 * Implementa un algoritmo de force-directed edge bundling simplificado.
 */

// =============================================================================
// Constantes de Bundling
// =============================================================================

export const BUNDLING_CONFIG = {
    // Fuerza de atracción entre edges cercanos (0-1)
    ATTRACTION_STRENGTH: 0.6,

    // Distancia máxima para considerar edges como agrupables
    CLUSTER_THRESHOLD: 100,

    // Número de puntos de subdivisión para bundling
    SUBDIVISION_POINTS: 6,

    // Separación en los extremos (para mantener legibilidad)
    END_SEPARATION: 0.15, // 15% desde cada extremo no se agrupa

    // Radio de influencia para compatibilidad de edges
    COMPATIBILITY_RADIUS: 150,
};

// =============================================================================
// Funciones de Utilidad
// =============================================================================

/**
 * Calcula la distancia entre dos puntos
 */
function distance(p1, p2) {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/**
 * Interpola entre dos puntos
 */
function lerp(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
    };
}

/**
 * Subdivide un edge en múltiples puntos equidistantes
 */
function subdivideEdge(edge, numPoints) {
    const points = [];
    const source = edge.sourcePort || { x: edge.sourceX, y: edge.sourceY };
    const target = edge.targetPort || { x: edge.targetX, y: edge.targetY };

    for (let i = 0; i <= numPoints + 1; i++) {
        const t = i / (numPoints + 1);
        points.push(lerp(source, target, t));
    }

    return points;
}

// =============================================================================
// Compatibilidad de Edges
// =============================================================================

/**
 * Calcula la compatibilidad angular entre dos edges
 * Edges paralelos = alta compatibilidad
 */
function angleCompatibility(edge1, edge2) {
    const v1 = {
        x: (edge1.targetPort?.x || edge1.targetX) - (edge1.sourcePort?.x || edge1.sourceX),
        y: (edge1.targetPort?.y || edge1.sourceY) - (edge1.sourcePort?.y || edge1.sourceY),
    };
    const v2 = {
        x: (edge2.targetPort?.x || edge2.targetX) - (edge2.sourcePort?.x || edge2.sourceX),
        y: (edge2.targetPort?.y || edge2.targetY) - (edge2.sourcePort?.y || edge2.sourceY),
    };

    const len1 = Math.sqrt(v1.x ** 2 + v1.y ** 2);
    const len2 = Math.sqrt(v2.x ** 2 + v2.y ** 2);

    if (len1 === 0 || len2 === 0) return 0;

    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    return Math.abs(dot); // 0 = perpendicular, 1 = parallel
}

/**
 * Calcula la compatibilidad de escala (longitudes similares)
 */
function scaleCompatibility(edge1, edge2) {
    const len1 = distance(
        edge1.sourcePort || { x: edge1.sourceX, y: edge1.sourceY },
        edge1.targetPort || { x: edge1.targetX, y: edge1.targetY }
    );
    const len2 = distance(
        edge2.sourcePort || { x: edge2.sourceX, y: edge2.sourceY },
        edge2.targetPort || { x: edge2.targetX, y: edge2.targetY }
    );

    const avgLen = (len1 + len2) / 2;
    if (avgLen === 0) return 0;

    return 2 / (len1 / len2 + len2 / len1);
}

/**
 * Calcula la compatibilidad de posición (edges cercanos)
 */
function positionCompatibility(edge1, edge2) {
    const mid1 = lerp(
        edge1.sourcePort || { x: edge1.sourceX, y: edge1.sourceY },
        edge1.targetPort || { x: edge1.targetX, y: edge1.targetY },
        0.5
    );
    const mid2 = lerp(
        edge2.sourcePort || { x: edge2.sourceX, y: edge2.sourceY },
        edge2.targetPort || { x: edge2.targetX, y: edge2.targetY },
        0.5
    );

    const dist = distance(mid1, mid2);
    const avgLen = (
        distance(
            edge1.sourcePort || { x: edge1.sourceX, y: edge1.sourceY },
            edge1.targetPort || { x: edge1.targetX, y: edge1.targetY }
        ) +
        distance(
            edge2.sourcePort || { x: edge2.sourceX, y: edge2.sourceY },
            edge2.targetPort || { x: edge2.targetX, y: edge2.targetY }
        )
    ) / 2;

    return Math.max(0, 1 - dist / avgLen);
}

/**
 * Calcula la compatibilidad total entre dos edges
 */
export function edgeCompatibility(edge1, edge2) {
    const angle = angleCompatibility(edge1, edge2);
    const scale = scaleCompatibility(edge1, edge2);
    const position = positionCompatibility(edge1, edge2);

    // Producto de las compatibilidades (todas deben ser altas)
    return angle * scale * position;
}

// =============================================================================
// Clustering de Edges
// =============================================================================

/**
 * Agrupa edges por compatibilidad
 */
export function clusterEdges(edges) {
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < edges.length; i++) {
        if (assigned.has(i)) continue;

        const cluster = [i];
        assigned.add(i);

        for (let j = i + 1; j < edges.length; j++) {
            if (assigned.has(j)) continue;

            const compat = edgeCompatibility(edges[i], edges[j]);
            if (compat > 0.5) { // Umbral de compatibilidad
                cluster.push(j);
                assigned.add(j);
            }
        }

        clusters.push(cluster.map(idx => edges[idx]));
    }

    return clusters;
}

// =============================================================================
// Algoritmo de Bundling
// =============================================================================

/**
 * Aplica force-directed bundling a un cluster de edges
 */
function bundleCluster(cluster, strength) {
    if (cluster.length <= 1) {
        return cluster.map(edge => ({
            ...edge,
            bundledPoints: null,
        }));
    }

    const numPoints = BUNDLING_CONFIG.SUBDIVISION_POINTS;
    const endSep = BUNDLING_CONFIG.END_SEPARATION;

    // Subdividir todos los edges
    const subdivisions = cluster.map(edge => subdivideEdge(edge, numPoints));

    // Iterar para aplicar fuerzas de atracción
    const iterations = 3;

    for (let iter = 0; iter < iterations; iter++) {
        for (let pointIdx = 1; pointIdx <= numPoints; pointIdx++) {
            // No mover puntos cerca de los extremos
            const t = pointIdx / (numPoints + 1);
            if (t < endSep || t > 1 - endSep) continue;

            // Calcular centroide de este punto entre todos los edges
            let centroidX = 0;
            let centroidY = 0;

            subdivisions.forEach(points => {
                centroidX += points[pointIdx].x;
                centroidY += points[pointIdx].y;
            });

            centroidX /= subdivisions.length;
            centroidY /= subdivisions.length;

            // Mover cada punto hacia el centroide
            subdivisions.forEach(points => {
                const p = points[pointIdx];
                const dx = centroidX - p.x;
                const dy = centroidY - p.y;

                // Fuerza decae hacia los extremos
                const edgeFactor = 1 - Math.abs(t - 0.5) * 2;
                const effectiveStrength = strength * edgeFactor;

                p.x += dx * effectiveStrength;
                p.y += dy * effectiveStrength;
            });
        }
    }

    // Convertir subdivisiones a paths
    return cluster.map((edge, idx) => ({
        ...edge,
        bundledPoints: subdivisions[idx],
    }));
}

/**
 * Genera un path SVG suave a partir de puntos de bundling
 */
function generateBundledPath(points) {
    if (!points || points.length < 2) return null;

    // Usar Catmull-Rom spline para curva suave
    let path = `M ${points[0].x} ${points[0].y}`;

    // Convertir a bezier curves
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        // Control points para curva Catmull-Rom → Bezier
        const tension = 0.5;
        const cp1 = {
            x: p1.x + (p2.x - p0.x) * tension / 3,
            y: p1.y + (p2.y - p0.y) * tension / 3,
        };
        const cp2 = {
            x: p2.x - (p3.x - p1.x) * tension / 3,
            y: p2.y - (p3.y - p1.y) * tension / 3,
        };

        path += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p2.x} ${p2.y}`;
    }

    return path;
}

// =============================================================================
// API Principal
// =============================================================================

/**
 * Aplica edge bundling a todos los edges
 * @param {Array} edges - Edges con puertos asignados
 * @param {Object} options - Opciones de bundling
 * @returns {Array} - Edges con paths de bundling
 */
export function bundleEdges(edges, options = {}) {
    const {
        strength = BUNDLING_CONFIG.ATTRACTION_STRENGTH,
        enabled = true,
    } = options;

    if (!enabled || edges.length <= 1) {
        return edges;
    }

    // Agrupar edges por compatibilidad
    const clusters = clusterEdges(edges);

    // Aplicar bundling a cada cluster
    const bundledClusters = clusters.map(cluster => bundleCluster(cluster, strength));

    // Flatten y generar paths finales
    return bundledClusters.flat().map(edge => {
        if (edge.bundledPoints) {
            return {
                ...edge,
                path: generateBundledPath(edge.bundledPoints),
                isBundled: true,
            };
        }
        return edge;
    });
}

/**
 * Versión ligera de bundling: solo agrupa edges con el mismo target
 */
export function bundleByTarget(edges) {
    const byTarget = new Map();

    edges.forEach(edge => {
        const target = edge.target;
        if (!byTarget.has(target)) {
            byTarget.set(target, []);
        }
        byTarget.get(target).push(edge);
    });

    const result = [];

    byTarget.forEach(group => {
        if (group.length <= 1) {
            result.push(...group);
            return;
        }

        // Aplicar bundling ligero a este grupo
        const bundled = bundleCluster(group, 0.4);
        result.push(...bundled.map(edge => ({
            ...edge,
            path: edge.bundledPoints ? generateBundledPath(edge.bundledPoints) : edge.path,
            isBundled: edge.bundledPoints != null,
        })));
    });

    return result;
}

const edgeBundler = {
    edgeCompatibility,
    clusterEdges,
    bundleEdges,
    bundleByTarget,
    BUNDLING_CONFIG,
};

export default edgeBundler;
