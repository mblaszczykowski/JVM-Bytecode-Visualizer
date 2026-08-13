import { describe, expect, it } from 'vitest';

import { ConstantTag, parseClassFile, type ConstantPool } from '../../core/classfile';
import {
  ConstantPoolBuilder,
  syntheticClass,
} from '../../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from '../__fixtures__/example-files';
import { constantPoolComments, constantPoolIndexOf, resolveConstant } from './constant-pool';
import { buildProgram, findListing, type LoadedProgram } from '../loading/program';

function factorialProgram(): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName: 'Factorial.class' },
    classFile: parseClassFile(readExampleBytes('Factorial.class')),
    source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
  });
}

describe('constant pool', () => {
  it('comments every instruction that names a pool entry, javap style', () => {
    const program = factorialProgram();
    const main = findListing(program, 'main', '([Ljava/lang/String;)V');
    if (main === undefined) {
      throw new Error('main is missing');
    }

    const comments = constantPoolComments(main, program.classFile);

    expect([...comments.values()]).toEqual(['// Method Factorial.factorial:(I)I']);
  });

  it('resolves a Class entry to its internal name', () => {
    const program = factorialProgram();
    const pool = program.classFile.constantPool;
    const classIndex = pool.findIndex((entry) => entry?.tag === 7);

    expect(resolveConstant(pool, classIndex)?.tagName).toBe('Class');
    expect(resolveConstant(pool, classIndex)?.chain).toHaveLength(3);
  });

  it('returns nothing for an index outside the pool', () => {
    const program = factorialProgram();

    expect(resolveConstant(program.classFile.constantPool, 9999)).toBeUndefined();
  });

  it('names the pool entry of an instruction the interpreter cannot run', () => {
    expect(
      constantPoolIndexOf({ offset: 0, opcode: 0xb4, mnemonic: 'getfield', operands: [7] }),
    ).toBe(7);
    expect(constantPoolIndexOf({ offset: 0, opcode: 0xbb, mnemonic: 'new', operands: [2] })).toBe(
      2,
    );
  });

  it('reads the entries a modern class file carries beyond the executable subset', () => {
    const pool = new ConstantPoolBuilder();
    const listClass = pool.classEntry('java/util/List');
    const add = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: pool.utf8('add'),
      descriptorIndex: pool.utf8('(Ljava/lang/Object;)Z'),
    });
    const interfaceMethod = pool.raw({
      tag: ConstantTag.InterfaceMethodref,
      classIndex: listClass,
      nameAndTypeIndex: add,
    });
    const concat = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: pool.utf8('makeConcatWithConstants'),
      descriptorIndex: pool.utf8('(I)Ljava/lang/String;'),
    });
    const invokeDynamic = pool.raw({
      tag: ConstantTag.InvokeDynamic,
      bootstrapMethodAttrIndex: 0,
      nameAndTypeIndex: concat,
    });
    const dynamic = pool.raw({
      tag: ConstantTag.Dynamic,
      bootstrapMethodAttrIndex: 1,
      nameAndTypeIndex: concat,
    });
    const factory = pool.methodref('java/lang/invoke/StringConcatFactory', 'makeConcat', '()V');
    const handle = pool.raw({
      tag: ConstantTag.MethodHandle,
      referenceKind: 6,
      referenceIndex: factory,
    });
    const methodType = pool.raw({
      tag: ConstantTag.MethodType,
      descriptorIndex: pool.utf8('(Ljava/lang/Object;)Z'),
    });
    const module = pool.raw({ tag: ConstantTag.Module, nameIndex: pool.utf8('java.base') });
    const entries = pool.build();
    const textOf = (index: number) => resolveConstant(entries, index)?.text;
    const commentOf = (index: number) => resolveConstant(entries, index)?.comment;

    expect(textOf(interfaceMethod)).toBe('java/util/List.add:(Ljava/lang/Object;)Z');
    expect(commentOf(interfaceMethod)).toBe(
      '// InterfaceMethod java/util/List.add:(Ljava/lang/Object;)Z',
    );
    expect(commentOf(invokeDynamic)).toBe(
      '// InvokeDynamic #0:makeConcatWithConstants:(I)Ljava/lang/String;',
    );
    expect(commentOf(dynamic)).toBe('// Dynamic #1:makeConcatWithConstants:(I)Ljava/lang/String;');
    expect(commentOf(handle)).toBe(
      '// MethodHandle REF_invokeStatic java/lang/invoke/StringConcatFactory.makeConcat:()V',
    );
    expect(commentOf(methodType)).toBe('// MethodType (Ljava/lang/Object;)Z');
    expect(commentOf(module)).toBe('// Module java.base');
    expect(resolveConstant(entries, interfaceMethod)?.chain).toEqual([
      `#${String(interfaceMethod)}`,
      'InterfaceMethodref',
      'java/util/List.add:(Ljava/lang/Object;)Z',
    ]);
  });

  it('prints the wide numeric constants the way javap suffixes them', () => {
    const pool = new ConstantPoolBuilder();
    const long = pool.raw({ tag: ConstantTag.Long, value: 4_294_967_296n });
    const float = pool.raw({ tag: ConstantTag.Float, value: 1.5 });
    const double = pool.raw({ tag: ConstantTag.Double, value: 2 });
    const entries = pool.build();

    expect(resolveConstant(entries, long)?.text).toBe('4294967296l');
    expect(resolveConstant(entries, long)?.comment).toBe('// long 4294967296l');
    expect(resolveConstant(entries, float)?.comment).toBe('// float 1.5f');
    expect(resolveConstant(entries, double)?.comment).toBe('// double 2.0d');
  });

  it('says nothing rather than something wrong about a reference kind outside JVMS 4.4.8', () => {
    const pool = new ConstantPoolBuilder();
    const factory = pool.methodref('java/lang/invoke/StringConcatFactory', 'makeConcat', '()V');
    const handle = pool.raw({
      tag: ConstantTag.MethodHandle,
      referenceKind: 99,
      referenceIndex: factory,
    });

    expect(resolveConstant(pool.build(), handle)).toBeUndefined();
  });

  it('refuses a MethodHandle that names itself, rather than following it forever', () => {
    const pool: ConstantPool = [
      null,
      { tag: ConstantTag.MethodHandle, referenceKind: 6, referenceIndex: 1 },
    ];

    expect(resolveConstant(pool, 1)).toBeUndefined();
  });

  it('refuses a pair of MethodHandles that name each other', () => {
    const pool: ConstantPool = [
      null,
      { tag: ConstantTag.MethodHandle, referenceKind: 6, referenceIndex: 2 },
      { tag: ConstantTag.MethodHandle, referenceKind: 6, referenceIndex: 1 },
    ];

    expect(resolveConstant(pool, 1)).toBeUndefined();
    expect(resolveConstant(pool, 2)).toBeUndefined();
  });

  it('comments an interface call the way javap does', () => {
    const pool = new ConstantPoolBuilder();
    const interfaceMethod = pool.raw({
      tag: ConstantTag.InterfaceMethodref,
      classIndex: pool.classEntry('java/util/List'),
      nameAndTypeIndex: pool.raw({
        tag: ConstantTag.NameAndType,
        nameIndex: pool.utf8('add'),
        descriptorIndex: pool.utf8('(Ljava/lang/Object;)Z'),
      }),
    });
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Interfaces.class' },
      classFile: syntheticClass({
        pool,
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
            code: [0xb9, 0x00, interfaceMethod, 0x01, 0x00, 0xb1],
          },
        ],
      }),
    });
    const listing = program.entry;
    if (listing === undefined) {
      throw new Error('the synthetic class has no entry point');
    }

    expect([...constantPoolComments(listing, program.classFile).values()]).toEqual([
      '// InterfaceMethod java/util/List.add:(Ljava/lang/Object;)Z',
    ]);
  });

  it('has no pool entry for an instruction whose operand is not one', () => {
    expect(
      constantPoolIndexOf({ offset: 0, opcode: 0x15, mnemonic: 'iload', operands: [3] }),
    ).toBeUndefined();
  });
});
