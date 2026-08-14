import { parseMethodDescriptor, type JvmType } from '../classfile';
import type { RecordingBudget } from './budget';
import type { ConsoleOutput } from './console';
import { VmFault } from './errors';
import { iabs, ifloorDiv, ifloorMod } from './int32';
import type { ExternalValue, ValueKind } from './types';

export type ExternalArgument =
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'null' }
  | { readonly kind: 'external'; readonly value: ExternalValue };

export interface ExternalCall {
  readonly receiver: ExternalValue | undefined;
  readonly args: readonly ExternalArgument[];
  readonly console: ConsoleOutput;
}

export interface ExternalMethod {
  readonly key: string;
  readonly dispatch: 'static' | 'virtual';
  readonly parameters: readonly ValueKind[];
  readonly apply: (call: ExternalCall) => number | undefined;
}

const EMPTY_POOL: readonly ExternalValue[] = Object.freeze([]);

export class ExternalPool {
  private readonly budget: RecordingBudget;
  private readonly values: ExternalValue[] = [];
  private readonly handles = new Map<string, number>();
  private frozen: readonly ExternalValue[] = EMPTY_POOL;
  private frozenSize = 0;

  constructor(budget: RecordingBudget) {
    this.budget = budget;
  }

  add(value: ExternalValue): number {
    return this.values.push(Object.freeze(value)) - 1;
  }

  intern(value: ExternalValue): number {
    const key = `${value.className}|${value.label}|${value.detail ?? ''}`;
    const existing = this.handles.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const handle = this.add(value);
    this.handles.set(key, handle);
    return handle;
  }

  at(handle: number): ExternalValue | undefined {
    return this.values[handle];
  }

  freeze(): readonly ExternalValue[] {
    if (this.frozenSize !== this.values.length) {
      this.budget.charge(this.values.length);
      this.frozen = Object.freeze([...this.values]);
      this.frozenSize = this.values.length;
    }
    return this.frozen;
  }
}

export function memberKey(className: string, name: string, descriptor: string): string {
  return `${className}.${name}:${descriptor}`;
}

const PRINT_STREAM = 'java/io/PrintStream';
const STRING_CLASS = 'java/lang/String';

const SYSTEM_OUT: ExternalValue = Object.freeze({
  className: PRINT_STREAM,
  label: 'System.out',
});

export const EXTERNAL_FIELDS: ReadonlyMap<string, ExternalValue> = new Map([
  [memberKey('java/lang/System', 'out', 'Ljava/io/PrintStream;'), SYSTEM_OUT],
]);

export function stringConstant(text: string): ExternalValue {
  return Object.freeze({ className: STRING_CLASS, label: `"${text}"`, text });
}

export function throwableObject(className: string, detail: string): ExternalValue {
  return Object.freeze({
    className,
    label: className.slice(className.lastIndexOf('/') + 1),
    detail,
  });
}

const PRINTED_AS: ReadonlyMap<string, (arg: ExternalArgument | undefined) => string> = new Map([
  ['I', (arg) => String(intArgument(arg))],
  ['Z', (arg) => (intArgument(arg) === 0 ? 'false' : 'true')],
  ['C', (arg) => String.fromCharCode(intArgument(arg))],
  ['Ljava/lang/String;', (arg) => textArgument(arg)],
]);

function intArgument(arg: ExternalArgument | undefined): number {
  return arg?.kind === 'int' ? arg.value : 0;
}

function textArgument(arg: ExternalArgument | undefined): string {
  if (arg?.kind === 'external') {
    return arg.value.text ?? arg.value.label;
  }
  return 'null';
}

interface ExternalRow {
  readonly className: string;
  readonly name: string;
  readonly descriptor: string;
  readonly dispatch: 'static' | 'virtual';
  readonly apply: (call: ExternalCall) => number | undefined;
}

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

function nonZero(divisor: number): number {
  if (divisor === 0) {
    throw new VmFault({ kind: 'division-by-zero' });
  }
  return divisor;
}

const ROWS: readonly ExternalRow[] = [
  mathRow('max', '(II)I', (left, right) => (left >= right ? left : right)),
  mathRow('min', '(II)I', (left, right) => (left <= right ? left : right)),
  mathRow('abs', '(I)I', iabs),
  mathRow('floorDiv', '(II)I', (left, right) => ifloorDiv(left, nonZero(right))),
  mathRow('floorMod', '(II)I', (left, right) => ifloorMod(left, nonZero(right))),
  ...printStreamRows(),
];

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
