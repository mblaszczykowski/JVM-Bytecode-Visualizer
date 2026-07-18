/**
 * The application state machine and the two load paths that feed it.
 *
 * One discriminated union, no boolean flags: a view is a function of `status`, and the
 * failures that still have something to show (`vm-error`, `step-limit`) keep the program in
 * `error` so the grid and the transport stay alive over the history collected so far
 * (ADR-0001).
 */

import { parseClassFile } from '../core/classfile';
import { DEFAULT_MAX_STEPS } from '../core/interpreter';

import { toAppError, type AppError } from './errors';
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
  return stateFor(
    buildProgram({
      origin: program.origin,
      classFile: program.classFile,
      source: sourceOf(program),
      maxSteps,
    }),
  );
}

/** Uploads have no source — feeding the placeholder lines back would fake one. */
function sourceOf(program: LoadedProgram): { fileName: string; text: string } | undefined {
  return program.origin.kind === 'upload'
    ? undefined
    : { fileName: program.sourceFileName, text: program.sourceLines.join('\n') };
}
