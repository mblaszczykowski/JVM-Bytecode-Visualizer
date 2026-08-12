import { describe, expect, it } from 'vitest';

import { parseClassFile, type ConstantPool } from '../core/classfile';
import type { Instruction } from '../core/disassembler';

import { readExampleBytes } from './__fixtures__/example-files';
import {
  describeStackEffect,
  formatOperands,
  operandTokens,
  stackEffectOf,
} from './bytecode-format';

const pool: ConstantPool = parseClassFile(readExampleBytes('Factorial.class')).constantPool;

const iinc: Instruction = { offset: 0, opcode: 0x84, mnemonic: 'iinc', operands: [1, 1] };

const invokestatic: Instruction = {
  offset: 3,
  opcode: 0xb8,
  mnemonic: 'invokestatic',
  operands: [7],
};

const goto: Instruction = {
  offset: 6,
  opcode: 0xa7,
  mnemonic: 'goto',
  operands: [-6],
  branchTarget: 0,
};

const imul: Instruction = { offset: 9, opcode: 0x68, mnemonic: 'imul', operands: [] };

const monitorenter: Instruction = {
  offset: 10,
  opcode: 0xc2,
  mnemonic: 'monitorenter',
  operands: [],
  unsupported: true,
};

describe('operandTokens', () => {
  it('marks a constant pool index as a reference and carries the index', () => {
    expect(operandTokens(invokestatic)).toEqual([
      { text: '#7', isReference: true, constantIndex: 7 },
    ]);
  });

  it('reports the absolute branch target instead of the encoded delta', () => {
    expect(operandTokens(goto)).toEqual([{ text: '0', isReference: true }]);
  });

  it('leaves a plain immediate alone', () => {
    expect(operandTokens(iinc)).toEqual([
      { text: '1', isReference: false },
      { text: '1', isReference: false },
    ]);
  });
});

describe('formatOperands', () => {
  it('joins the operands the way the listing prints them', () => {
    expect(formatOperands(iinc)).toBe('1, 1');
    expect(formatOperands(invokestatic)).toBe('#7');
    expect(formatOperands(imul)).toBe('');
  });
});

describe('stackEffectOf', () => {
  it('reports the fixed effect of a supported instruction', () => {
    expect(stackEffectOf(imul, pool)).toEqual({ pops: 2, pushes: 1 });
  });

  it('resolves an effect that follows a descriptor', () => {
    expect(stackEffectOf(invokestatic, pool)).toEqual({ pops: 1, pushes: 1 });
  });

  it('says varies where the descriptor cannot be resolved', () => {
    const getstatic: Instruction = {
      offset: 0,
      opcode: 0xb2,
      mnemonic: 'getstatic',
      operands: [2],
    };

    expect(stackEffectOf(getstatic, [])).toBe('varies');
  });

  it('reports nothing at all for an instruction outside the executable subset', () => {
    expect(stackEffectOf(monitorenter, pool)).toBeUndefined();
  });
});

describe('describeStackEffect', () => {
  it('spells the effect out for a screen reader', () => {
    expect(describeStackEffect({ pops: 2, pushes: 1 })).toBe('stack: pops 2, pushes 1');
    expect(describeStackEffect({ pops: 2, pushes: 0 })).toBe('stack: pops 2');
    expect(describeStackEffect({ pops: 0, pushes: 1 })).toBe('stack: pushes 1');
    expect(describeStackEffect({ pops: 0, pushes: 0 })).toBe('stack: unchanged');
    expect(describeStackEffect('varies')).toBe('stack: varies with the descriptor');
    expect(describeStackEffect(undefined)).toBeUndefined();
  });
});
