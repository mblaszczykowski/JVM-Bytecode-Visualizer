/**
 * The application state machine and the two load paths that feed it.
 *
 * One discriminated union, no boolean flags: a view is a function of `status`, and the
 * failures that still have something to show (`vm-error`, `step-limit`) keep the program in
 * `error` so the grid and the transport stay alive over the history collected so far
 * (ADR-0001).
 *
 * `AppModel` holds that lifecycle together with the three things that live alongside it —
 * the editor, the compile service and the examples — under one reducer, because they are not
 * independent: a load closes the editor, a compile answer revives the service badge, and a
 * manifest that never arrived must not erase a program the reader already opened.
 */

import { parseClassFile } from '../core/classfile';
import { DEFAULT_MAX_STEPS } from '../core/interpreter';

import type { CompileDiagnostic, CompileResult } from './compile-client';
import { toAppError, type AppError, type CompileFailure } from './errors';
import { fetchExampleResources } from './examples';
import type { ExampleEntry } from './manifest';
import { buildProgram, type LoadedProgram } from './program';

export type AppState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly label: string }
  | { readonly status: 'ready'; readonly program: LoadedProgram }
  | {
      readonly status: 'error';
      readonly error: AppError;
      /** Present when the run produced history before failing. */
      readonly program: LoadedProgram | undefined;
    };

/** Anything larger is not hand-written Java, and parsing it would block the tab. */
export const MAX_UPLOAD_BYTES = 512 * 1024;

/** Ceiling for "Raise the limit"; beyond this the history costs more memory than it is worth. */
export const MAX_STEP_LIMIT = 500_000;

const STEP_LIMIT_FACTOR = 5;

export const IDLE: AppState = { status: 'idle' };

export function loadingState(label: string): AppState {
  return { status: 'loading', label };
}

export function failedState(error: AppError): AppState {
  return { status: 'error', error, program: undefined };
}

/** The program a state can still display, if any. */
export function programOf(state: AppState): LoadedProgram | undefined {
  switch (state.status) {
    case 'ready':
      return state.program;
    case 'error':
      return state.program;
    case 'idle':
    case 'loading':
      return undefined;
  }
}

/** Next step limit for the banner action, or `undefined` once the ceiling is reached. */
export function raisedStepLimit(current: number): number | undefined {
  if (current >= MAX_STEP_LIMIT) {
    return undefined;
  }
  return Math.min(current * STEP_LIMIT_FACTOR, MAX_STEP_LIMIT);
}

/** A finished run is `ready` unless it stopped early — then the history is kept in `error`. */
export function stateFor(program: LoadedProgram): AppState {
  switch (program.outcome.kind) {
    case 'completed':
      return { status: 'ready', program };
    case 'vm-error':
      return { status: 'error', error: { kind: 'vm', error: program.outcome.error }, program };
    case 'step-limit':
      return {
        status: 'error',
        error: { kind: 'step-limit', limit: program.outcome.limit },
        program,
      };
  }
}

export async function loadExampleState(
  entry: ExampleEntry,
  maxSteps: number = DEFAULT_MAX_STEPS,
): Promise<AppState> {
  try {
    const resources = await fetchExampleResources(entry);
    return stateFor(
      buildProgram({
        origin: { kind: 'example', entry },
        classFile: parseClassFile(resources.classBytes),
        source: { fileName: entry.sourceFile, text: resources.source },
        maxSteps,
      }),
    );
  } catch (error) {
    return failedState(toAppError(error));
  }
}

export async function loadUploadState(
  file: File,
  maxSteps: number = DEFAULT_MAX_STEPS,
): Promise<AppState> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return failedState({
      kind: 'file-too-large',
      fileName: file.name,
      bytes: file.size,
      limit: MAX_UPLOAD_BYTES,
    });
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    return failedState({
      kind: 'file-unreadable',
      fileName: file.name,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return stateFor(
      buildProgram({
        origin: { kind: 'upload', fileName: file.name },
        classFile: parseClassFile(bytes),
        maxSteps,
      }),
    );
  } catch (error) {
    return failedState(toAppError(error));
  }
}

export interface CompiledClass {
  readonly className: string;
  readonly classBytes: ArrayBuffer;
  /** The `.java` that produced the bytes — the source panel shows exactly what was written. */
  readonly source: string;
}

/** The compile editor lands on the same path as an upload, only with its source in hand. */
export function loadCompiledState(
  compiled: CompiledClass,
  maxSteps: number = DEFAULT_MAX_STEPS,
): AppState {
  try {
    return stateFor(
      buildProgram({
        origin: { kind: 'compiled', className: compiled.className },
        classFile: parseClassFile(compiled.classBytes),
        source: { fileName: `${compiled.className}.java`, text: compiled.source },
        maxSteps,
      }),
    );
  } catch (error) {
    return failedState(toAppError(error));
  }
}

/** Same class file and source, a different step limit — the "Raise the limit" action. */
export function rerunState(program: LoadedProgram, maxSteps: number): AppState {
  try {
    return stateFor(
      buildProgram({
        origin: program.origin,
        classFile: program.classFile,
        source: sourceOf(program),
        maxSteps,
      }),
    );
  } catch (error) {
    return failedState(toAppError(error));
  }
}

/** Uploads have no source — feeding the placeholder lines back would fake one. */
function sourceOf(program: LoadedProgram): { fileName: string; text: string } | undefined {
  return program.origin.kind === 'upload'
    ? undefined
    : { fileName: program.sourceFileName, text: program.sourceLines.join('\n') };
}

