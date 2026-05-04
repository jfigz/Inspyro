import React, { useEffect, useMemo, useState } from 'react';
import { ExplorerIconChevronRight } from './ExplorerIcons';
import {
  deriveNotebookIndex,
  resolveActiveNotebookIndexItemId,
} from './notebook/deriveNotebookIndex';
import './NotebookIndexPanel.css';

const EMPTY_INDEX = Object.freeze({
  items: [],
  flatItems: [],
});

const collectOutlineExpandableIds = (entries = []) => {
  const ids = new Set();
  entries.forEach((entry) => {
    if (Array.isArray(entry?.children) && entry.children.length > 0) {
      ids.add(entry.id);
      collectOutlineExpandableIds(entry.children).forEach((childId) => ids.add(childId));
    }
  });
  return ids;
};

const mergeExpandedState = (previousExpanded, nextExpandableIds) => {
  const nextExpanded = new Set();
  nextExpandableIds.forEach((id) => {
    if (!previousExpanded || previousExpanded.has(id)) {
      nextExpanded.add(id);
    }
  });
  if (
    previousExpanded
    && previousExpanded.size === nextExpanded.size
    && Array.from(nextExpanded).every((id) => previousExpanded.has(id))
  ) {
    return previousExpanded;
  }
  return nextExpanded;
};

const OutlineRow = ({
  entry,
  depth,
  expandedIds,
  onToggle,
  onNavigate,
  activeItemId,
}) => {
  const hasChildren = Array.isArray(entry?.children) && entry.children.length > 0;
  const isExpanded = hasChildren ? expandedIds.has(entry.id) : false;
  const isActive = Boolean(activeItemId) && activeItemId === entry.id;

  return (
    <div className="notebook-index-panel__node">
      <div
        className={[
          'notebook-index-panel__row',
          isActive ? 'is-active' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--notebook-index-depth': depth }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="notebook-index-panel__chevron"
            onClick={() => onToggle(entry.id)}
            aria-label={`${isExpanded ? 'Contraer' : 'Expandir'} ${entry.title}`}
            aria-expanded={isExpanded}
          >
            <ExplorerIconChevronRight className={isExpanded ? 'is-expanded' : ''} />
          </button>
        ) : (
          <span className="notebook-index-panel__chevron is-placeholder" aria-hidden="true" />
        )}
        <button
          type="button"
          className="notebook-index-panel__link"
          onClick={() => onNavigate(entry)}
          title={entry.title}
        >
          <span className="notebook-index-panel__level">H{entry.level}</span>
          <span className="notebook-index-panel__title">{entry.title}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="notebook-index-panel__children">
          {entry.children.map((child) => (
            <OutlineRow
              key={child.id}
              entry={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onNavigate={onNavigate}
              activeItemId={activeItemId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const NotebookIndexPanel = ({
  notebook = null,
  notebookPath = null,
  activeCellId = null,
  activeLine = null,
  isCollapsed = false,
  onToggleCollapse = null,
  onNavigate = null,
}) => {
  const indexData = useMemo(() => (
    notebook ? deriveNotebookIndex(notebook.cells || []) : EMPTY_INDEX
  ), [notebook]);
  const outlineEntries = indexData.items;
  const expandableIds = useMemo(() => collectOutlineExpandableIds(outlineEntries), [outlineEntries]);
  const [expandedIds, setExpandedIds] = useState(() => new Set(expandableIds));
  const activeItemId = useMemo(() => resolveActiveNotebookIndexItemId(indexData, {
    activeCellId,
    activeLine,
  }), [activeCellId, activeLine, indexData]);

  useEffect(() => {
    setExpandedIds((previous) => mergeExpandedState(previous, expandableIds));
  }, [expandableIds]);

  const handleToggleEntry = (entryId) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const handleNavigateEntry = (entry) => {
    onNavigate?.({
      filePath: notebookPath,
      cellId: entry.navigation?.cellId || entry.cellId,
      cellIndex: entry.navigation?.cellIndex ?? entry.cellIndex,
      line: entry.navigation?.line ?? null,
      column: entry.navigation?.column ?? null,
      title: entry.title,
      level: entry.level,
      entryId: entry.id,
    });
  };

  const hasOutline = outlineEntries.length > 0;

  return (
    <section
      className={[
        'notebook-index-panel',
        isCollapsed ? 'is-collapsed' : '',
      ].filter(Boolean).join(' ')}
      aria-label="Indice de Notebook"
    >
      <div className="notebook-index-panel__header">
        <div className="notebook-index-panel__title-group">
          <span className="notebook-index-panel__eyebrow">Notebook</span>
          <h2 className="notebook-index-panel__title-heading">Indice de Notebook</h2>
        </div>
        <button
          type="button"
          className="notebook-index-panel__toggle"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expandir indice de notebook' : 'Contraer indice de notebook'}
        >
          <ExplorerIconChevronRight className={isCollapsed ? '' : 'is-expanded'} />
        </button>
      </div>

      {!isCollapsed && (
        <div className="notebook-index-panel__content scroll-surface">
          {!notebookPath && (
            <div className="notebook-index-panel__empty">
              <strong>Sin notebook activo</strong>
              <p>Abre un archivo `.ipynb` para ver su estructura de titulos.</p>
            </div>
          )}

          {notebookPath && !hasOutline && (
            <div className="notebook-index-panel__empty">
              <strong>Sin encabezados</strong>
              <p>Este notebook no tiene headings markdown detectables todavia.</p>
            </div>
          )}

          {notebookPath && hasOutline && (
            <div className="notebook-index-panel__tree" role="tree" aria-label="Estructura del notebook activo">
              {outlineEntries.map((entry) => (
                <OutlineRow
                  key={entry.id}
                  entry={entry}
                  depth={0}
                  expandedIds={expandedIds}
                  onToggle={handleToggleEntry}
                  onNavigate={handleNavigateEntry}
                  activeItemId={activeItemId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default NotebookIndexPanel;
