import {
  isStatic,
  type ClassFile,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from '../core/classfile';
import { disassemble, type Instruction } from '../core/disassembler';
import {
  DEFAULT_ENTRY_METHOD,
  DEFAULT_MAX_STEPS,
  execute,
  isEntryMethod,
  type ExecutionResult,
  type Snapshot,
  type StackFrame,
  type VmError,
  NO_SNAPSHOTS,
} from '../core/interpreter';

import type { ExampleEntry } from './manifest';
import type { LoadContext } from './program-runner';

export type NotRunnableReason = 'no-code' | 'instance-method' | 'descriptor';

export function describeNotRunnable(reason: NotRunnableReason): string {
  switch (reason) {
    case 'no-code':
      return 'no Code attribute: abstract, native, or declared by an interface';
    case 'instance-method':
      return 'an instance method; a run needs a static entry point';
    case 'descriptor':
      return 'its descriptor is outside the int-only subset this machine executes';
  }
}

export interface MethodListing {
  readonly name: string;
  readonly descriptor: string;
  readonly accessFlags: number;
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  readonly indexByOffset: ReadonlyMap<number, number>;
  readonly undecodedFromOffset: number | undefined;
  readonly lineNumbers: readonly LineNumberEntry[];
  readonly localVariables: readonly LocalVariableEntry[];
  readonly executedOffsets: ReadonlySet<number>;
  readonly notRunnable: NotRunnableReason | undefined;
}

export type ProgramOrigin =
  | { readonly kind: 'example'; readonly entry: ExampleEntry }
  | { readonly kind: 'upload'; readonly fileName: string }
  | { readonly kind: 'compiled'; readonly className: string };

export type ExecutionOutcome =
  | { readonly kind: 'completed'; readonly returnValue: number | undefined }
  | { readonly kind: 'vm-error'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number }
  | { readonly kind: 'no-entry-point' };

export interface LoadedProgram {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  readonly methods: readonly MethodListing[];
  readonly entry: MethodListing | undefined;
  readonly sourceFileName: string;
  readonly sourceLines: readonly string[];
  readonly snapshots: readonly Snapshot[];
  readonly outcome: ExecutionOutcome;
  readonly maxSteps: number;
}

export function runnableMethodsOf(program: LoadedProgram): readonly MethodListing[] {
  return program.methods.filter((method) => method.notRunnable === undefined);
}

export interface ProgramSource {
  readonly fileName: string;
  readonly text: string;
}

export interface BuildProgramInput {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  readonly source?: ProgramSource | undefined;
  readonly maxSteps?: number | undefined;
  readonly entryMethod?: string | undefined;
  readonly run?: ExecutionResult | undefined;
}

export const NO_SOURCE_LINES: readonly string[] = [
  '// No .java source for this class file.',
  '//',
  '// The upload carries only the compiled class, so the source panel has nothing to',
  '// highlight. Line numbers still come from the LineNumberTable, and the bytecode',
  '// panel shows the instructions being executed.',
];

export function buildProgram({
  origin,
  classFile,
  source,
  maxSteps = DEFAULT_MAX_STEPS,
  entryMethod,
  run,
}: BuildProgramInput): LoadedProgram {
  const entry = chooseEntry(classFile, entryMethod);
  const result =
    run ??
    (entry === undefined ? undefined : execute(classFile, { entryMethod: entry.name, maxSteps }));
  const executed = executedOffsets(result?.snapshots ?? NO_SNAPSHOTS);

  const methods = classFile.methods.map<MethodListing>((method) => {
    const { code } = method;
    const decoded = code === undefined ? undefined : disassemble(code.code);
    return {
      name: method.name,
      descriptor: method.descriptor,
      accessFlags: method.accessFlags,
      maxStack: code?.maxStack ?? 0,
      maxLocals: code?.maxLocals ?? 0,
      instructions: decoded?.instructions ?? NO_INSTRUCTIONS,
      indexByOffset: decoded?.indexByOffset ?? NO_INDEX_BY_OFFSET,
      undecodedFromOffset: decoded?.undecodedFromOffset,
      lineNumbers: code?.lineNumberTable ?? [],
      localVariables: code?.localVariableTable ?? [],
      executedOffsets: executed.get(methodKey(method.name, method.descriptor)) ?? EMPTY_OFFSETS,
      notRunnable: notRunnableReasonOf(method),
    };
  });

  return {
    origin,
    classFile,
    methods,
    entry:
      entry === undefined
        ? undefined
        : methods.find(
            (method) => method.name === entry.name && method.descriptor === entry.descriptor,
          ),
    sourceFileName: source?.fileName ?? fileNameOf(origin),
    sourceLines: source === undefined ? NO_SOURCE_LINES : source.text.split(/\r?\n/),
    snapshots: result?.snapshots ?? NO_SNAPSHOTS,
    outcome: result === undefined ? NO_ENTRY_POINT : outcomeOf(result),
    maxSteps,
  };
}

export async function runProgram(
  input: BuildProgramInput,
  context: LoadContext,
): Promise<LoadedProgram> {
  const entry = chooseEntry(input.classFile, input.entryMethod);
  if (entry === undefined) {
    return buildProgram(input);
  }

  const run = await context.runner.run(
    {
      classFile: input.classFile,
      entryMethod: entry.name,
      maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    },
    context,
  );
  return buildProgram({ ...input, run });
}

const EMPTY_OFFSETS: ReadonlySet<number> = new Set<number>();
const NO_INSTRUCTIONS: readonly Instruction[] = [];
const NO_INDEX_BY_OFFSET: ReadonlyMap<number, number> = new Map();
const NO_ENTRY_POINT: ExecutionOutcome = { kind: 'no-entry-point' };

function notRunnableReasonOf(method: MethodInfo): NotRunnableReason | undefined {
  if (method.code === undefined) {
    return 'no-code';
  }
  if (!isStatic(method.accessFlags)) {
    return 'instance-method';
  }
  return isEntryMethod(method) ? undefined : 'descriptor';
}

function chooseEntry(classFile: ClassFile, requested: string | undefined): MethodInfo | undefined {
  const runnable = classFile.methods.filter((method) => notRunnableReasonOf(method) === undefined);
  return (
    (requested === undefined ? undefined : runnable.find((method) => method.name === requested)) ??
    runnable.find((method) => method.name === DEFAULT_ENTRY_METHOD) ??
    runnable.find((method) => method.name !== CLASS_INITIALISER)
  );
}

const CLASS_INITIALISER = '<clinit>';

export function findListing(
  program: LoadedProgram,
  name: string,
  descriptor: string,
): MethodListing | undefined {
  return program.methods.find((method) => method.name === name && method.descriptor === descriptor);
}

export function defaultListingOf(program: LoadedProgram): MethodListing | undefined {
  return program.entry ?? program.methods.find((method) => method.instructions.length > 0);
}

export function methodKeyOf(method: MethodListing): string {
  return `${method.name}${method.descriptor}`;
}

export function listingToShow(
  program: LoadedProgram,
  snapshot: Snapshot | undefined,
  viewedMethodKey: string | undefined,
): MethodListing | undefined {
  const viewed =
    viewedMethodKey === undefined
      ? undefined
      : program.methods.find((method) => methodKeyOf(method) === viewedMethodKey);
  return viewed ?? listingFor(program, snapshot);
}

export function listingFor(
  program: LoadedProgram,
  snapshot: Snapshot | undefined,
): MethodListing | undefined {
  const frame = snapshot?.callStack.at(-1);
  if (frame === undefined) {
    return defaultListingOf(program);
  }
  return (
    findListing(program, frame.methodName, frame.methodDescriptor) ?? defaultListingOf(program)
  );
}

export function isCurrentListing(
  listing: MethodListing | undefined,
  frame: StackFrame | undefined,
): boolean {
  return (
    listing !== undefined &&
    frame?.methodName === listing.name &&
    frame.methodDescriptor === listing.descriptor
  );
}

export function consoleLinesOf(snapshot: Snapshot | undefined): readonly string[] {
  return snapshot?.consoleOutput ?? NO_CONSOLE_OUTPUT;
}

export function runPrintedOutput(snapshots: readonly Snapshot[]): boolean {
  return snapshots.some((snapshot) => consoleLinesOf(snapshot).length > 0);
}

const NO_CONSOLE_OUTPUT: readonly string[] = [];

export function deadOffsetsOf(listing: MethodListing): ReadonlySet<number> {
  const dead = new Set<number>();
  for (const instruction of listing.instructions) {
    if (!listing.executedOffsets.has(instruction.offset)) {
      dead.add(instruction.offset);
    }
  }
  return dead;
}

export function lineForOffset(listing: MethodListing, offset: number): number | undefined {
  let line: number | undefined;
  let bestStartPc = -1;
  for (const entry of listing.lineNumbers) {
    if (entry.startPc <= offset && entry.startPc > bestStartPc) {
      bestStartPc = entry.startPc;
      line = entry.lineNumber;
    }
  }
  return line;
}

export interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

export function offsetsForLine(listing: MethodListing, line: number): OffsetRange | undefined {
  const offsets = listing.instructions
    .map((instruction) => instruction.offset)
    .filter((offset) => lineForOffset(listing, offset) === line);

  const from = offsets[0];
  const to = offsets.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

export function lineMappingNote(listing: MethodListing, pc: number): string | undefined {
  const line = lineForOffset(listing, pc);
  return line === undefined
    ? undefined
    : `LineNumberTable · largest startPc ≤ ${String(pc)} → line ${String(line)}`;
}

export function depthsOf(snapshots: readonly Snapshot[]): readonly number[] {
  return snapshots.map((snapshot) => snapshot.callStack.length);
}

export function topFrameOf(snapshot: Snapshot | undefined): StackFrame | undefined {
  return snapshot?.callStack.at(-1);
}

export interface RunPreview {
  readonly steps: number;
  readonly maxDepth: number;
  readonly profile: readonly number[];
}

const PREVIEW_MAX_STEPS = 5_000;

const PREVIEW_BUCKETS = 32;

export function previewProgram(classFile: ClassFile): RunPreview {
  const depths = depthsOf(execute(classFile, { maxSteps: PREVIEW_MAX_STEPS }).snapshots);
  const profile: number[] = [];

  for (let bucket = 0; bucket < PREVIEW_BUCKETS; bucket++) {
    const first = Math.floor((bucket * depths.length) / PREVIEW_BUCKETS);
    const last = Math.max(first, Math.floor(((bucket + 1) * depths.length) / PREVIEW_BUCKETS) - 1);
    let deepest = 0;
    for (let step = first; step <= last; step++) {
      deepest = Math.max(deepest, depths[step] ?? 0);
    }
    profile.push(deepest);
  }

  return {
    steps: depths.length,
    maxDepth: depths.reduce((deepest, depth) => Math.max(deepest, depth), 0),
    profile,
  };
}

export interface RunSummary {
  readonly resultName: string;
  readonly resultValue: number | undefined;
  readonly totalSteps: number;
  readonly maxDepth: number;
  readonly referenceValue: number | undefined;
}

function resultOf(frame: StackFrame | undefined, name: string): number | undefined {
  if (frame === undefined) {
    return undefined;
  }
  const slot = frame.localNames.indexOf(name);
  return slot < 0 ? undefined : frame.locals[slot];
}

export function lastLiveSnapshot(snapshots: readonly Snapshot[]): Snapshot | undefined {
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot !== undefined && snapshot.callStack.length > 0) {
      return snapshot;
    }
  }
  return undefined;
}

