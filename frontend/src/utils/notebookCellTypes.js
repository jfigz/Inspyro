export const NOTEBOOK_CELL_TYPE_CODE = 'code';
export const NOTEBOOK_CELL_TYPE_MARKDOWN = 'markdown';
export const NOTEBOOK_CELL_TYPE_DOCX = 'docx';

const KNOWN_NOTEBOOK_CELL_TYPES = new Set([
  NOTEBOOK_CELL_TYPE_CODE,
  NOTEBOOK_CELL_TYPE_MARKDOWN,
  NOTEBOOK_CELL_TYPE_DOCX,
]);

export const normalizeNotebookCellType = (cellType) => {
  const normalized = String(cellType || NOTEBOOK_CELL_TYPE_CODE).trim().toLowerCase();
  return KNOWN_NOTEBOOK_CELL_TYPES.has(normalized) ? normalized : NOTEBOOK_CELL_TYPE_CODE;
};

export const isCodeCell = (cell) => (
  normalizeNotebookCellType(cell?.cell_type) === NOTEBOOK_CELL_TYPE_CODE
);

export const isMarkdownCell = (cell) => (
  normalizeNotebookCellType(cell?.cell_type) === NOTEBOOK_CELL_TYPE_MARKDOWN
);

export const isDocxCell = (cell) => (
  normalizeNotebookCellType(cell?.cell_type) === NOTEBOOK_CELL_TYPE_DOCX
);

export const isPythonNotebookCell = (cell) => (
  isCodeCell(cell) || isDocxCell(cell)
);

export const isRunnableNotebookCell = (cell, { includeDocx = true } = {}) => (
  isCodeCell(cell) || (includeDocx && isDocxCell(cell))
);
