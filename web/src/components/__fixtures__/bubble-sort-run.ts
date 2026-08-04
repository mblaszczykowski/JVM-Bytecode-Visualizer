/**
 * The Bubble sort example exactly as the application loads it: the committed `.class` is
 * parsed, disassembled and executed by the domain layer, and the panels are handed the heap
 * that run produced.
 *
 * Nothing here is written out by hand. A panel test that passes against these values passes
 * against a real heap — one `int[5]` allocated by `newarray`, filled with `{5,3,4,1,2}` and
 * left sorted at the end of a few hundred steps.
 */

import { parseClassFile } from '../../core/classfile';
import type { ArrayObject, HeapObject, Snapshot, StackFrame } from '../../core/interpreter';
import { readExampleBytes, readExampleText } from '../../services/__fixtures__/example-files';
import { describeOperandRoles } from '../../services/derivations';
import { buildProgram, listingFor, runSummaryOf, type LoadedProgram } from '../../services/program';
import type { RunSummary } from '../../services/program';

const CLASS_FILE = 'BubbleSort.class';
const SOURCE_FILE = 'BubbleSort.java';

/** Parsing and running the example takes a few milliseconds; every test file needs it once. */
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

/** The snapshot at `step`, or the terminal one for anything past the end of the run. */
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

/** The instruction that step is about to run; `undefined` on the terminal snapshot. */
export function mnemonicAt(step: number): string | undefined {
  return snapshotAt(step).currentInstruction?.mnemonic;
}

export function heapAt(step: number): readonly HeapObject[] {
  return snapshotAt(step).heap ?? [];
}

/** The one array the program allocates, as it stood at `step`. */
export function arrayAt(step: number): ArrayObject {
  const object = heapAt(step)[0];
  if (object?.kind !== 'int-array') {
    throw new Error(`the BubbleSort run has no array on the heap at step ${String(step)}`);
  }
  return object;
}

/**
 * The first step whose next instruction is `mnemonic` — how the panel tests name a moment.
 * `after` skips the array's initialisation, where `iastore` is filling it rather than sorting.
 */
export function firstStepOf(mnemonic: string, after = 0): number {
  const step = snapshots().findIndex(
    (snapshot, index) => index >= after && snapshot.currentInstruction?.mnemonic === mnemonic,
  );
  if (step < 0) {
    throw new Error(`the BubbleSort run never executes ${mnemonic} after step ${String(after)}`);
  }
  return step;
}

/** The role annotations the operand stack panel shows at `step`. */
export function operandRolesAt(step: number): readonly (string | undefined)[] {
  const program = bubbleSortProgram();
  const snapshot = snapshotAt(step);
  return describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);
}

/** The terminal snapshot: the empty call stack and the sorted array the run left behind. */
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
