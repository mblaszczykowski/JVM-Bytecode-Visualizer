import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseClassFile, type ClassFile, type MethodInfo } from '../core/classfile';
import { DEFAULT_MAX_STEPS } from '../core/interpreter';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import {
  readExampleBytes,
  readExampleManifest,
  readFixtureBytes,
} from './__fixtures__/example-files';
import { exampleRoutes, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import { uploadFile } from './__fixtures__/upload-file';
import {
  affordableStepLimit,
  IDLE,
  loadCompiledState,
  loadExampleState,
  loadUploadState,
  MAX_STEP_LIMIT,
  MAX_UPLOAD_BYTES,
  programOf,
  raisedStepLimit,
  rerunState,
  runFromState,
  stateFor,
} from './app-state';
import { describeAppError } from './errors';
import { exampleUrl } from './examples';
import type { ExampleEntry, ExampleManifest } from './manifest';
import { buildProgram } from './program';
import { isRunCancelled, RunCancelled, type ProgramRunner } from './program-runner';

function factorialEntry(): ExampleEntry {
  const entry = (readExampleManifest() as ExampleManifest).examples[0];
  if (entry === undefined) {
    throw new Error('the manifest is empty');
  }
  return entry;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('example loading', () => {
  it('goes from idle to a ready program', async () => {
    stubFetch(exampleRoutes());
    expect(programOf(IDLE)).toBeUndefined();

    const state = await loadExampleState(factorialEntry());

    expect(state.status).toBe('ready');
    expect(programOf(state)?.snapshots).toHaveLength(40);
    expect(programOf(state)?.origin).toEqual({ kind: 'example', entry: factorialEntry() });
  });

  it('turns a failed download into an error state with nothing to replay', async () => {
    const entry = factorialEntry();
    stubFetch({ ...exampleRoutes(), [exampleUrl(entry.classFile)]: () => statusResponse(500) });

    const state = await loadExampleState(entry);

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'example-load', detail: { kind: 'http', status: 500 } },
      program: undefined,
    });
  });
});

describe('upload', () => {
  it('accepts a class file and executes it', async () => {
    const bytes = new Uint8Array(readExampleBytes('Gcd.class'));

    const state = await loadUploadState(uploadFile('Gcd.class', bytes));

    expect(state.status).toBe('ready');
    expect(programOf(state)?.origin).toEqual({ kind: 'upload', fileName: 'Gcd.class' });
    // No .java travels with an upload, so the source panel explains itself instead.
    expect(programOf(state)?.sourceLines[0]).toContain('No .java source');
  });

  it('rejects a file over the size limit before reading it', async () => {
    const oversized = uploadFile('Huge.class', new Uint8Array(MAX_UPLOAD_BYTES + 1));

    const state = await loadUploadState(oversized);

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'file-too-large', fileName: 'Huge.class', limit: MAX_UPLOAD_BYTES },
    });
  });

  it('reports a file that is not a class file at all', async () => {
    const text = new TextEncoder().encode('Not a class file, just some text.');

    const state = await loadUploadState(uploadFile('notes.txt', text));

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'class-file', detail: { kind: 'bad-magic', offset: 0 } },
      program: undefined,
    });
  });
});

describe('compiled source', () => {
  it('runs the class and keeps the source that produced it', async () => {
    const source = 'public class Gcd {\n    // whatever the author wrote\n}\n';

    const state = await loadCompiledState({
      className: 'Gcd',
      classBytes: readExampleBytes('Gcd.class'),
      source,
    });

    expect(state.status).toBe('ready');
    expect(programOf(state)?.origin).toEqual({ kind: 'compiled', className: 'Gcd' });
    expect(programOf(state)?.sourceFileName).toBe('Gcd.java');
    expect(programOf(state)?.sourceLines).toEqual(source.split('\n'));
  });

  it('reports bytes that are not a class file', async () => {
    const state = await loadCompiledState({
      className: 'Broken',
      classBytes: new TextEncoder().encode('not bytecode').buffer,
      source: 'public class Broken { }',
    });

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'class-file', detail: { kind: 'bad-magic' } },
    });
  });

  it('re-runs with a higher limit without losing the source', async () => {
    const program = buildProgram({
      origin: { kind: 'compiled', className: 'Loop' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      source: { fileName: 'Loop.java', text: 'public class Loop { }' },
      maxSteps: 25,
    });

    expect(programOf(await rerunState(program, 125))?.sourceLines).toEqual([
      'public class Loop { }',
    ]);
  });
});

