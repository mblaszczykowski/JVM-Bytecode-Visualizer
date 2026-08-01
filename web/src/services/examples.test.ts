import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleRoutes, okResponse, statusResponse, stubFetch } from './__fixtures__/fake-fetch';
import { readExampleManifest } from './__fixtures__/example-files';
import {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('example URLs', () => {
  it('resolves against the Vite base URL', () => {
    expect(exampleUrl('Factorial.class')).toBe(
      `${import.meta.env.BASE_URL}examples/Factorial.class`,
    );
  });

  it('shortens the toolbar label to the part before the dash', () => {
    expect(shortTitleOf(factorialEntry())).toBe('Factorial');
  });
});

describe('fetchExampleManifest', () => {
  it('validates and returns the committed manifest', async () => {
    stubFetch(exampleRoutes());

    const manifest = await fetchExampleManifest();

    expect(manifest.version).toBe(1);
    // However many examples ship, the loader hands back the ones the file lists.
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
