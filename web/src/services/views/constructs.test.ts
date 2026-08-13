import { describe, expect, it } from 'vitest';

import { ConstantTag, parseClassFile, type ClassFile } from '../../core/classfile';
import { disassemble, type Instruction } from '../../core/disassembler';
import { ConstantPoolBuilder } from '../../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes } from '../__fixtures__/example-files';
import { constructsFor } from './constructs';

function methodOf(classFile: ClassFile, name: string): readonly Instruction[] {
  const method = classFile.methods.find((candidate) => candidate.name === name);
  if (method?.code === undefined) {
    throw new Error(`no method ${name} with code`);
  }
  return disassemble(method.code.code).instructions;
}

function labelsIn(fileName: string, methodName: string): readonly string[] {
  const classFile = parseClassFile(readExampleBytes(fileName));
  const found = constructsFor(
    methodOf(classFile, methodName),
    classFile.constantPool,
    methodName,
    classFile.thisClassName,
  );
  return [...found.values()].map((construct) => construct.label);
}

describe('loops', () => {
  it('names the top of the loop in a sort, where the jump back lands', () => {
    const labels = labelsIn('BubbleSort.class', 'sortedMinimum');

    expect(labels.filter((label) => label === 'loop')).toHaveLength(2);
  });

  it('says nothing about a method with no backward branch', () => {
    const labels = labelsIn('Factorial.class', 'factorial');

    expect(labels).not.toContain('loop');
  });

  it('reports the head at the branch target rather than at the branch', () => {
    const classFile = parseClassFile(readExampleBytes('BubbleSort.class'));
    const instructions = methodOf(classFile, 'sortedMinimum');
    const found = constructsFor(
      instructions,
      classFile.constantPool,
      'sortedMinimum',
      classFile.thisClassName,
    );

    const backward = instructions.filter(
      (instruction) =>
        instruction.branchTarget !== undefined && instruction.branchTarget < instruction.offset,
    );
    expect(backward.length).toBeGreaterThan(0);
    for (const branch of backward) {
      expect(found.get(branch.branchTarget ?? -1)?.label).toBe('loop');
      expect(found.get(branch.offset)?.label).not.toBe('loop');
    }
  });
});

describe('the array literal in the sort', () => {
  it('names the allocation that a written-out array compiles to', () => {
    expect(labelsIn('BubbleSort.class', 'sortedMinimum')).toContain('array literal');
  });
});

describe('string concatenation', () => {
  it('reads the call site javac hides behind invokedynamic', () => {
    const pool = new ConstantPoolBuilder();
    const concat = pool.raw({
      tag: ConstantTag.InvokeDynamic,
      bootstrapMethodAttrIndex: 0,
      nameAndTypeIndex: pool.raw({
        tag: ConstantTag.NameAndType,
        nameIndex: pool.utf8('makeConcatWithConstants'),
        descriptorIndex: pool.utf8('(I)Ljava/lang/String;'),
      }),
    });
    const { instructions } = disassemble(Uint8Array.from([0xba, 0x00, concat, 0x00, 0x00]));

    const found = constructsFor(instructions, pool.build(), 'main', 'Synthetic');

    expect([...found.values()].map((construct) => construct.label)).toEqual(['concat']);
  });
});

describe('the constructor call javac inserts', () => {
  function constructorConstructs(owner: string, className: string): readonly string[] {
    const pool = new ConstantPoolBuilder();
    const called = pool.methodref(owner, '<init>', '()V');
    const { instructions } = disassemble(Uint8Array.from([0x2a, 0xb7, 0x00, called, 0xb1]));
    const found = constructsFor(instructions, pool.build(), '<init>', className);
    return [...found.values()].map((construct) => construct.label);
  }

  it('names the superclass constructor the source never wrote', () => {
    expect(constructorConstructs('Base', 'Child')).toEqual(['super()']);
  });

  it('says nothing about this(), which the source did write', () => {
    expect(constructorConstructs('Child', 'Child')).toEqual([]);
  });
});

describe('what it refuses to say', () => {
  it('reports nothing for a method whose pool resolves to nothing it knows', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));
    const found = constructsFor(
      methodOf(classFile, 'factorial'),
      classFile.constantPool,
      'factorial',
      classFile.thisClassName,
    );

    expect([...found.values()]).toEqual([]);
  });

  it('survives a pool entry that does not resolve', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));
    const instructions = methodOf(classFile, 'factorial');

    expect(() => constructsFor(instructions, [], 'factorial', 'Factorial')).not.toThrow();
  });

  it('keeps a construct over a loop head when a row is both', () => {
    const classFile = parseClassFile(readExampleBytes('BubbleSort.class'));
    const found = constructsFor(
      methodOf(classFile, 'sortedMinimum'),
      classFile.constantPool,
      'sortedMinimum',
      classFile.thisClassName,
    );

    expect(new Set(found.keys()).size).toBe(found.size);
  });
});
