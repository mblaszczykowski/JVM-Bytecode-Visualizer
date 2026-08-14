import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syntheticClass } from '../../core/interpreter/__fixtures__/synthetic-class';
import { readExampleManifest } from '../__fixtures__/example-files';
import type { ExampleEntry, ExampleManifest } from '../loading/manifest';
import { buildProgram, type LoadedProgram, type ProgramOrigin } from '../loading/program';

import {
  observeUnhandledFailures,
  report,
  telemetryContextOf,
  type ProgramContext,
} from './telemetry';

const URL = 'https://telemetry.example/report';

interface Beacon {
  readonly url: string;
  readonly body: string;
}

let sent: Beacon[] = [];

interface Sent {
  readonly report: Record<string, unknown>;
  readonly program: Record<string, unknown>;
}

function envelopeOf(beacon: Beacon): Sent {
  return JSON.parse(beacon.body) as Sent;
}

function fieldsOf(beacon: Beacon): Record<string, unknown> {
  return envelopeOf(beacon).report;
}

function stubBeacon(): void {
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (url: string, blob: Blob) => {
      sent.push({ url, body: (blob as Blob & { __text?: string }).__text ?? '' });
      return true;
    },
  });
}

const RealBlob = globalThis.Blob;
class RecordingBlob extends RealBlob {
  readonly __text: string;
  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    this.__text = parts.map(String).join('');
  }
}

beforeEach(() => {
  sent = [];
  globalThis.Blob = RecordingBlob as unknown as typeof Blob;
  stubBeacon();
});

afterEach(() => {
  globalThis.Blob = RealBlob;
  vi.unstubAllEnvs();
});

describe('report', () => {
  it('sends nothing at all when no endpoint is configured', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', '');

    expect(report({ kind: 'unhandled', errorName: 'TypeError', fromPromise: true })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends the failure and the program it happened in to the configured endpoint', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);

    const accepted = report(
      { kind: 'panel-crash', errorName: 'TypeError', step: 12, totalSteps: 40 },
      { origin: 'example', exampleId: 'factorial' },
    );

    expect(accepted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(URL);

    const envelope: unknown = JSON.parse(sent[0]?.body ?? '{}');
    expect(envelope).toMatchObject({
      report: { kind: 'panel-crash', errorName: 'TypeError', step: 12, totalSteps: 40 },
      program: { origin: 'example', exampleId: 'factorial' },
    });
  });

  it('carries the shape of an uploaded program and none of its content', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);
    const program: ProgramContext = { origin: 'upload', methods: 12 };

    report({ kind: 'panel-crash', errorName: 'TypeError', step: 91, totalSteps: 400 }, program);

    const body = sent[0]?.body ?? '';
    for (const secret of ['Secret.class', 'com/acme', 'cafebabe', 'password']) {
      expect(body).not.toContain(secret);
    }
    expect(JSON.parse(body)).toMatchObject({
      report: { kind: 'panel-crash', errorName: 'TypeError' },
      program: { origin: 'upload', methods: 12 },
    });
  });

  it('sends the counted fields of the envelope and the report inside it, and no others', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);

    report({ kind: 'panel-crash', errorName: 'TypeError', step: 1, totalSteps: 2 });
    report(
      { kind: 'unhandled', errorName: 'RangeError', fromPromise: true },
      { origin: 'example', exampleId: 'factorial' },
    );

    expect(sent.map((beacon) => Object.keys(envelopeOf(beacon)))).toEqual([
      ['report', 'program', 'userAgent'],
      ['report', 'program', 'userAgent'],
    ]);
    expect(sent.map((beacon) => Object.keys(fieldsOf(beacon)))).toEqual([
      ['kind', 'errorName', 'step', 'totalSteps'],
      ['kind', 'errorName', 'fromPromise'],
    ]);
    expect(sent.map((beacon) => Object.keys(envelopeOf(beacon).program))).toEqual([
      ['origin'],
      ['origin', 'exampleId'],
    ]);
  });

  it('answers false rather than throwing when the beacon refuses', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('blocked by the browser');
      },
    });

    expect(report({ kind: 'unhandled', errorName: 'Error', fromPromise: false })).toBe(false);
  });
});

describe('telemetryContextOf', () => {
  function programFrom(origin: ProgramOrigin): LoadedProgram {
    return buildProgram({
      origin,
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb1] }],
      }),
    });
  }

  function firstExample(): ExampleEntry {
    const entry = (readExampleManifest() as ExampleManifest).examples[0];
    if (entry === undefined) {
      throw new Error('the manifest is empty');
    }
    return entry;
  }

  it('names the example, which is public anyway', () => {
    const entry = firstExample();

    expect(telemetryContextOf(programFrom({ kind: 'example', entry }))).toEqual({
      origin: 'example',
      exampleId: entry.id,
    });
  });

  it('counts the methods of an upload instead of naming the file', () => {
    expect(telemetryContextOf(programFrom({ kind: 'upload', fileName: 'Payroll.class' }))).toEqual({
      origin: 'upload',
      methods: 1,
    });
  });

  it('counts the methods of a compiled class instead of naming it', () => {
    expect(telemetryContextOf(programFrom({ kind: 'compiled', className: 'Payroll' }))).toEqual({
      origin: 'compiled',
      methods: 1,
    });
  });
});

describe('observeUnhandledFailures', () => {
  it('reports a rejected promise nobody handled, and stops when torn down', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);
    const stop = observeUnhandledFailures(window);

    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new RangeError('boom') }),
    );
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({
      report: { kind: 'unhandled', errorName: 'RangeError', fromPromise: true },
    });

    stop();
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new RangeError('again') }),
    );
    expect(sent).toHaveLength(1);
  });

  it('names a thrown value that is not an Error without inspecting it', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);
    const stop = observeUnhandledFailures(window);

    window.dispatchEvent(Object.assign(new Event('error'), { error: 'a bare string' }));

    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({
      report: { kind: 'unhandled', errorName: 'Error', fromPromise: false },
    });
    stop();
  });
});
