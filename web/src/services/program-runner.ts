/**
 * Where a run happens, and how the reader gives up on one.
 *
 * `execute()` is a pure function of a parsed class file (ADR-0001), so nothing about a run
 * depends on the thread it is on — which is what makes it movable at all. What a worker adds
 * is not speed: it is `terminate()`, the only thing that stops a synchronous interpreter loop
 * that has already started. Every other mechanism in this application, `AppModel.token`
 * included, can only decide to ignore an answer; the work goes on regardless, and at the
 * `MAX_STEP_LIMIT` ceiling it goes on for long enough to hold the tab.
 *
 * The two runners here are the same contract over two very different trades, and the
 * application picks between them once, at start-up:
 *
 * - `workerRunner` runs the program somewhere else and streams the history back. The page
 *   keeps painting throughout and "Cancel" ends the run for real. The history costs more to
 *   receive than it did to produce — see `workers/run-protocol` for the measurements — so
 *   this is slower end to end for a very long run, and never blocks.
 * - `inlineRunner` runs it here, exactly as this application always did. It is what a browser
 *   without `Worker` gets, and what the tests get under jsdom and Node. It buys one macrotask
 *   so the loading skeleton can paint, and then owns the thread until the run ends.
 */

import { execute, type ExecutionResult, type Snapshot } from '../core/interpreter';
import { withHistory, type RunCommand, type RunEvent } from '../workers/run-protocol';

export interface RunOptions {
  /** Aborting it abandons the run — and, on a cancellable runner, stops it. */
  readonly signal?: AbortSignal | undefined;
  /** Steps handed over so far, so a long handover can show that the page is still alive. */
  readonly onProgress?: ((steps: number) => void) | undefined;
}

export interface ProgramRunner {
  /**
   * Whether abandoning a run stops the work, or only stops the answer being used. The loading
   * panel offers "Cancel" on the strength of this, so it must not overpromise.
   */
  readonly cancellable: boolean;
  run(command: RunCommand, options?: RunOptions): Promise<ExecutionResult>;
}

/** How a load reaches its runner: `App` fills this in once and passes it down every path. */
export interface LoadContext extends RunOptions {
  readonly runner: ProgramRunner;
}

/**
 * A run the reader walked away from. Not a failure and never a banner — the screen it would
 * have written into is already gone, put back by `load-cancelled`.
 */
export class RunCancelled extends Error {
  constructor() {
    super('The run was cancelled.');
    this.name = 'RunCancelled';
  }
}

export function isRunCancelled(error: unknown): boolean {
  return error instanceof RunCancelled;
}

/**
 * One macrotask, so React can commit and paint the loading skeleton before the interpreter
 * takes the thread. It buys exactly one frame; everything after it is the freeze that
 * `workerRunner` exists to remove.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export const inlineRunner: ProgramRunner = {
  cancellable: false,
  async run(command, options): Promise<ExecutionResult> {
    await yieldToPaint();
    // A run that has not begun can still be called off; one already in the loop cannot, which
    // is precisely what `cancellable: false` says out loud.
    if (options?.signal?.aborted === true) {
      throw new RunCancelled();
    }
    return execute(command.classFile, {
      entryMethod: command.entryMethod,
      maxSteps: command.maxSteps,
    });
  },
};

/**
 * Steps between progress reports. Every batch would be ~250 renders for a run at the ceiling,
 * which is more re-rendering than the skeleton it updates is worth; this is roughly twenty.
 */
const STEPS_PER_REPORT = 25_000;

/**
 * How long a worker may go without saying anything before it is presumed dead.
 *
 * A worker the browser kills outright — reclaiming memory is the usual reason — fires no
 * event at all: `onerror` reports a script that failed to run, not a thread that stopped
 * existing. Nothing else in the protocol would ever settle that run, so the loading panel
 * would spin for the rest of the session.
 *
 * The interpreter reaches the 500,000-step ceiling in well under a second, and the handover
 * that follows sends a batch at a time, so a minute of complete silence is not a slow run:
 * it is a thread that is no longer there.
 */
const WORKER_SILENCE_LIMIT_MS = 60_000;

