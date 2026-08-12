import {
  AccessFlag,
  ConstantTag,
  type ClassFile,
  type ConstantPool,
  type ConstantPoolEntry,
  type ExceptionTableEntry,
  type FieldInfo,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from '../../classfile';

export const SYNTHETIC_CLASS_NAME = 'Synthetic';

export class ConstantPoolBuilder {
  private readonly entries: (ConstantPoolEntry | null)[] = [null];

  utf8(value: string): number {
    return this.raw({ tag: ConstantTag.Utf8, value });
  }

  classEntry(name: string): number {
    return this.raw({ tag: ConstantTag.Class, nameIndex: this.utf8(name) });
  }

  methodref(className: string, name: string, descriptor: string): number {
    return this.memberref(ConstantTag.Methodref, className, name, descriptor);
  }

  fieldref(className: string, name: string, descriptor: string): number {
    return this.memberref(ConstantTag.Fieldref, className, name, descriptor);
  }

  integer(value: number): number {
    return this.raw({ tag: ConstantTag.Integer, value });
  }

  stringEntry(value: string): number {
    return this.raw({ tag: ConstantTag.String, stringIndex: this.utf8(value) });
  }

  private memberref(
    tag: typeof ConstantTag.Methodref | typeof ConstantTag.Fieldref,
    className: string,
    name: string,
    descriptor: string,
  ): number {
    const classIndex = this.classEntry(className);
    const nameAndTypeIndex = this.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: this.utf8(name),
      descriptorIndex: this.utf8(descriptor),
    });
    return this.raw({ tag, classIndex, nameAndTypeIndex });
  }

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
  readonly code?: readonly number[];
  readonly accessFlags?: number;
  readonly maxStack?: number;
  readonly maxLocals?: number;
  readonly lineNumberTable?: readonly LineNumberEntry[];
  readonly localVariableTable?: readonly LocalVariableEntry[];
  readonly exceptionTable?: readonly ExceptionTableEntry[];
}

export interface SyntheticClass {
  readonly className?: string;
  readonly pool?: ConstantPoolBuilder;
  readonly fields?: readonly FieldInfo[];
  readonly methods: readonly SyntheticMethod[];
}

export function syntheticClass({
  className = SYNTHETIC_CLASS_NAME,
  pool = new ConstantPoolBuilder(),
  fields = [],
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
    fields,
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
      ...(method.exceptionTable === undefined ? {} : { exceptionTable: method.exceptionTable }),
    },
  };
}
