# Adding an instruction

The executable subset grows one instruction group at a time. This is what that costs, in the order
it is worth doing, written from what the last few additions actually touched.

Every instruction assigned by the JVM specification is already decoded: the mnemonic, the operand
widths and the branch targets come from one table and the listing renders all of them. What follows
is the second half, teaching the interpreter to _run_ one.

## 1. Give it a stack effect

`web/src/core/disassembler/opcodes.ts` keeps two facts apart. Every assigned opcode carries its
encoding, because a listing that prints `getstatic` without its `#7` is not a listing of that
instruction. Only the ones the interpreter executes carry a stack effect, which is what
`kind: 'supported'` means.

Adding an entry to `STACK_EFFECTS` is therefore the moment an instruction becomes executable as far
as the rest of the application is concerned:

```ts
[0xbb, fixed(0, 1)], // new: pushes the uninitialised instance
[0xb4, VARIES],      // getfield: the descriptor decides
```

`VARIES` is for the instructions whose effect depends on something outside themselves: a method
descriptor, a field type, the caller's frame. It is not a way to avoid thinking about the number.
The stack-effect column in the listing prints `varies` instead of a confident wrong figure, and
`stackDeltaOf` resolves the real one against the constant pool when it can.

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

Faults are `VmFault` with a typed detail, never a thrown `Error`: `execute()` promises in its own
docstring that it does not throw, and a run that stops must leave its history playable.

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

## 4. What updates itself

Three things update without being told, so do not duplicate them by hand:

- The capability note. `web/src/services/capabilities.ts` derives its families by intersecting the
  JVMS opcode blocks with the interpreter's executable set. An instruction that gains an
  implementation joins its family, and any feature listed as blocked on it stops being listed. The
  count on the welcome screen moves on its own.
- The listing. Decoding never needed the change, so the row was always there; it stops being dimmed
  as `unsupported` once the stack effect exists.
- `docs/adr/` does not update itself. If the addition moves a boundary instead of filling one in
  (a new kind of value on the operand stack, a second class file, anything the existing ADRs argued
  against) it needs its own ADR, not a paragraph in an old one.

## 5. Run the checks CI runs

```
npm run typecheck && npm run lint && npm run test && npm run build && npm run size -w web
npm run e2e -w web
```

Coverage on `web/src/core/**` is enforced at 90% lines, branches and functions, so an arm with no
test fails the build.

## What this does not cover

Instructions blocked on something other than an implementation. `invokeinterface` and the object
array instructions are waiting on the machine being able to see a second class file, which is a
change to how classes are resolved and not an entry in a table; `ADR-0008` records why nothing
built for objects has to change for it. Adding the stack effect for one of those would make it look
executable and then fail at the first instruction that needed a class the file in front of it does
not contain.
