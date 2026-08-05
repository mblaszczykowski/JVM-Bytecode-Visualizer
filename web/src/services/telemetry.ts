/**
 * Where a failure goes after the banner has been shown.
 *
 * The banner tells the reader what happened. Nothing told anyone else, which for a deployed
 * application means a bug that a visitor hits once is a bug nobody ever hears about. This is
 * the seam that changes that, and it is deliberately small: one function, one payload type,
 * one endpoint, no dependency.
 *
 * **Two constraints shape it, and both are stated in the code rather than in a policy.**
 *
 * The first is privacy. An uploaded `.class` never leaves the tab — that is a property this
 * project claims in its README, and a crash report is exactly the sort of thing that quietly
 * breaks such a claim. So `Report` is a closed union of scalars: there is no field a class
 * file, a line of source or a constant pool string can be put in, which is a stronger
 * guarantee than remembering to redact. What travels is the shape of the failure, never its
 * contents.
 *
 * The second is that a report only has to be *actionable*, and here that costs almost
 * nothing. Runs are deterministic (ADR-0001): the same class file replays identically, every
 * time. So for a bundled example the id and the step index reproduce the exact state that
 * broke — no stack trace needed to know where to look. For an upload, the id is the reader's
 * and stays with them; the shape is what comes back.
 *
 * Off unless `VITE_TELEMETRY_URL` is set, which is how the local setup, the test suite and any
 * deployment that would rather not collect anything all get the same answer: a no-op.
 */

/** Where a failure was noticed. Each variant carries only what is useful for that origin. */
export type Report =
  | {
      readonly kind: 'panel-crash';
      /** Constructor name of the thrown error, e.g. `TypeError` — never its message. */
      readonly errorName: string;
      /** Step the transport was on, which replays the state exactly for a bundled example. */
      readonly step: number;
      readonly totalSteps: number;
    }
  | {
      readonly kind: 'run-failed';
      /** `VmError['kind']` or an application error kind — a closed set of our own strings. */
      readonly reason: string;
      readonly steps: number;
    }
  | {
      readonly kind: 'unhandled';
      readonly errorName: string;
      /** Whether it came from a promise nobody caught rather than from an event handler. */
      readonly fromPromise: boolean;
    };

/**
 * What the program was, in terms that are ours rather than the reader's. A bundled example is
 * named because we shipped it; anything the reader brought is a kind and a size, and its name,
 * its class name and its bytes stay in the tab.
 */
export interface ProgramContext {
  readonly origin: 'example' | 'upload' | 'compiled' | 'none';
  /** Set for a bundled example only — the id from our own manifest. */
  readonly exampleId?: string;
  /** How many methods the class declares: enough to tell a toy from a real class file. */
  readonly methods?: number;
}

interface Envelope {
  readonly report: Report;
  readonly program: ProgramContext;
  /** The build this came from, so a report can be tied to a deploy. */
  readonly release: string;
  readonly userAgent: string;
}

function endpoint(): string | undefined {
  const configured: unknown = import.meta.env.VITE_TELEMETRY_URL;
  return typeof configured === 'string' && configured !== '' ? configured : undefined;
}

/**
 * `sendBeacon` rather than `fetch`: a report about a page that is failing has to survive the
 * page, and a beacon is queued by the browser and sent regardless of what happens next. It
 * also cannot be awaited, which is the right shape — nothing here may delay the banner.
 */
function send(url: string, envelope: Envelope): boolean {
  const body = JSON.stringify(envelope);
  if (typeof navigator.sendBeacon === 'function') {
    return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  }
  return false;
}

const NO_PROGRAM: ProgramContext = { origin: 'none' };

/**
 * Reports a failure, if this build was configured to report anything. Never throws: a
 * telemetry seam that can fail is a second fault on top of the first one.
 */
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

/**
 * Catches what React's error boundary cannot: a rejected promise nobody handled, and an error
 * thrown outside a render. Returns the teardown, so a test can install it and take it away.
 */
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