export function runSummaryOf(program: LoadedProgram): RunSummary | undefined {
  if (program.outcome.kind !== 'completed') {
    return undefined;
  }

  const entry = program.origin.kind === 'example' ? program.origin.entry : undefined;
  const resultName = entry?.resultVariable ?? 'result';
  const lastLive = lastLiveSnapshot(program.snapshots);
  const resultValue = resultOf(lastLive?.callStack[0], resultName) ?? program.outcome.returnValue;

  let maxDepth = 0;
  for (const snapshot of program.snapshots) {
    maxDepth = Math.max(maxDepth, snapshot.callStack.length);
  }

  return {
    resultName,
    resultValue,
    totalSteps: program.snapshots.length,
    maxDepth,
    referenceValue:
      entry !== undefined && entry.expectedResult === resultValue
        ? entry.expectedResult
        : undefined,
  };
}

export function firstStepByOffset(
  snapshots: readonly Snapshot[],
  listing: MethodListing | undefined,
): ReadonlyMap<number, number> {
  const steps = new Map<number, number>();
  if (listing === undefined) {
    return steps;
  }

  snapshots.forEach((snapshot, index) => {
    const frame = snapshot.callStack.at(-1);
    const offset = snapshot.currentInstruction?.offset;
    if (
      frame?.methodName !== listing.name ||
      frame.methodDescriptor !== listing.descriptor ||
      offset === undefined ||
      steps.has(offset)
    ) {
      return;
    }
    steps.set(offset, index);
  });
  return steps;
}

