import type { ExternalValue, Snapshot, StackFrame } from '../../core/interpreter';
import type { LoadedProgram } from '../../services/loading/program';

import { recordedRun, type FirstStepOptions } from './recorded-run';

const run = recordedRun('Collatz.class', 'Collatz.java');

export function collatzProgram(): LoadedProgram {
  return run.program();
}

export function snapshots(): readonly Snapshot[] {
  return run.snapshots();
}

export function snapshotAt(step: number): Snapshot {
  return run.snapshotAt(step);
}

export function frameAt(step: number): StackFrame | undefined {
  return run.frameAt(step);
}

export function firstStepOf(mnemonic: string, options?: FirstStepOptions): number {
  return run.firstStepOf(mnemonic, options);
}

export function externalsAt(step: number): readonly ExternalValue[] {
  return snapshotAt(step).externals;
}

export function firstInternedStep(): number {
  const step = snapshots().findIndex((snapshot) =>
    snapshot.callStack.at(-1)?.operandKinds.includes('external'),
  );
  if (step < 0) {
    throw new Error('the Collatz run never leaves an interned object on the operand stack');
  }
  return step;
}
