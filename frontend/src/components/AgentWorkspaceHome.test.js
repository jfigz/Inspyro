import { fireEvent, render, screen } from '@testing-library/react';
import AgentWorkspaceHome from './AgentWorkspaceHome';

const notebookTarget = {
  path: 'C:\\CalcPyro\\P1\\examples\\structural-report-demo\\beam_report.ipynb',
  name: 'beam_report.ipynb',
};

const documentTarget = {
  id: 'docx-1',
  docxFileName: 'beam_report.docx',
};

const templateTarget = {
  name: 'Base Structural Template',
  status: 'ready',
};

const buildCallbacks = () => ({
  onOpenFile: jest.fn(),
  onOpenNotebook: jest.fn(),
  onOpenDocument: jest.fn(),
  onOpenTemplate: jest.fn(),
  onStartAgents: jest.fn(),
  onStopAgents: jest.fn(),
  onRestartAgents: jest.fn(),
  onToggleMirror: jest.fn(),
  onOpenAgentsPanel: jest.fn(),
  onGoToFileSurface: jest.fn(),
});

const buildCards = () => ({
  notebooks: {
    summary: '2 notebooks listos para retomar.',
    badge: { label: '2 inventariados', tone: 'accent' },
    primaryTarget: { kind: 'notebook', payload: notebookTarget },
    rows: [
      {
        id: 'nb-1',
        title: 'beam_report.ipynb',
        subtitle: 'Informe principal',
        meta: 'Documento listo',
        badges: [{ label: 'Activo', tone: 'accent' }],
        progress: { value: 72, max: 100, label: '72%', tone: 'accent' },
        target: { kind: 'notebook', payload: notebookTarget },
        details: [
          { label: 'Ruta', value: notebookTarget.path },
          { label: 'Ultimo DOCX', value: 'beam_report.docx' },
        ],
        actions: [
          { label: 'Abrir notebook', tone: 'primary', target: { kind: 'notebook', payload: notebookTarget } },
          { label: 'Abrir DOCX', tone: 'secondary', target: { kind: 'document', payload: documentTarget } },
        ],
      },
    ],
  },
  docx: {
    summary: 'Ultimo entregable listo para abrir.',
    badge: { label: 'DOCX + PDF', tone: 'good' },
    primaryTarget: { kind: 'document', payload: documentTarget },
    rows: [
      {
        id: 'docx-1',
        title: 'beam_report.docx',
        subtitle: 'Entrega mas reciente',
        meta: 'Abr 18, 12:05',
        badges: [{ label: 'Trazable', tone: 'accent' }],
        target: { kind: 'document', payload: documentTarget },
        details: [
          { label: 'Origen', value: notebookTarget.path },
        ],
        actions: [
          { label: 'Abrir DOCX', tone: 'primary', target: { kind: 'document', payload: documentTarget } },
        ],
      },
    ],
  },
  mcpClients: {
    summary: 'Servicio listo y un run activo.',
    badge: { label: 'En linea', tone: 'good' },
    primaryTarget: { kind: 'agents' },
    rows: [
      {
        id: 'service',
        title: 'Servicio local',
        subtitle: 'Puerto 8100',
        meta: 'Espejo activo',
        badges: [{ label: 'Ejecutando', tone: 'good' }],
        target: { kind: 'agents' },
        details: [
          { label: 'PID', value: '4420' },
          { label: 'Mirror', value: 'Activo' },
        ],
        actions: [
          { label: 'Detener agentes', tone: 'secondary', target: { kind: 'stopAgents' } },
          { label: 'Reiniciar agentes', tone: 'ghost', target: { kind: 'restartAgents' } },
          { label: 'Desactivar espejo', tone: 'ghost', target: { kind: 'toggleMirror' } },
        ],
      },
    ],
  },
  templates: {
    summary: 'Una plantilla lista para la siguiente salida.',
    badge: { label: 'Lista', tone: 'good' },
    primaryTarget: { kind: 'template', payload: templateTarget },
    rows: [
      {
        id: 'tpl-1',
        title: 'Base Structural Template',
        subtitle: 'Plantilla activa',
        meta: 'ready',
        badges: [{ label: 'Configurada', tone: 'good' }],
        target: { kind: 'template', payload: templateTarget },
        details: [
          { label: 'Estado', value: 'ready' },
        ],
        actions: [
          { label: 'Abrir plantilla', tone: 'primary', target: { kind: 'template', payload: templateTarget } },
        ],
      },
    ],
  },
});

