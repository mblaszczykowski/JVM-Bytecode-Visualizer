# ADR-0002: MVP on `int` only, without a heap

- **Status:** Accepted. The "no heap" half is amended by [ADR-0005](0005-heap-of-int-arrays.md)
  (2026-07-30), which takes the exit path named below. The `int`-only value model and the closed
  instruction set stand as written.
- **Date:** 2026-07-16

## Context

A complete JVM implementation is months of work: the heap and object management, arrays,
`long`/`float`/`double` (two slots each), `String` and the string constant pool, exceptions with the
`exception_table`, `invokevirtual` with dynamic dispatch, `invokedynamic` and lambdas, class
initialisation (`<clinit>`), threads, bytecode verification.

The goal of this project is educational and portfolio-oriented: to show how a stack machine works,
meaning the operand stack, call frames, jumps and recursion. None of the features above are needed
for that, and each of them blurs the scope and reduces the chance of implementing a narrower set
completely.

## Decision

The MVP supports the `int` type only and has no heap. The instruction set is closed and listed in
the specification (constants, load/store, `iinc`, stack, arithmetic, comparisons with branch,
`goto`, `invokestatic`/`ireturn`/`return`). Out of scope: objects, arrays, `long`/`float`/`double`,
`String`, exceptions, threads, lambdas, reflection, bytecode verification.

Two requirements follow from this, and they are non-negotiable:

1. `int` semantics bit-compatible with the JVM, in the `int32.ts` module: `(a + b) | 0`,
   `Math.imul(a, b)`, `(a / b) | 0` (truncation toward zero, `INT_MIN / -1 === INT_MIN`), `a % b`,
   `(-a) | 0`. A plain `a * b` in JavaScript is a bug: it does not wrap around at 32 bits.
2. Degrade instead of crashing. An out-of-scope opcode met while _decoding_ is marked `unsupported`
   (with its real mnemonic from the full JVM table); only an attempt to _execute_ it yields a
   `vm-error`. A file with an unsupported instruction in dead code still runs.

The parser is wider than the interpreter: it reads the whole `.class` format (all constant pool
tags, unknown attributes skipped by length), because otherwise it would break on files produced by a
modern `javac`.

## Consequences

**Positive**

- A scope that can be closed in reasonable time and tested completely (`core/` coverage ≥ 90%).
- A simple snapshot data model: `readonly number[]` for the operand stack and local slots, with no
  references, no GC and no aliasing, which keeps the UI readable and snapshots cheap to copy.
- Differential tests against a real JVM are feasible: a program's result is a single number.

**Negative / costs**

- Examples cannot use `System.out.println` (it needs `getstatic` + `invokevirtual` + the heap) or
  static fields (they generate `<clinit>`). A program's result is stored in a local variable in
  `main`, which has to be stated explicitly in the README and in the example descriptions.
- BubbleSort and other classic array examples are out of scope (hence `SumOfSquares` and `Gcd`).
- A "normal" `.class` file uploaded by a user will usually stop at a `vm-error`. The message must be
  specific (the instruction name), so that it does not look like an application crash.

**Exit path**

Arrays (`newarray`, `iaload`, `iastore`, `arraylength`) are the first candidate for v2, and
BubbleSort comes back then. The snapshot model would need to grow a heap, which changes the domain
contract and calls for a new ADR.
