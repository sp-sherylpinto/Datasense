import React from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-6">
          <div className="bg-surf border border-border rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-xl">
            <div className="bg-err/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-err">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-[18px] font-bold text-tx">Something went wrong</h2>
            <p className="text-[13px] text-tx2">
              The application encountered an unexpected error. This might be due to a data format issue or a temporary connection problem.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-acc w-full"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
