import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile, type MethodInfo } from '../core/classfile';
import { execute, NO_SNAPSHOTS, type Snapshot } from '../core/interpreter';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';
import { readExampleBytes } from '../services/__fixtures__/example-files';

import {
  runAndStream,
  SNAPSHOTS_PER_MESSAGE,
  withHistory,
  type RunCommand,
  type RunEvent,
} from './run-protocol';

function gcd(): ClassFile {
  return parseClassFile(readExampleBytes('Gcd.class'));
}

function commandFor(classFile: ClassFile, maxSteps = 20_000): RunCommand {
  return { classFile, entryMethod: 'main', maxSteps };
}

function collect(command: RunCommand): readonly RunEvent[] {
  const events: RunEvent[] = [];
  runAndStream(command, (event) => {
    events.push(event);
  });
  return events;
}

function streamed(events: readonly RunEvent[]): readonly Snapshot[] {
  return events.flatMap((event) => (event.kind === 'snapshots' ? [...event.snapshots] : []));
}

describe('runAndStream', () => {
  it('hands back exactly the history the interpreter recorded', () => {
    const classFile = gcd();
    const events = collect(commandFor(classFile));

    const done = events.at(-1);
    if (done?.kind !== 'done') {
      throw new Error('the run did not finish');
    }
    expect(withHistory(done.result, streamed(events))).toEqual(
      execute(classFile, { entryMethod: 'main', maxSteps: 20_000 }),
    );
  });

  it('cuts the history into batches of a fixed size, the last one short', () => {
    const events = collect(
      commandFor(
        syntheticClass({
          methods: [
            { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] },
          ],
        }),
        SNAPSHOTS_PER_MESSAGE * 2 + 1,
      ),
    );

    expect(
      events.map((event) => (event.kind === 'snapshots' ? event.snapshots.length : event.kind)),
    ).toEqual([SNAPSHOTS_PER_MESSAGE, SNAPSHOTS_PER_MESSAGE, 1, 'done']);
  });

  it('sends the outcome without the history, which has already been sent', () => {
    const done = collect(commandFor(gcd())).at(-1);

    expect(done).toEqual({ kind: 'done', result: { kind: 'completed', snapshots: NO_SNAPSHOTS } });
  });

  it('reports an interpreter that threw, rather than leaving the caller waiting', () => {
    const classFile = gcd();
    const unreadable: ClassFile = {
      ...classFile,
      get methods(): readonly MethodInfo[] {
        throw new Error('the class file fell apart');
      },
    };

    expect(collect(commandFor(unreadable))).toEqual([
      { kind: 'failed', reason: 'the class file fell apart' },
    ]);
  });

  it('names a thrown value that is not an Error', () => {
    const classFile = gcd();
    const unreadable: ClassFile = {
      ...classFile,
      get methods(): readonly MethodInfo[] {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the worker has to survive whatever the interpreter throws, Error or not
        throw 'the class file fell apart';
      },
    };

    expect(collect(commandFor(unreadable))).toEqual([
      { kind: 'failed', reason: 'the class file fell apart' },
    ]);
  });
});

describe('withHistory', () => {
  it('puts the history back on whichever outcome the run reached', () => {
    const snapshots: readonly Snapshot[] = [{ step: 0, callStack: [] }];

    expect(withHistory({ kind: 'completed' }, snapshots).snapshots).toBe(snapshots);
    expect(withHistory({ kind: 'step-limit', limit: 25 }, snapshots)).toEqual({
      kind: 'step-limit',
      limit: 25,
      snapshots,
    });
  });
});
