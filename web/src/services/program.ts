/**
 * The loaded program: everything the panels read, computed once per run.
 *
 * The disassembly of every method and the set of offsets the run actually reached are
 * derived here rather than in render, so replaying the history stays a lookup by index.
 *
 * A run is a capability of a parsed class file, not a precondition for having one: every
 * method is listed whether or not the interpreter could enter it, and a class with nothing
 * runnable in it still produces a `LoadedProgram` — with `no-entry-point` as its outcome.
 *
 * Where the run itself happened is not this file's business. `buildProgram` will do it here
 * if nobody else has, and `runProgram` hands it to a `ProgramRunner` — the worker, in a
 * browser that has one — and assembles the same program around the answer.
 */

import {
  isClassFileError,
  isStatic,
  parseMethodDescriptor,
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
} from '../core/interpreter';

import type { ExampleEntry } from './manifest';
import type { LoadContext } from './program-runner';

/** Why a run cannot start from a method. `undefined` on a `MethodListing` means it can. */
export type NotRunnableReason = 'no-code' | 'instance-method' | 'needs-arguments' | 'descriptor';

/** Said next to a method in the picker, so "listing only" is never left as a verdict. */
export function describeNotRunnable(reason: NotRunnableReason): string {
  switch (reason) {
    case 'no-code':
      return 'no Code attribute — abstract, native, or declared by an interface';
    case 'instance-method':
      return 'an instance method, and this machine has no objects to call one on';
    case 'needs-arguments':
      return 'takes arguments, and a run cannot be given values for them yet';
    case 'descriptor':
      return 'its descriptor is outside the int-only subset this machine executes';
  }
}

export interface MethodListing {
  readonly name: string;
  readonly descriptor: string;
  /** JVMS §4.6 table 4.6-A; the picker decodes it into modifier names. */
  readonly accessFlags: number;
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  /** Set when decoding stopped early — the panel renders a `… not decoded` row for it. */
  readonly truncatedAtOffset: number | undefined;
  readonly lineNumbers: readonly LineNumberEntry[];
  /** LocalVariableTable entries with their pc ranges — a slot can name several variables. */
  readonly localVariables: readonly LocalVariableEntry[];
  /** Offsets reached by this run; everything else is dead code in this run. */
  readonly executedOffsets: ReadonlySet<number>;
  /** Absent when a run can start here; otherwise the reason it cannot. */
  readonly notRunnable: NotRunnableReason | undefined;
}

export type ProgramOrigin =
  | { readonly kind: 'example'; readonly entry: ExampleEntry }
  | { readonly kind: 'upload'; readonly fileName: string }
  /** Compiled from source written in the editor; the source is always available. */
  | { readonly kind: 'compiled'; readonly className: string };

export type ExecutionOutcome =
  | { readonly kind: 'completed'; readonly returnValue: number | undefined }
  | { readonly kind: 'vm-error'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number }
  /** No run was attempted: the class declares no method this machine can enter. */
  | { readonly kind: 'no-entry-point' };

export interface LoadedProgram {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  /** Every declared method, including the ones with no Code attribute to disassemble. */
  readonly methods: readonly MethodListing[];
  /** Method the run started from; absent when the class has no usable entry point. */
  readonly entry: MethodListing | undefined;
  readonly sourceFileName: string;
  readonly sourceLines: readonly string[];
  /** Stable across renders — `useExecutionPlayer` treats a new array as a new program. */
  readonly snapshots: readonly Snapshot[];
  readonly outcome: ExecutionOutcome;
  readonly maxSteps: number;
}

/** Methods a run could start from — the picker's runnable set, in declaration order. */
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
  /** The matching `.java`; uploads rarely have one. */
  readonly source?: ProgramSource | undefined;
  readonly maxSteps?: number | undefined;
  /**
   * Name of the method to start from. Defaults to `main`, then to the first runnable method
   * the class declares — a utility class runs its first helper rather than nothing at all.
   */
  readonly entryMethod?: string | undefined;
  /**
   * A run of this class file that already happened somewhere else — the worker. Absent, the
   * run happens here, on whichever thread called: the fallback path, and the one the previews
   * and the tests take.
   */
  readonly run?: ExecutionResult | undefined;
}