describe('runs that stop early', () => {
  it('keeps the collected history next to a VM error', () => {
    const state = stateFor(
      buildProgram({
        origin: { kind: 'upload', fileName: 'Divide.class' },
        // iconst_1, iconst_0, idiv, return
        classFile: syntheticClass({
          methods: [
            { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0x04, 0x03, 0x6c, 0xb1] },
          ],
        }),
      }),
    );

    expect(state.status).toBe('error');
    expect(programOf(state)?.snapshots).toHaveLength(3);
  });

  it('keeps the collected history next to the step limit', () => {
    const state = stateFor(
      buildProgram({
        origin: { kind: 'upload', fileName: 'Loop.class' },
        classFile: syntheticClass({
          methods: [
            { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] },
          ],
        }),
        maxSteps: 25,
      }),
    );

    expect(state).toMatchObject({ status: 'error', error: { kind: 'step-limit', limit: 25 } });
    expect(programOf(state)?.snapshots).toHaveLength(25);
  });
});

describe('a class file with nothing to run', () => {
  it('reaches a state that still carries the program', async () => {
    const bytes = new Uint8Array(readFixtureBytes('Library.class'));

    const state = await loadUploadState(uploadFile('Library.class', bytes));

    // The outcome is a property of the program, not a gate on whether there is one.
    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'no-entry-point', className: 'Library' },
    });
    expect(programOf(state)?.methods).toHaveLength(3);
    expect(programOf(state)?.snapshots).toHaveLength(0);
  });

  it('says so as a notice rather than as a failure', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Library.class' },
      classFile: parseClassFile(readFixtureBytes('Library.class')),
    });

    const state = stateFor(program);
    expect(state.status).toBe('error');
    expect(state.status === 'error' ? describeAppError(state.error).severity : undefined).toBe(
      'info',
    );
  });
});

describe('running another method', () => {
  it('re-runs the same class file from the method the picker names', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
    });
    expect(program.entry?.name).toBe('count');

    const state = await runFromState(program, 'count');

    expect(state.status).toBe('ready');
    expect(programOf(state)?.entry?.name).toBe('count');
    expect(programOf(state)?.snapshots).toHaveLength(program.snapshots.length);
  });

  it('keeps the entry method when only the step limit changes', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
      maxSteps: 10,
    });

    expect(programOf(await rerunState(program, 200))?.entry?.name).toBe('count');
  });
});