const buildWorkspaceData = (overrides = {}) => ({
  workspaceName: 'Structural Demo',
  workspacePath: 'C:\\CalcPyro\\P1\\examples\\structural-report-demo',
  subtitle: 'Centro operativo del workspace.',
  meta: ['2 notebooks', '1 DOCX listo', 'Espejo activo'],
  headerActions: [
    { label: 'Ir a archivos', tone: 'primary', target: { kind: 'fileSurface' } },
    { label: 'Abrir agentes', tone: 'ghost', target: { kind: 'agents' } },
  ],
  operational: {
    quickActions: [
      { label: 'Ir a archivos', tone: 'primary', target: { kind: 'fileSurface' } },
      { label: 'Abrir agentes', tone: 'ghost', target: { kind: 'agents' } },
      { label: 'Abrir ultimo DOCX', tone: 'secondary', target: { kind: 'document', payload: documentTarget } },
    ],
    attention: {
      title: 'Atencion',
      summary: 'Lo que requiere seguimiento aparece primero.',
      primaryAction: { label: 'Abrir notebook', tone: 'primary', target: { kind: 'notebook', payload: notebookTarget } },
      items: [
        {
          id: 'attention-run',
          title: 'beam_report.ipynb',
          subtitle: 'Run All en curso',
          meta: '72%',
          tone: 'accent',
          badges: [{ label: 'Ejecutando', tone: 'accent' }],
          progress: { value: 72, max: 100, label: '72%', tone: 'accent' },
          target: { kind: 'notebook', payload: notebookTarget },
          details: [{ label: 'Ruta', value: notebookTarget.path }],
          actions: [{ label: 'Abrir notebook', tone: 'primary', target: { kind: 'notebook', payload: notebookTarget } }],
        },
      ],
    },
    lanes: {
      understand: {
        title: 'Entender',
        kicker: 'Notebooks y contexto',
        tone: 'accent',
        badge: { label: '2 inventariados', tone: 'accent' },
        summary: '2 notebooks inventariados.',
        primaryAction: { label: 'Abrir primer notebook', tone: 'primary', target: { kind: 'notebook', payload: notebookTarget } },
        items: buildCards().notebooks.rows,
      },
      run: {
        title: 'Ejecutar',
        kicker: 'Runtimes y agentes',
        tone: 'warn',
        badge: { label: '2 activos', tone: 'warn' },
        summary: 'Servicio MCP listo y un run activo.',
        primaryAction: { label: 'Abrir agentes', tone: 'primary', target: { kind: 'agents' } },
        items: buildCards().mcpClients.rows,
      },
      deliver: {
        title: 'Entregar',
        kicker: 'DOCX, calidad y formato',
        tone: 'good',
        badge: { label: '1 DOCX', tone: 'good' },
        summary: 'El ultimo entregable esta listo para abrir.',
        primaryAction: { label: 'Abrir ultimo DOCX', tone: 'primary', target: { kind: 'document', payload: documentTarget } },
        items: [
          ...buildCards().docx.rows,
          ...buildCards().templates.rows,
        ],
      },
    },
  },
  cards: buildCards(),
  ...overrides,
});

