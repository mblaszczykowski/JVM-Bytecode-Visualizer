# ADR-0005: A heap that holds `int` arrays and nothing else

- **Status:** Accepted. The sentence below that the heap "holds fixed-length arrays of `int` and no
  other object" is superseded by [ADR-0008](0008-objects-of-the-loaded-class.md) (2026-08-04), which
  takes the exit path named at the end of this record. Everything else here (handles, kind tags, the
  append-only heap, the frozen view) stands as written and is what objects were built on.
- **Date:** 2026-07-30
- **Amends:** [ADR-0002](0002-int-only-mvp-without-heap.md), the "no heap" half of that decision,
  along the exit path it named.

## Context

ADR-0002 closed the MVP at the `int` type with no heap, and said what would have to happen for that
boundary to move: arrays are "the first candidate for v2", the snapshot model "would need to grow a
heap, which changes the domain contract and calls for a new ADR". This is that ADR.

What the int-only machine ran into was a ceiling on what it could teach. With locals and the
operand stack as the entire state, nothing on screen ever outlives the frame that created it or is
reachable from two frames at once. A viewer watching `Factorial` or `Gcd` sees a stack machine
compute a number, and never sees a data structure that instructions read and write by reference.

Arrays are that first data structure, and a sort is the canonical thing to watch execute. Bubble
sort in particular is worth an animation: its interesting state is not in any frame, the same five
cells are rewritten a few dozen times, and the local variables alone stop telling the whole story.
ADR-0002 listed exactly this as a cost it accepted ("BubbleSort and other classic array examples are
out of scope").

The reasoning that produced the boundary in the first place has not changed. A closed scope is what
makes it possible for the part that exists to be complete and completely tested. So the question was
not whether to open up the heap, but where the new boundary sits.

## Decision

The interpreter has a heap (`web/src/core/interpreter/heap.ts`, JVMS §2.5.3), shared by every frame
of a run and never unwound. It holds fixed-length arrays of `int` and no other object.

- `newarray` allocates, but only for `atype = T_INT` (10). Every other element type ends the run
  with `unsupported-array-type`, checked before the count is popped, since a `long[]` is not a
  program this interpreter can continue in any case. `iaload`, `iastore` and `arraylength` operate
  on what it allocated; the `aload`/`astore` families move references between slots and the operand
  stack; `aconst_null` pushes the null reference. The executable set is the `Op` table and the
  dispatch `switch` in `web/src/core/interpreter/interpreter.ts`, which is the definitive list.
- A reference is a handle: the index of the array in the heap, with no address arithmetic, so a `ref`
  value `h` names `snapshot.heap[h]`. `null` is the handle `-1`, at which no array ever lives (JVMS
  §2.4). A handle that names no cell, whether `null` or anything else out of range, is a
  `null-reference` fault, which is the `NullPointerException` a real JVM raises.
- Every operand stack cell and every local slot carries a `ValueKind`, `int` or `ref`, tracked
  alongside the number. An instruction that reads a reference as an `int`, or the reverse, stops the
  run with `invalid-state` instead of producing a plausible wrong number. This is the bytecode
  verifier's job in a real JVM (JVMS §4.10), and this interpreter has no verifier.
- Faults are named for the exception a real JVM throws: `array-index-out-of-bounds`,
  `negative-array-size`, `null-reference`, alongside the existing kinds. They are returned with the
  history so far, like every other `VmError`, so an out-of-bounds write stops the run and leaves it
  playable.
- The heap is append-only. Arrays are never freed and handles are never reused, so there is no
  garbage collector and no aliasing question a snapshot has to answer. `freeze()` produces the
  immutable view a snapshot carries: a step that touched no array hands back the identical view it
  handed back last time, and a step that wrote to one array keeps the frozen objects of all the
  others. The history therefore costs one element copy per allocation and per mutating step rather
  than one per array per step, which is the same sharing the call stack already uses (ADR-0001).
- Two bounds, and they measure different things. `MAX_HEAP_ELEMENTS` (8,000,000) is what the program
  holds live at once, so `new int[Integer.MAX_VALUE]` stops at the allocation.
  `MAX_RECORDED_ELEMENTS` (24,000,000) is what the history retains, which is the larger number
  because a loop writing to one array records a copy per step. Both surface as `OutOfMemoryError`
  with `resource` naming which one was hit, and both leave the run playable up to that point.

  The recording bound is no longer the heap's alone. One `RecordingBudget` per run is shared by the
  heap, the console and the interned external objects, and each recorded step charges one slot per
  heap handle plus the elements or fields of the cells that actually changed, plus the console lines
  it hands back, plus the length of the externals pool. A run that prints on every step therefore
  costs history even with an empty heap, which is the case that used to escape the bound entirely.

- The `Snapshot` change is additive. `heap` and the two kind arrays are optional fields that
  `execute()` always fills, so a panel that only reads numbers keeps working and an int-only run
  produces the same frozen empty heap on every step.

Still out of scope: objects (`new`, `invokespecial`, constructors), instance and static fields,
arrays of any element type but `int`, arrays of arrays (`anewarray`, `multianewarray`), `String` and
the string pool, and everything ADR-0002 excluded that is not an `int` array. Array _parameters_ and
array _returns_ are out too: `invokestatic` still accepts only descriptors of `int` parameters and
an `int` or `void` return, so an array is built and used inside the frame that owns it.

## Consequences

**Positive**

- `BubbleSort` is a bundled example, and it shows what the visualizer is for: the heap panel redraws
  the same five cells while the frames stay dull.
- The reference/`int` distinction is visible in the UI. A slot holding `int[5]@0` reads as a handle,
  which is the mental model the JVM uses.
- Refusing to confuse the two kinds turns a class of malformed bytecode into a specific message at
  the instruction that did it, which is the closest this machine gets to a verifier.
- Handles as indices make snapshots trivially serialisable and trivially comparable: the array in
  step 40 and the array in step 41 are the same frozen object unless the program wrote to it.

**Negative / costs**

- The domain contract grew. `Snapshot` now describes memory as well as frames, and every consumer
  that renders machine state has one more shape to know about.
- "No references, no GC, no aliasing", an explicit benefit in ADR-0002, is spent. Two slots can now
  name the same array, which the UI has to be able to show and the tests have to cover.
- Never freeing anything is only defensible because runs are bounded by the step limit. A machine
  that ran indefinitely would need a collector.
- The gap between "compiles" and "replays" narrows without closing: a program using `int[]` now
  runs, one using `String[]` or `List<Integer>` still stops on the instruction that needs an object.

**Exit path**

Unchanged in kind from ADR-0002: the next boundary to move is the one that carries an object with
fields, and it would bring `new`, `invokespecial`, `getfield`/`putfield` and a constant pool
resolution path for `Fieldref` with it. That is a larger change than this one, and it gets its own
record.
