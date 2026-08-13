# ADR-0003: The backend compiles, it never executes user code

- **Status:** Accepted. The contract sketched here has since been built out on both sides; see
  "What the contract became" below.
- **Date:** 2026-07-16

## Context

The "write Java code and see its bytecode" feature needs a compiler, and there is no Java compiler
in the browser. That means a server-side service accepting source code from anonymous users on the
internet.

Running such code on the server is textbook remote code execution (RCE). Defending against it would
require a full sandbox: process/container isolation, CPU and memory limits, no network and no
filesystem, protection against fork bombs and infinite loops. That is a large area and easy to get
wrong, and the project already has its own interpreter on the client side.

## Decision

The `compile-service` only compiles:

`POST /api/compile` → Java source → `javax.tools.JavaCompiler` with a `ForwardingJavaFileManager`
that keeps the output in memory → `.class` bytes (base64) or a list of diagnostics with line and
column.

Execution happens exclusively in the interpreter in the user's browser, through the same path as a
manually uploaded file. The server never loads or runs the compiled class.

The residual risks of `javac` itself are mitigated explicitly:

- `-proc:none`. Annotation processing is the only vector that runs foreign code inside javac; it
  must be off.
- A child JVM per compilation. javac runs in a short-lived process with a small heap and stack, gets
  the source on stdin, and is killed with `destroyForcibly()` when the 10 s deadline passes. An
  in-process timeout cannot do this: `Future.cancel(true)` only raises an interrupt flag, javac
  never polls it, and the thread keeps burning CPU long after the client has its answer.
- Bounded concurrency. A compilation costs a whole JVM, so the number in flight is capped; a
  saturated service answers 503 with `Retry-After` instead of queueing requests that each hold a
  process.
- Two size caps, at different points. A request body over 256 KiB is refused on `Content-Length`
  before it is buffered; a source over 64 KiB is refused by `SourceValidator` once the body has been
  read, before javac is invoked. An empty user class path, and `--release 21`.
- Rate limiting, 10 requests per minute per IP. This is the control that actually bounds abuse,
  along with the concurrency cap and the size caps.
- CORS restricted to the frontend origin. This one is worth stating precisely, because it is easy to
  read as more than it is: CORS constrains browsers. It stops another page from driving this
  compiler with a reader's network position; it does nothing about `curl`. The service is a public
  endpoint and is bounded as one.

## What the contract became

This record was written before there was a client. Four things settled afterwards and belong with
it.

- The 503 has a reader. The `Retry-After` contract described above was defined here and honoured
  by nothing. `compile-client.ts` now reads it: a 429 and a 503 both become a message naming how
  long to wait, rather than a generic failure.
- Infrastructure failure answers 503. When the child JVM could not be run at all, the service used
  to answer 200 with `success: false` and a manufactured compile error, which told the reader their
  Java was wrong when the compiler had not started. That is now a 503 with the code
  `compiler-unavailable`, distinct from `compiler-busy`, which means every slot was taken. A
  compile that hits the deadline stays a 200 with `success: false`, because there the source really
  is what did not compile.
- The parent talks to the child in JSON. The child used to receive raw source on stdin, which
  left the type name to be inferred twice, once on each side. It now receives a
  `{ typeName, source }` document and answers with a result document, so the protocol has one shape
  in each direction and a place to add a field.
- The responses are committed as fixtures. `server/src/test/resources/contract/` holds one file
  per case: status, the headers that matter, and the body. The server's tests assert it produces
  them; the web client's tests parse them. Both ends are checked against the same bytes, so a status
  or a code cannot be changed on one side alone.

## Consequences

**Positive**

- The whole class of RCE vulnerabilities disappears from the threat model instead of being
  mitigated; there is no sandbox to get wrong.
- The service is stateless, trivial to scale and to host on a free plan (Fly.io / Railway).
- There is a single data path: `.class` bytes → parser → interpreter. Compilation is one more source
  of bytes, and not a separate mode of the application.

**Negative / costs**

- The user does not see "the result from a real JVM"; they see the result from our interpreter, with
  its limitations (ADR-0002). A program using out-of-scope instructions compiles but will not run.
- The risk of `javac` itself exhausting resources (pathological sources) remains, but it is bounded:
  a runaway compilation costs one child JVM for at most the deadline, and the process is killed
  outright instead of being asked to stop.
- Forking is not free. Every compilation pays a JVM start-up, and the child is launched with the
  parent's `java.class.path`, so the deployment has to run exploded instead of from a repackaged
  Spring Boot jar. The Dockerfile does that, and the service warns about it at start-up.
- Compilation diagnostics have to travel over the API as structured data (line, column, kind,
  message) and not as text.
