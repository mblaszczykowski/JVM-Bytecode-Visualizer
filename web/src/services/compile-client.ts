import { z, type core } from 'zod';

import { describeIssues, reasonOf } from './failure-reason';

export type DiagnosticKind = 'error' | 'warning' | 'note';

export interface CompileDiagnostic {
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly kind: DiagnosticKind;
  readonly message: string;
}

export interface ServiceFailure {
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds: number | undefined;
}

export type UnavailableReason =
  | { readonly kind: 'network'; readonly reason: string }
  | { readonly kind: 'timeout'; readonly ms: number }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly service?: ServiceFailure | undefined;
    }
  | { readonly kind: 'invalid-response'; readonly reason: string };

export type CompileResult =
  | {
      readonly kind: 'compiled';
      readonly className: string;
      readonly classBytes: ArrayBuffer;
      readonly diagnostics: readonly CompileDiagnostic[];
    }
  | { readonly kind: 'diagnostics'; readonly diagnostics: readonly CompileDiagnostic[] }
  | { readonly kind: 'rate-limited'; readonly service?: ServiceFailure | undefined }
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason };

export const HEALTH_TIMEOUT_MS = 2_000;

export const COMPILE_TIMEOUT_MS = 30_000;

export const COMPILER_BUSY = 'compiler-busy';

const RATE_LIMITED = 429;
const BAD_REQUEST = 400;

const CONFIGURED_BASE_URL = readConfiguredBaseUrl();

export function compileApiBaseUrl(): string | undefined {
  return CONFIGURED_BASE_URL;
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  const attempt = await send(`${baseUrl}/actuator/health`, HEALTH_TIMEOUT_MS);
  if (attempt.kind === 'failed') {
    return false;
  }
  attempt.done();
  return attempt.response.ok;
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

  try {
    return await Promise.race([
      interpret(attempt),
      attempt.expired.then<CompileResult>((reason) => ({ kind: 'unavailable', reason })),
    ]);
  } finally {
    attempt.done();
  }
}

async function interpret(attempt: Extract<Attempt, { kind: 'response' }>): Promise<CompileResult> {
  const { response } = attempt;
  if (response.status === BAD_REQUEST) {
    return {
      kind: 'diagnostics',
      diagnostics: [
        { line: undefined, column: undefined, kind: 'error', message: await rejectionOf(response) },
      ],
    };
  }
  if (!response.ok) {
    const service = await serviceFailureOf(response);
    return response.status === RATE_LIMITED
      ? { kind: 'rate-limited', service }
      : { kind: 'unavailable', reason: { kind: 'http', status: response.status, service } };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    return attempt.reasonFor(error).kind === 'timeout'
      ? { kind: 'unavailable', reason: attempt.reasonFor(error) }
      : unavailable('invalid-response', reasonOf(error));
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
  return {
    kind: 'compiled',
    className: parsed.data.className,
    classBytes,
    diagnostics: parsed.data.diagnostics.map(toDiagnostic),
  };
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

const errorDocumentSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
});

const GENERIC_REJECTION =
  'The service rejected the source: it must declare one public top-level class and stay under 64 KiB.';

type Attempt =
  | {
      readonly kind: 'response';
      readonly response: Response;
      readonly reasonFor: (error: unknown) => UnavailableReason;
      readonly expired: Promise<UnavailableReason>;
      readonly done: () => void;
    }
  | { readonly kind: 'failed'; readonly reason: UnavailableReason };

async function send(url: string, timeoutMs: number, init?: RequestInit): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const reasonFor = (error: unknown): UnavailableReason =>
    controller.signal.aborted
      ? { kind: 'timeout', ms: timeoutMs }
      : { kind: 'network', reason: reasonOf(error) };

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      kind: 'response',
      response,
      reasonFor,
      expired: new Promise<UnavailableReason>((resolve) => {
        controller.signal.addEventListener('abort', () => {
          resolve({ kind: 'timeout', ms: timeoutMs });
        });
      }),
      done: () => {
        clearTimeout(timer);
      },
    };
  } catch (error) {
    clearTimeout(timer);
    return { kind: 'failed', reason: reasonFor(error) };
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

async function serviceFailureOf(response: Response): Promise<ServiceFailure | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  const parsed = errorDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  return {
    code: parsed.data.error,
    message: parsed.data.message,
    retryAfterSeconds: retryAfterSecondsOf(response),
  };
}

function retryAfterSecondsOf(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (header === null || !/^\d+$/.test(header.trim())) {
    return undefined;
  }
  return Number(header.trim());
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

function firstIssueOf(issues: readonly core.$ZodIssue[]): string {
  const described = describeIssues(issues, 1);
  return described === '' ? 'the payload does not match the compile response schema' : described;
}
