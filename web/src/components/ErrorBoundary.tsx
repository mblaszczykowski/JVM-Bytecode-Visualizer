import { Component, type ErrorInfo, type ReactNode } from 'react';

import { report, type ProgramContext } from '../services/telemetry';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Rendered instead of the children once a render below has thrown. */
  readonly fallback: (error: Error) => ReactNode;
  /**
   * What was on screen when it broke, for the crash report. Deliberately not the program
   * itself — see `services/telemetry`, which cannot carry one.
   */
  readonly context?: {
    readonly program: ProgramContext;
    readonly step: number;
    readonly totalSteps: number;
  };
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

    // A deployed build reports it as well. The step is what makes the report actionable: a
    // run is deterministic (ADR-0001), so for a bundled example the id and the index put the
    // machine back in exactly the state that broke the panel.
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
