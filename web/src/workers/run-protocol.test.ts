import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile, type MethodInfo } from '../core/classfile';
import { execute, NO_SNAPSHOTS, type Snapshot } from '../core/interpreter';
import { frameOf, snapshotOf } from '../core/interpreter/__fixtures__/snapshots';
import {
  ConstantPoolBuilder,
  syntheticClass,
} from '../core/interpreter/__fixtures__/synthetic-class';
import { readExampleBytes } from '../services/__fixtures__/example-files';

import {
  runAndStream,
  runOptionsOf,
  SnapshotDecoder,
  SnapshotEncoder,
  SNAPSHOTS_PER_MESSAGE,
  withHistory,
  withoutHistory,
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
  const decoder = new SnapshotDecoder();
  return events.flatMap((event) =>
    event.kind === 'snapshots' ? decoder.decode(structuredClone(event)) : [],
  );
}

function fallApart(reason: string): never {
  throw new Error(reason);
}

function classFileThatThrows(reason: string): ClassFile {
  return {
    ...gcd(),
    get methods(): readonly MethodInfo[] {
      return fallApart(reason);
    },
  };
}

describe('runAndStream', () => {
  it('sends a large unchanged heap array once across multiple worker messages', () => {
    const pool = new ConstantPoolBuilder();
    const length = 200_000;
    const size = pool.integer(length);
    const events = collect(
      commandFor(
        syntheticClass({
          pool,
          methods: [
            {
              name: 'main',
              descriptor: '([Ljava/lang/String;)V',
              maxLocals: 1,
              maxStack: 1,
              code: [0x12, size, 0xbc, 0x0a, 0x4b, 0xa7, 0x00, 0x00],
            },
          ],
        }),
        SNAPSHOTS_PER_MESSAGE * 3,
      ),
    );
    const batches = events.filter((event) => event.kind === 'snapshots');

    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.objects.length)).toEqual([1, 0, 0]);
    expect(
      batches
        .flatMap((batch) => batch.objects)
        .reduce(
          (total, object) =>
            total + (object.kind === 'int-array' ? object.elements.length : object.fields.length),
          0,
        ),
    ).toBe(length);
    const history = streamed(events);
    const before = history[SNAPSHOTS_PER_MESSAGE - 1];
    const after = history[SNAPSHOTS_PER_MESSAGE];
    expect(after?.heap).toBe(before?.heap);
    expect(after?.heap[0]).toBe(before?.heap[0]);
  });

  it.each(['BubbleSort', 'Collatz'])(
    'preserves every state of %s across individually cloned batches',
    (name) => {
      const original = execute(parseClassFile(readExampleBytes(`${name}.class`))).snapshots;
      const encoder = new SnapshotEncoder();
      const decoder = new SnapshotDecoder();
      const decoded = original.flatMap((snapshot) =>
        decoder.decode(structuredClone(encoder.encode([snapshot]))),
      );

      expect(decoded).toEqual(original);
    },
  );

  it('does not repeat large frames, console output or external pools in later messages', () => {
    const frame = frameOf({
      methodName: 'main',
      methodDescriptor: '()V',
      pc: 0,
      locals: new Array<number>(10_000).fill(0),
      localNames: [],
      operandStack: [],
    });
    const consoleOutput = ['large-console-output'.repeat(10_000)];
    const externals = [{ className: 'java/lang/String', label: 'large-string'.repeat(10_000) }];
    const history = Array.from({ length: SNAPSHOTS_PER_MESSAGE * 2 }, (_, step) =>
      snapshotOf({ step, callStack: [frame], consoleOutput, externals }),
    );
    const encoder = new SnapshotEncoder();
    const first = encoder.encode(history.slice(0, SNAPSHOTS_PER_MESSAGE));
    const second = encoder.encode(history.slice(SNAPSHOTS_PER_MESSAGE));

    expect(first.frames).toHaveLength(1);
    expect(second.frames).toHaveLength(0);
    expect(second.consoleOutputs).toHaveLength(0);
    expect(second.externalPools).toHaveLength(0);
    expect(JSON.stringify(second).length).toBeLessThan(SNAPSHOTS_PER_MESSAGE * 120);
    const decoder = new SnapshotDecoder();
    const before = decoder.decode(structuredClone(first)).at(-1);
    const after = decoder.decode(structuredClone(second))[0];
    expect(after?.callStack[0]).toBe(before?.callStack[0]);
    expect(after?.consoleOutput).toBe(before?.consoleOutput);
    expect(after?.externals).toBe(before?.externals);
  });

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
    if (done?.kind !== 'done') {
      throw new Error('the run did not finish');
    }

    expect(done.result).toEqual({ kind: 'completed' });
    expect(Object.hasOwn(done.result, 'snapshots')).toBe(false);
  });

  it('posts nothing the structured clone of the worker boundary cannot carry', () => {
    const events = collect(commandFor(gcd()));

    expect(events.map((event) => event.kind)).toEqual(['snapshots', 'done']);
    for (const event of events) {
      expect(() => structuredClone(event)).not.toThrow();
    }
  });

  it('carries a failure across the structured clone, still naming the frame that threw', () => {
    const events = collect(commandFor(classFileThatThrows('the class file fell apart')));

    const failed = events.at(-1);
    if (failed?.kind !== 'failed') {
      throw new Error('the run reported no failure');
    }
    expect(failed.error.stack).toContain('fallApart');

    const carried = structuredClone(failed);
    expect(carried.error).toBeInstanceOf(Error);
    expect(carried.error.message).toBe('the class file fell apart');
    expect(carried.error.stack).toBe(failed.error.stack);
  });

  it('posts a failure the boundary can carry even when the thrown error itself cannot be', () => {
    const uncloneable = new Error('the class file fell apart', { cause: () => undefined });
    expect(() => structuredClone(uncloneable)).toThrow();

    const events = collect(
      commandFor({
        ...gcd(),
        get methods(): readonly MethodInfo[] {
          throw uncloneable;
        },
      }),
    );

    const failed = events.at(-1);
    if (failed?.kind !== 'failed') {
      throw new Error('the run reported no failure');
    }
    expect(() => structuredClone(failed)).not.toThrow();
    expect(structuredClone(failed).error.message).toBe('the class file fell apart');
  });

  it('reports an error that carries no stack of its own', () => {
    const stackless = new Error('the class file fell apart');
    delete stackless.stack;

    const events = collect(
      commandFor({
        ...gcd(),
        get methods(): readonly MethodInfo[] {
          throw stackless;
        },
      }),
    );

    expect(events).toEqual([{ kind: 'failed', error: new Error('the class file fell apart') }]);
  });

  it('lets a failure to hand the history over reach the worker, so the run can fall back', () => {
    const events: RunEvent[] = [];
    const refuseTheHistory = (event: RunEvent): void => {
      if (event.kind === 'snapshots') {
        throw new DOMException('a snapshot could not be cloned', 'DataCloneError');
      }
      events.push(event);
    };

    expect(() => {
      runAndStream(commandFor(gcd()), refuseTheHistory);
    }).toThrow('a snapshot could not be cloned');

    expect(events).toHaveLength(0);
  });

  it('carries a VM error through as the outcome of a finished run', () => {
    const dividesByZero = syntheticClass({
      methods: [
        { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0x04, 0x03, 0x6c, 0xb1] },
      ],
    });

    const events = collect(commandFor(dividesByZero));

    const done = events.at(-1);
    if (done?.kind !== 'done') {
      throw new Error('the run did not finish');
    }
    expect(done.result.kind).toBe('vm-error');
    expect(withHistory(done.result, streamed(events))).toEqual(
      execute(dividesByZero, { entryMethod: 'main', maxSteps: 20_000 }),
    );
  });

  it('reports an interpreter that threw, rather than leaving the caller waiting', () => {
    expect(collect(commandFor(classFileThatThrows('the class file fell apart')))).toEqual([
      { kind: 'failed', error: new Error('the class file fell apart') },
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
      { kind: 'failed', error: new Error('the class file fell apart') },
    ]);
  });
});

