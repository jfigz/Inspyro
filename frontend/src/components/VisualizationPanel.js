import React, { useState } from 'react';
import DocxViewer from './DocxViewer';
import DependencyGraph from './DependencyGraph';
import { IconDocx, IconChevronRight, IconDependencies, IconVariables } from './Icons';
import QuantityVariablesPanel from './notebook/QuantityVariablesPanel';
import { createEmptyDocumentState } from '../utils/docxArtifacts';

const EMPTY_DOCUMENT_STATE = createEmptyDocumentState();
const EMPTY_DOCUMENT_ACTIONS = Object.freeze({
  onClearDocx: null,
  onRetryPdf: null,
  onStatusMessage: null,
});
const AVAILABLE_VIEWS = ['docx', 'dependencies', 'variables'];
const rememberedViewBySourceKey = new Map();

const buildVisualizationSourceKey = (documentState, dependencyProps, kernelId) => {
  const sourcePath = documentState?.sourcePath || dependencyProps?.filePath || null;
  if (typeof sourcePath === 'string' && sourcePath.trim()) {
    return `path:${sourcePath.trim().toLowerCase()}`;
  }
  if (typeof kernelId === 'string' && kernelId.trim()) {
    return `kernel:${kernelId.trim()}`;
  }
  return 'global';
};

const getRememberedView = (sourceKey) => {
  const rememberedView = rememberedViewBySourceKey.get(sourceKey);
  return AVAILABLE_VIEWS.includes(rememberedView) ? rememberedView : null;
};

const buildDependencyTargetKey = (dependencyProps) => {
  const target = dependencyProps?.dependencyTarget;
  if (!target?.symbol) {
    return null;
  }
  if (target.requestToken) {
    return String(target.requestToken);
  }
  return [
    target.symbol,
    target.mode || 'dependencies',
    target.cellId || '',
    Number.isInteger(target.line) ? target.line : '',
    Number.isInteger(target.column) ? target.column : '',
    dependencyProps?.filePath || '',
  ].join('|');
};

const resolveInitialActiveView = (requestedView, dependencyProps, rememberedView = null) => {
  const requested = requestedView?.view;
  if (AVAILABLE_VIEWS.includes(requested)) {
    return requested;
  }
  if (AVAILABLE_VIEWS.includes(rememberedView)) {
    return rememberedView;
  }
  if (dependencyProps?.dependencyTarget?.symbol) {
    return 'dependencies';
  }
  return 'docx';
};

export const __resetVisualizationPanelViewMemoryForTests = () => {
  rememberedViewBySourceKey.clear();
};

/**
 * Panel de visualización - Muestra DOCX o Grafo de Dependencias
 * Soporta dos modos: 'docx' y 'dependencies'
 */
