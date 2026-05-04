import { normalizeNotebookCellType } from './notebookCellTypes';

const normalizeNotebookCellSource = (source) => {
  if (Array.isArray(source)) {
    return source;
  }
  if (typeof source === 'string') {
    return source.split(/\r?\n/);
  }
  return [''];
};

const normalizeCellMetadata = (metadata) => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {}
);

const hashStableString = (value) => {
  const source = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildStableFallbackCellId = (cellType, source, occurrence) => {
  const signature = `${cellType}|${Array.isArray(source) ? source.join('\n') : ''}|${occurrence}`;
  return `cell_${hashStableString(signature)}`;
};

const resolveNotebookCellId = (cell, occurrence = 0) => {
  if (typeof cell?.id === 'string' && cell.id.trim()) {
    return cell.id.trim();
  }
  const metadataCellId = cell?.metadata?.inspyro_id;
  if (typeof metadataCellId === 'string' && metadataCellId.trim()) {
    return metadataCellId.trim();
  }
  const cellType = normalizeNotebookCellType(cell?.cell_type);
  return buildStableFallbackCellId(cellType, normalizeNotebookCellSource(cell?.source), occurrence);
};

const normalizeNotebookSnapshot = (rawNotebook) => {
  if (!rawNotebook || typeof rawNotebook !== 'object') {
    return null;
  }

  const cells = Array.isArray(rawNotebook.cells) ? rawNotebook.cells : [];
  const fallbackCellOccurrences = new Map();

  return {
    ...rawNotebook,
    cells: cells.map((cell = {}) => {
      const source = normalizeNotebookCellSource(cell?.source);
      const resolvedCellType = normalizeNotebookCellType(cell?.cell_type);
      const fallbackSignature = `${resolvedCellType}|${source.join('\n')}`;
      const occurrence = fallbackCellOccurrences.get(fallbackSignature) || 0;
      fallbackCellOccurrences.set(fallbackSignature, occurrence + 1);

      const id = resolveNotebookCellId({
        ...cell,
        source,
        cell_type: resolvedCellType,
      }, occurrence);
      const metadata = normalizeCellMetadata(cell?.metadata);

      return {
        ...cell,
        id,
        cell_type: resolvedCellType,
        source,
        outputs: Array.isArray(cell?.outputs) ? cell.outputs : [],
        execution_count: typeof cell?.execution_count === 'number'
          ? cell.execution_count
          : (cell?.execution_count ?? null),
        metadata: metadata.inspyro_id === id
          ? metadata
          : { ...metadata, inspyro_id: metadata.inspyro_id || id },
      };
    }),
    metadata: rawNotebook.metadata || {},
    nbformat: rawNotebook.nbformat || 4,
    nbformat_minor: rawNotebook.nbformat_minor || 5,
  };
};

export {
  buildStableFallbackCellId,
  normalizeNotebookCellSource,
  normalizeNotebookSnapshot,
  resolveNotebookCellId,
};
