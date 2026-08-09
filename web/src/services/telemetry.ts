export type Report =
  | {
      readonly kind: 'panel-crash';
      readonly errorName: string;
      readonly step: number;
      readonly totalSteps: number;
    }
  | {
      readonly kind: 'run-failed';
      readonly reason: string;
      readonly steps: number;
    }
  | {
      readonly kind: 'unhandled';
      readonly errorName: string;
      readonly fromPromise: boolean;
    };

export interface ProgramContext {
  readonly origin: 'example' | 'upload' | 'compiled' | 'none';
  readonly exampleId?: string;
  readonly methods?: number;
}

interface Envelope {
  readonly report: Report;
  readonly program: ProgramContext;
  readonly release: string;
  readonly userAgent: string;
}

function endpoint(): string | undefined {
  const configured: unknown = import.meta.env.VITE_TELEMETRY_URL;
  return typeof configured === 'string' && configured !== '' ? configured : undefined;
}

function send(url: string, envelope: Envelope): boolean {
  const body = JSON.stringify(envelope);
  if (typeof navigator.sendBeacon === 'function') {
    return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  }
  return false;
}

const NO_PROGRAM: ProgramContext = { origin: 'none' };

export function report(problem: Report, program: ProgramContext = NO_PROGRAM): boolean {
  const url = endpoint();
  if (url === undefined) {
    return false;
  }
  try {
    return send(url, {
      report: problem,
      program,
      release: import.meta.env.MODE,
      userAgent: navigator.userAgent,
    });
  } catch {
    return false;
  }
}

export function observeUnhandledFailures(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    report({
      kind: 'unhandled',
      errorName: event.error instanceof Error ? event.error.name : 'Error',
      fromPromise: false,
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    report({
      kind: 'unhandled',
      errorName: event.reason instanceof Error ? event.reason.name : 'Error',
      fromPromise: true,
    });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