const buildLegacyProps = (overrides = {}) => ({
  workspaceName: 'Structural Demo',
  workspacePath: 'C:\\CalcPyro\\P1\\examples\\structural-report-demo',
  openFiles: [
    notebookTarget,
    { path: 'C:\\CalcPyro\\P1\\examples\\structural-report-demo\\beam_design.py', name: 'beam_design.py' },
  ],
  activeFile: notebookTarget,
  templateInfo: templateTarget,
  activity: [],
  activeRuns: [],
  mcpStatus: { status: 'stopped', port: 8100, uptime_seconds: 0, pid: 4420 },
  mirrorEnabled: false,
  mirrorToggleDisabled: true,
  mirrorDisabledReason: 'El espejo no esta disponible todavia.',
  agentExecutionState: null,
  docxHistoryEntries: [
    {
      id: 'docx-1',
      docxFileName: 'beam_report.docx',
      sourcePath: notebookTarget.path,
      sourceKind: 'notebook',
      docxUpdatedAt: '2026-04-18T12:05:00Z',
      docxSizeBytes: 204800,
      docxProvenanceAvailable: true,
    },
  ],
  ...buildCallbacks(),
  ...overrides,
});

describe('AgentWorkspaceHome', () => {
  it('renders the operational home with attention and three lanes', () => {
    render(<AgentWorkspaceHome workspaceData={buildWorkspaceData()} {...buildCallbacks()} />);

    expect(screen.getByLabelText('Inicio del espacio de trabajo de agentes')).toBeTruthy();
    expect(screen.getByText('Centro operativo')).toBeTruthy();
    expect(screen.getByText('Structural Demo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Atencion' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Entender' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ejecutar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Entregar' })).toBeTruthy();
    expect(screen.getByText('beam_report.docx')).toBeTruthy();
    expect(screen.getByText('Base Structural Template')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Plantillas' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ir a archivos' })).toBeTruthy();
  });

  it('navigates rows in one click and keeps details explicit', () => {
    const callbacks = buildCallbacks();
    render(<AgentWorkspaceHome workspaceData={buildWorkspaceData()} {...callbacks} />);

    fireEvent.click(screen.getAllByRole('button', { name: /beam_report\.ipynb/i })[0]);
    expect(callbacks.onOpenNotebook).toHaveBeenCalledWith(notebookTarget);

    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalle de beam_report\.ipynb/i })[0]);
    expect(screen.getByText(notebookTarget.path)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir DOCX' })[0]);
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith(documentTarget);
  });

  it('adapts card-only workspaceData into the operational layout', () => {
    const callbacks = buildCallbacks();
    render(
      <AgentWorkspaceHome
        workspaceData={{
          ...buildWorkspaceData(),
          operational: undefined,
          cards: buildCards(),
        }}
        {...callbacks}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Entender' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ejecutar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Entregar' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /beam_report\.docx/i })[0]);
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith(documentTarget);
  });

  it('keeps legacy props compatible and exposes disabled MCP actions', () => {
    const props = buildLegacyProps({
      openFiles: [],
      activeFile: null,
      templateInfo: null,
      docxHistoryEntries: [],
    });

    render(<AgentWorkspaceHome {...props} />);

    expect(screen.getByText('Centro operativo')).toBeTruthy();
    expect(screen.getAllByText('Agentes detenidos').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalle de Agentes detenidos/i })[0]);
    expect(screen.getByText('El espejo no esta disponible todavia.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Iniciar agentes' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Detener agentes' })[0].disabled).toBe(true);
  });

  it('adds DOCX quality state and review CTA to legacy workspace data', () => {
    const callbacks = buildCallbacks();
    const qualityEntry = {
      ...buildLegacyProps().docxHistoryEntries[0],
      docxQualityStatus: 'warning',
      docxQualityCounts: { warning: 3, error: 0, info: 1 },
      docxQualityScore: 76,
      docxRenderStatus: 'complete',
      docxRenderPageCount: 4,
      docxRenderCachedPages: 4,
      docxRenderRenderer: 'word',
    };

    render(
      <AgentWorkspaceHome
        {...buildLegacyProps({
          ...callbacks,
          docxHistoryEntries: [qualityEntry],
        })}
      />,
    );

    expect(screen.getAllByText('3 avisos').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Visual listo').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Preparar entrega' })[0]);
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({
      focus: 'quality',
      focusQuality: true,
    }));
  });
});
