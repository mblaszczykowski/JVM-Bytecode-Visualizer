import type { ClassFile } from '../core/classfile';
import {
  execute,
  type ExecuteOptions,
  type ExecutionResult,
  type Snapshot,
} from '../core/interpreter';

export const SNAPSHOTS_PER_MESSAGE = 2_000;

export interface RunCommand {
  readonly classFile: ClassFile;
  readonly entryMethod: string;
  readonly entryDescriptor?: string;
  readonly maxSteps: number;
}

type WithoutHistory<T> = T extends unknown ? Omit<T, 'snapshots'> : never;
export type RunResultWithoutHistory = WithoutHistory<ExecutionResult>;

export type RunEvent =
  | { readonly kind: 'snapshots'; readonly snapshots: readonly Snapshot[] }
  | { readonly kind: 'done'; readonly result: RunResultWithoutHistory }
  | { readonly kind: 'failed'; readonly error: Error };

export function withHistory(
  result: RunResultWithoutHistory,
  snapshots: readonly Snapshot[],
): ExecutionResult {
  return { ...result, snapshots };
}

export function withoutHistory(result: ExecutionResult): RunResultWithoutHistory {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the history is what this drops
  const { snapshots: _history, ...outcome } = result;
  return outcome;
}

export function runOptionsOf(command: RunCommand): ExecuteOptions {
  return {
    entryMethod: command.entryMethod,
    entryDescriptor: command.entryDescriptor,
    maxSteps: command.maxSteps,
  };
}

function cloneableError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  const carried = new Error(error.message);
  if (error.stack !== undefined) {
    carried.stack = error.stack;
  }
  return carried;
}

export function runAndStream(command: RunCommand, post: (event: RunEvent) => void): void {
  let result: ExecutionResult;
  try {
    result = execute(command.classFile, runOptionsOf(command));
  } catch (error) {
    post({ kind: 'failed', error: cloneableError(error) });
    return;
  }

  const { snapshots } = result;
  for (let from = 0; from < snapshots.length; from += SNAPSHOTS_PER_MESSAGE) {
    post({ kind: 'snapshots', snapshots: snapshots.slice(from, from + SNAPSHOTS_PER_MESSAGE) });
  }
  post({ kind: 'done', result: withoutHistory(result) });
}
