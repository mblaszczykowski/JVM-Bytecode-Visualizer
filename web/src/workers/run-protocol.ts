import type { ClassFile } from '../core/classfile';
import {
  execute,
  type ExecuteOptions,
  type ExecutionResult,
  type ExternalValue,
  type HeapObject,
  type Snapshot,
  type StackFrame,
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

type StreamedSnapshot = Omit<Snapshot, 'callStack' | 'heap' | 'consoleOutput' | 'externals'> & {
  readonly callStack: readonly number[];
  readonly heap: number;
  readonly consoleOutput: number;
  readonly externals: number;
};

export interface SnapshotBatch {
  readonly kind: 'snapshots';
  readonly snapshots: readonly StreamedSnapshot[];
  readonly frames: readonly StackFrame[];
  readonly heaps: readonly (readonly number[])[];
  readonly objects: readonly HeapObject[];
  readonly consoleOutputs: readonly (readonly string[])[];
  readonly externalPools: readonly (readonly ExternalValue[])[];
}

export type RunEvent =
  | SnapshotBatch
  | { readonly kind: 'done'; readonly result: RunResultWithoutHistory }
  | { readonly kind: 'failed'; readonly error: Error };

class VersionEncoder<T extends object> {
  private readonly versions = new WeakMap<T, number>();
  private count = 0;
  private additions: T[] = [];

  id(value: T): number {
    const previous = this.versions.get(value);
    if (previous !== undefined) {
      return previous;
    }
    const id = this.count++;
    this.versions.set(value, id);
    this.additions.push(value);
    return id;
  }

  take(): readonly T[] {
    const additions = this.additions;
    this.additions = [];
    return additions;
  }
}

export class SnapshotEncoder {
  private readonly frames = new VersionEncoder<StackFrame>();
  private readonly heaps = new VersionEncoder<readonly HeapObject[]>();
  private readonly objects = new VersionEncoder<HeapObject>();
  private readonly consoleOutputs = new VersionEncoder<readonly string[]>();
  private readonly externalPools = new VersionEncoder<readonly ExternalValue[]>();

  encode(snapshots: readonly Snapshot[]): SnapshotBatch {
    const encoded = snapshots.map((snapshot) => ({
      ...snapshot,
      callStack: snapshot.callStack.map((frame) => this.frames.id(frame)),
      heap: this.heaps.id(snapshot.heap),
      consoleOutput: this.consoleOutputs.id(snapshot.consoleOutput),
      externals: this.externalPools.id(snapshot.externals),
    }));
    const heaps = this.heaps.take().map((heap) => heap.map((object) => this.objects.id(object)));
    return {
      kind: 'snapshots',
      snapshots: encoded,
      frames: this.frames.take(),
      heaps,
      objects: this.objects.take(),
      consoleOutputs: this.consoleOutputs.take(),
      externalPools: this.externalPools.take(),
    };
  }
}

function append<T>(target: T[], additions: readonly T[]): void {
  for (const value of additions) {
    target.push(value);
  }
}

function versionAt<T>(versions: readonly T[], id: number): T {
  const version = versions[id];
  if (version === undefined) {
    throw new Error(`The worker referenced an unknown snapshot version: ${String(id)}.`);
  }
  return version;
}

export class SnapshotDecoder {
  private readonly frames: StackFrame[] = [];
  private readonly objects: HeapObject[] = [];
  private readonly heaps: (readonly HeapObject[])[] = [];
  private readonly consoleOutputs: (readonly string[])[] = [];
  private readonly externalPools: (readonly ExternalValue[])[] = [];

  decode(batch: SnapshotBatch): readonly Snapshot[] {
    append(this.frames, batch.frames);
    append(this.objects, batch.objects);
    append(
      this.heaps,
      batch.heaps.map((heap) => heap.map((id) => versionAt(this.objects, id))),
    );
    append(this.consoleOutputs, batch.consoleOutputs);
    append(this.externalPools, batch.externalPools);
    return batch.snapshots.map((snapshot) => ({
      ...snapshot,
      callStack: snapshot.callStack.map((id) => versionAt(this.frames, id)),
      heap: versionAt(this.heaps, snapshot.heap),
      consoleOutput: versionAt(this.consoleOutputs, snapshot.consoleOutput),
      externals: versionAt(this.externalPools, snapshot.externals),
    }));
  }
}

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
  const encoder = new SnapshotEncoder();
  for (let from = 0; from < snapshots.length; from += SNAPSHOTS_PER_MESSAGE) {
    post(encoder.encode(snapshots.slice(from, from + SNAPSHOTS_PER_MESSAGE)));
  }
  post({ kind: 'done', result: withoutHistory(result) });
}
