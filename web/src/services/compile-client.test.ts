import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  contractRoute,
  readContractResponses,
  recordedResponse,
  type ContractResponse,
} from './__fixtures__/contract-responses';
import { jsonResponse, okResponse, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import {
  checkHealth,
  compile,
  COMPILE_TIMEOUT_MS,
  compileApiBaseUrl,
  COMPILER_BUSY,
  HEALTH_TIMEOUT_MS,
  type CompileResult,
} from './compile-client';

const BASE = 'http://compile.test';
const COMPILE_URL = `${BASE}/api/compile`;
const HEALTH_URL = `${BASE}/actuator/health`;

const SOURCE = 'public class Loop { }';

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
  it('sends the source as JSON and decodes the class file that comes back', async () => {
    const fetchMock = stubFetch({
      [COMPILE_URL]: contractRoute(recordedResponse('compile-success')),
    });

    const result = await compile(BASE, SOURCE);

    expect(result).toMatchObject({ kind: 'compiled', className: 'Adder' });
    if (result.kind !== 'compiled') {
      throw new Error('expected a compiled result');
    }
    expect([...new Uint8Array(result.classBytes)]).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    expect(fetchMock).toHaveBeenCalledWith(
      COMPILE_URL,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: SOURCE }) }),
    );
  });

  it('keeps the warnings javac attached to a class it did compile', async () => {
    stubFetch({ [COMPILE_URL]: contractRoute(recordedResponse('compile-success')) });

    expect(await compile(BASE, SOURCE)).toMatchObject({
      kind: 'compiled',
      diagnostics: [
        { line: 5, column: 9, kind: 'warning', message: 'unchecked call to add(int,int)' },
      ],
    });
  });

  it('reports the rate limit even when there is no error document to read', async () => {
    stubFetch({ [COMPILE_URL]: () => statusResponse(429) });

    expect(await compile(BASE, SOURCE)).toEqual({ kind: 'rate-limited', service: undefined });
  });

  it('ignores a Retry-After this build cannot read as a number of seconds', async () => {
    stubFetch({
      [COMPILE_URL]: () =>
        jsonResponse(
          503,
          { error: COMPILER_BUSY, message: 'busy' },
          {
            'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT',
          },
        ),
    });

    expect(await compile(BASE, SOURCE)).toMatchObject({
      reason: { service: { code: COMPILER_BUSY, retryAfterSeconds: undefined } },
    });
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
      reason: { kind: 'http', status: 502, service: undefined },
    });
  });

  it('keeps the status when the service says nothing this build recognises', async () => {
    stubFetch({ [COMPILE_URL]: () => jsonResponse(500, { detail: 'something went wrong' }) });

    expect(await compile(BASE, SOURCE)).toEqual({
      kind: 'unavailable',
      reason: { kind: 'http', status: 500, service: undefined },
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

describe('the answers the service records for this client', () => {
  function errorDocument(response: ContractResponse): { error: string; message: string } {
    return response.body as { error: string; message: string };
  }

  function rejectedSource(response: ContractResponse): unknown {
    return {
      kind: 'diagnostics',
      diagnostics: [
        {
          line: undefined,
          column: undefined,
          kind: 'error',
          message: errorDocument(response).message,
        },
      ],
    };
  }

  function serviceFailure(response: ContractResponse): unknown {
    const retryAfter = response.headers['Retry-After'];
    return {
      code: errorDocument(response).error,
      message: errorDocument(response).message,
      retryAfterSeconds: retryAfter === undefined ? undefined : Number(retryAfter),
    };
  }

  function outage(response: ContractResponse): unknown {
    return {
      kind: 'unavailable',
      reason: { kind: 'http', status: response.status, service: serviceFailure(response) },
    };
  }

  const expected: Readonly<Record<string, (response: ContractResponse) => unknown>> = {
    'compile-success': () => ({
      kind: 'compiled',
      className: 'Adder',
      classBytes: [0xca, 0xfe, 0xba, 0xbe],
      diagnostics: [
        { line: 5, column: 9, kind: 'warning', message: 'unchecked call to add(int,int)' },
      ],
    }),
    'compile-diagnostics': () => ({
      kind: 'diagnostics',
      diagnostics: [
        { line: 3, column: 16, kind: 'error', message: "';' expected" },
        {
          line: undefined,
          column: undefined,
          kind: 'note',
          message: 'some input files use unchecked or unsafe operations',
        },
      ],
    }),
    'no-public-class': rejectedSource,
    'source-too-large': rejectedSource,
    'source-field-too-long': rejectedSource,
    'request-body-too-large': rejectedSource,
    'invalid-request': rejectedSource,
    'rate-limit-exceeded': (response) => ({
      kind: 'rate-limited',
      service: serviceFailure(response),
    }),
    'compiler-busy': outage,
    'compiler-unavailable': outage,
    'internal-error': outage,
  };

  function readable(result: CompileResult): unknown {
    return result.kind === 'compiled'
      ? { ...result, classBytes: [...new Uint8Array(result.classBytes)] }
      : result;
  }

  it.each(readContractResponses())('reads the recorded $case answer', async (response) => {
    const answer = expected[response.case];
    if (answer === undefined) {
      throw new Error(`the service records a ${response.case} answer this test says nothing about`);
    }
    stubFetch({ [COMPILE_URL]: contractRoute(response) });

    expect(readable(await compile(BASE, SOURCE))).toEqual(answer(response));
  });

  it('reads every answer the service records, and claims no answer it does not', () => {
    expect(readContractResponses().map((response) => response.case)).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it('names the busy service by the code the recorded answer carries', () => {
    expect(errorDocument(recordedResponse('compiler-busy')).error).toBe(COMPILER_BUSY);
  });
});
