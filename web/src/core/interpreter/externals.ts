/**
 * The members of the standard library this interpreter recognises, as a table.
 *
 * There is no object model behind them and there is not meant to be one: a `getstatic` of a
 * listed field pushes an opaque token, and an `invokestatic`/`invokevirtual` of a listed
 * method consumes its arguments — and, for a virtual call, that token — and answers directly.
 * `System.out.println(x)` therefore runs without a heap that can hold a `PrintStream`, and
 * `Math.max(a, b)` runs without loading `java.lang.Math`.
 *
 * Everything the machinery needs comes from the row: the descriptor decides how many
 * arguments are popped and as what, and whether a value goes back on the stack. Adding
 * `Integer.parseInt` is one more row, not a new branch in the interpreter.
 *
 * Anything not listed here fails as `unsupported-call`, `unsupported-field` or
 * `unsupported-constant`, naming the member that was attempted.
 */

import { parseMethodDescriptor, type JvmType } from '../classfile';
import type { ConsoleOutput } from './console';
import { VmFault } from './errors';
import { iabs, ifloorDiv, ifloorMod } from './int32';
import type { ExternalValue, ValueKind } from './types';

export type ExternalArgument =
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'external'; readonly value: ExternalValue };

export interface ExternalCall {
  /** The token the method was invoked on; `undefined` for a static call. */
  readonly receiver: ExternalValue | undefined;
  /** Arguments in declaration order, each popped as the kind its descriptor names. */
  readonly args: readonly ExternalArgument[];
  readonly console: ConsoleOutput;
}

export interface ExternalMethod {
  /** As `memberKey` writes it, e.g. `java/lang/Math.max:(II)I`. */
  readonly key: string;
  /** `invokestatic` reaches a `static` row; `invokevirtual` a `virtual` one, via its receiver. */
  readonly dispatch: 'static' | 'virtual';
  /** Kinds to pop the arguments as, in declaration order — read off the descriptor. */
  readonly parameters: readonly ValueKind[];
  /** The int the call leaves on the operand stack, or `undefined` for a `void` method. */
  readonly apply: (call: ExternalCall) => number | undefined;
}

const EMPTY_POOL: readonly ExternalValue[] = Object.freeze([]);

/**
 * The external objects one run has produced, addressed by handle — the number a value of kind
 * `external` carries. Append-only, and interned: JVMS §5.1 gives one `String` object per
 * constant pool entry, so an `ldc` inside a loop must not pile up copies of the same string.
 *
 * `freeze()` shares its view with the previous snapshot exactly as `Heap.freeze` does.
 */
export class ExternalPool {
  private readonly values: ExternalValue[] = [];
  private readonly handles = new Map<string, number>();
  private frozen: readonly ExternalValue[] = EMPTY_POOL;
  private frozenSize = 0;

  intern(value: ExternalValue): number {
    const key = `${value.className}|${value.label}`;
    const existing = this.handles.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const handle = this.values.push(Object.freeze(value)) - 1;
    this.handles.set(key, handle);
    return handle;
  }

  /** `undefined` for a handle no `intern` ever returned. */
  at(handle: number): ExternalValue | undefined {
    return this.values[handle];
  }

  freeze(): readonly ExternalValue[] {
    if (this.frozenSize !== this.values.length) {
      this.frozen = Object.freeze([...this.values]);
      this.frozenSize = this.values.length;
    }
    return this.frozen;
  }
}

/** How a resolved Fieldref or Methodref is written, matching `javap -c`'s comments. */
export function memberKey(className: string, name: string, descriptor: string): string {
  return `${className}.${name}:${descriptor}`;
}

const PRINT_STREAM = 'java/io/PrintStream';
const STRING_CLASS = 'java/lang/String';

const SYSTEM_OUT: ExternalValue = Object.freeze({
  className: PRINT_STREAM,
  label: 'System.out',
});

/** The static fields a `getstatic` may read. */
export const EXTERNAL_FIELDS: ReadonlyMap<string, ExternalValue> = new Map([
  [memberKey('java/lang/System', 'out', 'Ljava/io/PrintStream;'), SYSTEM_OUT],
]);

/** A `String` constant pulled out of the pool by `ldc`, as the value it puts on the stack. */
export function stringConstant(text: string): ExternalValue {
  return Object.freeze({ className: STRING_CLASS, label: `"${text}"`, text });
}

