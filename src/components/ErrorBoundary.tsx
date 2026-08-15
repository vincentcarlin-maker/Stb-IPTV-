import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[iSTB Uncaught Application Error]:', error, errorInfo);
  }

  private handleReset = () => {
    try {
      localStorage.removeItem('istb_active_server');
    } catch {
      // ignore
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#020617] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900/90 border border-white/10 shadow-2xl backdrop-blur-2xl text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center shadow-lg shadow-amber-500/10">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Une erreur est survenue</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                L'application a rencontré un problème inattendu lors du chargement des données ou de la chaîne.
              </p>
              {this.state.error?.message && (
                <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-red-300 text-left overflow-auto max-h-24">
                  {this.state.error.message}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-xs font-semibold text-white flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Recharger</span>
              </button>
              <button
                onClick={this.handleReset}
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 active:scale-95 transition text-xs font-semibold text-slate-300 flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" />
                <span>Réinitialiser</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
