'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'An unexpected workspace error occurred.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string };
      if (parsed && typeof parsed.error === 'string') {
        readable = parsed.error.includes('Missing or insufficient permissions')
          ? 'Your account does not have permission to access this cloud resource. Sign in with an authorized Google account and try again.'
          : parsed.error;
      }
    } catch {
      // Non-JSON error message; display cleanly as-is.
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error): void {
    console.error('[Nexus HRM ErrorBoundary]', error);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FAFAFB] dark:bg-[#0B0F17] p-6">
          <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                  Something went wrong
                </h2>
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {this.state.message}
                </p>
                <div className="mt-4 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={this.handleReset}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Return to Workspace</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
