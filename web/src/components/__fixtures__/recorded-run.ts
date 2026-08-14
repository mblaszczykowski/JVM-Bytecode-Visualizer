import { parseClassFile } from '../../core/classfile';
import type { Snapshot, StackFrame } from '../../core/interpreter';
import { readExampleBytes, readExampleText } from '../../services/__fixtures__/example-files';
import { buildProgram, type LoadedProgram } from '../../services/loading/program';

export interface FirstStepOptions {
  readonly depth?: number;
  readonly after?: number;
}

export interface RecordedRun {
  readonly program: () => LoadedProgram;
  readonly snapshots: () => readonly Snapshot[];
  readonly snapshotAt: (step: number) => Snapshot;
  readonly frameAt: (step: number) => StackFrame | undefined;
  readonly firstStepOf: (mnemonic: string, options?: FirstStepOptions) => number;
}

export function recordedRun(classFile: string, sourceFile: string): RecordedRun {
  let cached: LoadedProgram | undefined;

  function program(): LoadedProgram {
    cached ??= buildProgram({
      origin: { kind: 'upload', fileName: classFile },
      classFile: parseClassFile(readExampleBytes(classFile)),
      source: { fileName: sourceFile, text: readExampleText(sourceFile) },
    });
    return cached;
  }

  function snapshots(): readonly Snapshot[] {
    return program().snapshots;
  }

  function snapshotAt(step: number): Snapshot {
    const history = snapshots();
    const snapshot = history[Math.min(Math.max(step, 0), history.length - 1)];
    if (snapshot === undefined) {
      throw new Error(`the ${classFile} fixture produced no snapshots`);
    }
    return snapshot;
  }

  function frameAt(step: number): StackFrame | undefined {
    return snapshotAt(step).callStack.at(-1);
  }

  function firstStepOf(mnemonic: string, { depth, after = 0 }: FirstStepOptions = {}): number {
    const step = snapshots().findIndex(
      (snapshot, index) =>
        index >= after &&
        snapshot.currentInstruction?.mnemonic === mnemonic &&
        (depth === undefined || snapshot.callStack.length === depth),
    );
    if (step < 0) {
      throw new Error(`the ${classFile} run never executes ${mnemonic} under those conditions`);
    }
    return step;
  }

  return { program, snapshots, snapshotAt, frameAt, firstStepOf };
}