/** The slice of `Worker` a run uses — small enough for a test to stand in for it. */
export interface RunWorker {
  onmessage: ((event: MessageEvent<RunEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: RunCommand): void;
  terminate(): void;
}

/**
 * A runner backed by one worker per run.
 *
 * `spawn` is injected rather than called directly so a test can drive the protocol without a
 * `Worker`, which neither jsdom nor Node has. A worker that fails to load — an old browser
 * refusing a module worker, a chunk that never shipped — hands that run to `fallback` and
 * marks itself unusable, so the next load goes straight there and stops offering "Cancel".
 */
export function workerRunner(
  spawn: () => RunWorker,
  fallback: ProgramRunner = inlineRunner,
  silenceLimitMs: number = WORKER_SILENCE_LIMIT_MS,
): ProgramRunner {
  let usable = true;

  return {
    get cancellable(): boolean {
      return usable;
    },

    run(command, options): Promise<ExecutionResult> {
      if (!usable) {
        return fallback.run(command, options);
      }
      if (options?.signal?.aborted === true) {
        return Promise.reject(new RunCancelled());
      }

      let worker: RunWorker;
      try {
        worker = spawn();
      } catch {
        usable = false;
        return fallback.run(command, options);
      }

      return new Promise<ExecutionResult>((resolve, reject) => {
        const snapshots: Snapshot[] = [];
        let reported = 0;

        let watchdog: ReturnType<typeof setTimeout> | undefined;

        const stopWatchdog = (): void => {
          if (watchdog !== undefined) {
            clearTimeout(watchdog);
            watchdog = undefined;
          }
        };

        const release = (): void => {
          stopWatchdog();
          worker.onmessage = null;
          worker.onerror = null;
          options?.signal?.removeEventListener('abort', abandon);
          // The history dies with the worker, which is most of the point of having one.
          worker.terminate();
        };

        /**
         * Restarted by every message, so the deadline is on silence rather than on the run:
         * a long handover keeps resetting it, and a thread that has stopped existing does not.
         *
         * This run ends here rather than being handed to `fallback`. Whatever was heavy
         * enough to cost the worker its life would be run again on the thread that paints,
         * and that is the one failure this application cannot report at all.
         */
        const armWatchdog = (): void => {
          stopWatchdog();
          watchdog = setTimeout(() => {
            usable = false;
            release();
            reject(
              new Error(
                'the run stopped answering and was abandoned — the program was probably too ' +
                  'large for this browser to record',
              ),
            );
          }, silenceLimitMs);
        };

        function abandon(): void {
          release();
          reject(new RunCancelled());
        }

        worker.onmessage = ({ data }): void => {
          armWatchdog();
          switch (data.kind) {
            case 'snapshots':
              for (const snapshot of data.snapshots) {
                snapshots.push(snapshot);
              }
              if (snapshots.length - reported >= STEPS_PER_REPORT) {
                reported = snapshots.length;
                options?.onProgress?.(reported);
              }
              return;
            case 'done':
              release();
              resolve(withHistory(data.result, snapshots));
              return;
            case 'failed':
              release();
              reject(new Error(data.reason));
              return;
          }
        };

        worker.onerror = (): void => {
          // Nothing usable can come from a worker that never loaded, and the reader asked for
          // a program rather than for a thread: this run finishes here instead.
          usable = false;
          release();
          fallback.run(command, options).then(resolve, reject);
        };

        options?.signal?.addEventListener('abort', abandon, { once: true });
        worker.postMessage(command);
        armWatchdog();
      });
    },
  };
}

/**
 * The runner this application uses. `new Worker(new URL(…), { type: 'module' })` is the exact
 * form Vite recognises and bundles into its own chunk; anything more dynamic ships a worker
 * that works in dev and 404s in the build.
 */
export function createProgramRunner(): ProgramRunner {
  if (typeof Worker === 'undefined') {
    return inlineRunner;
  }
  return workerRunner(
    () =>
      new Worker(new URL('../workers/run-program.worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
}

let shared: ProgramRunner | undefined;

/** One runner for the session: a fresh object every render would rebuild every load callback. */
export function defaultProgramRunner(): ProgramRunner {
  shared ??= createProgramRunner();
  return shared;
}
