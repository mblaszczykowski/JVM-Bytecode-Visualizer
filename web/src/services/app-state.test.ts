import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleManifest } from './__fixtures__/example-files';
import { exampleRoutes, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import { uploadFile } from './__fixtures__/upload-file';
import {
  IDLE,
  loadCompiledState,
  loadExampleState,
  loadUploadState,
  MAX_STEP_LIMIT,
  MAX_UPLOAD_BYTES,
  programOf,
  raisedStepLimit,
  rerunState,
  stateFor,
} from './app-state';
import { exampleUrl } from './examples';
import type { ExampleEntry, ExampleManifest } from './manifest';
import { buildProgram } from './program';

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
  it('runs the class and keeps the source that produced it', () => {
    const source = 'public class Gcd {\n    // whatever the author wrote\n}\n';

    const state = loadCompiledState({
      className: 'Gcd',
      classBytes: readExampleBytes('Gcd.class'),
      source,
    });

    expect(state.status).toBe('ready');
    expect(programOf(state)?.origin).toEqual({ kind: 'compiled', className: 'Gcd' });
    expect(programOf(state)?.sourceFileName).toBe('Gcd.java');
    expect(programOf(state)?.sourceLines).toEqual(source.split('\n'));
  });

  it('reports bytes that are not a class file', () => {
    const state = loadCompiledState({
      className: 'Broken',
      classBytes: new TextEncoder().encode('not bytecode').buffer,
      source: 'public class Broken { }',
    });

    expect(state).toMatchObject({
      status: 'error',
      error: { kind: 'class-file', detail: { kind: 'bad-magic' } },
    });
  });

  it('re-runs with a higher limit without losing the source', () => {
    const program = buildProgram({
      origin: { kind: 'compiled', className: 'Loop' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      source: { fileName: 'Loop.java', text: 'public class Loop { }' },
      maxSteps: 25,
    });

    expect(programOf(rerunState(program, 125))?.sourceLines).toEqual(['public class Loop { }']);
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

describe('raising the step limit', () => {
  it('multiplies the previous limit by five, up to the ceiling', () => {
    expect(raisedStepLimit(20_000)).toBe(100_000);
    expect(raisedStepLimit(100_000)).toBe(MAX_STEP_LIMIT);
    expect(raisedStepLimit(200_000)).toBe(MAX_STEP_LIMIT);
  });

  it('stops offering the action at the ceiling', () => {
    expect(raisedStepLimit(MAX_STEP_LIMIT)).toBeUndefined();
  });

  it('re-runs the same program with the new limit', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Loop.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xa7, 0x00, 0x00] }],
      }),
      maxSteps: 25,
    });

    const state = rerunState(program, 125);

    expect(state).toMatchObject({ status: 'error', error: { kind: 'step-limit', limit: 125 } });
    expect(programOf(state)?.snapshots).toHaveLength(125);
  });

  it('re-runs an example without downloading it again', async () => {
    stubFetch(exampleRoutes());
    const loaded = await loadExampleState(factorialEntry(), 20);
    const program = programOf(loaded);
    if (program === undefined) {
      throw new Error('the example failed to load');
    }
    vi.unstubAllGlobals();

    const state = rerunState(program, 100);

    expect(state.status).toBe('ready');
    expect(programOf(state)?.snapshots).toHaveLength(40);
    expect(programOf(state)?.sourceLines).toEqual(program.sourceLines);
  });
});

describe('parsing a class file straight from bytes', () => {
  it('is the same pipeline the upload path uses', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));

    expect(classFile.thisClassName).toBe('Factorial');
  });
});
