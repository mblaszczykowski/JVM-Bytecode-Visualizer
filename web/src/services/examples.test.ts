import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleRoutes, okResponse, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import { readExampleManifest } from './__fixtures__/example-files';
import {
  EXAMPLE_TIMEOUT_MS,
  exampleUrl,
  fetchExampleManifest,
  fetchExampleResources,
  isExampleLoadError,
  MANIFEST_FILE,
  shortTitleOf,
} from './examples';
import type { ExampleEntry, ExampleManifest } from './manifest';

const MANIFEST_URL = exampleUrl(MANIFEST_FILE);

function factorialEntry(): ExampleEntry {
  const manifest = readExampleManifest() as ExampleManifest;
  const entry = manifest.examples.find((example) => example.id === 'factorial');
  if (entry === undefined) {
    throw new Error('the factorial example is missing from the manifest');
  }
  return entry;
}

async function detailOf(load: () => Promise<unknown>) {
  try {
    await load();
  } catch (error) {
    if (isExampleLoadError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the load to fail');
}

function stubHangingFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('example URLs', () => {
  it('resolves against the Vite base URL', () => {
    expect(exampleUrl('Factorial.class')).toBe(
      `${import.meta.env.BASE_URL}examples/Factorial.class`,
    );
  });

  it('shortens the toolbar label to the part before the separator', () => {
    expect(shortTitleOf(factorialEntry())).toBe('Factorial');
  });
});

describe('fetchExampleManifest', () => {
  it('validates and returns the committed manifest', async () => {
    stubFetch(exampleRoutes());

    const manifest = await fetchExampleManifest();

    expect(manifest.version).toBe(1);
    expect(manifest.examples.map((example) => example.id)).toEqual(
      (readExampleManifest() as ExampleManifest).examples.map((example) => example.id),
    );
  });

  it('reports an unreachable server as a network failure', async () => {
    stubFetch({
      [MANIFEST_URL]: () => {
        throw new TypeError('Failed to fetch');
      },
    });

    const error = await detailOf(fetchExampleManifest);

    expect(error.detail).toEqual({
      kind: 'network',
      url: MANIFEST_URL,
      reason: 'Failed to fetch',
    });
    expect(error.message).toContain('Could not download');
  });

  it('reports an HTTP status', async () => {
    stubFetch({ [MANIFEST_URL]: () => statusResponse(404) });

    const error = await detailOf(fetchExampleManifest);

    expect(error.detail).toEqual({ kind: 'http', url: MANIFEST_URL, status: 404 });
    expect(error.message).toContain('the server answered 404');
  });

  it('reports a body that is not JSON', async () => {
    stubFetch({
      [MANIFEST_URL]: () =>
        ({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        }) as unknown as Response,
    });

    const error = await detailOf(fetchExampleManifest);

    expect(error.detail.kind).toBe('invalid-json');
    expect(error.message).toContain('is not valid JSON');
  });

  it('reports a manifest that does not match the schema', async () => {
    const broken = { version: 1, examples: [{ id: 'factorial' }] };
    stubFetch({ [MANIFEST_URL]: () => okResponse({ json: broken }) });

    const error = await detailOf(fetchExampleManifest);

    expect(error.detail.kind).toBe('invalid-manifest');
    expect(error.message).toContain('does not match the example manifest schema');
    expect(error.message).toContain('examples.0.title');
  });

  it('rejects a manifest whose version this build does not know', async () => {
    stubFetch({
      [MANIFEST_URL]: () => okResponse({ json: { version: 2, examples: [] } }),
    });

    const error = await detailOf(fetchExampleManifest);

    expect(error.detail.kind).toBe('invalid-manifest');
  });
});

describe('a download that never answers', () => {
  it.each([
    { name: 'the manifest', load: fetchExampleManifest, url: MANIFEST_URL },
    {
      name: 'an example',
      load: () => fetchExampleResources(factorialEntry()),
      url: exampleUrl(factorialEntry().classFile),
    },
  ])('gives up on $name rather than leaving the screen loading', async ({ load, url }) => {
    vi.useFakeTimers();
    stubHangingFetch();

    const pending = detailOf(load);
    await vi.advanceTimersByTimeAsync(EXAMPLE_TIMEOUT_MS);

    expect((await pending).detail).toEqual({
      kind: 'network',
      url,
      reason: `no answer within ${String(EXAMPLE_TIMEOUT_MS / 1000)} s`,
    });
  });
});

describe('the routes a test serves the examples over', () => {
  it('serves the manifest it was given, and the files that manifest names', async () => {
    const entry = factorialEntry();
    const routes = exampleRoutes({ version: 1, examples: [entry] });
    stubFetch(routes);

    const manifest = await fetchExampleManifest();

    expect(manifest.examples).toEqual([entry]);
    expect(Object.keys(routes)).toEqual([
      MANIFEST_URL,
      exampleUrl(entry.classFile),
      exampleUrl(entry.sourceFile),
    ]);
    expect((await fetchExampleResources(entry)).source).toContain('static int factorial(int n)');
  });

  it('serves no files at all for a manifest that is not one', () => {
    expect(Object.keys(exampleRoutes({ version: 2, examples: [] }))).toEqual([MANIFEST_URL]);
  });

  it('serves a body that can be read once, as a real Response can', async () => {
    const response = okResponse({ json: { version: 1 } });

    await expect(response.json()).resolves.toEqual({ version: 1 });
    await expect(response.json()).rejects.toThrow(TypeError);
  });
});

describe('fetchExampleResources', () => {
  it('downloads the class file and its source', async () => {
    stubFetch(exampleRoutes());
    const entry = factorialEntry();

    const resources = await fetchExampleResources(entry);

    expect(new DataView(resources.classBytes).getUint32(0)).toBe(0xcafebabe);
    expect(resources.source).toContain('static int factorial(int n)');
    expect(resources.entry).toBe(entry);
  });

  it('fails when the class file is missing from the deployment', async () => {
    const entry = factorialEntry();
    stubFetch({
      ...exampleRoutes(),
      [exampleUrl(entry.classFile)]: () => statusResponse(404),
    });

    const error = await detailOf(() => fetchExampleResources(entry));

    expect(error.detail).toEqual({
      kind: 'http',
      url: exampleUrl(entry.classFile),
      status: 404,
    });
  });
});