export function firstStepByLine(snapshots: readonly Snapshot[]): ReadonlyMap<number, number> {
  const steps = new Map<number, number>();
  snapshots.forEach((snapshot, index) => {
    const { sourceLine } = snapshot;
    if (sourceLine !== undefined && !steps.has(sourceLine)) {
      steps.set(sourceLine, index);
    }
  });
  return steps;
}

function methodKey(name: string, descriptor: string): string {
  return `${name}${descriptor}`;
}

function executedOffsets(snapshots: readonly Snapshot[]): ReadonlyMap<string, Set<number>> {
  const byMethod = new Map<string, Set<number>>();

  for (const snapshot of snapshots) {
    const frame = snapshot.callStack.at(-1);
    const instruction = snapshot.currentInstruction;
    if (frame === undefined || instruction === undefined) {
      continue;
    }
    const key = methodKey(frame.methodName, frame.methodDescriptor);
    const offsets = byMethod.get(key) ?? new Set<number>();
    offsets.add(instruction.offset);
    byMethod.set(key, offsets);
  }

  return byMethod;
}

function outcomeOf(result: ExecutionResult): ExecutionOutcome {
  switch (result.kind) {
    case 'completed':
      return { kind: 'completed', returnValue: result.returnValue };
    case 'vm-error':
      return { kind: 'vm-error', error: result.error };
    case 'step-limit':
      return { kind: 'step-limit', limit: result.limit };
  }
}

function fileNameOf(origin: ProgramOrigin): string {
  switch (origin.kind) {
    case 'example':
      return origin.entry.sourceFile;
    case 'upload':
      return origin.fileName;
    case 'compiled':
      return `${origin.className}.java`;
  }
}
