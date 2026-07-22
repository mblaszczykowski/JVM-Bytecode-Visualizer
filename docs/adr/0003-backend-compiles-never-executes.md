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
- **A child JVM per compilation.** javac runs in a short-lived process with a small heap and stack,
  gets the source on stdin, and is killed with `destroyForcibly()` when the 10 s deadline passes. An
  in-process timeout cannot do this: `Future.cancel(true)` only raises an interrupt flag, javac
  never polls it, and the thread keeps burning CPU long after the client has its answer.
- **Bounded concurrency.** A compilation costs a whole JVM, so the number in flight is capped;
  a saturated service answers 503 with `Retry-After` instead of queueing requests that each hold a
  process.
- Source ≤ 64 KiB, refused before the request body is buffered; an empty user class path;
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
- The risk of `javac` itself exhausting resources (pathological sources) remains, but it is bounded
  instead of argued away: a runaway compilation costs one child JVM for at most the deadline, and
  the process is killed rather than asked to stop.
- Forking is not free. Every compilation pays a JVM start-up, and the child is launched with the
  parent's `java.class.path` — so the deployment has to run exploded rather than from a repackaged
  Spring Boot jar, which the Dockerfile does and the service warns about at start-up.
- Compilation diagnostics have to travel over the API as structured data (line, column, kind,
  message) rather than as text.
