# ADR-0008: Objects, of the loaded class and no other

- **Status:** Accepted
- **Date:** 2026-08-04
- **Amends:** [ADR-0002](0002-int-only-mvp-without-heap.md) and
  [ADR-0005](0005-heap-of-int-arrays.md), the "no objects" half of the first, along the exit path
  the second left open.

## Context

The corpus job ([`web/corpus/`](../../web/corpus/fetch-corpus.mjs)) turned an impression into a
number. Across 8,053 class files from ten Maven Central libraries, the interpreter implemented 75.2%
of the 1.17 million instructions decoded, and the four most common it could not run were `areturn`,
`getfield`, `invokespecial` and `invokeinterface`. Three of those four are one feature.

That measurement is what put objects ahead of `long`/`double` in the queue, which had
looked comparable from the inside. It also framed the question correctly: not "should the machine
have objects" but "how much of an object model is a complete, testable piece of work".

The obvious scope, objects the way Java has them, needs class loading, a superclass chain, method
overriding, interface dispatch, static initialisers and a `String` that is a real object instead of
a token. That is not a boundary, it is the rest of the JVM.

## Decision

Implement objects of the class being executed, and of no other class.

`new`, `invokespecial`, `getfield`, `putfield`, `invokevirtual` on an instance and `areturn` all
run, together with `if_acmpeq`/`if_acmpne`/`ifnull`/`ifnonnull`, which no code that walks a linked
structure can terminate without. Every one of them resolves against the uploaded class and refuses
anything else. That is the same boundary `invokestatic` has had since the beginning, and for the
same reason: there is no second class file, so there is no field table to give another object a
shape.

`super()` is the single exception. It compiles to `java/lang/Object.<init>()V` on every class here,
and `Object` has nothing this machine models, so the receiver is popped and the call is over.

Three details were decided rather than falling out of the implementation:

- An instance's shape is fixed at allocation, from the class's own field table, which is why fields
  are an array and not a map. A real heap decides an object's layout once, from the class; making it
  a map would model something a JVM does not have.
- Every field starts at the default its descriptor names, `0` for an `int` and `null` for a
  reference, so a fresh object shows its slots and not an absence. `new` puts the instance on
  the operand stack _before_ its constructor runs. That is the real order and it is worth seeing:
  `new` and `invokespecial` are two instructions with an uninitialised object between them.
- Instances share the array's versioning and its memory budget. `freeze()` re-copies only what a
  step changed, and a field costs what an element costs, so the bounds from the memory work hold
  with no second rule.

## Consequences

65.2% of the corpus's 88,604 methods, 57,732 of them, now consist entirely of instructions this
interpreter implements, up from what three missing opcodes allowed. The per-instruction figure is
91.5%, but the per-method one is the honest measure of reach and is what the README quotes: a method
replays only if all of it runs.

What still stops is now one thing instead of a list, and it is stated as one sentence:
`new ArrayList<>()` and `throw new IllegalStateException(...)` fail not for want of an instruction
but for want of a class to load. No opcode expresses that limit, so `CALL_SCOPE_NOTE` in
`web/src/services/capabilities.ts` asserts it by hand while the derived gap list, which reads the
executable opcode set directly, stops naming objects as missing. The welcome screen updated itself.

`Instances.java` under `core/interpreter/__fixtures__/programs/` pins the whole of it against a real
JVM: a linked list of its own class, which is the smallest program that still exercises a
constructor, an int field written and read, a reference field pointing at another instance, a method
called on a receiver, one returning `this`, and a loop that ends on `null`.

The exit path, if it is ever taken, is class loading: a second `ClassFile` in the machine, keyed by
name, with `new` and the call instructions resolving against it. Everything decided here survives
that. The field table would come from whichever class the pool entry names instead of from the one
being executed, and nothing else about the heap, the frame or the snapshot would change.
