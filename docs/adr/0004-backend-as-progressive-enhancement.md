# ADR-0004: The backend is progressive enhancement

- **Status:** Accepted
- **Date:** 2026-07-16

## Context

The frontend is fully static (Vercel) and holds the complete logic: the parser, the disassembler and
the interpreter all run in the browser (ADR-0001). The `compile-service` backend adds one feature:
compiling the code typed into the editor (ADR-0003).

If the application depended hard on the server, then:

- the portfolio demo would break whenever the free hosting plan puts the service to sleep (cold
  starts, quotas),
- running it locally would require a JDK and Maven, even though 90% of the features need neither,
- the frontend CI would have to start the backend for its end-to-end tests.

## Decision

The application is fully functional without the backend: the bundled examples (`.class` files
committed under `public/examples/`) and uploading your own `.class` cover the entire visualisation
flow.

The "write and compile" editor (`CompileEditor`) renders conditionally, only when:

1. `VITE_COMPILE_API_URL` is set at build time, **and**
2. the service answers a health check at runtime.

If either is missing, the tab does not exist: no broken button, no error message. The frontend has
no hard dependency on the server at any stage: build, deploy or test.

## Consequences

**Positive**

- The demo link in the portfolio always works, whatever state the free backend hosting is in.
- `git clone && npm ci && npm run dev` is enough to work on 90% of the project, with no JDK and no
  Maven.
- CI splits naturally into `web.yml`, `server.yml` and `e2e.yml`; only the last one starts the
  backend.
- Frontend and backend deploys are independent.

**Negative / costs**

- Two UI paths to test (with and without the editor). The e2e test that needs compilation has to
  live in a separate workflow, outside the default suite.
- API availability detection is an extra asynchronous state in the application; it must be modelled
  explicitly, as a discriminated union and not a boolean flag.
- A hidden feature can confuse a reviewer, so the README has to state plainly how to enable the
  editor (`VITE_COMPILE_API_URL`).
