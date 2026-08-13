import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { execute } from '../core/interpreter';
import { readExampleBytes } from '../services/__fixtures__/example-files';

import { withHistory, type RunCommand, type RunEvent } from './run-protocol';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function postedFor(command: RunCommand): Promise<readonly RunEvent[]> {
  const posted: RunEvent[] = [];
  vi.spyOn(self, 'postMessage').mockImplementation((event: unknown) => {
    posted.push(event as RunEvent);
  });

  await import('./run-program.worker');
  self.dispatchEvent(new MessageEvent('message', { data: command }));

  return posted;
}

describe('the run worker', () => {
  it('answers a command with the history the interpreter recorded', async () => {
    const classFile = parseClassFile(readExampleBytes('Gcd.class'));

    const posted = await postedFor({ classFile, entryMethod: 'main', maxSteps: 20_000 });

    const done = posted.at(-1);
    if (done?.kind !== 'done') {
      throw new Error('the worker did not finish the run');
    }
    const snapshots = posted.flatMap((event) =>
      event.kind === 'snapshots' ? [...event.snapshots] : [],
    );
    expect(withHistory(done.result, snapshots)).toEqual(
      execute(classFile, { entryMethod: 'main', maxSteps: 20_000 }),
    );
  });
});
