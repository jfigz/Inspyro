import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error capturado por ErrorBoundary:', error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          background: '#2d1b1b',
          border: '1px solid #f44336',
          borderRadius: '8px',
          margin: '1rem',
          color: '#ffffff'
        }}>
          <h2 style={{ color: '#f44336', marginBottom: '1rem' }}>
            ⚠️ Ha ocurrido un error inesperado
          </h2>
          
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Error:</strong> {this.state.error && this.state.error.toString()}</p>
            {this.state.errorInfo && this.state.errorInfo.componentStack && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', color: '#cccccc' }}>
                  Ver detalles técnicos
                </summary>
                <pre style={{
                  background: '#1a1a1a',
                  padding: '1rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  marginTop: '0.5rem',
                  whiteSpace: 'pre-wrap'
                }}>
                  {this.state.error && this.state.error.stack}
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={this.handleRetry}
              style={{
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🔄 Reintentar
            </button>
            
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#007acc',
                color: 'white',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🔃 Recargar página
            </button>
          </div>

          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#3e3e42',
            borderRadius: '4px',
            fontSize: '0.9rem'
          }}>
            <p><strong>💡 Sugerencias:</strong></p>
            <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
              <li>Intenta recargar la página</li>
              <li>Verifica que el servidor backend esté funcionando</li>
              <li>Revisa la consola del desarrollador para más detalles</li>
            </ul>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;