import { execute } from '../core/interpreter';

import {
  NO_SNAPSHOTS,
  SNAPSHOTS_PER_MESSAGE,
  withHistory,
  type RunCommand,
  type RunEvent,
} from './run-protocol';

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