const VisualizationPanel = ({
  documentState = null,
  documentActions = null,
  isCollapsed,
  onToggleCollapse,
  // Template props
  kernelId = null,
  sendMessage = null,
  lastMessage = null,
  templateInfo = null,
  templateBinding = null,
  onTemplateChange = null,
  onTemplateUpload = null,
  onTemplateBind = null,
  onRequestKernelStart = null, // Callback to start kernel if needed
  templateOpenRequest = null,
  onTemplateOpenHandled = null,
  // Dependency Graph props
  dependencyProps = null,  // { kernelId, notebookCells, sendMessage, lastMessage }
  templateSendMessage = null,
  templateLastMessage = null,
  onRequestDependencyAnalysis = null,
  // Variables props
  variables = {},
  requestedView = null,
  onNavigateToCode = null,
  onDocumentVisibilityChange = null,
  style = null,
  panelRef = null,
}) => {
  const effectiveDocumentState = documentState || EMPTY_DOCUMENT_STATE;
  const effectiveDocumentActions = documentActions || EMPTY_DOCUMENT_ACTIONS;
  const sourceKey = React.useMemo(
    () => buildVisualizationSourceKey(effectiveDocumentState, dependencyProps, kernelId),
    [dependencyProps, effectiveDocumentState, kernelId],
  );
  const [activeView, setActiveView] = useState(() => (
    resolveInitialActiveView(requestedView, dependencyProps, getRememberedView(sourceKey))
  ));
  const previousSourceKeyRef = React.useRef(sourceKey);

  React.useEffect(() => {
    if (previousSourceKeyRef.current === sourceKey) {
      return;
    }
    previousSourceKeyRef.current = sourceKey;
    setActiveView(resolveInitialActiveView(
      requestedView,
      dependencyProps,
      getRememberedView(sourceKey),
    ));
  }, [dependencyProps, requestedView, sourceKey]);

  React.useEffect(() => {
    rememberedViewBySourceKey.set(sourceKey, activeView);
  }, [activeView, sourceKey]);

  // Auto-switch to dependencies tab when a new dependency target is set
  const prevTargetRef = React.useRef(null);
  React.useEffect(() => {
    const currentTargetKey = buildDependencyTargetKey(dependencyProps);
    if (currentTargetKey && currentTargetKey !== prevTargetRef.current) {
      prevTargetRef.current = currentTargetKey;
      setActiveView('dependencies');
      // Si el panel está colapsado, expandirlo
      if (isCollapsed && onToggleCollapse) {
        onToggleCollapse();
      }
    } else if (!currentTargetKey) {
      prevTargetRef.current = null;
    }
  }, [dependencyProps, isCollapsed, onToggleCollapse]);

  React.useEffect(() => {
    const requested = requestedView?.view;
    if (!requested || !AVAILABLE_VIEWS.includes(requested)) {
      return;
    }
    setActiveView(requested);
    if (isCollapsed && onToggleCollapse) {
      onToggleCollapse();
    }
  }, [requestedView, isCollapsed, onToggleCollapse]);

  const isDocxViewVisible = !isCollapsed && activeView === 'docx';
  React.useEffect(() => {
    if (onDocumentVisibilityChange) {
      onDocumentVisibilityChange(isDocxViewVisible);
    }
  }, [isDocxViewVisible, onDocumentVisibilityChange]);

  const docIconStyle = { width: 20, height: 20, color: '#4a7ab8' };
  const depIconStyle = { width: 20, height: 20, color: '#27ae60' };
  const varsIconStyle = { width: 20, height: 20, color: '#64b5f6' };
  const [manualDependencySymbol, setManualDependencySymbol] = useState('');
  const manualDependencyPlaceholder = React.useMemo(() => {
    const sourcePath = dependencyProps?.filePath || effectiveDocumentState.sourcePath || '';
    const sourceKind = effectiveDocumentState.sourceKind || '';
    if (sourceKind === 'notebook' || String(sourcePath).toLowerCase().endsWith('.ipynb')) {
      return 'M_max';
    }
    if (String(sourcePath).toLowerCase().endsWith('.py')) {
      return 'main';
    }
    return 'nombre_variable';
  }, [dependencyProps?.filePath, effectiveDocumentState.sourceKind, effectiveDocumentState.sourcePath]);

  // Handler para cambiar a vista de dependencias
  const handleDependencyClick = () => {
    if (isCollapsed) {
      onToggleCollapse();
    }
    setActiveView('dependencies');
  };

  const submitManualDependencySymbol = (mode = 'dependencies') => {
    const symbol = manualDependencySymbol.trim();
    if (!symbol) {
      return;
    }
    onRequestDependencyAnalysis?.({ symbol, mode });
  };

  // Handler para cambiar a vista de documento
  const handleDocxClick = () => {
    if (isCollapsed) {
      onToggleCollapse();
    }
    setActiveView('docx');
  };

  const handleVariablesClick = () => {
    if (isCollapsed) {
      onToggleCollapse();
    }
    setActiveView('variables');
  };

  const docxView = (
    <div
      className="visualization-docx-view"
      style={{ display: activeView === 'docx' ? 'flex' : 'none', flex: 1, minHeight: 0 }}
      hidden={activeView !== 'docx'}
      aria-hidden={activeView !== 'docx'}
    >
      <DocxViewer
        docxBase64={effectiveDocumentState.docxBase64}
        docxHash={effectiveDocumentState.docxHash}
        docxDownloadUrl={effectiveDocumentState.docxDownloadUrl}
        docxFileToken={effectiveDocumentState.docxFileToken}
        docxArtifactId={effectiveDocumentState.docxArtifactId}
        docxFileName={effectiveDocumentState.docxFileName}
        docxWarnings={effectiveDocumentState.docxWarnings}
        docxError={effectiveDocumentState.docxError}
        docxSizeBytes={effectiveDocumentState.docxSizeBytes}
        docxStoreError={effectiveDocumentState.docxStoreError}
        docxProvenanceAvailable={effectiveDocumentState.docxProvenanceAvailable}
        docxProvenanceRef={effectiveDocumentState.docxProvenanceRef}
        docxUpdatedAt={effectiveDocumentState.docxUpdatedAt}
        docxHistory={effectiveDocumentState.docxHistory}
        docxWorkspacePath={effectiveDocumentState.docxWorkspacePath}
        docxWorkspaceRelpath={effectiveDocumentState.docxWorkspaceRelpath}
        docxWorkspaceWarning={effectiveDocumentState.docxWorkspaceWarning}
        docxQualityStatus={effectiveDocumentState.docxQualityStatus}
        docxQualityScore={effectiveDocumentState.docxQualityScore}
        docxQualityCounts={effectiveDocumentState.docxQualityCounts}
        sourcePath={effectiveDocumentState.sourcePath}
        sourceKind={effectiveDocumentState.sourceKind}
        pdfBase64={effectiveDocumentState.pdfBase64}
        pdfRefUrl={effectiveDocumentState.pdfRefUrl}
        pdfHash={effectiveDocumentState.pdfHash}
        pdfConversionError={effectiveDocumentState.pdfConversionError}
        pdfAttempted={effectiveDocumentState.pdfAttempted}
        pdfConversionStdout={effectiveDocumentState.pdfConversionStdout}
        pdfConversionStderr={effectiveDocumentState.pdfConversionStderr}
        pdfConversionMs={effectiveDocumentState.pdfConversionMs}
        conversionStatus={effectiveDocumentState.conversionStatus}
        documentPipelineStatus={effectiveDocumentState.documentPipelineStatus}
        pdfServiceStatus={effectiveDocumentState.pdfServiceStatus}
        converterUsed={effectiveDocumentState.converterUsed}
        wordError={effectiveDocumentState.wordError}
        onClearDocx={effectiveDocumentActions.onClearDocx}
        onRetryPdf={effectiveDocumentActions.onRetryPdf}
        onStatusMessage={effectiveDocumentActions.onStatusMessage}
        kernelId={kernelId}
        sendMessage={sendMessage}
        lastMessage={lastMessage}
        templateSendMessage={templateSendMessage}
        templateLastMessage={templateLastMessage}
        templateInfo={templateInfo}
        templateBinding={templateBinding}
        onTemplateChange={onTemplateChange}
        onTemplateUpload={onTemplateUpload}
        onTemplateBind={onTemplateBind}
        onRequestKernelStart={onRequestKernelStart}
        templateOpenRequest={templateOpenRequest}
        onTemplateOpenHandled={onTemplateOpenHandled}
        qualityOpenRequest={requestedView?.view === 'docx' && requestedView?.focus === 'quality' ? requestedView : null}
        onNavigateToCode={onNavigateToCode}
        isVisible={isDocxViewVisible}
      />
    </div>
  );

  if (isCollapsed) {
    return (
      <div ref={panelRef} className="visualization-panel collapsed" style={style || undefined}>
        <button
          className={`collapse-toggle ${activeView === 'docx' ? 'active' : ''}`}
          onClick={handleDocxClick}
          title="Ver documento"
          data-testid="visualization-view-docx-collapsed"
        >
          <IconDocx style={docIconStyle} />
        </button>
        <button
          className={`collapse-toggle ${activeView === 'dependencies' ? 'active' : ''}`}
          onClick={handleDependencyClick}
          title="Ver grafo de dependencias"
          style={{ marginTop: '8px' }}
          data-testid="visualization-view-dependencies-collapsed"
        >
          <IconDependencies style={depIconStyle} />
        </button>
        <button
          className={`collapse-toggle ${activeView === 'variables' ? 'active' : ''}`}
          onClick={handleVariablesClick}
          title="Ver variables"
          style={{ marginTop: '8px' }}
          data-testid="visualization-view-variables-collapsed"
        >
          <IconVariables style={varsIconStyle} />
        </button>
        <div style={{ display: 'none' }} aria-hidden="true">
          {docxView}
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="visualization-panel visualization-panel-shell" style={style || undefined}>
      <div className="panel-header">
        <button
          onClick={onToggleCollapse}
          title="Colapsar panel"
          className="collapse-toggle-btn"
        >
          <IconChevronRight style={{ width: 14, height: 14 }} />
        </button>

        {/* Toggle buttons for views */}
        <div className="panel-view-toggle">
          <button
            className={`view-toggle-btn ${activeView === 'docx' ? 'active' : ''}`}
            onClick={() => setActiveView('docx')}
            title="Documento"
            data-testid="visualization-view-docx"
          >
            <IconDocx style={{ width: 16, height: 16 }} />
            <span>DOCUMENTO</span>
          </button>
          <button
            className={`view-toggle-btn ${activeView === 'dependencies' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('dependencies');
            }}
            title="Dependencias"
            data-testid="visualization-view-dependencies"
          >
            <IconDependencies style={{ width: 16, height: 16 }} />
            <span>DEPENDENCIAS</span>
          </button>
          <button
            className={`view-toggle-btn ${activeView === 'variables' ? 'active' : ''}`}
            onClick={() => setActiveView('variables')}
            title="Variables"
            data-testid="visualization-view-variables"
          >
            <IconVariables style={{ width: 16, height: 16 }} />
            <span>VARIABLES</span>
          </button>
        </div>
      </div>

      <div className="tab-content visualization-tab-content scroll-surface">
        {docxView}
        {activeView === 'dependencies' ? (
          <div className="dependency-view-container visualization-dependency-view">
            {dependencyProps?.dependencyTarget ? (
              <DependencyGraph
                symbol={dependencyProps.dependencyTarget.symbol}
                sourceCode={dependencyProps.dependencyTarget.sourceCode}
                line={dependencyProps.dependencyTarget.line}
                column={dependencyProps.dependencyTarget.column}
                notebookContext={dependencyProps.dependencyTarget.notebookContext}
                contextCellIds={dependencyProps.dependencyTarget.contextCellIds}
                cellId={dependencyProps.dependencyTarget.cellId}
                filePath={dependencyProps.filePath}
                kernelId={dependencyProps.kernelId}
                mode={dependencyProps.dependencyTarget.mode || 'dependencies'}
                sendMessage={dependencyProps.sendMessage}
                lastMessage={dependencyProps.lastMessage}
                layout="embedded"
                onClose={() => {
                  if (dependencyProps.onCloseDependency) {
                    dependencyProps.onCloseDependency();
                  }
                }}
                onNavigateToCode={dependencyProps.onNavigateToCode}
              />
            ) : (
              <div
                className="dependency-empty-state"
                title="Selecciona un simbolo en el editor con clic derecho o Ctrl+Shift+D."
              >
                <div className="dependency-empty-state-icon" aria-hidden="true">
                  <IconDependencies style={{ width: 28, height: 28 }} />
                </div>
                <p className="dependency-empty-title">Sin grafo activo</p>
                <form
                  className="dependency-manual-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitManualDependencySymbol('dependencies');
                  }}
                >
                  <label htmlFor="dependency-manual-symbol">Analizar simbolo</label>
                  <div className="dependency-manual-controls">
                    <input
                      id="dependency-manual-symbol"
                      type="text"
                      value={manualDependencySymbol}
                      onChange={(event) => setManualDependencySymbol(event.target.value)}
                      placeholder={manualDependencyPlaceholder}
                      title="Escribe un simbolo, atributo o variable del notebook"
                    />
                    <button type="submit" title="Analizar dependencias del simbolo">
                      Dependencias
                    </button>
                    <button type="button" title="Analizar impacto del simbolo" onClick={() => submitManualDependencySymbol('impact')}>
                      Impacto
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        ) : activeView === 'variables' ? (
          <div className="variables-view-container visualization-variables-view scroll-surface">
            <QuantityVariablesPanel
              variables={variables}
              onStatusMessage={effectiveDocumentActions.onStatusMessage}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default VisualizationPanel;