describe('withHistory', () => {
  it('puts the history back on whichever outcome the run reached', () => {
    const snapshots: readonly Snapshot[] = [snapshotOf({ step: 0, callStack: [] })];

    expect(withHistory({ kind: 'completed' }, snapshots).snapshots).toBe(snapshots);
    expect(withHistory({ kind: 'step-limit', limit: 25 }, snapshots)).toEqual({
      kind: 'step-limit',
      limit: 25,
      snapshots,
    });
  });
});

describe('withoutHistory', () => {
  it('takes the history off whichever outcome the run reached', () => {
    const snapshots: readonly Snapshot[] = [snapshotOf({ step: 0, callStack: [] })];

    expect(withoutHistory({ kind: 'completed', snapshots })).toEqual({ kind: 'completed' });
    expect(withoutHistory({ kind: 'step-limit', limit: 25, snapshots: NO_SNAPSHOTS })).toEqual({
      kind: 'step-limit',
      limit: 25,
    });
  });
});

describe('runOptionsOf', () => {
  it('carries every field of the command into the options execute takes', () => {
    const command: RunCommand = {
      classFile: gcd(),
      entryMethod: 'gcd',
      entryDescriptor: '(II)I',
      maxSteps: 7,
    };

    expect(runOptionsOf(command)).toEqual({
      entryMethod: 'gcd',
      entryDescriptor: '(II)I',
      maxSteps: 7,
    });
  });
});
