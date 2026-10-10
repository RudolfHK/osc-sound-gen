import { Component, type ErrorInfo, type ReactNode } from 'react';
import { serializeCurrentProject } from '../store/projectState';
import { downloadBlob } from '../utils/wav';

interface State {
  error: Error | null;
  stack: string;
  copied: boolean;
}

/**
 * If the interface itself fails, show a calm screen that still lets the
 * user keep their work — instead of a blank window.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The interface crashed:', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  private report(): string {
    const { error, stack } = this.state;
    return [
      `OSC Sound Gen error report — ${new Date().toISOString()}`,
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      'Component stack:',
      stack.trim(),
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
  }

  private save = () => {
    const project = serializeCurrentProject();
    if (!project) return;
    downloadBlob(new Blob([project.text], { type: 'application/json' }), project.name);
  };

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.report());
      this.setState({ copied: true });
    } catch { /* clipboard blocked: the report is visible to select by hand */ }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    const canSave = !!serializeCurrentProject();
    return (
      <div role="alert" className="h-screen flex items-center justify-center bg-[var(--surface-0)] text-neutral-200 p-6">
        <div className="max-w-[560px] w-full border border-neutral-700 bg-neutral-900 p-6 space-y-4">
          <h1 className="text-sm tracking-widest uppercase text-red-400">Something went wrong</h1>
          <p className="text-sm text-neutral-300 leading-relaxed">
            The interface ran into an error it couldn't recover from. Your song is still in memory
            {canSave ? ' — save a copy before reloading.' : '.'} The session is also kept in this
            browser, so reloading usually brings it back.
          </p>
          <div className="flex flex-wrap gap-2">
            {canSave && (
              <button onClick={this.save} className="px-3 py-1.5 text-xs tracking-widest border border-[var(--accent)] text-[var(--accent)]">
                SAVE PROJECT
              </button>
            )}
            <button onClick={() => location.reload()} className="px-3 py-1.5 text-xs tracking-widest border border-neutral-600 text-neutral-200 hover:border-neutral-400">
              RELOAD
            </button>
            <button onClick={this.copy} className="px-3 py-1.5 text-xs tracking-widest border border-neutral-600 text-neutral-200 hover:border-neutral-400">
              {copied ? 'COPIED' : 'COPY ERROR REPORT'}
            </button>
          </div>
          <pre className="text-[11px] text-neutral-500 bg-neutral-950 border border-neutral-800 p-2 max-h-40 overflow-auto whitespace-pre-wrap select-text">
            {error.name}: {error.message}
          </pre>
        </div>
      </div>
    );
  }
}
