import React, { useEffect, useMemo, useState } from 'react';
import App from '../App';
import ScrollSurfaceManager from '../components/ScrollSurfaceManager';
import { reportRendererPhase, serializeRendererError } from './rendererDesktopBridge';

const screenStyles = {
  root: {
    minHeight: '100vh',
    height: '100dvh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    background: '#0d1117',
    color: '#e6edf3',
    fontFamily: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif",
  },
  card: {
    width: 'min(680px, 100%)',
    padding: '28px',
    borderRadius: '20px',
    border: '1px solid rgba(248, 81, 73, 0.22)',
    background: 'rgba(22, 27, 34, 0.96)',
    boxShadow: '0 22px 52px rgba(0, 0, 0, 0.42)',
  },
  eyebrow: {
    margin: '0 0 10px',
    color: '#f85149',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    margin: '0 0 10px',
    fontSize: '28px',
    lineHeight: 1.15,
  },
  message: {
    margin: '0 0 18px',
    color: '#8b949e',
    fontSize: '15px',
    lineHeight: 1.55,
  },
  summary: {
    margin: '0 0 18px',
    padding: '14px 16px',
    borderRadius: '12px',
    background: 'rgba(248, 81, 73, 0.12)',
    border: '1px solid rgba(248, 81, 73, 0.18)',
  },
  summaryLabel: {
    display: 'block',
    marginBottom: '6px',
    color: '#f85149',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '18px',
  },
  button: {
    border: 'none',
    borderRadius: '10px',
    padding: '10px 14px',
    background: '#1f6feb',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  },
  secondaryButton: {
    background: '#30363d',
    color: '#e6edf3',
  },
  copyState: {
    margin: '0 0 12px',
    color: '#8b949e',
    fontSize: '13px',
  },
  diagnostic: {
    margin: 0,
    padding: '16px',
    borderRadius: '12px',
    background: '#11161d',
    color: '#c9d1d9',
    fontFamily: "'Source Code Pro', monospace",
    fontSize: '12px',
    lineHeight: 1.55,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

const RootReadySignal = () => {
  useEffect(() => {
    reportRendererPhase('renderer_app_ready', {
      phase: 'renderer_app_ready',
    });
  }, []);

  return null;
};

const RootFatalScreen = ({ diagnostic, onRetry }) => {
  const [copyState, setCopyState] = useState('');
  const diagnosticText = useMemo(
    () => JSON.stringify(diagnostic || {}, null, 2),
    [diagnostic],
  );

  const handleCopyDiagnostic = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnosticText);
        setCopyState('Diagnostico copiado.');
        return;
      }
      setCopyState('Clipboard no disponible en este entorno.');
    } catch {
      setCopyState('No se pudo copiar el diagnostico.');
    }
  };

  return (
    <div style={screenStyles.root} data-testid="renderer-fatal-screen">
      <section style={screenStyles.card}>
        <p style={screenStyles.eyebrow}>Renderer startup failure</p>
        <h1 style={screenStyles.title}>Inspyro no pudo iniciar la interfaz</h1>
        <p style={screenStyles.message}>
          El bundle del renderer cargo, pero React no logro montar el shell principal.
          Esta pantalla reemplaza la ventana negra y deja diagnostico visible para recuperacion.
        </p>

        <div style={screenStyles.summary}>
          <span style={screenStyles.summaryLabel}>Resumen</span>
          <strong>{diagnostic?.message || 'Error desconocido en el renderer.'}</strong>
        </div>

        <div style={screenStyles.buttonRow}>
          <button type="button" onClick={onRetry} style={screenStyles.button}>
            Reintentar renderer
          </button>
          <button
            type="button"
            onClick={() => window.inspyroDesktop?.reloadRenderer?.() || window.location.reload()}
            style={{ ...screenStyles.button, ...screenStyles.secondaryButton }}
          >
            Reiniciar shell
          </button>
          <button
            type="button"
            onClick={() => window.inspyroDesktop?.openDevTools?.()}
            style={{ ...screenStyles.button, ...screenStyles.secondaryButton }}
          >
            Abrir DevTools
          </button>
          <button
            type="button"
            onClick={handleCopyDiagnostic}
            style={{ ...screenStyles.button, ...screenStyles.secondaryButton }}
          >
            Copiar diagnostico
          </button>
        </div>

        {copyState ? (
          <p style={screenStyles.copyState}>{copyState}</p>
        ) : null}

        <pre style={screenStyles.diagnostic}>{diagnosticText}</pre>
      </section>
    </div>
  );
};

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      diagnostic: null,
      retryNonce: 0,
    };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const diagnostic = serializeRendererError(error, {
      phase: 'renderer_app_failed',
      componentStack: errorInfo?.componentStack || null,
    });

    reportRendererPhase('renderer_app_failed', diagnostic);
    this.setState({ diagnostic });
  }

  handleRetry = () => {
    this.setState((previous) => ({
      hasError: false,
      diagnostic: null,
      retryNonce: previous.retryNonce + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <RootFatalScreen
          diagnostic={this.state.diagnostic}
          onRetry={this.handleRetry}
        />
      );
    }

    return (
      <React.Fragment key={this.state.retryNonce}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export const RendererRoot = ({
  AppComponent = App,
  ScrollManagerComponent = ScrollSurfaceManager,
}) => (
  <RootErrorBoundary>
    <AppComponent />
    {ScrollManagerComponent ? <ScrollManagerComponent /> : null}
    <RootReadySignal />
  </RootErrorBoundary>
);

export default RendererRoot;
