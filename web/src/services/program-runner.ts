import { execute, type ExecutionResult, type Snapshot } from '../core/interpreter';
import { withHistory, type RunCommand, type RunEvent } from '../workers/run-protocol';

export interface RunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((steps: number) => void) | undefined;
}

export interface ProgramRunner {
  readonly cancellable: boolean;
  run(command: RunCommand, options?: RunOptions): Promise<ExecutionResult>;
}

export interface LoadContext extends RunOptions {
  readonly runner: ProgramRunner;
}

export class RunCancelled extends Error {
  constructor() {
    super('The run was cancelled.');
    this.name = 'RunCancelled';
  }
}

export function isRunCancelled(error: unknown): boolean {
  return error instanceof RunCancelled;
}

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export const inlineRunner: ProgramRunner = {
  cancellable: false,
  async run(command, options): Promise<ExecutionResult> {
    await yieldToPaint();
    if (options?.signal?.aborted === true) {
      throw new RunCancelled();
    }
    return execute(command.classFile, {
      entryMethod: command.entryMethod,
      entryDescriptor: command.entryDescriptor,
      maxSteps: command.maxSteps,
    });
  },
};

const STEPS_PER_REPORT = 25_000;

const WORKER_SILENCE_LIMIT_MS = 60_000;

const TOO_LARGE_TO_RECORD = 'the program was probably too large for this browser to record';

const SILENT_WORKER = `the run stopped answering and was abandoned; ${TOO_LARGE_TO_RECORD}`;

const DEAD_WORKER = `the run failed part-way through and was abandoned; ${TOO_LARGE_TO_RECORD}`;

export interface RunWorker {
  onmessage: ((event: MessageEvent<RunEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: RunCommand): void;
  terminate(): void;
}

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
        let answered = false;

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
          worker.terminate();
        };

        const armWatchdog = (): void => {
          stopWatchdog();
          watchdog = setTimeout(() => {
            usable = false;
            release();
            reject(new Error(SILENT_WORKER));
          }, silenceLimitMs);
        };

        function abandon(): void {
          release();
          reject(new RunCancelled());
        }

        worker.onmessage = ({ data }): void => {
          answered = true;
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
          release();
          if (answered) {
            reject(new Error(DEAD_WORKER));
            return;
          }
          usable = false;
          fallback.run(command, options).then(resolve, reject);
        };

        options?.signal?.addEventListener('abort', abandon, { once: true });
        worker.postMessage(command);
        armWatchdog();
      });
    },
  };
}

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

export function defaultProgramRunner(): ProgramRunner {
  shared ??= createProgramRunner();
  return shared;
}
