import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, okResponse, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import {
  checkHealth,
  compile,
  COMPILE_TIMEOUT_MS,
  compileApiBaseUrl,
  HEALTH_TIMEOUT_MS,
  type CompileResult,
} from './compile-client';

const BASE = 'http://compile.test';
const COMPILE_URL = `${BASE}/api/compile`;
const HEALTH_URL = `${BASE}/actuator/health`;

/** Base64 of the four bytes every class file starts with. */
const CAFEBABE = 'yv66vg==';

const SOURCE = 'public class Loop { }';

/** A connection that hangs until something aborts it — the case the deadline exists for. */
function stubHangingFetch() {
  const fetchMock = vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Narrows a result down to the failure detail a test is about. */
function invalidResponseReason(result: CompileResult): string {
  if (result.kind !== 'unavailable' || result.reason.kind !== 'invalid-response') {
    throw new Error(`expected an unreadable answer, got ${result.kind}`);
  }
  return result.reason.reason;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('configuration', () => {
  /** The base URL is read once at import, so each case needs a fresh module. */
  async function reload(value?: string) {
    if (value !== undefined) {
      vi.stubEnv('VITE_COMPILE_API_URL', value);
    }
    vi.resetModules();
    return import('./compile-client');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('leaves the feature off when the environment says nothing', () => {
    expect(compileApiBaseUrl()).toBeUndefined();
  });

  it('drops the trailing slash so the paths concatenate cleanly', async () => {
    const client = await reload('https://compile.example.com/');

    expect(client.compileApiBaseUrl()).toBe('https://compile.example.com');
  });

  it('treats a blank value as unset', async () => {
    const client = await reload('   ');

    expect(client.compileApiBaseUrl()).toBeUndefined();
  });
});

describe('health check', () => {
  it('is healthy when the actuator answers', async () => {
    const fetchMock = stubFetch({ [HEALTH_URL]: () => okResponse({ json: { status: 'UP' } }) });

    await expect(checkHealth(BASE)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(HEALTH_URL, expect.anything());
  });

  it('is unhealthy on an error status', async () => {
    stubFetch({ [HEALTH_URL]: () => statusResponse(503) });

    await expect(checkHealth(BASE)).resolves.toBe(false);
  });

  it('is unhealthy when there is nothing listening', async () => {
    stubFetch({});

    await expect(checkHealth(BASE)).resolves.toBe(false);
  });

  it('gives up after the deadline instead of hanging the badge', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const healthy = checkHealth(BASE);
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);

    await expect(healthy).resolves.toBe(false);
  });
});

describe('compile', () => {
  it('decodes the class file of a successful compilation', async () => {
    const fetchMock = stubFetch({
      [COMPILE_URL]: () =>
        okResponse({
          json: { success: true, className: 'Loop', classFileBase64: CAFEBABE, diagnostics: [] },
        }),
    });

    const result = await compile(BASE, SOURCE);

    expect(result).toMatchObject({ kind: 'compiled', className: 'Loop' });
    if (result.kind !== 'compiled') {
      throw new Error('expected a compiled result');
    }
    expect([...new Uint8Array(result.classBytes)]).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    expect(fetchMock).toHaveBeenCalledWith(
      COMPILE_URL,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: SOURCE }) }),
    );
  });

  it('maps javac diagnostics onto their positions and kinds', async () => {
    stubFetch({
      [COMPILE_URL]: () =>
        okResponse({
          json: {
            success: false,
            className: null,
            classFileBase64: null,
            diagnostics: [
              { line: 3, column: 12, kind: 'ERROR', message: "';' expected" },
              { line: null, column: null, kind: 'MANDATORY_WARNING', message: 'unchecked call' },
            ],
          },
        }),
    });

    const result = await compile(BASE, SOURCE);

    expect(result).toEqual({
      kind: 'diagnostics',
      diagnostics: [
        { line: 3, column: 12, kind: 'error', message: "';' expected" },
        { line: undefined, column: undefined, kind: 'warning', message: 'unchecked call' },
      ],
    });
  });

  it('reads a rejected source as a diagnostic, not as an outage', async () => {
    stubFetch({
      [COMPILE_URL]: () =>
        jsonResponse(400, {
          error: 'no-public-class',
          message: 'source must declare a public top-level class',
        }),
    });

    expect(await compile(BASE, SOURCE)).toEqual({
      kind: 'diagnostics',
      diagnostics: [
        {
          line: undefined,
          column: undefined,
          kind: 'error',
          message: 'source must declare a public top-level class',
        },
      ],
    });
  });

  it('reports the rate limit as its own outcome', async () => {
    stubFetch({ [COMPILE_URL]: () => statusResponse(429) });

    expect(await compile(BASE, SOURCE)).toEqual({ kind: 'rate-limited' });
  });

  it('reports an unreachable service', async () => {
    stubFetch({});

    expect(await compile(BASE, SOURCE)).toMatchObject({
      kind: 'unavailable',
      reason: { kind: 'network' },
    });
  });

  it('reports a server error with its status', async () => {
    stubFetch({ [COMPILE_URL]: () => statusResponse(502) });

    expect(await compile(BASE, SOURCE)).toEqual({
      kind: 'unavailable',
      reason: { kind: 'http', status: 502 },
    });
  });

  it('gives up on a connection that never answers', async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const result = compile(BASE, SOURCE);
    await vi.advanceTimersByTimeAsync(COMPILE_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      kind: 'unavailable',
      reason: { kind: 'timeout', ms: COMPILE_TIMEOUT_MS },
    });
  });

  it('refuses a success without a class file rather than guessing', async () => {
    stubFetch({
      [COMPILE_URL]: () =>
        okResponse({ json: { success: true, className: 'Loop', diagnostics: [] } }),
    });

    expect(invalidResponseReason(await compile(BASE, SOURCE))).toContain('classFileBase64');
  });

  it('refuses a payload that is not a compile response at all', async () => {
    stubFetch({ [COMPILE_URL]: () => okResponse({ json: { status: 'ok' } }) });

    expect(await compile(BASE, SOURCE)).toMatchObject({
      kind: 'unavailable',
      reason: { kind: 'invalid-response' },
    });
  });

  it('refuses class bytes that are not base64', async () => {
    stubFetch({
      [COMPILE_URL]: () =>
        okResponse({
          json: {
            success: true,
            className: 'Loop',
            classFileBase64: 'not base64!',
            diagnostics: [],
          },
        }),
    });

    expect(await compile(BASE, SOURCE)).toEqual({
      kind: 'unavailable',
      reason: { kind: 'invalid-response', reason: 'classFileBase64 is not valid base64' },
    });
  });
});
