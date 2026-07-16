# ADR-0003 — The backend compiles, it never executes user code

- **Status:** Accepted
- **Date:** 2026-07-16

## Context

The "write Java code and see its bytecode" feature needs a compiler, and there is no Java compiler
in the browser. That means a server-side service accepting source code from anonymous users on the
internet.

Running such code on the server is textbook **remote code execution (RCE)**. Defending against it
would require a full sandbox: process/container isolation, CPU and memory limits, no network and no
filesystem, protection against fork bombs and infinite loops. That is a large area, easy to get
wrong — and the project already has its own interpreter on the client side.

## Decision

The `compile-service` **only compiles**:

`POST /api/compile` → Java source → `javax.tools.JavaCompiler` with a `ForwardingJavaFileManager`
that keeps the output **in memory** → `.class` bytes (base64) or a list of diagnostics with line
and column.

**Execution happens exclusively in the interpreter in the user's browser** — through exactly the
same path as a manually uploaded file. The server never loads or runs the compiled class.

The residual risks of `javac` itself are mitigated explicitly:

- **`-proc:none`** — annotation processing is the only vector that runs _foreign_ code inside
  javac; it must be off.
- Source ≤ 64 KiB, a 10 s compilation timeout (`Future.get(timeout)`), an empty user class path,
  `--release 21`.
- Rate limiting (10 requests/minute/IP), CORS restricted to the frontend origin.

## Consequences

**Positive**

- The whole class of RCE vulnerabilities **disappears from the threat model** instead of being
  mitigated — there is no sandbox to get wrong.
- The service is stateless, trivial to scale and to host on a free plan (Fly.io / Railway).
- There is a single data path: `.class` bytes → parser → interpreter. Compilation is just another
  _source_ of bytes, not a separate mode of the application.

**Negative / costs**

- The user does not see "the result from a real JVM" — they see the result from our interpreter,
  with its limitations (ADR-0002). A program using out-of-scope instructions compiles but will not
  run.
- The risk of `javac` itself exhausting resources (pathological sources) remains — hence the size
  limit, the timeout and rate limiting.
- Compilation diagnostics have to travel over the API as structured data (line, column, kind,
  message) rather than as text.
