/**
 * A `fetch` stub built from a URL → response table. Anything the code under test asks for
 * and the table does not list fails loudly, so a typo in a URL cannot pass as a green test.
 */

import { vi } from 'vitest';

import { exampleUrl, MANIFEST_FILE } from '../examples';
import type { ExampleManifest } from '../manifest';

import { readExampleBytes, readExampleManifest, readExampleText } from './example-files';

export interface FakeBody {
  readonly json?: unknown;
  readonly text?: string;
  readonly bytes?: ArrayBuffer;
}

/** Only the members the loader touches; a full `Response` would be noise here. */
export function okResponse(body: FakeBody): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body.json),
    text: () => Promise.resolve(body.text ?? ''),
    arrayBuffer: () => Promise.resolve(body.bytes ?? new ArrayBuffer(0)),
  } as unknown as Response;
}

export function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('no body')),
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

export type FakeRoute = () => Response;

export function stubFetch(routes: Readonly<Record<string, FakeRoute>>) {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) {
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }
    try {
      return Promise.resolve(route());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Every committed example, served from disk exactly as the static host would. */
export function exampleRoutes(
  manifest: unknown = readExampleManifest(),
): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = {
    [exampleUrl(MANIFEST_FILE)]: () => okResponse({ json: manifest }),
  };

  for (const example of (readExampleManifest() as ExampleManifest).examples) {
    routes[exampleUrl(example.classFile)] = () =>
      okResponse({ bytes: readExampleBytes(example.classFile) });
    routes[exampleUrl(example.sourceFile)] = () =>
      okResponse({ text: readExampleText(example.sourceFile) });
  }

  return routes;
}