/**
 * Java's own rendering of a printed value, keyed by the parameter descriptor `print`/`println`
 * was resolved to (JVMS §4.3.2). It is the descriptor, not the value, that decides: `65` and
 * `(char) 65` are the same int on the operand stack and print as `65` and `A`.
 */
const PRINTED_AS: ReadonlyMap<string, (arg: ExternalArgument | undefined) => string> = new Map([
  ['I', (arg) => String(intArgument(arg))],
  ['Z', (arg) => (intArgument(arg) === 0 ? 'false' : 'true')],
  ['C', (arg) => String.fromCharCode(intArgument(arg))],
  ['Ljava/lang/String;', (arg) => textArgument(arg)],
]);

function intArgument(arg: ExternalArgument | undefined): number {
  // The argument was popped as the kind the descriptor names, so this only ever takes the
  // first branch; the fallback keeps the renderer total instead of asserting it.
  return arg?.kind === 'int' ? arg.value : 0;
}

function textArgument(arg: ExternalArgument | undefined): string {
  return arg?.kind === 'external' ? (arg.value.text ?? arg.value.label) : '';
}

interface ExternalRow {
  readonly className: string;
  readonly name: string;
  readonly descriptor: string;
  readonly dispatch: 'static' | 'virtual';
  readonly apply: (call: ExternalCall) => number | undefined;
}

/** Every `Math` method here has an int-only descriptor and is exact — no rounding, no doubles. */
function mathRow(
  name: string,
  descriptor: string,
  apply: (left: number, right: number) => number,
): ExternalRow {
  return {
    className: 'java/lang/Math',
    name,
    descriptor,
    dispatch: 'static',
    apply: (call) => apply(intArgument(call.args[0]), intArgument(call.args[1])),
  };
}

/**
 * `print` writes its argument, `println` writes it and ends the line. Both exist for every
 * descriptor in `PRINTED_AS`, plus the no-argument `println()` that ends a line on its own,
 * so the rows are generated rather than written out one by one.
 */
function printStreamRows(): readonly ExternalRow[] {
  const rows: ExternalRow[] = [
    {
      className: PRINT_STREAM,
      name: 'println',
      descriptor: '()V',
      dispatch: 'virtual',
      apply: (call) => {
        call.console.writeLine('');
        return undefined;
      },
    },
  ];

  for (const [parameter, render] of PRINTED_AS) {
    for (const name of ['print', 'println'] as const) {
      rows.push({
        className: PRINT_STREAM,
        name,
        descriptor: `(${parameter})V`,
        dispatch: 'virtual',
        apply: (call) => {
          const text = render(call.args[0]);
          if (name === 'println') {
            call.console.writeLine(text);
          } else {
            call.console.write(text);
          }
          return undefined;
        },
      });
    }
  }

  return rows;
}

/** JVMS §6.5 idiv: the JVM throws ArithmeticException before the division happens. */
function nonZero(divisor: number): number {
  if (divisor === 0) {
    throw new VmFault({ kind: 'division-by-zero' });
  }
  return divisor;
}

/**
 * The int-only part of `java.lang.Math`, implemented the way its javadoc defines it rather
 * than the way JavaScript would: `Math.max` here is Java's `a >= b ? a : b`, and `abs` and
 * `floorDiv` answer `Integer.MIN_VALUE` where the true result is not representable.
 */
const ROWS: readonly ExternalRow[] = [
  mathRow('max', '(II)I', (left, right) => (left >= right ? left : right)),
  mathRow('min', '(II)I', (left, right) => (left <= right ? left : right)),
  mathRow('abs', '(I)I', (value) => iabs(value)),
  mathRow('floorDiv', '(II)I', (left, right) => ifloorDiv(left, nonZero(right))),
  mathRow('floorMod', '(II)I', (left, right) => ifloorMod(left, nonZero(right))),
  ...printStreamRows(),
];

/** Whether a parameter arrives as an int slot or as a token — no other shape is in the table. */
function kindOf(type: JvmType): ValueKind {
  return type.kind === 'primitive' ? 'int' : 'external';
}

function toMethod(row: ExternalRow): ExternalMethod {
  return {
    key: memberKey(row.className, row.name, row.descriptor),
    dispatch: row.dispatch,
    parameters: parseMethodDescriptor(row.descriptor).params.map(kindOf),
    apply: row.apply,
  };
}

export const EXTERNAL_METHODS: ReadonlyMap<string, ExternalMethod> = new Map(
  ROWS.map(toMethod).map((method) => [method.key, method]),
);
