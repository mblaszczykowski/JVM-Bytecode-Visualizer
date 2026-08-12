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
  appReducer,
  exampleEntriesOf,
  examplesErrorOf,
  IDLE,
  initialAppModel,
  loadCompiledState,
  loadExampleState,
  loadUploadState,
  MAX_STEP_LIMIT,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  programOf,
  raisedStepLimit,
  rerunState,
  runFromState,
  stateFor,
  type AppAction,
  type AppModel,
  type AppState,
} from './app-state';
import { COMPILER_BUSY, type CompileResult } from './compile-client';
import { describeAppError, type AppError } from './errors';
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

  it('holds the compile service to the same size limit as an upload', async () => {
    const state = await loadCompiledState({
      className: 'Huge',
      classBytes: new ArrayBuffer(MAX_UPLOAD_BYTES + 1),
      source: 'public class Huge { }',
    });

    expect(state).toMatchObject({
      status: 'error',
      error: {
        kind: 'file-too-large',
        fileName: 'Huge.class',
        bytes: MAX_UPLOAD_BYTES + 1,
        limit: MAX_UPLOAD_BYTES,
      },
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
        expect(raisedStepLimit(20_000)).toBe(100_000);
        expect(raisedStepLimit(100_000)).toBe(ceiling);
        expect(raisedStepLimit(ceiling)).toBeUndefined();
      });
    });

    it('leaves every rung of the reported ladder able to replay an ordinary run', () => {
      for (const gigabytes of [0.25, 0.5, 1, 2, 4, 8]) {
        withDeviceMemory(gigabytes, () => {
          expect(affordableStepLimit()).toBeGreaterThanOrEqual(DEFAULT_MAX_STEPS);
        });
      }
    });

    it('never falls below one ordinary run, whatever it is told', () => {
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

  it('leaves the reader the history they were already replaying when the re-run fails', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Loop.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      maxSteps: 25,
    });
    const runner: ProgramRunner = {
      cancellable: true,
      run: () => Promise.reject(new Error('the tab ran out of memory')),
    };

    const state = await rerunState(program, 125, { runner });

    expect(state).toMatchObject({ status: 'error', error: { kind: 'unexpected' } });
    expect(programOf(state)).toBe(program);
    expect(programOf(state)?.snapshots).toHaveLength(25);
  });

  it('keeps the program when a run of another method fails', async () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
    });
    const runner: ProgramRunner = {
      cancellable: true,
      run: () => Promise.reject(new Error('the worker died')),
    };

    expect(programOf(await runFromState(program, 'count', { runner }))).toBe(program);
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

describe('the upload limit', () => {
  it('is written for the reader from the same number the loader enforces', () => {
    const { message } = describeAppError({
      kind: 'file-too-large',
      fileName: 'Huge.class',
      bytes: MAX_UPLOAD_BYTES + 1,
      limit: MAX_UPLOAD_BYTES,
    });

    expect(message).toContain(`the upload limit is ${MAX_UPLOAD_LABEL}`);
  });
});

