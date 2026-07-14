import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Rendered instead of the children once a render below has thrown. */
  readonly fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

/**
 * Last line of defence around the grid. A bug in one panel must not leave a white screen:
 * the toolbar, the banner and the transport stay usable, and picking another program
 * remounts the boundary through its `key`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Panel render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error === undefined ? this.props.children : this.props.fallback(error);
  }
}
