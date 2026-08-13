# ADR-0009: One table for an instruction's metadata

- **Status:** Accepted, and amended on 2026-08-13: the table is looked up by the base mnemonic
  derived from the opcode, so the forms the `wide` prefix mints reach a row, and the test that
  enforces this record walks those forms too.
- **Date:** 2026-08-10

## Context

The application teaches. For whichever instruction is about to run, the Next card names it, explains
it in a sentence, shows the stack effect as pills, labels the values it is about to pop, and says
what kind of value it will push. The listing shows a shorter form of the same thing, and the panel
headers show a tooltip.

That copy used to come from four places. `MNEMONIC_HELP` held the sentence. `REFERENCE_PUSHING` held
the set of instructions that push a reference rather than an `int`. A `stackDeltaOf` switch resolved
the effect of the instructions whose effect is not fixed. `OPERAND_ADDRESSING` held the operand
names and the heap addressing. Adding an instruction meant finding all four, and the cost of missing
one was silent: a blank tooltip, a pill saying `push int` over a reference, or a card that fell back
to generic filler. None of it failed a test, because there was nothing that knew the four tables
were supposed to agree.

This is a codebase that already reconciles four opcode tables at module load: the disassembler's
encoding table, its stack effects, the interpreter's `Op` map, and the capability derivation over
their intersection. A fifth set of hand-maintained parallel tables was the wrong direction.

## Decision

`OPCODE_NOTES` in `web/src/services/views/opcode-notes.ts` is the one table the teaching layer reads for an
instruction's metadata: the sentence that names it, the kind of value it pushes, whether it moves a
call frame, and how to resolve a stack effect the disassembler could not fix. One row per mnemonic:

```ts
export interface OpcodeNote {
  readonly help: string;
  readonly pushedKind?: PushedKind | 'descriptor' | 'stack-top';
  readonly frame?: 'call' | 'return';
  readonly varies?: (instruction: Instruction, pool: ConstantPool) => StackDelta | undefined;
}
```

`help` is required. The other three are defaults that a row overrides only when the default is
wrong: a push is an `int` unless stated, an instruction moves no frame unless stated, and its stack
effect is the fixed one from the disassembler unless it is `VARIES`, in which case `varies` resolves
it against the constant pool. `MNEMONIC_HELP` and `REFERENCE_PUSHING` are gone; `stackDeltaOf`
survives as a nine-line function that reads the disassembler's table and falls back to this one.

`OPERAND_ADDRESSING` stays as a second, smaller table, because operand naming and heap addressing
apply to twelve instructions and defaults cover the rest.

Most of the prose is not in the table. `help` is
the mnemonic tooltip everywhere it appears, and it is the Next card's sentence only when no
`explain*` function in the same module produces something more concrete. Over the 92 executable
opcodes that is three of them: `nop`, `aconst_null` and `arraylength` read their sentence off
`help`, and the other 89 come from a hand-written `explain*` arm that can name the values in front
of it. [`adding-an-opcode.md`](../adding-an-opcode.md) describes the same split from the other side.

The lookup is by base mnemonic. `baseMnemonicOf(instruction)` takes the mnemonic from the opcode
byte and not from the decoded instruction, so the five forms the `wide` prefix mints (`iload_w`,
`istore_w`, `aload_w`, `astore_w`, `iinc_w`) find the row of the instruction they widen. They used
to find no row at all: a blank tooltip, and a Next card that fell through to the generic filler.

The rows are made to hold by a test rather than by review.
`web/src/services/views/derivations.test.ts` walks `EXECUTABLE_OPCODES` together with the widened forms,
97 in all, and fails the build if any of them lacks help, has no resolvable stack delta, or produces
effect pills that disagree with that delta. It also rejects an explanation that does not end in a
period, that contains `undefined` or a `?`, or that is the generic fallback. A dispatch arm added
without a row therefore fails the suite, and so does a widened form the base mnemonic does not
reach.

## Consequences

**Positive**

- Adding an instruction is four hand edits rather than seven, and the doc that says so
  ([`adding-an-opcode.md`](../adding-an-opcode.md)) can be checked against the code.
- The failure mode moved from "a reader sees a blank card" to "the build fails".
- The defaults carry their weight: most rows are one string, because most instructions push an `int`
  and move no frame.

**Negative / costs**

- One more table that has to stay in step with `EXECUTABLE_OPCODES`. The test is what makes that
  survivable, and the test is now load-bearing.
- The prose is written by hand, ninety-two times, and the `explain*` arms on top of it. That is real
  work and it does not scale to the full instruction set.

## Alternatives considered

- _Generating the explanations from the interpreter._ The dispatch arm knows exactly what the
  instruction does, so deriving the sentence from it removes the table entirely. Rejected: what the
  arm knows is `push(frame, int32.add(a, b), 'int')`, and the sentence a beginner needs is "pops two
  ints and pushes their sum, wrapping at 32 bits". The second is not recoverable from the first, and
  a generator that produced it would be a worse table with more machinery in front of it.
- _Generating them from the JVMS text._ The specification's wording is precise and assumes the
  reader already knows the machine, which is the opposite of the audience here.
- _Keeping the four tables and adding a consistency test over them._ The test is most of the
  benefit, and it would have caught the defects. It leaves four places to edit, which is the cost
  this record exists to remove.
