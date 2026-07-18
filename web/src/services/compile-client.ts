/**
 * Client of the optional compile service.
 *
 * The whole feature hangs off `VITE_COMPILE_API_URL`: unset, nothing here is ever called and
 * the application stays what it is without a backend (ADR-0004). Everything crossing this
 * boundary is untrusted, so the response is validated with zod before it becomes a domain
 * value, and every failure comes back as a typed result rather than an exception.
 */

import { z } from 'zod';

export type DiagnosticKind = 'error' | 'warning' | 'note';

export interface CompileDiagnostic {
  /** 1-based; absent for diagnostics javac could not place in the source. */
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly kind: DiagnosticKind;
  readonly message: string;
}

export type UnavailableReason =
  | { readonly kind: 'network'; readonly reason: string }
  | { readonly kind: 'timeout'; readonly ms: number }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'invalid-response'; readonly reason: string };

export type CompileResult =
  | { readonly kind: 'compiled'; readonly className: string; readonly classBytes: ArrayBuffer }
  | { readonly kind: 'diagnostics'; readonly diagnostics: readonly CompileDiagnostic[] }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

/** Health has to answer fast or the badge is not worth showing at all. */
export const HEALTH_TIMEOUT_MS = 2_000;

/** The service caps a compilation at 10 s; this only catches a connection that hangs. */
export const COMPILE_TIMEOUT_MS = 30_000;

const RATE_LIMITED = 429;
const BAD_REQUEST = 400;

/** Read once at start-up: a deployment either has a compile service or it does not. */
const CONFIGURED_BASE_URL = readConfiguredBaseUrl();

export function compileApiBaseUrl(): string | undefined {
  return CONFIGURED_BASE_URL;
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  const attempt = await send(`${baseUrl}/actuator/health`, HEALTH_TIMEOUT_MS);
  return attempt.kind === 'response' && attempt.response.ok;
}

export async function compile(baseUrl: string, source: string): Promise<CompileResult> {
  const attempt = await send(`${baseUrl}/api/compile`, COMPILE_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  if (attempt.kind === 'failed') {
    return { kind: 'unavailable', reason: attempt.reason };
  }

  const { response } = attempt;
  if (response.status === RATE_LIMITED) {
    return { kind: 'rate-limited' };
  }
  // A rejected source is the author's problem, not the service's, so it reads as a diagnostic.
  if (response.status === BAD_REQUEST) {
    return {
      kind: 'diagnostics',
      diagnostics: [
        { line: undefined, column: undefined, kind: 'error', message: await rejectionOf(response) },
      ],
    };
  }
  if (!response.ok) {
    return { kind: 'unavailable', reason: { kind: 'http', status: response.status } };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    return unavailable('invalid-response', reasonOf(error));
  }

  const parsed = compileResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return unavailable('invalid-response', firstIssueOf(parsed.error.issues));
  }
  if (!parsed.data.success) {
    return { kind: 'diagnostics', diagnostics: parsed.data.diagnostics.map(toDiagnostic) };
  }

  const classBytes = decodeBase64(parsed.data.classFileBase64);
  if (classBytes === undefined) {
    return unavailable('invalid-response', 'classFileBase64 is not valid base64');
  }
  // Warnings on a successful compilation are dropped: the visualization replaces the editor.
  return { kind: 'compiled', className: parsed.data.className, classBytes };
}

const diagnosticSchema = z.object({
  line: z.number().int().nullish(),
  column: z.number().int().nullish(),
  kind: z.string(),
  message: z.string(),
});

const compileResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    className: z.string().min(1),
    classFileBase64: z.string().min(1),
    diagnostics: z.array(diagnosticSchema),
  }),
  z.object({
    success: z.literal(false),
    diagnostics: z.array(diagnosticSchema).min(1),
  }),
]);

const rejectionSchema = z.object({ message: z.string().min(1) });

const GENERIC_REJECTION =
  'The service rejected the source: it must declare one public top-level class and stay under 64 KiB.';

type Attempt =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'failed'; readonly reason: UnavailableReason };

/**
 * `fetch` with a deadline. The abort flag is read after the fact because an aborted request
 * rejects with the same shape as a refused connection, and the two need different sentences.
 */
async function send(url: string, timeoutMs: number, init?: RequestInit): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return { kind: 'response', response: await fetch(url, { ...init, signal: controller.signal }) };
  } catch (error) {
    return {
      kind: 'failed',
      reason: controller.signal.aborted
        ? { kind: 'timeout', ms: timeoutMs }
        : { kind: 'network', reason: reasonOf(error) },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function rejectionOf(response: Response): Promise<string> {
  try {
    const parsed = rejectionSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.message : GENERIC_REJECTION;
  } catch {
    return GENERIC_REJECTION;
  }
}

function unavailable(kind: 'invalid-response', reason: string): CompileResult {
  return { kind: 'unavailable', reason: { kind, reason } };
}

function toDiagnostic(raw: z.infer<typeof diagnosticSchema>): CompileDiagnostic {
  return {
    line: raw.line ?? undefined,
    column: raw.column ?? undefined,
    kind: toDiagnosticKind(raw.kind),
    message: raw.message,
  };
}

/** `javax.tools.Diagnostic.Kind` names, collapsed onto the three the editor styles. */
function toDiagnosticKind(raw: string): DiagnosticKind {
  switch (raw.toUpperCase()) {
    case 'ERROR':
      return 'error';
    case 'WARNING':
    case 'MANDATORY_WARNING':
      return 'warning';
    default:
      return 'note';
  }
}

function decodeBase64(value: string): ArrayBuffer | undefined {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return undefined;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function readConfiguredBaseUrl(): string | undefined {
  const raw: unknown = import.meta.env.VITE_COMPILE_API_URL;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed === '' ? undefined : trimmed;
}

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function firstIssueOf(issues: readonly SchemaIssue[]): string {
  const issue = issues[0];
  if (issue === undefined) {
    return 'the payload does not match the compile response schema';
  }
  const path = issue.path.map((segment) => String(segment)).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
