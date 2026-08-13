import { vi } from 'vitest';

import { exampleUrl, MANIFEST_FILE } from '../examples';
import { exampleManifestSchema, type ExampleEntry } from '../manifest';

import { readExampleBytes, readExampleManifest, readExampleText } from './example-files';

export interface FakeBody {
  readonly json?: unknown;
  readonly text?: string;
  readonly bytes?: ArrayBuffer;
}

interface FakeReaders {
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

function fakeResponse(status: number, headers: Headers, readers: FakeReaders): Response {
  let consumed = false;
  function once<T>(read: () => Promise<T>): () => Promise<T> {
    return () => {
      if (consumed) {
        return Promise.reject(new TypeError('Body has already been read'));
      }
      consumed = true;
      return read();
    };
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: once(readers.json),
    text: once(readers.text),
    arrayBuffer: once(readers.arrayBuffer),
  } as unknown as Response;
}

export function okResponse(body: FakeBody): Response {
  return fakeResponse(200, new Headers(), {
    json: () => Promise.resolve(body.json),
    text: () => Promise.resolve(body.text ?? ''),
    arrayBuffer: () => Promise.resolve(body.bytes ?? new ArrayBuffer(0)),
  });
}

export function jsonResponse(
  status: number,
  json: unknown,
  headers?: Readonly<Record<string, string>>,
): Response {
  return fakeResponse(status, new Headers(headers), {
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(JSON.stringify(json)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

export function statusResponse(status: number): Response {
  return fakeResponse(status, new Headers(), {
    json: () => Promise.reject(new Error('no body')),
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

export type FakeRoute = () => Response | Promise<Response>;

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

export function exampleRoutes(
  manifest: unknown = readExampleManifest(),
): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = {
    [exampleUrl(MANIFEST_FILE)]: () => okResponse({ json: manifest }),
  };

  for (const example of examplesOf(manifest)) {
    routes[exampleUrl(example.classFile)] = () =>
      okResponse({ bytes: readExampleBytes(example.classFile) });
    routes[exampleUrl(example.sourceFile)] = () =>
      okResponse({ text: readExampleText(example.sourceFile) });
  }

  return routes;
}

const NO_EXAMPLES: readonly ExampleEntry[] = [];

function examplesOf(manifest: unknown): readonly ExampleEntry[] {
  const parsed = exampleManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data.examples : NO_EXAMPLES;
}
