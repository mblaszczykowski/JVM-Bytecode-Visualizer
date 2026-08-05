import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeUnhandledFailures, report, type ProgramContext } from './telemetry';

/**
 * The two things this module has to get right are that it stays silent unless configured, and
 * that what it sends cannot carry the reader's code. The second is a type-level guarantee, so
 * the test that matters is the one that reads the bytes actually put on the wire.
 */

const URL = 'https://telemetry.example/report';

interface Beacon {
  readonly url: string;
  readonly body: string;
}

let sent: Beacon[] = [];

function stubBeacon(): void {
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (url: string, blob: Blob) => {
      // `Blob.text()` is async and `report` cannot await; the payload is captured through the
      // constructor argument instead, which is what jsdom keeps.
      sent.push({ url, body: (blob as Blob & { __text?: string }).__text ?? '' });
      return true;
    },
  });
}

/** jsdom's Blob does not expose its content synchronously, so record it as it is built. */
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

  it('sends the failure and the build to the configured endpoint', () => {
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

  /**
   * The property the README's privacy claim rests on. An uploaded class file never leaves the
   * tab, so a report about one may carry its shape and nothing else — no name, no class name,
   * and above all no bytes.
   */
  it('carries the shape of an uploaded program and none of its content', () => {
    vi.stubEnv('VITE_TELEMETRY_URL', URL);
    const program: ProgramContext = { origin: 'upload', methods: 12 };

    report({ kind: 'run-failed', reason: 'unsupported-opcode', steps: 91 }, program);

    const body = sent[0]?.body ?? '';
    expect(body).toContain('unsupported-opcode');
    for (const secret of ['Secret.class', 'com/acme', 'cafebabe', 'password']) {
      expect(body).not.toContain(secret);
    }
    expect(JSON.parse(body)).toMatchObject({ program: { origin: 'upload', methods: 12 } });
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
