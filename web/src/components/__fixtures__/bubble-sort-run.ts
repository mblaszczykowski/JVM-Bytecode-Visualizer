import { parseClassFile } from '../../core/classfile';
import type { ArrayObject, HeapObject, Snapshot, StackFrame } from '../../core/interpreter';
import { readExampleBytes, readExampleText } from '../../services/__fixtures__/example-files';
import { describeOperandRoles } from '../../services/views/derivations';
import {
  buildProgram,
  listingFor,
  runSummaryOf,
  type LoadedProgram,
} from '../../services/loading/program';
import type { RunSummary } from '../../services/loading/program';

const CLASS_FILE = 'BubbleSort.class';
const SOURCE_FILE = 'BubbleSort.java';

let cached: LoadedProgram | undefined;

export function bubbleSortProgram(): LoadedProgram {
  cached ??= buildProgram({
    origin: { kind: 'upload', fileName: CLASS_FILE },
    classFile: parseClassFile(readExampleBytes(CLASS_FILE)),
    source: { fileName: SOURCE_FILE, text: readExampleText(SOURCE_FILE) },
  });
  return cached;
}

export function snapshots(): readonly Snapshot[] {
  return bubbleSortProgram().snapshots;
}

export function snapshotAt(step: number): Snapshot {
  const history = snapshots();
  const clamped = Math.min(Math.max(step, 0), history.length - 1);
  const snapshot = history[clamped];
  if (snapshot === undefined) {
    throw new Error('the BubbleSort fixture produced no snapshots');
  }
  return snapshot;
}

export function frameAt(step: number): StackFrame | undefined {
  return snapshotAt(step).callStack.at(-1);
}

export function mnemonicAt(step: number): string | undefined {
  return snapshotAt(step).currentInstruction?.mnemonic;
}

export function heapAt(step: number): readonly HeapObject[] {
  return snapshotAt(step).heap ?? [];
}

export function arrayAt(step: number): ArrayObject {
  const object = heapAt(step)[0];
  if (object?.kind !== 'int-array') {
    throw new Error(`the BubbleSort run has no array on the heap at step ${String(step)}`);
  }
  return object;
}

export function firstStepOf(mnemonic: string, after = 0): number {
  const step = snapshots().findIndex(
    (snapshot, index) => index >= after && snapshot.currentInstruction?.mnemonic === mnemonic,
  );
  if (step < 0) {
    throw new Error(`the BubbleSort run never executes ${mnemonic} after step ${String(after)}`);
  }
  return step;
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
