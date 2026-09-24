import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not emit financial content to external telemetry. */
  }
  render() {
    return this.state.failed ? (
      <div className="startup">
        <h1>Pəncərə açıla bilmədi</h1>
        <p>Proqramı yenidən açın. Uçot bazası ayrıca saxlanılır.</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Yenidən aç
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
