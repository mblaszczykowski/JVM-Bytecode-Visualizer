import { describeIssues, reasonOf } from './failure-reason';
import { exampleManifestSchema, type ExampleEntry, type ExampleManifest } from './manifest';

export type ExampleLoadDetail =
  | { readonly kind: 'network'; readonly url: string; readonly reason: string }
  | { readonly kind: 'http'; readonly url: string; readonly status: number }
  | { readonly kind: 'invalid-json'; readonly url: string; readonly reason: string }
  | { readonly kind: 'invalid-manifest'; readonly url: string; readonly reason: string };

export class ExampleLoadError extends Error {
  readonly detail: ExampleLoadDetail;

  constructor(detail: ExampleLoadDetail) {
    super(formatExampleLoadError(detail));
    this.name = 'ExampleLoadError';
    this.detail = detail;
  }
}

export function isExampleLoadError(error: unknown): error is ExampleLoadError {
  return error instanceof ExampleLoadError;
}

export function formatExampleLoadError(detail: ExampleLoadDetail): string {
  switch (detail.kind) {
    case 'network':
      return `Could not download ${detail.url}: ${detail.reason}. Check your connection and try again.`;
    case 'http':
      return `Could not download ${detail.url}: the server answered ${String(detail.status)}.`;
    case 'invalid-json':
      return `${detail.url} is not valid JSON: ${detail.reason}.`;
    case 'invalid-manifest':
      return `${detail.url} does not match the example manifest schema: ${detail.reason}.`;
  }
}

export interface ExampleResources {
  readonly entry: ExampleEntry;
  readonly classBytes: ArrayBuffer;
  readonly source: string;
}

export function exampleUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}examples/${fileName}`;
}

export const MANIFEST_FILE = 'manifest.json';

export const EXAMPLE_TIMEOUT_MS = 10_000;

const TIMED_OUT = `no answer within ${String(EXAMPLE_TIMEOUT_MS / 1000)} s`;

const CANCELLED = 'the download was cancelled';

export async function fetchExampleManifest(): Promise<ExampleManifest> {
  const url = exampleUrl(MANIFEST_FILE);
  const raw = await request(url, async (response) => {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new ExampleLoadError({ kind: 'invalid-json', url, reason: reasonOf(error) });
    }
  });

  const parsed = exampleManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExampleLoadError({
      kind: 'invalid-manifest',
      url,
      reason: describeIssues(parsed.error.issues, 2),
    });
  }
  return parsed.data;
}

export function fetchExampleClass(entry: ExampleEntry): Promise<ArrayBuffer> {
  return fetchBinary(exampleUrl(entry.classFile));
}

export async function fetchExampleResources(
  entry: ExampleEntry,
  signal?: AbortSignal,
): Promise<ExampleResources> {
  const [classBytes, source] = await Promise.all([
    fetchBinary(exampleUrl(entry.classFile), signal),
    fetchText(exampleUrl(entry.sourceFile), signal),
  ]);
  return { entry, classBytes, source };
}

export function shortTitleOf(entry: ExampleEntry): string {
  const [head] = entry.title.split(':');
  return head === undefined ? entry.title : head.trim();
}

function abortRejection(signal: AbortSignal, reason: () => string): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new Error(reason()));
    });
  });
}

async function request<T>(
  url: string,
  read: (response: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, EXAMPLE_TIMEOUT_MS);
  const stop =
    signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
  const stopped = (): string => (controller.signal.aborted ? TIMED_OUT : CANCELLED);

  try {
    const response = await fetch(url, { signal: stop });
    if (!response.ok) {
      throw new ExampleLoadError({ kind: 'http', url, status: response.status });
    }
    return await Promise.race([read(response), abortRejection(stop, stopped)]);
  } catch (error) {
    if (error instanceof ExampleLoadError) {
      throw error;
    }
    throw new ExampleLoadError({
      kind: 'network',
      url,
      reason: stop.aborted ? stopped() : reasonOf(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return request(url, (response) => response.arrayBuffer(), signal);
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  return request(url, (response) => response.text(), signal);
}
