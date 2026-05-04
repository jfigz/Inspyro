import React from 'react';
import './ProjectLauncher.css';

const getWorkspaceName = (path) => {
  if (typeof path !== 'string' || !path.trim()) return 'Espacio de trabajo';
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
};

const ProjectLauncher = ({
  isLoading = false,
  isBusy = false,
  busyLabel = '',
  errorMessage = null,
  suggestedWorkspaceRoot = '',
  recentWorkspaces = [],
  onCreateProject,
  onStartWithAgent,
  onStartFromExample,
  onOpenWorkspace,
  onOpenRecentWorkspace,
}) => {
  const hasRecentWorkspaces = Array.isArray(recentWorkspaces) && recentWorkspaces.length > 0;
  const actionsDisabled = isLoading || isBusy;
  const launcherStatus = isLoading
    ? 'Leyendo la configuración del workspace...'
    : isBusy
      ? (busyLabel || 'Preparando tu workspace...')
      : 'Listo para comenzar';

  return (
    <section className="project-launcher" aria-label="Lanzador de Inspyro">
      <div className="project-launcher-hero">
        <span className="project-launcher-kicker">Espacio de ingeniería nativo para IA</span>
        <h1>Entiende el proyecto. Ejecuta cálculos. Entrega el informe.</h1>
        <p className="project-launcher-lede">
          Inspyro es un espacio de ingeniería nativo para IA orientado a cálculos,
          notebooks y generación de informes.
        </p>
        <p>
          Los agentes pueden inspeccionar un proyecto, editar notebooks, ejecutar
          cálculos y entregar informes DOCX/PDF.
        </p>

        <div className="project-launcher-promises" aria-label="Promesas centrales">
          <span className="project-launcher-promise">Entender el proyecto</span>
          <span className="project-launcher-promise">Ejecutar cálculos de ingeniería</span>
          <span className="project-launcher-promise">Entregar artefactos de informe</span>
        </div>

        <div className="project-launcher-paths">
          <button
            type="button"
            className="project-launcher-path project-launcher-path--primary"
            onClick={onStartWithAgent}
            disabled={actionsDisabled}
            data-testid="launcher-start-agent"
          >
            <span className="project-launcher-path__eyebrow">Agent-first</span>
            <strong>Comenzar con agente</strong>
            <span>
              Abre o crea un workspace, levanta el servicio local de agentes
              y comienza desde la superficie orientada a agentes.
            </span>
          </button>

          <button
            type="button"
            className="project-launcher-path"
            onClick={onStartFromExample}
            disabled={actionsDisabled}
            data-testid="launcher-start-example"
          >
            <span className="project-launcher-path__eyebrow">Demo canónica</span>
            <strong>Comenzar desde el ejemplo</strong>
            <span>
              Materializa el workspace demo del informe estructural, abre el notebook
              y explora el flujo completo de cálculos a informe.
            </span>
          </button>

          <button
            type="button"
            className="project-launcher-path"
            onClick={onOpenWorkspace}
            disabled={actionsDisabled}
            data-testid="launcher-open-project"
          >
            <span className="project-launcher-path__eyebrow">Preparación del workspace</span>
            <strong>Abrir proyecto</strong>
            <span>
              Selecciona un workspace de ingeniería existente o crea uno desde una carpeta vacía.
            </span>
          </button>
        </div>

        <div className="project-launcher-actions">
          <button
            type="button"
            className="project-launcher-btn tertiary"
            onClick={onCreateProject}
            disabled={actionsDisabled}
            data-testid="launcher-create-project"
          >
            Crear proyecto vacío
          </button>
        </div>

        <div className="project-launcher-meta">
          <div className="project-launcher-meta-card">
            <span className="label">Raíz sugerida</span>
            <strong>{suggestedWorkspaceRoot || 'Elige dónde deberían vivir los nuevos workspaces de ingeniería'}</strong>
          </div>
          <div className="project-launcher-meta-card">
            <span className="label">Estado del lanzador</span>
            <strong>{launcherStatus}</strong>
          </div>
        </div>

        {errorMessage && (
          <div className="project-launcher-error" role="alert">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="project-launcher-recents">
        <div className="project-launcher-section-head">
          <h2>Workspaces recientes</h2>
          <span>{hasRecentWorkspaces ? `${recentWorkspaces.length} workspace(s)` : 'Todavía no hay historial'}</span>
        </div>

        {hasRecentWorkspaces ? (
          <div className="project-launcher-recent-list scroll-surface">
            {recentWorkspaces.map((workspacePath) => (
              <button
                key={workspacePath}
                type="button"
                className="project-launcher-recent-item"
                onClick={() => onOpenRecentWorkspace?.(workspacePath)}
                disabled={actionsDisabled}
                data-testid="launcher-recent-workspace"
              >
                <span className="project-launcher-recent-name">{getWorkspaceName(workspacePath)}</span>
                <span className="project-launcher-recent-path">{workspacePath}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="project-launcher-empty">
            Todavía no hay workspaces recientes. Comienza desde el ejemplo canónico o abre un proyecto para empezar.
          </div>
        )}
      </div>
    </section>
  );
};

export default ProjectLauncher;
