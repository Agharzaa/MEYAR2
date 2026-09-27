import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { NativeDocument } from './NativeWindows';
import type { WindowContext } from '../shared/windows';
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
function Application() {
  const [context, setContext] = useState<WindowContext | null>(null),
    [error, setError] = useState('');
  const native = window.meyar?.windows;
  useEffect(() => {
    if (native)
      void native
        .context()
        .then(setContext)
        .catch((e) => setError(e.message));
  }, []);
  if (native && !context) return <div className="startup">{error || 'Pəncərə açılır…'}</div>;
  return context?.form ? (
    <NativeDocument context={context} />
  ) : (
    <App nativeContext={context ?? undefined} />
  );
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Application />
  </ErrorBoundary>,
);
