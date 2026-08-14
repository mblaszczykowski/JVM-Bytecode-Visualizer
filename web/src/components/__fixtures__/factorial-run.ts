import type { Snapshot, StackFrame } from '../../core/interpreter';
import { readExampleManifest } from '../../services/__fixtures__/example-files';
import { constantPoolComments } from '../../services/views/constant-pool';
import {
  describeNextInstruction,
  type NextInstructionSummary,
} from '../../services/views/derivations';
import { describeOperandRoles } from '../../services/views/operand-roles';
import { shortTitleOf } from '../../services/loading/examples';
import { parseExampleManifest } from '../../services/loading/manifest';
import { depthsOf, type LoadedProgram, type MethodListing } from '../../services/loading/program';
import { findListing, firstStepByLine, listingFor } from '../../services/views/program-view';
import type { ExampleOption } from '../dialogs/ExamplePicker';

import { recordedRun, type FirstStepOptions } from './recorded-run';

const run = recordedRun('Factorial.class', 'Factorial.java');

export function factorialProgram(): LoadedProgram {
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
    description: entry.description,
  }));
}