/** Shown instead of source code when a `.class` arrives without its `.java`. */
export const NO_SOURCE_LINES: readonly string[] = [
  '// No .java source for this class file.',
  '//',
  '// Upload only carries the compiled class, so the source panel has nothing to',
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
  // A class with nothing runnable in it is still a class: no run is attempted, and every
  // panel below reads from the parse rather than from the history.
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
      truncatedAtOffset: decoded?.truncatedAtOffset,
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

/**
 * The same program, with the run handed to `context.runner` instead of taken here.
 *
 * The entry method is still chosen on this side and named in the request: the runner is told
 * what to execute and decides nothing, so a worker and this thread cannot disagree about
 * which method a class "runs". A class with nothing runnable never reaches the runner at all.
 *
 * Rejects, rather than returning a program, when the reader abandoned the run — there is no
 * `LoadedProgram` to describe a run that was stopped halfway.
 */
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
/** One identity for every run that produced nothing — a fresh `[]` rewinds the player. */
const NO_SNAPSHOTS: readonly Snapshot[] = Object.freeze([]);
const NO_ENTRY_POINT: ExecutionOutcome = { kind: 'no-entry-point' };

/** `main`'s array parameter, which the interpreter deliberately leaves as an empty slot. */
const MAIN_DESCRIPTOR = '([Ljava/lang/String;)V';

/**
 * Whether the interpreter could start at this method, and if not, why. `isEntryMethod` is the
 * authority on the first three conditions — asking it rather than restating the rule keeps the
 * picker from offering a method the run would then refuse.
 *
 * The fourth is this layer's own: `ExecuteOptions` names an entry method but carries no
 * argument values, so a method that reads a parameter faults on its first `iload`. It is
 * listed, and marked, rather than offered. `main` is the standing exception — nothing in the
 * subset can allocate a `String[]`, so its slot is meant to stay empty.
 */
function notRunnableReasonOf(method: MethodInfo): NotRunnableReason | undefined {
  if (method.code === undefined) {
    return 'no-code';
  }
  if (!isStatic(method.accessFlags)) {
    return 'instance-method';
  }
  if (!isEntryMethod(method)) {
    return 'descriptor';
  }
  return takesArguments(method.descriptor) ? 'needs-arguments' : undefined;
}

function takesArguments(descriptor: string): boolean {
  if (descriptor === MAIN_DESCRIPTOR) {
    return false;
  }
  try {
    return parseMethodDescriptor(descriptor).params.length > 0;
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    // A descriptor the class file itself got wrong; `isEntryMethod` has already refused it.
    return true;
  }
}

/**
 * Where the run starts: what the caller asked for, then `main`, then the first runnable
 * method. `<clinit>` is never chosen on its own — it is the class initialiser, not a program,
 * and opening on it would answer "run this class" with a static-field setup nobody asked for.
 * It stays in the runnable set, so the picker can still offer it deliberately.
 */
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

/**
 * Listing the Bytecode panel opens on when the run has nothing to say: the method it started
 * from, else the first one there is anything to disassemble. A class with no entry point still
 * has code to read, and an empty panel would hide it.
 */
export function defaultListingOf(program: LoadedProgram): MethodListing | undefined {
  return program.entry ?? program.methods.find((method) => method.instructions.length > 0);
}

/** A name alone does not identify a method — overloads differ only in their descriptor. */
export function methodKeyOf(method: MethodListing): string {
  return `${method.name}${method.descriptor}`;
}

/**
 * The listing on screen: whichever method the reader opened in the picker, and until they open
 * one, whichever method the run is standing in. Browsing takes over from replaying here, and a
 * key that names nothing in this class file falls back rather than blanking the panel.
 */
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

/**
 * Listing to show for a snapshot: the method of the top frame, or the default listing once the
 * stack is empty — the terminal snapshot should not blank the panel.
 */
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

/**
 * Whether `listing` is the method the snapshot is standing in. Everything the panels derive
 * from the current step — the pc highlight, the "Next" card, the dead-code dimming — only
 * means anything while the two agree; browsing another method's listing must not borrow them.
 */
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

/**
 * Lines the program has printed by this snapshot. The interpreter's `consoleOutput` is
 * cumulative and optional — a build whose interpreter does not record it yet simply has a run
 * that printed nothing, rather than a panel that crashes.
 */
export function consoleLinesOf(snapshot: Snapshot | undefined): readonly string[] {
  // Structural rather than a cast: `Snapshot` is assignable to this whether or not it has
  // grown the field yet, and the day it does, nothing here has to change.
  const printing: PrintingSnapshot | undefined = snapshot;
  return printing?.consoleOutput ?? NO_CONSOLE_OUTPUT;
}

/** The additive half of the interpreter's snapshot contract, as this layer relies on it. */
interface PrintingSnapshot {
  readonly step: number;
  /** Every line printed up to and including this snapshot's state. Cumulative. */
  readonly consoleOutput?: readonly string[];
}

/** Whether the run printed anything at all — the Console panel joins the column only then. */
export function runPrintedOutput(snapshots: readonly Snapshot[]): boolean {
  return snapshots.some((snapshot) => consoleLinesOf(snapshot).length > 0);
}

const NO_CONSOLE_OUTPUT: readonly string[] = [];

/** Offsets of `listing` that this run never reached. */
export function deadOffsetsOf(listing: MethodListing): ReadonlySet<number> {
  const dead = new Set<number>();
  for (const instruction of listing.instructions) {
    if (!listing.executedOffsets.has(instruction.offset)) {
      dead.add(instruction.offset);
    }
  }
  return dead;
}

/** JVMS §4.7.12: the current line is the entry with the largest `startPc <= offset`. */
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

/** Byte offsets of every instruction mapped to `line` — the `pc 7–15` pill in the footer. */
export function offsetsForLine(listing: MethodListing, line: number): OffsetRange | undefined {
  const offsets = listing.instructions
    .map((instruction) => instruction.offset)
    .filter((offset) => lineForOffset(listing, offset) === line);

  const from = offsets[0];
  const to = offsets.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

/** Spells the mapping rule out for the current pc, so the footer reads as a decision. */
export function lineMappingNote(listing: MethodListing, pc: number): string | undefined {
  const line = lineForOffset(listing, pc);
  return line === undefined
    ? undefined
    : `LineNumberTable · largest startPc ≤ ${String(pc)} → line ${String(line)}`;
}

/** Call stack depth per step — the background chart of the scrubber. */
export function depthsOf(snapshots: readonly Snapshot[]): readonly number[] {
  return snapshots.map((snapshot) => snapshot.callStack.length);
}

export function topFrameOf(snapshot: Snapshot | undefined): StackFrame | undefined {
  return snapshot?.callStack.at(-1);
}

export interface RunPreview {
  readonly steps: number;
  readonly maxDepth: number;
  /** Call stack depth bucketed down to a fixed width — the sparkline on a welcome card. */
  readonly profile: readonly number[];
}

/** Nobody browses the welcome screen to watch a runaway loop; a preview gives up early. */
const PREVIEW_MAX_STEPS = 5_000;

const PREVIEW_BUCKETS = 32;

/**
 * The shape of a run, without loading it: how long it is and how deep it goes. Cheap enough
 * to do for all four examples while someone reads the headline — the bundled programs are a
 * few hundred instructions each.
 */
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
  /** Name of the local the program leaves its answer in, e.g. `result`. */
  readonly resultName: string;
  /** Value that local held on the last snapshot that still had a frame. */
  readonly resultValue: number | undefined;
  readonly totalSteps: number;
  readonly maxDepth: number;
  /**
   * What a real JVM computed for this example during the fixtures build. Present only for
   * the bundled examples, and only shown once it agrees with what the run produced.
   */
  readonly referenceValue: number | undefined;
}

/** The local `main` was left holding, by name — the answer the program was written to produce. */
function resultOf(frame: StackFrame | undefined, name: string): number | undefined {
  if (frame === undefined) {
    return undefined;
  }
  const slot = frame.localNames.indexOf(name);
  return slot < 0 ? undefined : frame.locals[slot];
}

/** Last snapshot that still had a frame — the terminal one is empty by definition. */
export function lastLiveSnapshot(snapshots: readonly Snapshot[]): Snapshot | undefined {
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot !== undefined && snapshot.callStack.length > 0) {
      return snapshot;
    }
  }
  return undefined;
}

/**
 * What the terminal snapshot has to say. The call stack is empty there, so the numbers come
 * from the history around it: the last frame that still existed carries the result, and the
 * depths carry how far the recursion went.
 *
 * `undefined` for a run that did not finish — a stopped run has an error banner instead.
 */
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
    // A reference the run disagrees with is a bug report, not a badge; it is simply not shown.
    referenceValue:
      entry !== undefined && entry.expectedResult === resultValue
        ? entry.expectedResult
        : undefined,
  };
}

/**
 * First step of the run that stood at each byte offset of `listing`. Clicking an instruction
 * row seeks there, so the map is keyed by offset and scoped to one method — the same offset
 * in another method is another instruction.
 */
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

/** Same idea for the source panel: the first step the run spent on each line of the file. */
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
