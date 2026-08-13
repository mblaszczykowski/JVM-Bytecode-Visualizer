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

export async function fetchExampleManifest(): Promise<ExampleManifest> {
  const url = exampleUrl(MANIFEST_FILE);
  const response = await request(url);

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new ExampleLoadError({ kind: 'invalid-json', url, reason: reasonOf(error) });
  }

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

export async function fetchExampleResources(entry: ExampleEntry): Promise<ExampleResources> {
  const [classBytes, source] = await Promise.all([
    fetchBinary(exampleUrl(entry.classFile)),
    fetchText(exampleUrl(entry.sourceFile)),
  ]);
  return { entry, classBytes, source };
}

export function shortTitleOf(entry: ExampleEntry): string {
  const [head] = entry.title.split(':');
  return head === undefined ? entry.title : head.trim();
}

async function request(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, EXAMPLE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw new ExampleLoadError({
      kind: 'network',
      url,
      reason: controller.signal.aborted ? TIMED_OUT : reasonOf(error),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ExampleLoadError({ kind: 'http', url, status: response.status });
  }
  return response;
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await request(url);
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw new ExampleLoadError({ kind: 'network', url, reason: reasonOf(error) });
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await request(url);
  try {
    return await response.text();
  } catch (error) {
    throw new ExampleLoadError({ kind: 'network', url, reason: reasonOf(error) });
  }
}
