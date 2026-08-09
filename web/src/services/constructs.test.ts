import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile } from '../core/classfile';
import { disassemble } from '../core/disassembler';
import type { Instruction } from '../core/disassembler/types';

import { readExampleBytes } from './__fixtures__/example-files';
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
  const found = constructsFor(methodOf(classFile, methodName), classFile.constantPool, methodName);
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
    const found = constructsFor(instructions, classFile.constantPool, 'sortedMinimum');

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

describe('what it refuses to say', () => {
  it('reports nothing for a method whose pool resolves to nothing it knows', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));
    const found = constructsFor(
      methodOf(classFile, 'factorial'),
      classFile.constantPool,
      'factorial',
    );

    expect([...found.values()]).toEqual([]);
  });

  it('survives a pool entry that does not resolve', () => {
    const classFile = parseClassFile(readExampleBytes('Factorial.class'));
    const instructions = methodOf(classFile, 'factorial');

    expect(() => constructsFor(instructions, [], 'factorial')).not.toThrow();
  });

  it('keeps a construct over a loop head when a row is both', () => {
    const classFile = parseClassFile(readExampleBytes('BubbleSort.class'));
    const found = constructsFor(
      methodOf(classFile, 'sortedMinimum'),
      classFile.constantPool,
      'sortedMinimum',
    );

    expect(new Set(found.keys()).size).toBe(found.size);
  });
});
