/**
 * ErrorBoundary — catches React render errors and shows a friendly fallback
 * instead of a blank white screen. Offers "Try again" (re-renders children)
 * and "Go home" actions.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>

          <h1 className="mb-2 text-2xl font-bold text-gray-900">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-500">
            An unexpected error occurred. You can try again or return to the dashboard.
          </p>

          {this.state.error && (
            <details className="mb-6 text-left">
              <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600">
                Error details
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-600">
                {this.state.error.message}
              </pre>
            </details>
          )}

          <div className="flex justify-center gap-3">
            <button onClick={this.handleRetry} className="btn-secondary">
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
            <button onClick={this.handleGoHome} className="btn-primary">
              <Home className="h-4 w-4" />
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
