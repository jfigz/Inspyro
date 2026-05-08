import React from 'react';
import { IconEye, IconRefresh, IconTable } from '../Icons';

const TableDirectFormatPanel = ({
  documentTables,
  selectedDirectTable,
  tablePreviewImages,
  loadingTablePreviews,
  loadingAllTablePreviews,
  selectedStyle,
  onSelectTable,
  onApplyTableFormat,
  onUseSourceStyleAsDefault,
  onOpenPreview,
  onRetryPreview,
}) => {
  return (
    <div className="direct-tables-panel">
      <div className="direct-tables-panel-header">
        <IconTable />
        <h3>Tablas de muestra</h3>
      </div>
      <p className="direct-tables-desc">
        Selecciona una tabla para copiar su visual o usar su estilo Word como tabla por defecto.
      </p>

      {loadingAllTablePreviews && (
        <div className="loading-all-previews">
          <span className="spinner" aria-hidden="true"></span> Cargando previsualizaciones...
        </div>
      )}

      <div className="direct-tables-grid">
        {documentTables.map((table, idx) => {
          const sourceStyleName = table.source_style_display_name || table.style_display_name || table.style_name;
          const hasSourceStyle = Boolean(table.source_style_selection_key && sourceStyleName);
          const hasDirectFormat = Boolean(table.has_direct_table_format);
          const applyLabel = hasDirectFormat ? 'Aplicar formato directo' : 'Copiar visual';
          return (
            <div
              key={idx}
              className={`direct-table-card ${selectedDirectTable === idx ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectTable?.(idx)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectTable?.(idx);
                }
              }}
            >
              <div className="direct-table-header">
                <strong>Tabla {idx + 1}</strong>
                <span className="direct-table-dims">{table.rows} × {table.cols}</span>
                {hasSourceStyle && (
                  <span className="direct-table-badge">Estilo Word</span>
                )}
                {hasDirectFormat && (
                  <span className="direct-table-badge">Formato directo</span>
                )}
                {table.has_distinct_header && (
                  <span className="direct-table-badge">Encabezado</span>
                )}
              </div>

              <div
                className="direct-table-preview-container clickable"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectTable?.(idx);
                  onOpenPreview?.(idx, tablePreviewImages[idx]);
                }}
                title={tablePreviewImages[idx] ? 'Clic para ampliar' : ''}
              >
                {loadingTablePreviews[idx] ? (
                  <div className="direct-table-loading">
                    <span className="spinner" aria-hidden="true"></span>
                  </div>
                ) : tablePreviewImages[idx] ? (
                  <>
                    <img
                      src={`data:image/png;base64,${tablePreviewImages[idx]}`}
                      alt={`Tabla ${idx + 1}`}
                      className="direct-table-preview-img"
                    />
                    <div className="zoom-hint">
                      <IconEye /> Ver más grande
                    </div>
                  </>
                ) : (
                  <div className="direct-table-no-preview">
                    <div>Vista previa no disponible</div>
                    {onRetryPreview && (
                      <button
                        type="button"
                        className="direct-table-retry-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRetryPreview(idx);
                        }}
                      >
                        <IconRefresh /> Reintentar preview
                      </button>
                    )}
                  </div>
                )}
              </div>

              {sourceStyleName && (
                <div className="direct-table-style-name">Estilo Word: {sourceStyleName}</div>
              )}

              {hasSourceStyle && (
                <button
                  className="direct-table-use-btn secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUseSourceStyleAsDefault?.(table);
                  }}
                  data-testid="template-use-source-table-style"
                >
                  <IconTable />
                  <span>Usar como tabla por defecto</span>
                </button>
              )}

              <button
                className="direct-table-use-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onApplyTableFormat?.(idx);
                }}
                data-testid="template-apply-table-format"
              >
                <IconTable />
                <span>{applyLabel} a {selectedStyle?.style?.name || selectedStyle?.display_name || selectedStyle?.name || 'estilo actual'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TableDirectFormatPanel;
