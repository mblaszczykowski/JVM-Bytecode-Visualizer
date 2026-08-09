import type { ClassFile } from '../core/classfile';
import type { ExecutionResult, Snapshot } from '../core/interpreter';

export const SNAPSHOTS_PER_MESSAGE = 2_000;

export interface RunCommand {
  readonly classFile: ClassFile;
  readonly entryMethod: string;
  readonly maxSteps: number;
}

type WithoutHistory<T> = T extends unknown ? Omit<T, 'snapshots'> : never;
export type RunSummary = WithoutHistory<ExecutionResult>;

export type RunEvent =
  | { readonly kind: 'snapshots'; readonly snapshots: readonly Snapshot[] }
  | { readonly kind: 'done'; readonly result: RunSummary }
  | { readonly kind: 'failed'; readonly reason: string };

export const NO_SNAPSHOTS: readonly Snapshot[] = Object.freeze([]);

export function withHistory(result: RunSummary, snapshots: readonly Snapshot[]): ExecutionResult {
  switch (result.kind) {
    case 'completed':
      return { ...result, snapshots };
    case 'vm-error':
      return { ...result, snapshots };
    case 'step-limit':
      return { ...result, snapshots };
  }
}
