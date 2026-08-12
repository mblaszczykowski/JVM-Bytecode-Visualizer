import type { ClassFile } from '../core/classfile';
import { execute, NO_SNAPSHOTS, type ExecutionResult, type Snapshot } from '../core/interpreter';

export const SNAPSHOTS_PER_MESSAGE = 2_000;

export interface RunCommand {
  readonly classFile: ClassFile;
  readonly entryMethod: string;
  readonly maxSteps: number;
}

type WithoutHistory<T> = T extends unknown ? Omit<T, 'snapshots'> : never;
export type RunResultWithoutHistory = WithoutHistory<ExecutionResult>;

export type RunEvent =
  | { readonly kind: 'snapshots'; readonly snapshots: readonly Snapshot[] }
  | { readonly kind: 'done'; readonly result: RunResultWithoutHistory }
  | { readonly kind: 'failed'; readonly reason: string };

export function withHistory(
  result: RunResultWithoutHistory,
  snapshots: readonly Snapshot[],
): ExecutionResult {
  switch (result.kind) {
    case 'completed':
      return { ...result, snapshots };
    case 'vm-error':
      return { ...result, snapshots };
    case 'step-limit':
      return { ...result, snapshots };
  }
}

export function runAndStream(command: RunCommand, post: (event: RunEvent) => void): void {
  let result: ExecutionResult;
  try {
    result = execute(command.classFile, {
      entryMethod: command.entryMethod,
      maxSteps: command.maxSteps,
    });
  } catch (error) {
    post({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
    return;
  }

  const { snapshots } = result;
  for (let from = 0; from < snapshots.length; from += SNAPSHOTS_PER_MESSAGE) {
    post({ kind: 'snapshots', snapshots: snapshots.slice(from, from + SNAPSHOTS_PER_MESSAGE) });
  }
  post({ kind: 'done', result: withHistory(result, NO_SNAPSHOTS) });
}
