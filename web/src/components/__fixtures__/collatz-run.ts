import { parseClassFile } from '../../core/classfile';
import type { ExternalValue, Snapshot, StackFrame } from '../../core/interpreter';
import { readExampleBytes, readExampleText } from '../../services/__fixtures__/example-files';
import { buildProgram, type LoadedProgram } from '../../services/program';

const CLASS_FILE = 'Collatz.class';
const SOURCE_FILE = 'Collatz.java';

let cached: LoadedProgram | undefined;

export function collatzProgram(): LoadedProgram {
  cached ??= buildProgram({
    origin: { kind: 'upload', fileName: CLASS_FILE },
    classFile: parseClassFile(readExampleBytes(CLASS_FILE)),
    source: { fileName: SOURCE_FILE, text: readExampleText(SOURCE_FILE) },
  });
  return cached;
}

export function snapshots(): readonly Snapshot[] {
  return collatzProgram().snapshots;
}

export function snapshotAt(step: number): Snapshot {
  const snapshot = snapshots()[step];
  if (snapshot === undefined) {
    throw new Error(`the Collatz run has no step ${String(step)}`);
  }
  return snapshot;
}

export function frameAt(step: number): StackFrame | undefined {
  return snapshotAt(step).callStack.at(-1);
}

export function externalsAt(step: number): readonly ExternalValue[] {
  return snapshotAt(step).externals ?? [];
}

export function firstInternedStep(): number {
  const step = snapshots().findIndex((snapshot) =>
    snapshot.callStack.at(-1)?.operandKinds?.includes('external'),
  );
  if (step < 0) {
    throw new Error('the Collatz run never leaves an interned object on the operand stack');
  }
  return step;
}
