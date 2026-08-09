# ADR-0006: Execution in a worker, and the history streamed back in batches

- **Status:** Accepted
- **Date:** 2026-08-01
- **Amends:** [ADR-0001](0001-snapshot-history.md), on where the run happens and what it costs to
  hand the history over. The recording model itself is unchanged.

## Context

ADR-0001 accepted one cost explicitly: "execution starts with a delay equal to the entire run
(milliseconds for the MVP)". That held while the step limit was 20 000. It stopped holding when the
UI grew a "Raise the limit" action that goes to 500 000: the case where the reader asks for a longer
run is exactly the case where the tab stops responding, including the control that would let them
change their mind.

The same ADR deferred structural sharing to v2 "because it needs a benchmark, which is itself good
README material". Sharing has since landed. `SnapshotWriter` reuses the frozen frame it last emitted
at each depth, and the heap reuses each frozen array whose version did not change. The benchmark it
named was never written. Moving execution off the main thread is what finally required one, because
the obvious design turns out to be wrong in a way only measurement reveals.

## The measurement

A 500 000-step run, measured on V8:

|                                                |          |
| ---------------------------------------------- | -------- |
| `execute()` itself                             | 404 ms   |
| Serialising the history into one `postMessage` | 1 443 ms |
| Deserialising it on the receiving side         | 2 591 ms |
| Heap held by the history in the worker         | 274 MB   |
| Heap held by the same history after transfer   | ~610 MB  |

Two conclusions follow, and the second is the one that matters.

Structural sharing survives the boundary. The structured clone algorithm preserves object identity
through its memory map: 36 distinct `Instruction` objects arrive as 36, and the bottom frame shared
by every snapshot arrives shared. What does not survive is `Object.freeze` and the compactness that
came with it: a deserialised graph costs 2.2× the heap of the one it was cloned from.

A worker that posts the history whole is slower than no worker at all. Deserialisation runs on the
receiving thread, so the naive design moves a 404 ms block off the main thread and puts a 2 591 ms
one back on it. It makes the freeze roughly six times worse while appearing, in the source, to fix
it.

## Decision

Execution runs in a dedicated worker per run, and the history is streamed back in batches of 2 000
snapshots instead of posted as one value.

Batching is cheaper in total, 1.9 s against 3.9 s, because V8's back-reference table degrades worse
than linearly on a graph of that size. That is not the reason for it. The reason is that it splits
the receiving cost into tasks the browser can interleave with painting and input. Measured on the
built application in Chromium, uploading a class and raising the limit to 500 000 steps:

|                             | wall clock | longest main-thread stall | frames painted |
| --------------------------- | ---------- | ------------------------- | -------------- |
| Before, on the main thread  | 550 ms     | 403 ms                    | 5              |
| After, worker and streaming | ~1.6–2.1 s | 107–131 ms                | 34–91          |

The run takes longer in wall-clock terms and the page stays alive throughout, which is the trade
this decision makes.

The residual ~100 ms gaps were attributed by measurement: raising the batch size to 100 000 turns
them into five gaps of ~230 ms, which identifies those as deserialisation, while 2 000 and 500
produce identical ~100 ms gaps. Those are V8 major-GC pauses as the received history grows the heap
toward 600 MB. Batching has removed deserialisation from the profile; what remains is the 2.2×
memory tax.

Cancellation comes with the worker, and not as a separate feature. `AbortController` complements
the token that `app-state.ts` already carries: the token settles which answer counts, the controller
settles which run continues. Terminating the worker stops the interpreter loop mid-flight and
releases the history it had accumulated, which the token alone could never do, since it only ever
discarded a result that had already been computed in full.

Where no `Worker` exists (jsdom, Node, a browser that refuses a module worker, a missing chunk) the
run happens inline exactly as before. The fallback is a property of the runner and not a branch at
each call site, and the UI stops offering to cancel instead of offering it falsely.

## Consequences

**Positive**

- The page stays responsive during a long run, and a run can be abandoned in a way that actually
  stops the work.
- ADR-0001's central claim is untouched: `execute()` is still a pure function returning an immutable
  history, and the player is still an index into an array. Only the thread it runs on moved.
- The benchmark ADR-0001 asked for exists, and it changed the design instead of confirming it.

**Negative / costs**

- Wall-clock time for a long run is roughly three times what it was. Responsiveness was bought with
  throughput.
- The history is materialised twice at peak, once in the worker and once on the main thread, and the
  transferred copy is unfrozen and 2.2× larger. This is now the dominant cost of a large run.
- One more moving part: a wire protocol between two threads, which has to stay in step with the
  domain types on both sides.

**What this does not do**

Eliminating the 2.2× tax would mean never materialising the history on the main thread at all:
keeping it in the worker, serving snapshots by index, and computing the whole-history derivations
(the depth chart, the executed-offset sets, the first-step indexes) there too. That is a real
design, and it reshapes `LoadedProgram` and every panel that reads it. It is not taken here.

## Alternatives considered

- _Posting the history as one message._ Rejected by the measurement above; it is a pessimization.
- _Transferring an `ArrayBuffer` and decoding it lazily._ Would avoid the structured-clone cost
  entirely, but it means designing a binary encoding of the snapshot graph and giving up the shared
  object identity that survives cloning today. Worth revisiting only if the history stops being
  materialised on the main thread at all, which is the larger design above.
- _Chunking execution on the main thread with `setTimeout` between slices._ Keeps one thread and
  needs no protocol, but it makes `execute()` re-entrant and destroys the property ADR-0001 exists
  to protect: that the interpreter is a pure function testable as one.
