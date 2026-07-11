import {
  lookupOpcode,
  operandWidth,
  type OperandType,
  type SupportedOpcode,
  type UnsupportedOpcode,
} from './opcodes';
import type { DisassembledCode, Instruction } from './types';

/**
 * Sequential decoder for a method's `code[]` array (JVMS §4.7.3).
 *
 * It never throws and never reads past the buffer: anything it cannot decode reliably
 * ends the listing at `truncatedAtOffset` instead. That happens for variable-length
 * instructions (`tableswitch`/`lookupswitch`/`wide`, whose length depends on operands and
 * padding), for reserved or unassigned opcode bytes, and for operands cut off by the end
 * of `code[]` — in each case the following bytes are not known to be instruction
 * boundaries, so decoding them would produce fiction.
 */
export function disassemble(code: Uint8Array): DisassembledCode {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const instructions: Instruction[] = [];
  const indexByOffset = new Map<number, number>();
  let offset = 0;
  let truncatedAtOffset: number | undefined;

  while (offset < code.byteLength) {
    const step = decodeAt(view, offset);
    if (step.kind === 'stop') {
      truncatedAtOffset = offset;
      break;
    }
    indexByOffset.set(offset, instructions.length);
    instructions.push(step.instruction);
    offset = step.nextOffset;
  }

  return {
    instructions,
    indexByOffset,
    ...(truncatedAtOffset === undefined ? {} : { truncatedAtOffset }),
  };
}

type DecodeStep =
  | { readonly kind: 'decoded'; readonly instruction: Instruction; readonly nextOffset: number }
  | { readonly kind: 'stop' };

const STOP: DecodeStep = { kind: 'stop' };

/** Shared by every unsupported instruction, so it must not be writable. */
const NO_OPERANDS: readonly number[] = Object.freeze([]);

function decodeAt(view: DataView, offset: number): DecodeStep {
  const opcode = view.getUint8(offset);
  const info = lookupOpcode(opcode);
  if (info === undefined) {
    return STOP;
  }

  switch (info.kind) {
    case 'supported':
      return decodeSupported(view, offset, info);
    case 'unsupported':
      return decodeUnsupported(view, offset, info);
    case 'variable-length':
    case 'reserved':
      return STOP;
    default:
      info satisfies never;
      return STOP;
  }
}

function decodeSupported(view: DataView, offset: number, info: SupportedOpcode): DecodeStep {
  const nextOffset = offset + 1 + info.operandBytes;
  if (nextOffset > view.byteLength) {
    return STOP;
  }

  const operands: number[] = [];
  let branchTarget: number | undefined;
  let cursor = offset + 1;

  for (const spec of info.operands) {
    const value = readOperand(view, cursor, spec.type);
    operands.push(value);
    if (spec.role === 'branch-offset') {
      // JVMS §6.5 (goto, if<cond>, …): the delta is relative to the opcode byte itself,
      // not to the byte following the operands.
      branchTarget = offset + value;
    }
    cursor += operandWidth(spec.type);
  }

  return {
    kind: 'decoded',
    instruction: {
      offset,
      opcode: info.opcode,
      mnemonic: info.mnemonic,
      operands,
      ...(branchTarget === undefined ? {} : { branchTarget }),
    },
    nextOffset,
  };
}

/**
 * Outside the MVP subset the operand encoding is not modelled, so the operands are
 * skipped by length and reported as empty — the listing still shows the real mnemonic.
 */
function decodeUnsupported(view: DataView, offset: number, info: UnsupportedOpcode): DecodeStep {
  const nextOffset = offset + 1 + info.operandBytes;
  if (nextOffset > view.byteLength) {
    return STOP;
  }

  return {
    kind: 'decoded',
    instruction: {
      offset,
      opcode: info.opcode,
      mnemonic: info.mnemonic,
      operands: NO_OPERANDS,
      unsupported: true,
    },
    nextOffset,
  };
}

/** JVMS §4.1: every multi-byte value in a class file is big-endian. */
function readOperand(view: DataView, offset: number, operandType: OperandType): number {
  switch (operandType) {
    case 'u1':
      return view.getUint8(offset);
    case 'i1':
      return view.getInt8(offset);
    case 'u2':
      return view.getUint16(offset);
    case 'i2':
      return view.getInt16(offset);
    default:
      operandType satisfies never;
      return 0;
  }
}
