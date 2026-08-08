# JVM Bytecode Visualizer

A browser-based JVM bytecode visualizer: load a `.class` file or write Java, then watch the virtual
machine execute it one instruction at a time.

![Four frames deep into a recursive factorial, with the branch arcs and the depth chart](docs/screenshots/app-ready.png)

## What it does

- **Three ways in.** Pick one of the bundled examples, upload your own `.class` file, or write Java
  in the browser and have it compiled (the last one needs the optional compile service). Any valid
  class file opens; whether it also _replays_ depends on the instructions it uses, and
  [Scope and limitations](#scope-and-limitations) is specific about which.
- **An explorer for the file itself.** The constant pool as a browsable table cross-linked with the
  listing, so clicking `#7` in a comment lands on the entry it names and back again; every method
  including the ones no run enters; the class header, interfaces, fields and class file version. A
  class with no runnable `main` — a utility class, an interface, an enum, a record — opens here
  rather than being turned away.
- **Deterministic replay.** The whole run is recorded before anything is drawn, so play, pause, step
  forward, step back and scrubbing are all the same operation: an index into an array. Speeds run
  from 0.5x to 8x; space, arrow keys, Home and End drive the transport from the keyboard, and `?`
  lists the rest.
- **Debugger stepping over a recording.** Step over runs to the next step no deeper than this one —
  past a call and over its whole callee — and step out to the step at which the current frame has
  returned. Where the history holds no such step the control is disabled rather than jumping to
  whichever step happens to be last.
- **The machine state, panel by panel.** Source with the current line highlighted, the disassembly
  with the program counter, the call stack, the operand stack, the local variable slots — named from
  the `LocalVariableTable` when the class was compiled with `-g` — the heap when the program
  allocates an array or an object, and the console when it prints.
- **Branch arcs.** Jump targets are drawn as arcs in the bytecode gutter, so a loop looks like a
  loop before you read a single offset.
- **A "next instruction" card.** For the instruction about to execute: its effect on the operand
  stack, a sentence about the concrete values it will touch, and — for instructions with a constant
  pool operand — the resolution chain, e.g. `#7 → Methodref → Factorial.factorial:(I)I`.
- **A depth chart under the scrubber.** Call stack depth across the entire run, which makes
  recursion visible as a shape you can click into, marked with the calls, returns, taken branches,
  heap writes and printed lines — so the track is a map of the run rather than a progress bar.
- **Where a value came from.** Every cell of the operand stack and every local slot carries the step
  that produced it, and following it seeks the run there. A live debugger cannot answer that; a
  recording can, and this one keeps every step.
- **A link to a moment.** `#/bubble-sort/248` addresses a step of a run, so a question about one
  instruction can be sent as the run standing on it. Only the bundled examples are addressable — an
  uploaded `.class` never leaves the tab.
- **A glossary where the words are.** Every panel header whose term needs explaining carries a way
  into it, and `docs/jvm-primer.md` is the long form behind them.

![Mid-run: the console filling line by line as `invokevirtual` resolves `PrintStream.println`](docs/screenshots/console.png)

If the operand stack, the frame, the constant pool or a descriptor like `(I)I` is unfamiliar,
[`docs/jvm-primer.md`](docs/jvm-primer.md) explains each of them from scratch, using this
application's own panels as the running example.

## How it works

Everything that executes bytecode runs in the browser. A `.class` file is parsed from an
`ArrayBuffer` with a `DataView` cursor, disassembled into instructions, and then executed **ahead of
time** by an interpreter that records one immutable snapshot per step — the state _before_ each
instruction runs, closed by a terminal snapshot. The UI never executes anything; it reads
`history[index]`. Stepping backwards needs no undo logic because there is nothing to undo.

The optional Java compile service is the other half of the story, and it is deliberately boring: it
compiles source to bytecode in memory with `javax.tools.JavaCompiler` and returns the bytes. It
never loads a class, never runs what it compiled, never writes to disk. javac itself runs in a
short-lived child JVM that is killed outright once the deadline passes — the only kind of timeout
that actually stops a compiler. The compiled bytecode executes on the client, in the same
interpreter that handles uploads. That inversion — the server compiles, the client executes —
removes remote code execution from the threat model instead of trying to sandbox it
([ADR-0003](docs/adr/0003-backend-compiles-never-executes.md)).

```mermaid
flowchart LR
  subgraph browser["Browser"]
    examples["Bundled examples"] --> bytes
    upload["Uploaded .class"] --> bytes
    editor["Java editor"]
    bytes[".class bytes"] --> parser["Parser<br/>DataView cursor"]
    parser --> disasm["Disassembler<br/>Instruction list"]
    disasm --> interp["Interpreter<br/>int subset, arrays, objects"]
    interp --> history["Snapshot history<br/>one per step"]
    history --> ui["React UI<br/>replay = index lookup"]
  end
  subgraph backend["compile-service — optional"]
    javac["javac in a child JVM<br/>in memory, never executes"]
  end
  editor -->|"POST /api/compile"| javac
  javac -->|"class bytes, base64"| bytes
```

The domain layer (`web/src/core/`) is plain TypeScript with no React, no DOM and no dependency on
the application layer. That is not a convention, it is a lint rule — see
[Design decisions](#design-decisions).

## Correctness

The interpreter is the part that has to be right, so it is pinned from four directions.

- **Differential tests against a real JVM.** Each bundled example is compiled and then _run_ by
  `java` when the fixtures are built; the printed result is stored in `manifest.json` as
  `expectedResult`. Beyond that, the awkward corners of the instruction set have programs of their
  own under `web/src/core/interpreter/__fixtures__/programs/`, whose stdout was captured from a real
  `java` and is committed line for line: shifts at distances 0–35 across both `int` boundaries,
  `tableswitch` and `lookupswitch` including fall-through, every pair from a nine-value set through
  `Math.max`/`min`/`abs`/`floorDiv`/`floorMod`, and every `print`/`println` overload. No expectation
  in those files was written by hand. If the interpreter drifts from the reference implementation,
  the test fails with the number that proves it.
- **Property-based tests (fast-check).** 32-bit `int` arithmetic is checked against a `BigInt`
  reference truncated to the low 32 bits — `iadd`, `isub`, `imul`, `idiv`, `irem`, `ineg`, the
  shifts and their five-bit distance masking, the bitwise operations and the `i2b`/`i2c`/`i2s`
  narrowings, including `INT_MIN / -1` and `INT_MIN % -1`. A plain `a * b` in JavaScript does not
  wrap at 32 bits, and these properties are what catches it. The parser gets the same treatment from
  the other side: fed random buffers, random tails and arbitrary truncations of a valid class file,
  it must fail with a typed `ClassFileError` and never with a raw `RangeError`.
- **javap parity.** The parser assertions are transcribed from `javap -v -p Factorial.class` and the
  disassembler assertions from `javap -c` — mnemonics, offsets, operands, resolved branch targets
  and the jump tables of both switch instructions, which are compared against javap's own arms
  rather than a transcription of them. The full javap dump is committed next to the fixture
  (`web/src/core/classfile/__fixtures__/Factorial.javap.txt`) so a reviewer can check the expected
  values without a JDK.
- **A corpus nobody here wrote.** 8,053 class files from ten Maven Central libraries — javac across
  a decade, plus `kotlinc` and `scalac` — parsed and disassembled with zero failures, on every CI
  run. It is also what measures the interpreter's reach rather than asserting it; see
  [Scope and limitations](#scope-and-limitations).
- **The rest of the pyramid.** Over a thousand unit and component tests, plus a Playwright suite that
  replays a recursive program end to end, scrubs into the recursion, opens a class with no entry
  point in the explorer, rejects a non-class file and keeps the app usable afterwards — and a second
  end-to-end job that runs the editor against the compile service built from its own Dockerfile.

## What it costs

Recording every step is the central bet of this design, so the cost of recording is measured
rather than assumed, and the measurements are budgets that fail a build when they move.

- **~600,000 steps a second.** A 20,007-step counting loop is parsed, disassembled, executed and
  recorded in 33 ms. Measured under Node 20 on one core with `vitest`, which is a development
  machine and not a benchmark rig — the figure is there to catch an order of magnitude, not to be
  compared against a JIT.
- **A frame is copied once per change, not once per step it survives.** Two hundred nested calls
  produce 1,608 frozen frames where copying the whole call stack per step would have produced
  142,911 — 89× fewer. That reuse is what makes [ADR-0001](docs/adr/0001-snapshot-history.md)
  affordable rather than theoretical, and
  `web/src/core/interpreter/performance.test.ts` asserts the ratio instead of trusting it.
- **The history has a ceiling, and it is a number in a file.** 8M live array elements and 24M
  recorded ones, both surfaced as `OutOfMemoryError` exactly as a real JVM would, so a program
  that asks for more stops with its history intact rather than taking the tab with it.
- **The bundle has one too.** `npm run size -w web` fails when a shipped chunk outgrows its
  gzipped budget. Raising a budget is a normal thing to do; doing it in a commit that says why is
  the point.

Only the wall-clock figure is a smoke ceiling — timing on a shared CI runner is not evidence. The
assertions that matter are the ones about shape: frames shared, budgets enforced, nothing
quadratic.

## Running it in the open

Two things a deployed build needs that a local one does not.

**Failures reach someone.** `web/src/services/telemetry.ts` is one function, one payload type and
one endpoint, off unless `VITE_TELEMETRY_URL` is set. Two constraints shaped it. The first is
privacy: an uploaded `.class` never leaves the tab, and a crash report is exactly the sort of thing
that quietly breaks such a promise — so the payload is a **closed union of scalars**, with no field
a class file, a line of source or a pool string can be put in. That is a stronger guarantee than
remembering to redact, and a test reads the bytes actually put on the wire to prove it. The second
is that a report has to be actionable, which here costs almost nothing: runs are deterministic
(ADR-0001), so for a bundled example an id and a step index reproduce the exact state that broke.

**The bundle cannot drift.** ADR-0006 measured what this application costs a browser and changed the
architecture on the strength of it, and then nothing enforced any of it. `npm run size -w web`
checks each chunk's gzipped size against a budget set close to its current figure, and CI runs it
after the build — a bundle grows a hundred kilobytes one reasonable-looking dependency at a time,
and this makes the hundredth kilobyte a decision instead of an accident.

```
✓ index.js                   85.7 kB gzip /  95 kB  the application itself
✓ react.js                   42.2 kB gzip /  48 kB  react + react-dom
✓ motion.js                  44.1 kB gzip /  50 kB  framer-motion
✓ index.css                  10.1 kB gzip /  14 kB  the whole stylesheet
✓ run-program.worker.js      12.2 kB gzip /  16 kB  parser + interpreter
```

**A run can be shown somewhere else.** Adding `?embed` puts the application in embedded mode: the
toolbar is replaced by the name of what is loaded and a way out to the full application, and the
frame shows one run rather than an invitation to pick one. The flag is a query parameter and the
moment is a hash, so the two compose without knowing about each other.

```html
<iframe
  src="https://your-deployment/?embed#/bubble-sort/tour/the-swap/2"
  width="1100"
  height="700"
  title="A swap, one instruction at a time"
  loading="lazy"
></iframe>
```

Anything from about 1000×640 gets all three panels; below that the State column folds into a band
under the code, as it does on a tablet, and a short frame starts costing rows of the listing. An
embed that names no program loads the first example, because a frame in someone else's page has no
business showing a chooser.

Coverage thresholds are enforced by CI rather than by review: `web/src/core/**` must stay at 90%
lines, branches and functions, configured in `web/vite.config.ts`.

## Scope and limitations

This is a teaching instrument for how a stack machine works, not a JVM. The scope is closed on
purpose so that what exists can be complete — see
[ADR-0002](docs/adr/0002-int-only-mvp-without-heap.md) for the reasoning and the exit path, and
[ADR-0005](docs/adr/0005-heap-of-int-arrays.md) for where the boundary moved to when that path was
taken.

**The parser and the disassembler are measured against the real world; the interpreter is
deliberately not.** Those are two different claims and it is worth keeping them apart.

`npm run corpus -w web` fetches ten libraries from Maven Central — pinned by SHA-1, and chosen so
that four compilers are represented rather than one: javac across a decade (a Java 6 target through
a Java 17 one), plus `kotlinc` and `scalac`, which emit shapes javac never does, plus ASM, which is
a bytecode library and therefore full of the format's own corners. `npm run test:corpus -w web` then
puts every class file in them through the same parse → disassemble path the application uses:

| Over 10 jars from Maven Central       |           |
| ------------------------------------- | --------- |
| Class files parsed                    | 8,053     |
| Failures                              | **0**     |
| Methods disassembled                  | 88,604    |
| Instructions decoded                  | 1,173,738 |
| Methods with an undecodable tail      | **0**     |
| Class file major versions encountered | 49–53     |

That is what "the parser reads the whole format" means here, and CI runs it on every change.

**Execution is a narrower claim, and the same corpus measures it rather than guessing.** 91.5% of
those 1.17 million instructions are ones the interpreter implements. That figure flatters, though,
because a method replays only if _every_ instruction in it runs — so the number that matters is the
one counted per method: **65.2% of the 88,604 methods (57,732 of them) consist entirely of
implemented instructions.**

The most common instruction still outside the subset is `invokeinterface`, and behind it sit the
things a second class file would be needed for. Which is the boundary in one sentence: **everything
resolves inside the uploaded class.** Its own objects, constructors, instance methods and fields all
run — `new ArrayList<>()` does not, and neither does `throw new IllegalStateException(...)`, not for
want of an instruction but for want of a class to load. The table below makes that predictable
rather than surprising.

A separate limit decides whether a file replays at all: a run needs a static method it can enter,
and a library class has none. Only one of the 8,053 has a `main` — which is a fact about libraries,
not about the interpreter, and why the explorer matters as much as the transport.

A file that does not replay is not a dead end. Parsing, the constant pool, the method table and the
full listing of every method do not depend on execution, so the class opens in the explorer either
way, and a run that stops midway keeps the history it recorded up to that point.

| In the Java source                                                                                                         | In the bytecode                                         | What the application does                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A type other than the one loaded — `new ArrayList<>()`, `throw new IllegalStateException(...)`, a second class of your own | `new`, `invokespecial`, `getfield` naming another class | Stops at the instruction that names it. Objects of the _loaded_ class work; there is no second class file to load.                 |
| Static fields                                                                                                              | `putstatic`, `getstatic` outside the externals table    | Stops at the write. There is no class initialisation and no static state.                                                          |
| `long`, `float`, `double`                                                                                                  | `ladd`, `fmul`, `dload`, two-slot locals                | Stops at the first such instruction; a method taking one cannot be called.                                                         |
| Lambdas, method references, `"a" + b`                                                                                      | `invokedynamic`                                         | Stops at the call site. String concatenation compiles to `invokedynamic` on Java 9 and later.                                      |
| Arrays of anything but `int`                                                                                               | `anewarray`, `multianewarray`, `baload`, …              | Stops at the allocation. The heap holds `int` arrays only.                                                                         |
| Standard library calls beyond `Math` and `System.out`                                                                      | `invokestatic`/`invokevirtual` on another type          | Stops with `unsupported-call`. The recognised members are a table in `web/src/core/interpreter/externals.ts`; adding one is a row. |
| No static `main` — a utility class, an interface, an enum, a record, a nested class                                        | no entry point to run                                   | Opens in the explorer with no run attached: the listing, the pool and the class header are all still there to read.                |

The parts that hold regardless of which file is loaded:

- **A single-class machine.** `int` values, `int` arrays and instances of the one class in the file,
  on a small heap, plus opaque tokens for the few external members it recognises. No
  `long`/`float`/`double`, no second class file, no inheritance beyond `Object`, no interfaces, no
  static state, no threads, no lambdas, no bytecode verification.
- **Objects of the loaded class.** `new`, the constructor, instance methods and instance fields all
  run: an object's shape is fixed at allocation from the class's own field table, each field starts
  at the default its descriptor names, and the heap panel draws the fields by name as the run writes
  them — a linked list of the class shows up as the chain it is
  ([ADR-0008](docs/adr/0008-objects-of-the-loaded-class.md)).
- **The executable subset** is integer computation and control flow — constants, load/store, `iinc`,
  stack manipulation, integer arithmetic, shifts and bitwise operations, narrowing conversions, the
  `if<cond>`/`if_icmp<cond>` families, `goto`, `tableswitch`/`lookupswitch`, `wide`, `int` array
  access, `athrow`, and `invokestatic`/`ireturn`/`return`, with `invokestatic` resolving within the
  class being executed plus the `java/lang/Math` methods on the externals table. The definitive list is
  `STACK_EFFECTS` in `web/src/core/disassembler/opcodes.ts`, and the welcome screen states it at
  runtime rather than from a hand-written list, so it cannot drift.
- **Decoding is wider than execution, on purpose.** Every assigned opcode below `0xca` is fully
  decoded — mnemonic, operands, branch targets, switch tables — whether or not the interpreter runs
  it, so `getfield #3` reads as `getfield #3 // Field Counter.value:I` in a class that never
  executes. Decoding stops only at bytes that genuinely have no instruction boundary after them.
- **The parser is wider still.** It reads the whole class file format — every constant pool tag,
  unknown attributes skipped by length — because a modern `javac` emits attributes a narrow parser
  would choke on. Not a claim taken on trust: 8,053 class files from ten Maven Central libraries,
  including Kotlin's and Scala's standard libraries, parse and disassemble with zero failures, and
  CI checks it on every change (see [Scope and limitations](#scope-and-limitations)).
- **`try`/`catch` catches what the machine raises.** The `exception_table` is read, `athrow` runs,
  and a thrown exception walks the call stack looking for a handler, unwinding the frames that have
  none — visibly, in the call stack panel, one step at a time. What it catches are the exceptions
  this machine can raise: `ArithmeticException`, `ArrayIndexOutOfBoundsException`,
  `NullPointerException`, `NegativeArraySizeException`. Handler matching follows the class
  hierarchy, so `catch (Exception e)` catches all of them, and `finally` works because javac
  compiles it to a catch-all row. An exception of your own still needs `new` to build it
  ([ADR-0007](docs/adr/0007-exceptions-without-an-object-model.md)).
- **A stopped run is still a run.** Whatever was recorded before the failure stays loaded and
  scrubbable, and the banner names the instruction and the offset that stopped it.
- **The bundled examples do not print.** `System.out.println` works, but a printed line is a worse
  teaching artefact than a named local you can watch change, so each example leaves its result in a
  local variable in `main` instead.
- **A step limit of 20,000** (raisable from the UI) stops runaway loops. The history collected up to
  that point stays playable, and so does the history up to a division by zero or an unsupported
  instruction. How far the limit may be raised depends on the device: a browser that reports how
  much memory it has gets a ceiling it can actually hold, rather than one chosen on a laptop.
- **Two bounds on memory, both reported as `OutOfMemoryError`** — the same answer a real JVM gives.
  One is the heap itself, so that `new int[Integer.MAX_VALUE]` stops at the allocation instead of
  taking the tab with it. The other is the recording: every step that writes to an array keeps its
  own immutable copy of that array, so a large array written in a loop costs far more history than
  the array does, and that is what the second bound meters. Both leave the run playable up to the
  point they stopped it.

The bundled examples exist because of this table, not in spite of it: they are the shape of program
that fits, and [`docs/jvm-primer.md`](docs/jvm-primer.md) explains the machine they run on.

## Tech stack

| Layer              | Choice                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Frontend           | React 18, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite |
| Styling            | Tailwind CSS v4 (`@theme` tokens in `index.css`), framer-motion for value transitions         |
| Domain             | Plain TypeScript — parser, disassembler, interpreter, zero framework dependencies             |
| Backend (optional) | Java 21, Spring Boot 3, Maven                                                                 |
| Tests              | Vitest, Testing Library, fast-check, Playwright, JUnit 5, MockMvc                             |
| Tooling            | ESLint (typescript-eslint strict-type-checked), Prettier, GitHub Actions                      |

## Getting started

**Prerequisites:** Node ≥ 20.18.1 and npm ≥ 10. A JDK 21+ is needed only for the compile service and
for rebuilding fixtures — the example `.class` files are committed, so the frontend needs no Java at
all.

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole application: examples and `.class` upload work with no backend
([ADR-0004](docs/adr/0004-backend-as-progressive-enhancement.md)).

![The start screen, with the bundled examples](docs/screenshots/welcome.png)

### The optional compile service

The in-browser Java editor appears only when a compile service is configured and answers a health
check. In one terminal:

```bash
cd server
./mvnw spring-boot:run       # http://localhost:8080
```

In another, point the frontend at it and restart the dev server:

```bash
cp web/.env.example web/.env    # sets VITE_COMPILE_API_URL=http://localhost:8080
npm run dev
```

The variable is read at build time. Leave it unset and the editor tab simply does not exist — no
broken button, no error.

### Checks

```bash
npm run lint                 # ESLint, strict-type-checked
npm run typecheck            # tsc -b
npm test                     # Vitest: core + UI projects
npm run build                # production bundle
npm run test:coverage -w web # coverage, with the core thresholds enforced
npm run e2e -w web           # Playwright; builds and serves dist/ itself
cd server && ./mvnw verify   # JUnit + MockMvc
```

The first Playwright run needs a browser: `npx playwright install chromium`.

### Rebuilding the fixtures

```bash
npm run fixtures -w web
```

Requires a JDK 21+ on `PATH`. The script compiles the sources in `web/fixtures/src/` with
`javac -g --release 21`, runs each program on a real JVM to capture its result, and regenerates
`web/public/examples/` together with `manifest.json`. Those artifacts are committed, which is why CI
and deployment need no JDK.

### Deploying it

The frontend is a static bundle and the compile service is a container, so the two deploy
independently and neither waits for the other. [`docs/deployment.md`](docs/deployment.md) walks
through Vercel for the frontend and Fly.io for the server, and lists the placeholders to fill in.

## Design decisions

Architecture decision records live in [`docs/adr/`](docs/adr/), and
[`docs/architecture.md`](docs/architecture.md) goes deeper on the module map, the data flow and the
error taxonomy. [`docs/jvm-primer.md`](docs/jvm-primer.md) covers the machine itself — the operand
stack, frames, local variable slots, the constant pool and descriptors — for a reader who has never
opened the JVM specification.

- [**ADR-0001 — Snapshot history instead of a live interpreter.**](docs/adr/0001-snapshot-history.md)
  Execute the whole program up front and return an immutable array of snapshots; the frontend
  replays it. Step-back and scrubbing become index arithmetic, and the interpreter stays a pure
  function that can be tested like one. Amended by ADR-0006 for where the run happens.
- [**ADR-0002 — MVP on `int` only, without a heap.**](docs/adr/0002-int-only-mvp-without-heap.md)
  A closed instruction set that can be implemented and tested completely, rather than a broad one
  that is right in patches. Amended by ADR-0005 for the heap.
- [**ADR-0003 — The backend compiles, it never executes user code.**](docs/adr/0003-backend-compiles-never-executes.md)
  Compilation happens in memory with `-proc:none`, an empty class path and a size cap, inside a
  child JVM that is killed at the deadline and rationed by a bounded pool and a per-IP rate limit;
  execution happens in the user's own browser.
- [**ADR-0004 — The backend is progressive enhancement, not a dependency.**](docs/adr/0004-backend-as-progressive-enhancement.md)
  The demo, the local setup and the frontend CI all work with no server running.
- [**ADR-0005 — A heap that holds `int` arrays and nothing else.**](docs/adr/0005-heap-of-int-arrays.md)
  Amends ADR-0002 along the exit path it named: arrays on an append-only heap, references as
  handles, and a kind tag per value so the machine refuses to read one as the other.
- [**ADR-0006 — Execution in a worker, and the history streamed back in batches.**](docs/adr/0006-execution-in-a-worker.md)
  A worker that posts a 500,000-step history as one message is six times _worse_ than no worker,
  because deserialising it lands on the thread the worker was meant to free. Batching splits that
  cost into tasks the browser can interleave: the longest main-thread stall drops from 403 ms to
  ~120 ms.
- [**ADR-0008 — Objects, of the loaded class and no other.**](docs/adr/0008-objects-of-the-loaded-class.md)
  The corpus measurement is what chose this over `long`/`double`: three of the four most common
  instructions the interpreter could not run were one feature. The boundary is the one
  `invokestatic` always had — everything resolves inside the uploaded class, because there is no
  second class file to give another object a shape.
- [**ADR-0007 — Exceptions the machine raises, caught without an object model.**](docs/adr/0007-exceptions-without-an-object-model.md)
  `try`/`catch` looked blocked behind `new`, until the observation that the exceptions a learner
  actually meets are never constructed by their code — the JVM raises them. Catching is the half
  that needs no constructor, and it is the half where the stack unwinding is worth watching.

The boundary from ADR-0001 is enforced mechanically. `web/eslint.config.js` bans imports of React,
the DOM and the application layer from `web/src/core/**`, and bans `window`, `document` and
`localStorage` there too. Dependencies flow UI → core, and a stray import fails the build rather
than a code review.

## Project structure

```
web/
  src/core/         pure TypeScript domain — no React, no DOM (lint-enforced)
    classfile/      ByteReader, parser, descriptors, typed ClassFileError
    disassembler/   full opcode table, decoding, branch targets, switch tables
    interpreter/    execute() → snapshots, frames, int32, heap, external members
  src/components/   panels, transport, branch gutter, depth chart, constant pool
  src/services/     program building, app state machine, capabilities, compile client
  fixtures/         example .java sources + the build script
  public/examples/  committed .class files and manifest.json
  tests/e2e/        Playwright specs
server/             Spring Boot compile service (Java 21)
docs/adr/           architecture decision records
```

## Roadmap

Ordered by how often an uploaded file runs into them, which is not the order they are easiest to
build in.

1. **Arguments for the method a run starts from.** `ExecuteOptions` names an entry method but has no
   channel for argument values, so a static `int` method that takes parameters is listed and marked
   rather than offered. `notRunnableReasonOf` in `web/src/services/program.ts` is the one place that
   has to change.
2. **A second class file** — the one limit that now decides most outcomes. Loading a class by name
   would let `new` and the call instructions resolve against something other than the file in front
   of them, which is what `new ArrayList<>()`, `throw new MyException()` and interface dispatch are
   all waiting on. ADR-0008 records why nothing built for objects has to change for it.
3. **Other JVM languages** — Kotlin and Scala compile to the same bytecode, and the corpus already
   parses both standard libraries; the constraint is the instruction set, not the source language.

Earlier items are done and are described above rather than here: arrays on a small heap (BubbleSort
is a bundled example again), the everyday instruction set that uploads used to stop on (shifts and
bitwise operations, `switch`, `System.out.println` and the static `Math` methods), the explorer that
opens a class file whether or not anything in it can run, and shareable links — `#/bubble-sort/248`
addresses a step of a run, so a moment can be linked to rather than described.

![Bubble sort mid-run: the heap panel shows the array being reordered, with the element the current `iastore` writes highlighted](docs/screenshots/bubble-sort.png)

## License

[MIT](LICENSE) — Copyright (c) 2026 Michał Błaszczykowski.
