# ADR-0001: Snapshot history instead of a live interpreter

- **Status:** Accepted. The costs recorded below are amended by
  [ADR-0006](0006-execution-in-a-worker.md) (2026-08-01), which moves the run off the main thread
  and carries the benchmark this record asked for. The recording model (execute ahead of time,
  replay by index) stands as written.
- **Date:** 2026-07-16

## Context

The application replays bytecode execution like a video: play/pause, step forward, step back and
scrubbing to any point of the run. The obvious first approach, an interpreter driven by the UI that
executes one instruction on demand, has three drawbacks:

1. Stepping back requires undoing effects (an undo path for every instruction) or restarting from
   the beginning and fast-forwarding. The first doubles the implementation of every instruction; the
   second is slow and feels non-deterministic.
2. The interpreter becomes stateful and coupled to the UI. Testing it means driving it from the
   outside, and the state "between" steps leaks into components.
3. Scrubbing (jumping to step N) has no sensible implementation without a full history.

Programs within the MVP scope are small: a 20 000 step limit, `int`s only, no heap, and a frame
holds a few dozen bytes of data.

## Decision

`execute(classFile, options)` runs the whole program synchronously and returns an `ExecutionResult`
containing an array of immutable snapshots, one per step (the state before the instruction
executes), closed by a terminal snapshot.

The frontend executes nothing; it replays the array. `stepForward`/`stepBack`/`seekTo` are index
operations: `history[index]`.

The interpreter is a pure, deterministic function: `ClassFile → ExecutionResult`. The `core/` layer
knows nothing about React or the DOM; the boundary is enforced by an ESLint rule
(`no-restricted-imports` for `src/core/**`).

## Consequences

**Positive**

- Stepping back and scrubbing are trivial and always consistent; there is no separate code path to
  test.
- The interpreter is tested like a pure function: input → expected history. That makes differential
  testing against a real JVM and property-based testing of the arithmetic possible.
- Runtime errors (division by zero, unsupported opcode) still return the history up to the error, so
  the UI can show where the program stopped and not only that it stopped.
- No state is shared between the UI and the domain. The hook plays a recording; it drives nothing.

**Negative / costs**

- Memory: a full copy of the frame stack per step. With a 20 000 step limit and small frames this is
  an accepted cost; no optimisation before measurement.
- Programs with long loops end as `kind: 'step-limit'` instead of running "forever"; the UI has to
  say so explicitly.
- Execution starts with a delay equal to the entire run (milliseconds for the MVP).

**Alternatives considered**

- _Step-driven interpreter with an undo log._ Rejected: it doubles the implementation of instruction
  semantics.
- _Snapshots with structural sharing (persistent data structures)._ Deferred to v2; it needs a
  benchmark, which is itself good README material.
