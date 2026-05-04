import { isMarkdownCell } from '../../utils/notebookCellTypes';

const MARKDOWN_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const MARKDOWN_HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/;

export function normalizeNotebookMarkdownSource(source) {
  if (Array.isArray(source)) {
    const hasExplicitBreaks = source.some((line) => (
      typeof line === 'string' && /[\r\n]/.test(line)
    ));
    const joined = hasExplicitBreaks ? source.join('') : source.join('\n');
    return joined.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  if (typeof source === 'string') {
    return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  return '';
}

export function buildNotebookIndexEntryId({ cellId, line, ordinal }) {
  const stableCellId = encodeURIComponent(String(cellId || 'cell-unknown'));
  return `notebook-index:${stableCellId}:${line}:${ordinal}`;
}

export function normalizeNotebookHeadingTitle(rawTitle) {
  return String(rawTitle || '')
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function flattenNotebookIndexItems(items = []) {
  const flatItems = [];

  const visit = (entries) => {
    entries.forEach((entry) => {
      flatItems.push(entry);
      if (Array.isArray(entry?.children) && entry.children.length > 0) {
        visit(entry.children);
      }
    });
  };

  visit(Array.isArray(items) ? items : []);
  return flatItems;
}

export function deriveNotebookIndex(cells = []) {
  const rootItems = [];
  const flatItems = [];
  const hierarchy = [];

  (Array.isArray(cells) ? cells : []).forEach((cell, cellIndex) => {
    if (!isMarkdownCell(cell)) {
      return;
    }

    const source = normalizeNotebookMarkdownSource(cell?.source);
    if (!source) {
      return;
    }

    let activeFence = null;
    let headingOrdinal = 0;

    source.split('\n').forEach((lineText, lineIndex) => {
      const fenceMatch = lineText.match(MARKDOWN_FENCE_PATTERN);
      if (fenceMatch) {
        const nextFence = fenceMatch[1];
        if (!activeFence) {
          activeFence = nextFence;
          return;
        }
        if (activeFence[0] === nextFence[0] && nextFence.length >= activeFence.length) {
          activeFence = null;
          return;
        }
      }

      if (activeFence) {
        return;
      }

      const headingMatch = lineText.match(MARKDOWN_HEADING_PATTERN);
      if (!headingMatch) {
        return;
      }

      const title = normalizeNotebookHeadingTitle(headingMatch[2]);
      if (!title) {
        return;
      }

      headingOrdinal += 1;

      const level = headingMatch[1].length;
      const line = lineIndex + 1;
      const item = {
        id: buildNotebookIndexEntryId({
          cellId: cell?.id || `cell-${cellIndex + 1}`,
          line,
          ordinal: headingOrdinal,
        }),
        title,
        level,
        depth: 0,
        line,
        ordinal: headingOrdinal,
        cellId: cell?.id || `cell-${cellIndex + 1}`,
        cellIndex,
        navigation: {
          cellId: cell?.id || `cell-${cellIndex + 1}`,
          cellIndex,
          line,
          column: 0,
        },
        children: [],
      };

      while (hierarchy.length > 0 && hierarchy[hierarchy.length - 1].level >= level) {
        hierarchy.pop();
      }

      item.depth = hierarchy.length;

      if (hierarchy.length === 0) {
        rootItems.push(item);
      } else {
        hierarchy[hierarchy.length - 1].children.push(item);
      }

      hierarchy.push(item);
      flatItems.push(item);
    });
  });

  return {
    items: rootItems,
    flatItems,
  };
}

export function resolveActiveNotebookIndexItemId(indexData, {
  activeEntryId = null,
  activeCellId = null,
  activeLine = null,
} = {}) {
  const flatItems = Array.isArray(indexData)
    ? indexData
    : (Array.isArray(indexData?.flatItems) ? indexData.flatItems : []);

  if (flatItems.length === 0) {
    return null;
  }

  if (activeEntryId && flatItems.some((item) => item.id === activeEntryId)) {
    return activeEntryId;
  }

  if (!activeCellId) {
    return null;
  }

  const sameCellItems = flatItems.filter((item) => item.cellId === activeCellId);
  if (sameCellItems.length === 0) {
    return null;
  }

  const desiredLine = Number(activeLine);
  if (!Number.isFinite(desiredLine) || desiredLine <= 0) {
    return sameCellItems[0].id;
  }

  const precedingItem = [...sameCellItems]
    .filter((item) => item.line <= desiredLine)
    .sort((left, right) => right.line - left.line)[0];

  return (precedingItem || sameCellItems[0]).id;
}
