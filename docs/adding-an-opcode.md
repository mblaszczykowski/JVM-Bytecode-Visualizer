# Adding an instruction

The executable subset grows one instruction group at a time. This is what that costs, in the order
it is worth doing, written from what the last few additions actually touched.

Every instruction assigned by the JVM specification is already decoded: the mnemonic, the operand
widths and the branch targets come from one table and the listing renders all of them. What follows
is the second half, teaching the interpreter to _run_ one.

There are four edits, and a build-failing test that will tell you if you missed one of them.

## 1. Give it a stack effect

`web/src/core/disassembler/opcodes.ts` keeps two facts apart. Every assigned opcode carries its
encoding, so that the listing can print `getstatic` together with the `#7` that says which field it
means. Only the ones the interpreter executes carry a stack effect, which is what `kind: 'supported'`
means.

Adding an entry to `STACK_EFFECTS` is therefore the moment an instruction becomes executable as far
as the rest of the application is concerned:

```ts
[0xbb, fixed(0, 1)], // new: pushes the uninitialised instance
[0xb4, VARIES],      // getfield: the descriptor decides
```

`VARIES` is for the instructions whose effect depends on something outside themselves: a method
descriptor, a field type, the caller's frame. It still needs a number at run time; `stackDeltaOf`
resolves the real one against the constant pool, using the `varies` function from step 4, and the
listing prints `varies` only where no answer is available.

## 2. Implement it

`web/src/core/interpreter/interpreter.ts` holds an opcode-to-byte map (`Op`) and one dispatch
switch. A case that does the work and breaks:

```ts
case Op.new:
  allocateInstance(machine, frame, operand(instruction, 0));
  break;
```

Keep the arm small. Anything with substance behind it, such as the heap, exception unwinding or the
descriptor parser, lives in its own module beside the interpreter, and the switch stays readable as
a table of what the machine can do.

Faults are `VmFault` with a typed detail, never a thrown `Error`. The invariant behind that is the
one to keep in mind while writing an arm: **`execute()` does not throw for anything a program can
do.** It returns `{ kind: 'vm-error', snapshots, error }` with the history collected so far, so a
run that stops is still a run the reader can scrub. Only a bug in the interpreter itself escapes,
and `failedRun` rethrows anything that is not a `VmFault` precisely so that a bug does not disguise
itself as a program error.

## 3. Prove it against a real JVM

Write a small Java program that exercises the instruction, including the corner where it is easy to
be wrong, and put it in `web/src/core/interpreter/__fixtures__/programs/`. Register it in two
places:

- `web/fixtures/build-test-fixtures.mjs`, in the `FIXTURES` array, with `runs: true`;
- `web/src/core/interpreter/differential.test.ts`, with a one-line `covers:` saying what it is for.

Then `npm run fixtures:tests -w web`. That compiles the program with `javac -g` and runs it with a
real `java`, capturing stdout into a committed `.stdout.txt`. No expectation in those files is
written by hand. If this interpreter disagrees with the reference implementation, the differential
test fails with the number that proves it.

An instruction whose behaviour cannot be pinned this way, because it prints nothing observable,
needs a program that makes it observable.

## 4. Say what it does, in one sentence

`OPCODE_NOTES` in `web/src/services/derivations.ts` is the table the teaching layer reads for an
instruction's metadata. One row per mnemonic, keyed on the base mnemonic, so a form the `wide`
prefix mints takes the row of the instruction it widens:

```ts
export interface OpcodeNote {
  readonly help: string;
  readonly pushedKind?: PushedKind | 'descriptor' | 'stack-top';
  readonly frame?: 'call' | 'return';
  readonly varies?: (instruction: Instruction, pool: ConstantPool) => StackDelta | undefined;
}
```

`help` is required, and it is what the reader sees: the mnemonic tooltip, and the fallback
explanation on the Next card when no `explain*` arm produces something more concrete. Write it as a
sentence ending in a period, for someone who has not met the instruction before.

The other three fields are defaults you override only when the defaults are wrong. `pushedKind`
defaults to `int`; set it when the instruction pushes a reference (`'descriptor'` reads the answer
off the constant pool entry, `'stack-top'` mirrors whatever was on top). `frame` is unset unless the
instruction pushes or pops a call frame. `varies` is needed only for the instructions whose stack
effect is `VARIES`, and it is how step 1's placeholder becomes a real number.

Two extras that are worth adding when they apply, and skipping when they do not:

- a row in `OPERAND_ADDRESSING`, when the popped values deserve names of their own (`→ index`,
  `→ array`) or the instruction reads or writes the heap and the heap panel should follow it;
- an arm in one of the `explain*` functions, when the card can name the concrete values in front of
  it rather than repeat the row's `help`.

## 5. What updates itself

Five things follow from the tables above, so do not duplicate them by hand:

- The capability note and its count. `web/src/services/capabilities.ts` derives its families by
  intersecting the JVMS opcode blocks with the interpreter's executable set. An instruction that
  gains an implementation joins its family, any feature listed as blocked on it stops being listed,
  and the count on the welcome screen moves on its own.
- The listing row. Decoding never needed the change, so the row was always there; it stops being
  dimmed as `unsupported` once the stack effect exists.
- The effect pills on the Next card, from the stack effect and `frame`.
- The operand roles, from `OPERAND_ADDRESSING` where there is a row and from the invoke-aware
  defaults where there is not.
- The mnemonic tooltip, from `help`, for the widened forms as well as the narrow one.

This list used to be shorter and the by-hand list longer. `MNEMONIC_HELP`, `REFERENCE_PUSHING` and a
hand-maintained `stackDeltaOf` switch were three separate places saying overlapping things about the
same opcode, and an addition that updated two of the three left a wrong pill or a missing tooltip
that only a reader would notice. They are gone, folded into the one row above.

What keeps it that way is a test.
`web/src/services/derivations.test.ts`, in "gives every executable instruction help, a stack delta
and effect pills", walks `EXECUTABLE_OPCODES` together with the forms the `wide` prefix mints and
fails the build if any of them lacks `help`, has no resolvable stack delta, or produces effect pills
that disagree with that delta. It also rejects an explanation that does not end in a period,
contains `undefined` or a `?`, or falls back to generic filler. Adding a dispatch arm without step 4
therefore fails the suite instead of shipping a blank card.

`docs/adr/` does not update itself. If the addition moves a boundary rather than filling one in (a
new kind of value on the operand stack, a second class file, anything the existing ADRs argued
against) it needs its own ADR rather than a paragraph in an old one.

## 6. Run the checks CI runs

```
npm run typecheck && npm run lint && npm run test && npm run build && npm run size -w web
npm run e2e -w web
```

Coverage on `web/src/core/**` is enforced at 90% lines, branches and functions, and measured per
file rather than in aggregate, so an arm with no test fails the build in the file that lacks it.

## What this does not cover

Instructions blocked on something other than an implementation. `invokeinterface` and the object
array instructions are waiting on the machine being able to see a second class file, which is a
change to how classes are resolved and not an entry in a table; `ADR-0008` records why nothing
built for objects has to change for it. Adding the stack effect for one of those would make it look
executable and then fail at the first instruction that needed a class the file in front of it does
not contain.