describe('the application model', () => {
  function readyState(): AppState {
    return stateFor(
      buildProgram({
        origin: { kind: 'upload', fileName: 'Return.class' },
        classFile: syntheticClass({
          methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb1] }],
        }),
      }),
    );
  }

  function started(token: number, label = 'Loading Factorial'): AppAction {
    return { kind: 'load-started', token, label, cancellable: true };
  }

  function reduce(model: AppModel, ...actions: readonly AppAction[]): AppModel {
    return actions.reduce(appReducer, model);
  }

  const compiled: CompileResult = {
    kind: 'compiled',
    className: 'Gcd',
    classBytes: new ArrayBuffer(0),
  };

  const busy: CompileResult = {
    kind: 'unavailable',
    reason: {
      kind: 'http',
      status: 503,
      service: {
        code: COMPILER_BUSY,
        message: 'the compile service is at capacity, retry in a moment',
        retryAfterSeconds: 5,
      },
    },
  };

  const gone: CompileResult = {
    kind: 'unavailable',
    reason: { kind: 'network', reason: 'Failed to fetch' },
  };

  describe('the load pipeline', () => {
    it('names the run it is waiting for and puts the editor away', () => {
      const model = reduce(initialAppModel(true), { kind: 'editor-opened' }, started(1));

      expect(model.load).toEqual({
        status: 'loading',
        label: 'Loading Factorial',
        steps: undefined,
        cancellable: true,
        resume: IDLE,
      });
      expect(model.editor).toEqual({ kind: 'closed' });
    });

    it('counts the steps of that run, and of no other', () => {
      const loading = reduce(initialAppModel(true), started(1));

      const counted = appReducer(loading, { kind: 'load-progress', token: 1, steps: 50_000 });
      expect(counted.load).toMatchObject({ status: 'loading', steps: 50_000 });
      expect(appReducer(loading, { kind: 'load-progress', token: 2, steps: 50_000 })).toBe(loading);
    });

    it('has nothing to count once the run has settled', () => {
      const settled = reduce(initialAppModel(true), started(1), {
        kind: 'load-settled',
        token: 1,
        state: readyState(),
      });

      expect(appReducer(settled, { kind: 'load-progress', token: 1, steps: 10 })).toBe(settled);
    });

    it('takes the answer of the run it is waiting for', () => {
      const ready = readyState();

      const model = reduce(initialAppModel(true), started(1), {
        kind: 'load-settled',
        token: 1,
        state: ready,
      });

      expect(model.load).toBe(ready);
    });

    it('drops the answer of a run that a later one replaced', () => {
      const first = readyState();
      const second = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        started(2, 'Reading Gcd.class'),
        { kind: 'load-settled', token: 1, state: first },
        { kind: 'load-settled', token: 2, state: second },
      );

      expect(model.load).toBe(second);
    });

    it('still takes the answer of a run the reader opened and closed the editor over', () => {
      const ready = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        { kind: 'editor-opened' },
        { kind: 'editor-closed', token: 2 },
        { kind: 'load-settled', token: 1, state: ready },
      );

      expect(model.load).toBe(ready);
    });

    it('still takes the answer of a run the reader started a compilation over', () => {
      const ready = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 2 },
        { kind: 'load-settled', token: 1, state: ready },
      );

      expect(model.load).toBe(ready);
    });

    it('goes back to the screen the reader cancelled over', () => {
      const ready = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        { kind: 'load-settled', token: 1, state: ready },
        started(2, 'Re-running with 100,000 steps'),
        { kind: 'load-cancelled', token: 3 },
      );

      expect(model.load).toBe(ready);
    });

    it('keeps the first screen to go back to when a second run starts over the first', () => {
      const ready = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        { kind: 'load-settled', token: 1, state: ready },
        started(2),
        started(3),
        { kind: 'load-cancelled', token: 4 },
      );

      expect(model.load).toBe(ready);
    });

    it('has nothing to cancel when no run is in flight', () => {
      const idle = initialAppModel(true);

      expect(appReducer(idle, { kind: 'load-cancelled', token: 1 })).toBe(idle);
    });

    it('drops a cancelled run that answers anyway', () => {
      const ready = readyState();

      const model = reduce(
        initialAppModel(true),
        started(1),
        { kind: 'load-cancelled', token: 2 },
        { kind: 'load-settled', token: 1, state: ready },
      );

      expect(model.load).toBe(IDLE);
    });
  });

  describe('the compile pipeline', () => {
    it('opens the editor with no diagnostics and no banner', () => {
      const model = reduce(initialAppModel(true), { kind: 'editor-opened' });

      expect(model.editor).toEqual({ kind: 'editing', diagnostics: [] });
      expect(model.compileFailure).toBeUndefined();
    });

    it('keeps javac diagnostics in the editor rather than in the banner', () => {
      const diagnostics = [
        { line: 3, column: 12, kind: 'error' as const, message: "';' expected" },
      ];

      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: { kind: 'diagnostics', diagnostics } },
      );

      expect(model.editor).toEqual({ kind: 'editing', diagnostics });
      expect(model.compileFailure).toBeUndefined();
      expect(model.compiler).toBe('online');
    });

    it('leaves the editor compiling over the run that follows a successful compilation', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: compiled },
      );

      expect(model.editor).toEqual({ kind: 'compiling' });
      expect(appReducer(model, started(2)).editor).toEqual({ kind: 'closed' });
    });

    it('reports an outage in the banner and marks the compiler degraded', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: gone },
      );

      expect(model.compileFailure).toBe(gone);
      expect(model.editor).toEqual({ kind: 'editing', diagnostics: [] });
      expect(model.compiler).toBe('degraded');
    });

    it('calls a service that is merely at capacity online, and still says so', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: busy },
      );

      expect(model.compiler).toBe('online');
      expect(model.compileFailure).toBe(busy);
    });

    it('calls the compiler healthy again once it answers', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: gone },
        { kind: 'compile-started', token: 2 },
        { kind: 'compile-settled', token: 2, result: compiled },
      );

      expect(model.compiler).toBe('online');
    });

    it('leaves a compiler that was never configured alone', () => {
      const model = reduce(
        initialAppModel(false),
        { kind: 'compile-started', token: 1 },
        { kind: 'compile-settled', token: 1, result: gone },
      );

      expect(model.compiler).toBe('unconfigured');
    });

    it('reports a service that never answered the health check', () => {
      expect(
        appReducer(initialAppModel(true), { kind: 'compiler-checked', healthy: false }),
      ).toEqual(expect.objectContaining({ compiler: 'unavailable' }));
    });

    it('drops a compile answer that lands after the editor was closed', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        { kind: 'editor-closed', token: 2 },
        { kind: 'compile-settled', token: 1, result: gone },
      );

      expect(model.editor).toEqual({ kind: 'closed' });
      expect(model.compileFailure).toBeUndefined();
      expect(model.compiler).toBe('online');
    });

    it('drops a compile answer that lands after another program was loaded', () => {
      const model = reduce(
        initialAppModel(true),
        { kind: 'compiler-checked', healthy: true },
        { kind: 'editor-opened' },
        { kind: 'compile-started', token: 1 },
        started(2, 'Reading Gcd.class'),
        { kind: 'compile-settled', token: 1, result: { kind: 'diagnostics', diagnostics: [] } },
      );

      expect(model.editor).toEqual({ kind: 'closed' });
      expect(model.load.status).toBe('loading');
    });
  });

  describe('the example list', () => {
    it('holds the entries the manifest listed', () => {
      const entries = [factorialEntry()];

      const model = appReducer(initialAppModel(true), { kind: 'examples-loaded', entries });

      expect(exampleEntriesOf(model.examples)).toBe(entries);
      expect(examplesErrorOf(model.examples)).toBeUndefined();
    });

    it('holds the failure instead, with no entries to offer', () => {
      const error: AppError = { kind: 'unexpected', reason: 'the manifest fell over' };

      const model = appReducer(initialAppModel(true), { kind: 'examples-failed', error });

      expect(exampleEntriesOf(model.examples)).toEqual([]);
      expect(examplesErrorOf(model.examples)).toBe(error);
    });

    it('offers nothing while it is still loading', () => {
      expect(exampleEntriesOf(initialAppModel(true).examples)).toEqual([]);
      expect(examplesErrorOf(initialAppModel(true).examples)).toBeUndefined();
    });
  });
});
