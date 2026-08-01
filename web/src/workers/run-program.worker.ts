/**
 * Runs one program off the main thread and streams its history back.
 *
 * One worker per run, deliberately. `execute()` is a synchronous loop with no yield point in
 * it (ADR-0001, and moving one into `core/**` would put a UI concern in the domain), so
 * `terminate()` is the only thing that can actually stop a run that has already started —
 * everything short of it merely ignores the answer. Throwing the whole worker away also
 * releases the history with it, which for a run at the step-limit ceiling is ~275 MB.
 *
 * The worker owns no decisions: the entry method is chosen on the main thread, where the
 * class file is parsed and the method picker lives, and named in the command.
 */

import { execute } from '../core/interpreter';

import {
  NO_SNAPSHOTS,
  SNAPSHOTS_PER_MESSAGE,
  withHistory,
  type RunCommand,
  type RunEvent,
} from './run-protocol';

/**
 * `lib.dom` and `lib.webworker` describe the same global names with different types and
 * cannot both be on `lib`, so the two members this file uses are declared rather than the
 * worker lib pulled in wholesale — which would break every other file in the project.
 */
interface RunScope {
  postMessage(event: RunEvent): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RunCommand>) => void): void;
}

const scope = self as unknown as RunScope;

scope.addEventListener('message', ({ data }) => {
  let result;
  try {
    result = execute(data.classFile, {
      entryMethod: data.entryMethod,
      maxSteps: data.maxSteps,
    });
  } catch (error) {
    // Only the error type survives a clone, so it is flattened here rather than half-lost.
    scope.postMessage({
      kind: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const { snapshots } = result;
  for (let from = 0; from < snapshots.length; from += SNAPSHOTS_PER_MESSAGE) {
    scope.postMessage({
      kind: 'snapshots',
      snapshots: snapshots.slice(from, from + SNAPSHOTS_PER_MESSAGE),
    });
  }
  scope.postMessage({ kind: 'done', result: withHistory(result, NO_SNAPSHOTS) });
});
