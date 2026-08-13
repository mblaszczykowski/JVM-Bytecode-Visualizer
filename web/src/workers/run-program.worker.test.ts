import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { execute } from '../core/interpreter';
import { readExampleBytes } from '../services/__fixtures__/example-files';

import { withHistory, type RunCommand, type RunEvent } from './run-protocol';

afterEach(() => {
  vi.restoreAllMocks();
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

  it('registers one listener, however many times the module is imported', async () => {
    const classFile = parseClassFile(readExampleBytes('Gcd.class'));

    const posted = await postedFor({ classFile, entryMethod: 'main', maxSteps: 20_000 });

    expect(posted.filter((event) => event.kind === 'done')).toHaveLength(1);
  });

  it('carries the whole command across the structured clone the worker boundary needs', () => {
    const classFile = parseClassFile(readExampleBytes('Gcd.class'));
    const command: RunCommand = { classFile, entryMethod: 'main', maxSteps: 20_000 };

    expect(() => structuredClone(command)).not.toThrow();
    expect(structuredClone(command).classFile.thisClassName).toBe(classFile.thisClassName);
  });
});