/**
 * Availability of the optional compile service. `unavailable` is the health check having
 * failed at start-up — the editor never appears and the application looks complete without
 * it; `degraded` is the service dropping out mid-session, which is worth saying out loud
 * because the editor is already open with the reader's source in it.
 */
export type CompilerAvailability =
  'unconfigured' | 'checking' | 'online' | 'degraded' | 'unavailable';

/**
 * The editor is a view over the grid, not a stage of the program lifecycle, so it stays out
 * of `AppState`: `error` plus an open editor is a legal combination, and folding one into the
 * other would either duplicate every status or make that combination unrepresentable.
 */
export type EditorView =
  | { readonly kind: 'closed' }
  | { readonly kind: 'editing'; readonly diagnostics: readonly CompileDiagnostic[] }
  | { readonly kind: 'compiling' };

/** Whether the bundled examples can be offered — an availability, not a stage of the run. */
export type ExamplesStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: readonly ExampleEntry[] }
  | { readonly kind: 'failed'; readonly error: AppError };

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];
const NO_ENTRIES: readonly ExampleEntry[] = [];

export const CLOSED_EDITOR: EditorView = { kind: 'closed' };
export const EDITING: EditorView = { kind: 'editing', diagnostics: NO_DIAGNOSTICS };

export interface AppModel {
  readonly load: AppState;
  readonly editor: EditorView;
  readonly compiler: CompilerAvailability;
  readonly examples: ExamplesStatus;
  /** The compile outcome that belongs in the banner rather than next to the source. */
  readonly compileFailure: CompileFailure | undefined;
  /**
   * The newest request the reader issued. Loads and compiles run past their own screen —
   * an answer that comes back carrying an older token lost the race and is dropped, so a
   * slow compile can never write into an editor that has since closed or moved on.
   */
  readonly token: number;
}

export type AppAction =
  | { readonly kind: 'load-started'; readonly token: number; readonly label: string }
  | { readonly kind: 'load-settled'; readonly token: number; readonly state: AppState }
  | { readonly kind: 'examples-loaded'; readonly entries: readonly ExampleEntry[] }
  | { readonly kind: 'examples-failed'; readonly error: AppError }
  | { readonly kind: 'compiler-checked'; readonly healthy: boolean }
  | { readonly kind: 'editor-opened' }
  | { readonly kind: 'editor-closed'; readonly token: number }
  | { readonly kind: 'compile-started'; readonly token: number }
  | { readonly kind: 'compile-settled'; readonly token: number; readonly result: CompileResult };

export function initialAppModel(compilerConfigured: boolean): AppModel {
  return {
    load: IDLE,
    editor: CLOSED_EDITOR,
    compiler: compilerConfigured ? 'checking' : 'unconfigured',
    examples: { kind: 'loading' },
    compileFailure: undefined,
    token: 0,
  };
}

export function appReducer(model: AppModel, action: AppAction): AppModel {
  switch (action.kind) {
    case 'load-started':
      // A new program takes the grid back; the draft itself survives outside the model.
      return {
        ...model,
        load: loadingState(action.label),
        editor: CLOSED_EDITOR,
        compileFailure: undefined,
        token: action.token,
      };
    case 'load-settled':
      return action.token === model.token ? { ...model, load: action.state } : model;
    case 'examples-loaded':
      return { ...model, examples: { kind: 'ready', entries: action.entries } };
    case 'examples-failed':
      // Whether examples can be offered, not what the application is doing: a manifest that
      // never arrived leaves a program loaded from anywhere else exactly where it was.
      return { ...model, examples: { kind: 'failed', error: action.error } };
    case 'compiler-checked':
      return { ...model, compiler: action.healthy ? 'online' : 'unavailable' };
    case 'editor-opened':
      return { ...model, editor: EDITING, compileFailure: undefined };
    case 'editor-closed':
      return { ...model, editor: CLOSED_EDITOR, compileFailure: undefined, token: action.token };
    case 'compile-started':
      return {
        ...model,
        editor: { kind: 'compiling' },
        compileFailure: undefined,
        token: action.token,
      };
    case 'compile-settled':
      return action.token === model.token ? settleCompile(model, action.result) : model;
  }
}

function settleCompile(model: AppModel, result: CompileResult): AppModel {
  const compiler = compilerAfter(model.compiler, result);

  switch (result.kind) {
    case 'compiled':
      // The load the caller starts next closes the editor and shows the run instead.
      return { ...model, compiler };
    case 'diagnostics':
      return {
        ...model,
        compiler,
        editor: { kind: 'editing', diagnostics: result.diagnostics },
        compileFailure: undefined,
      };
    case 'rate-limited':
    case 'unavailable':
      // The draft stays on screen: the source is fine, the service is not.
      return { ...model, compiler, editor: EDITING, compileFailure: result };
  }
}

/**
 * Any answer at all — a class file, javac diagnostics, even a rate limit — proves the service
 * is up, so a session that once went `degraded` finds its way back. A service that never
 * answered the health check stays where it is: the editor it hides was never offered.
 */
function compilerAfter(current: CompilerAvailability, result: CompileResult): CompilerAvailability {
  if (current !== 'online' && current !== 'degraded') {
    return current;
  }
  return result.kind === 'unavailable' ? 'degraded' : 'online';
}

/** Examples to offer; a manifest still in flight or refused simply has none. */
export function exampleEntriesOf(status: ExamplesStatus): readonly ExampleEntry[] {
  switch (status.kind) {
    case 'ready':
      return status.entries;
    case 'loading':
    case 'failed':
      return NO_ENTRIES;
  }
}

/** The failure the examples column has to own up to, if any. */
export function examplesErrorOf(status: ExamplesStatus): AppError | undefined {
  return status.kind === 'failed' ? status.error : undefined;
}
