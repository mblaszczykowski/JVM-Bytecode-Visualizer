import { Component, type ErrorInfo, type ReactNode } from 'react';

import { report, type ProgramContext } from '../../services/session/telemetry';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback: (error: Error) => ReactNode;
  readonly context?: {
    readonly program: ProgramContext;
    readonly step: number;
    readonly totalSteps: number;
  };
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Panel render failed', error, info.componentStack);

    const { context } = this.props;
    report(
      {
        kind: 'panel-crash',
        errorName: error.name,
        step: context?.step ?? -1,
        totalSteps: context?.totalSteps ?? 0,
      },
      context?.program,
    );
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error === undefined ? this.props.children : this.props.fallback(error);
  }
}
