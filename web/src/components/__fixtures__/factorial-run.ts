import { parseClassFile } from '../../core/classfile';
import type { Snapshot, StackFrame } from '../../core/interpreter';
import {
  readExampleBytes,
  readExampleManifest,
  readExampleText,
} from '../../services/__fixtures__/example-files';
import { constantPoolComments } from '../../services/constant-pool';
import {
  describeNextInstruction,
  describeOperandRoles,
  type NextInstructionSummary,
} from '../../services/derivations';
import { shortTitleOf } from '../../services/examples';
import { parseExampleManifest } from '../../services/manifest';
import {
  buildProgram,
  depthsOf,
  findListing,
  firstStepByLine,
  listingFor,
  type LoadedProgram,
  type MethodListing,
} from '../../services/program';
import type { ExampleOption } from '../dialogs/ExamplePicker';

const CLASS_FILE = 'Factorial.class';
const SOURCE_FILE = 'Factorial.java';

let cached: LoadedProgram | undefined;

export function factorialProgram(): LoadedProgram {
  cached ??= buildProgram({
    origin: { kind: 'upload', fileName: CLASS_FILE },
    classFile: parseClassFile(readExampleBytes(CLASS_FILE)),
    source: { fileName: SOURCE_FILE, text: readExampleText(SOURCE_FILE) },
  });
  return cached;
}

export function snapshots(): readonly Snapshot[] {
  return factorialProgram().snapshots;
}

export function snapshotAt(step: number): Snapshot {
  const history = snapshots();
  const clamped = Math.min(Math.max(step, 0), history.length - 1);
  const snapshot = history[clamped];
  if (snapshot === undefined) {
    throw new Error('the Factorial fixture produced no snapshots');
  }
  return snapshot;
}

export function frameAt(step: number): StackFrame | undefined {
  return snapshotAt(step).callStack.at(-1);
}

export function firstStepOf(mnemonic: string, depth?: number): number {
  const step = snapshots().findIndex(
    (snapshot) =>
      snapshot.currentInstruction?.mnemonic === mnemonic &&
      (depth === undefined || snapshot.callStack.length === depth),
  );
  if (step < 0) {
    throw new Error(`the Factorial run never executes ${mnemonic}`);
  }
  return step;
}

export function listingOf(name: string, descriptor: string): MethodListing {
  const listing = findListing(factorialProgram(), name, descriptor);
  if (listing === undefined) {
    throw new Error(`Factorial.class has no method ${name}${descriptor}`);
  }
  return listing;
}

const FACTORIAL_DESCRIPTOR = '(I)I';
const CONSTRUCTOR_DESCRIPTOR = '()V';

export function factorialListing(): MethodListing {
  return listingOf('factorial', FACTORIAL_DESCRIPTOR);
}

export function constructorListing(): MethodListing {
  return listingOf('<init>', CONSTRUCTOR_DESCRIPTOR);
}

export function commentsOf(listing: MethodListing): ReadonlyMap<number, string> {
  return constantPoolComments(listing, factorialProgram().classFile);
}

export function nextInstructionAt(step: number): NextInstructionSummary | undefined {
  const program = factorialProgram();
  const snapshot = snapshotAt(step);
  return describeNextInstruction(snapshot, listingFor(program, snapshot), program.classFile);
}

export function operandRolesAt(step: number): readonly (string | undefined)[] {
  const program = factorialProgram();
  const snapshot = snapshotAt(step);
  return describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);
}

export function depths(): readonly number[] {
  return depthsOf(snapshots());
}

export function sourceFileName(): string {
  return factorialProgram().sourceFileName;
}

export function sourceLines(): readonly string[] {
  return factorialProgram().sourceLines;
}

export function stepForLine(): ReadonlyMap<number, number> {
  return firstStepByLine(snapshots());
}

export function exampleOptions(): readonly ExampleOption[] {
  return parseExampleManifest(readExampleManifest()).examples.map((entry) => ({
    id: entry.id,
    name: shortTitleOf(entry),
    tagline: entry.tagline,
    description: entry.description,
  }));
}
