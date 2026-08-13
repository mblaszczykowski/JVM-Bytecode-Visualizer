# ADR-0007: Exceptions the machine raises, caught without an object model

- **Status:** Accepted, and amended on 2026-08-13: a throw allocates a throwable instead of
  interning one, which changes what a throwing loop costs the recording budget. See "Every throw
  allocates" at the end of this record.
- **Date:** 2026-08-02
- **Amends:** [ADR-0002](0002-int-only-mvp-without-heap.md), the "no exceptions" half of that
  decision.

## Context

`try`/`catch` was the largest remaining hole in the scope table, and the one hardest to teach any
other way. A stack machine's most interesting behaviour is what it does when an instruction cannot
complete: the operand stack is discarded, frames are popped one at a time, and control resumes at an
offset that no branch instruction points to. Reading about that is nothing like watching the call
stack panel shed a frame per step.

The obvious objection is that exceptions look like they need objects. `java.lang.Throwable` is a
class; `throw` takes a reference; a handler stores one in a local slot. This machine has no object
model at all, since [ADR-0005](0005-heap-of-int-arrays.md) opened the heap only as far as `int[]`,
so the feature appeared to be blocked behind `new`, `invokespecial`, `getfield` and `putfield`,
which is a much larger piece of work with a much larger blast radius.

That framing turns out to be wrong: the exceptions a learner actually meets are not constructed by
their code. Dividing by zero, indexing past the end of an array, dereferencing null: every one of
those is raised by the JVM itself. The program never builds the object. It only catches it.

## Decision

Implement the half that needs no constructor:

- The parser reads the `exception_table` (JVMS §4.7.3) instead of skipping it, resolving each row's
  `catch_type` to a class name at parse time; `catch_type = 0` stays a catch-all, which is how javac
  compiles both `finally` and `catch (Throwable)`.
- The four faults that correspond to real Java exceptions become catchable, carrying the class the
  JVM would have used. The mapping is a table in `core/interpreter/errors.ts`.
- A thrown exception is an `ExternalValue`, a class name and a label, exactly as `System.out` is. It
  has no fields, and reading one is an unsupported call like any other. This reuses the machinery
  built for the externals table, without introducing a second kind of object.
- `athrow` runs, so a caught exception can be thrown again. That is the only source of a throwable
  on the operand stack, which is a closed and checkable invariant: `athrow` of anything else is
  reported as the verifier error it is.
- Handler matching walks a written-down fragment of the JDK's class hierarchy, so
  `catch (Exception e)` catches an `ArithmeticException`. The fragment is small because the set of
  throwable classes is small, and a handler naming a class outside it catches nothing, which is
  correct, since nothing outside it can be thrown either.

Two faults are not catchable: `stack-overflow` and `out-of-memory`. A real JVM does let a program
catch both. Here they are the visualizer's own resource limits and not the program's semantics,
and a handler that swallowed one would hand the run straight back to the loop that reached it.

## Consequences

`try`/`catch`/`finally` over machine-raised exceptions works, and the stack unwinding is visible in
the panel that already exists, with no new UI. `Exceptions.java` under
`core/interpreter/__fixtures__/programs/` pins the whole of it against a real JVM: sixteen printed
lines covering exact-class matching, matching by supertype, handler order, unwinding across a frame
with no handler, `finally` on both paths, and a rethrow.

What is still missing is stated as such. `throw new IllegalStateException(...)` stops at the `new`,
and the welcome screen says so: the feature-gap list now reads "Throwing an exception you
constructed yourself", which is narrower and truer than the "Exceptions, throw and try/catch" it
replaces. Because that list is derived from the executable opcode set, it changed itself; the only
edit was to the wording of what remains.

The boundary this ADR draws is the same one ADR-0002 and ADR-0005 drew, in the same place: take the
half of a feature that is complete and testable on its own, and say plainly where it stops. When
`new` and `invokespecial` land, throwing an exception of your own is the last row of this table to
fill in, and nothing here has to be rebuilt for it. `athrow` already takes a reference off the stack
and does not care where it came from.

## Every throw allocates (2026-08-13)

Making a thrown exception an `ExternalValue` put it in the pool that also holds `System.out` and the
`String` constants `ldc` pushes, and that pool interns: it keys a value on class name, label and
detail and hands back the handle it gave out last time. That is wrong for a throwable. Two divisions
by zero in the same method produced one object, so a program that caught both and compared the two
references found them equal, where a real JVM creates a distinct instance per throw (JVMS §2.12).

`dispatchThrow` now calls `ExternalPool.add`, which appends without consulting the key map.
Interning is kept where identity really is defined that way: `ldc` of a `String` constant, which
JVMS §5.1 requires to be the same object for the same literal, and the external fields such as
`System.out`, which name one object each.

The cost is charged to the recording budget, because each step that grew the pool charges the pool's
whole length, so n throws cost n(n+1)/2 of the 24,000,000 elements in `MAX_RECORDED_ELEMENTS`.
Measured on a loop that does nothing but divide by zero and catch it, five recorded steps per throw:
at the default 20,000-step limit it throws 4,000 times and charges 8,002,000 elements, a third of
the budget, and still ends at the step limit. Raise the limit to 500,000 and it ends instead with an
`OutOfMemoryError` naming the history, after 6,927 throws at step 34,638. Interned, the pool never
grew past one entry and the same program ran to the step limit.

This is accepted for two reasons. Object identity is part of what the visualizer is here to show,
and the failure mode is one the machine already has: a loop that prints on every step charges the
console the same way and ends the same way, with an `OutOfMemoryError` naming the history and the
recorded prefix still loaded and scrubbable (ADR-0005, ADR-0006).