describe('raising the step limit', () => {
  it('multiplies the previous limit by five, up to the ceiling', () => {
    expect(raisedStepLimit(20_000)).toBe(100_000);
    expect(raisedStepLimit(100_000)).toBe(MAX_STEP_LIMIT);
    expect(raisedStepLimit(200_000)).toBe(MAX_STEP_LIMIT);
  });

  it('stops offering the action at the ceiling', () => {
    expect(raisedStepLimit(MAX_STEP_LIMIT)).toBeUndefined();
  });

  /**
   * The ceiling was picked against a laptop. A phone that says it has a gigabyte cannot hold
   * the history that limit produces, and a run that dies for want of memory leaves nothing on
   * screen — so the button has to stop lower there rather than fail later.
   */
  describe('on a device that reports how much memory it has', () => {
    function withDeviceMemory(gigabytes: number | undefined, assert: () => void): void {
      const original = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
      Object.defineProperty(navigator, 'deviceMemory', {
        value: gigabytes,
        configurable: true,
      });
      try {
        assert();
      } finally {
        if (original === undefined) {
          delete (navigator as { deviceMemory?: number }).deviceMemory;
        } else {
          Object.defineProperty(navigator, 'deviceMemory', original);
        }
      }
    }

    it('keeps the full ceiling where there is memory for it', () => {
      withDeviceMemory(8, () => {
        expect(affordableStepLimit()).toBe(MAX_STEP_LIMIT);
        expect(raisedStepLimit(100_000)).toBe(MAX_STEP_LIMIT);
      });
    });

    it('lowers the ceiling on a small device, and stops the action there', () => {
      withDeviceMemory(1, () => {
        const ceiling = affordableStepLimit();

        expect(ceiling).toBeLessThan(MAX_STEP_LIMIT);
        expect(ceiling).toBeGreaterThan(DEFAULT_MAX_STEPS);
        // The first raise is the usual five-fold one; it is the second that the lower
        // ceiling catches, and where the action then stops.
        expect(raisedStepLimit(20_000)).toBe(100_000);
        expect(raisedStepLimit(100_000)).toBe(ceiling);
        expect(raisedStepLimit(ceiling)).toBeUndefined();
      });
    });

    it('leaves every rung of the reported ladder able to replay an ordinary run', () => {
      // The Device Memory API reports one of these and nothing else.
      for (const gigabytes of [0.25, 0.5, 1, 2, 4, 8]) {
        withDeviceMemory(gigabytes, () => {
          expect(affordableStepLimit()).toBeGreaterThanOrEqual(DEFAULT_MAX_STEPS);
        });
      }
    });

    it('never falls below one ordinary run, whatever it is told', () => {
      // Below anything the API reports; the floor is a guard, not a working range.
      withDeviceMemory(0.05, () => {
        expect(affordableStepLimit()).toBe(DEFAULT_MAX_STEPS);
      });
    });

    it('keeps the full ceiling where the browser does not report memory at all', () => {
      withDeviceMemory(undefined, () => {
        expect(affordableStepLimit()).toBe(MAX_STEP_LIMIT);
      });
    });
  });

  it('re-runs the same program with the new limit', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Loop.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      maxSteps: 25,
    });

    const state = await rerunState(program, 125);

    expect(state).toMatchObject({ status: 'error', error: { kind: 'step-limit', limit: 125 } });
    expect(programOf(state)?.snapshots).toHaveLength(125);
  });

  it('reports a re-run that throws instead of leaving the screen loading', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Loop.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      maxSteps: 25,
    });
    // Whatever goes wrong below the load path, the caller only ever sees a state.
    const unreadable: ClassFile = {
      ...program.classFile,
      get methods(): readonly MethodInfo[] {
        throw new Error('the class file fell apart');
      },
    };

    const state = await rerunState({ ...program, classFile: unreadable }, 125);

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'unexpected', reason: 'the class file fell apart' },
    });
  });

  it('re-runs an example without downloading it again', async () => {
    stubFetch(exampleRoutes());
    const loaded = await loadExampleState(factorialEntry(), 20);
    const program = programOf(loaded);
    if (program === undefined) {
      throw new Error('the example failed to load');
    }
    vi.unstubAllGlobals();

    const state = await rerunState(program, 100);

    expect(state.status).toBe('ready');
    expect(programOf(state)?.snapshots).toHaveLength(40);
    expect(programOf(state)?.sourceLines).toEqual(program.sourceLines);
  });
});

describe('a run the reader abandoned', () => {
  /** Every load path goes through the same funnel, so the upload one stands for all of them. */
  it('is not turned into a banner, because there is no screen left for one', async () => {
    const runner: ProgramRunner = {
      cancellable: true,
      run: () => Promise.reject(new RunCancelled()),
    };
    const file = uploadFile('Gcd.class', new Uint8Array(readExampleBytes('Gcd.class')));

    await expect(loadUploadState(file, undefined, { runner })).rejects.toSatisfy(isRunCancelled);
  });

  it('never reaches the runner at all when the class has nothing to run', async () => {
    const run = vi.fn();
    const file = uploadFile('Library.class', new Uint8Array(readFixtureBytes('Library.class')));

    const state = await loadUploadState(file, undefined, {
      runner: { cancellable: true, run },
    });

    expect(run).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: 'error', error: { kind: 'no-entry-point' } });
  });
});

describe('parsing a class file straight from bytes', () => {
  it('is the same pipeline the upload path uses', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));

    expect(classFile.thisClassName).toBe('Factorial');
  });
});
