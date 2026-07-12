import {
  AccessFlag,
  ConstantTag,
  type ClassFile,
  type ConstantPool,
  type ConstantPoolEntry,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from '../../classfile';

/**
 * In-memory `ClassFile` values for interpreter tests.
 *
 * Hand-written bytecode reaches states javac never emits — division by zero, an infinite
 * `goto`, a call to another class, a malformed constant pool — without keeping a binary
 * fixture per case. The shapes are exactly what the parser produces, so the interpreter
 * cannot tell the difference.
 */

export const SYNTHETIC_CLASS_NAME = 'Synthetic';

export class ConstantPoolBuilder {
  /** Index 0 is unused — the pool is 1-indexed (JVMS §4.4). */
  private readonly entries: (ConstantPoolEntry | null)[] = [null];

  utf8(value: string): number {
    return this.raw({ tag: ConstantTag.Utf8, value });
  }

  classEntry(name: string): number {
    return this.raw({ tag: ConstantTag.Class, nameIndex: this.utf8(name) });
  }

  methodref(className: string, name: string, descriptor: string): number {
    const classIndex = this.classEntry(className);
    const nameAndTypeIndex = this.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: this.utf8(name),
      descriptorIndex: this.utf8(descriptor),
    });
    return this.raw({ tag: ConstantTag.Methodref, classIndex, nameAndTypeIndex });
  }

  /** Escape hatch for pools that are deliberately inconsistent. */
  raw(entry: ConstantPoolEntry): number {
    this.entries.push(entry);
    return this.entries.length - 1;
  }

  build(): ConstantPool {
    return [...this.entries];
  }
}

export interface SyntheticMethod {
  readonly name: string;
  readonly descriptor: string;
  /** Raw bytecode; omitted for a method without a Code attribute (abstract/native). */
  readonly code?: readonly number[];
  readonly accessFlags?: number;
  readonly maxStack?: number;
  readonly maxLocals?: number;
  readonly lineNumberTable?: readonly LineNumberEntry[];
  readonly localVariableTable?: readonly LocalVariableEntry[];
}

export interface SyntheticClass {
  readonly className?: string;
  readonly pool?: ConstantPoolBuilder;
  readonly methods: readonly SyntheticMethod[];
}

export function syntheticClass({
  className = SYNTHETIC_CLASS_NAME,
  pool = new ConstantPoolBuilder(),
  methods,
}: SyntheticClass): ClassFile {
  return {
    minorVersion: 0,
    majorVersion: 65,
    constantPool: pool.build(),
    accessFlags: AccessFlag.Public,
    thisClassName: className,
    superClassName: 'java/lang/Object',
    interfaceNames: [],
    fields: [],
    methods: methods.map(toMethodInfo),
  };
}

function toMethodInfo(method: SyntheticMethod): MethodInfo {
  const header = {
    name: method.name,
    descriptor: method.descriptor,
    accessFlags: method.accessFlags ?? AccessFlag.Static,
  };
  if (method.code === undefined) {
    return header;
  }

  return {
    ...header,
    code: {
      maxStack: method.maxStack ?? 16,
      maxLocals: method.maxLocals ?? 4,
      code: Uint8Array.from(method.code),
      ...(method.lineNumberTable === undefined ? {} : { lineNumberTable: method.lineNumberTable }),
      ...(method.localVariableTable === undefined
        ? {}
        : { localVariableTable: method.localVariableTable }),
    },
  };
}
