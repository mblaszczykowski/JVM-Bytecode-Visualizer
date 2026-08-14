import type { ArrayObject, HeapObject, Snapshot, StackFrame } from '../../core/interpreter';
import { describeOperandRoles } from '../../services/views/operand-roles';
import type { LoadedProgram } from '../../services/loading/program';
import { listingFor, runSummaryOf, type RunSummary } from '../../services/views/program-view';

import { recordedRun, type FirstStepOptions } from './recorded-run';

const run = recordedRun('BubbleSort.class', 'BubbleSort.java');

export function bubbleSortProgram(): LoadedProgram {
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

export function mnemonicAt(step: number): string | undefined {
  return snapshotAt(step).currentInstruction?.mnemonic;
}

export function heapAt(step: number): readonly HeapObject[] {
  return snapshotAt(step).heap;
}

export function arrayAt(step: number): ArrayObject {
  const object = heapAt(step)[0];
  if (object?.kind !== 'int-array') {
    throw new Error(`the BubbleSort run has no array on the heap at step ${String(step)}`);
  }
  return object;
}

export function operandRolesAt(step: number): readonly (string | undefined)[] {
  const program = bubbleSortProgram();
  const snapshot = snapshotAt(step);
  return describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);
}

export function terminalStep(): number {
  return snapshots().length - 1;
}

export function runSummary(): RunSummary {
  const summary = runSummaryOf(bubbleSortProgram());
  if (summary === undefined) {
    throw new Error('the BubbleSort run did not complete');
  }
  return summary;
}
