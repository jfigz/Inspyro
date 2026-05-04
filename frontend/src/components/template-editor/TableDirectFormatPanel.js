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
  onOpenPreview,
  onRetryPreview,
}) => {
  return (
    <div className="direct-tables-panel">
      <div className="direct-tables-panel-header">
        <IconTable />
        <h3>Tablas con Formato Directo</h3>
      </div>
      <p className="direct-tables-desc">
        Estas tablas tienen <strong>formato directo</strong> en el documento.
        Selecciona una tabla para revisarla y usa "Aplicar estilo" para copiar el formato al estilo actual.
      </p>

      {loadingAllTablePreviews && (
        <div className="loading-all-previews">
          <span className="spinner" aria-hidden="true"></span> Cargando previsualizaciones...
        </div>
      )}

      <div className="direct-tables-grid">
        {documentTables.map((table, idx) => (
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

            {table.style_name && (
              <div className="direct-table-style-name">Estilo base: {table.style_name}</div>
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
              <span>Aplicar a {selectedStyle?.style?.name || selectedStyle?.display_name || selectedStyle?.name || 'estilo actual'}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TableDirectFormatPanel;
