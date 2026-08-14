import {
  lookupOpcode,
  LOOKUPSWITCH,
  operandWidth,
  WIDENED_FORMS,
  type OperandSpec,
  type OperandType,
  type SupportedOpcode,
  type UnsupportedOpcode,
} from './opcodes';
import type { DisassembledCode, Instruction, SwitchCase } from './types';

export function disassemble(code: Uint8Array): DisassembledCode {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const instructions: Instruction[] = [];
  const indexByOffset = new Map<number, number>();
  let offset = 0;
  let undecodedFromOffset: number | undefined;

  while (offset < code.byteLength) {
    const step = decodeAt(view, offset);
    if (step.kind === 'stop') {
      undecodedFromOffset = offset;
      break;
    }
    indexByOffset.set(offset, instructions.length);
    instructions.push(step.instruction);
    offset = step.nextOffset;
  }

  return {
    instructions,
    indexByOffset,
    ...(undecodedFromOffset === undefined ? {} : { undecodedFromOffset }),
  };
}

type DecodeStep =
  | { readonly kind: 'decoded'; readonly instruction: Instruction; readonly nextOffset: number }
  | { readonly kind: 'stop' };

const STOP: DecodeStep = { kind: 'stop' };

function decodeAt(view: DataView, offset: number): DecodeStep {
  const opcode = view.getUint8(offset);
  const info = lookupOpcode(opcode);
  if (info === undefined) {
    return STOP;
  }

  switch (info.kind) {
    case 'supported':
      return info.operandBytes === undefined
        ? decodeSwitch(view, offset, info)
        : decodeFixed(view, offset, info, info.operandBytes);
    case 'unsupported':
      return decodeFixed(view, offset, info, info.operandBytes);
    case 'variable-length':
      return decodeWide(view, offset);
    case 'reserved':
      return STOP;
  }
}

function decodeFixed(
  view: DataView,
  offset: number,
  info: SupportedOpcode | UnsupportedOpcode,
  operandBytes: number,
): DecodeStep {
  const nextOffset = offset + 1 + operandBytes;
  if (nextOffset > view.byteLength) {
    return STOP;
  }

  const decoded = readOperands(view, offset + 1, info.operands, offset);
  return {
    kind: 'decoded',
    instruction: instructionOf(offset, info.opcode, info.mnemonic, decoded, {
      unsupported: info.kind === 'unsupported',
    }),
    nextOffset,
  };
}

interface DecodedOperands {
  readonly operands: number[];
  readonly branchTarget: number | undefined;
}

function recordedOperandCount(specs: readonly OperandSpec[]): number {
  return specs.at(-1)?.role === 'mandated-zero' ? specs.length - 1 : specs.length;
}

function readOperands(
  view: DataView,
  start: number,
  specs: readonly OperandSpec[],
  instructionOffset: number,
): DecodedOperands {
  const operands: number[] = [];
  const recorded = recordedOperandCount(specs);
  let branchTarget: number | undefined;
  let cursor = start;

  for (const [position, spec] of specs.entries()) {
    const value = readOperand(view, cursor, spec.type);
    if (position < recorded) {
      operands.push(value);
    }
    if (spec.role === 'branch-offset') {
      branchTarget = instructionOffset + value;
    }
    cursor += operandWidth(spec.type);
  }

  return { operands, branchTarget };
}

interface InstructionFlags {
  readonly unsupported: boolean;
  readonly switchTargets?: readonly SwitchCase[];
}

function instructionOf(
  offset: number,
  opcode: number,
  mnemonic: string,
  decoded: DecodedOperands,
  flags: InstructionFlags,
): Instruction {
  return {
    offset,
    opcode,
    mnemonic,
    operands: decoded.operands,
    ...(decoded.branchTarget === undefined ? {} : { branchTarget: decoded.branchTarget }),
    ...(flags.switchTargets === undefined ? {} : { switchTargets: flags.switchTargets }),
    ...(flags.unsupported ? { unsupported: true as const } : {}),
  };
}

function decodeSwitch(view: DataView, offset: number, info: SupportedOpcode): DecodeStep {
  let cursor = offset + 1 + ((4 - ((offset + 1) % 4)) % 4);
  const isLookup = info.opcode === LOOKUPSWITCH;
  if (cursor + (isLookup ? 8 : 12) > view.byteLength) {
    return STOP;
  }

  const cases: SwitchCase[] = [
    Object.freeze({ match: undefined, target: offset + view.getInt32(cursor) }),
  ];
  cursor += 4;

  if (isLookup) {
    const npairs = view.getInt32(cursor);
    cursor += 4;
    if (npairs < 0 || cursor + npairs * 8 > view.byteLength) {
      return STOP;
    }
    for (let pair = 0; pair < npairs; pair += 1) {
      cases.push(
        Object.freeze({ match: view.getInt32(cursor), target: offset + view.getInt32(cursor + 4) }),
      );
      cursor += 8;
    }
  } else {
    const low = view.getInt32(cursor);
    const high = view.getInt32(cursor + 4);
    cursor += 8;
    const count = high - low + 1;
    if (high < low || cursor + count * 4 > view.byteLength) {
      return STOP;
    }
    for (let arm = 0; arm < count; arm += 1) {
      cases.push(Object.freeze({ match: low + arm, target: offset + view.getInt32(cursor) }));
      cursor += 4;
    }
  }

  return {
    kind: 'decoded',
    instruction: instructionOf(
      offset,
      info.opcode,
      info.mnemonic,
      { operands: [], branchTarget: undefined },
      { unsupported: false, switchTargets: Object.freeze(cases) },
    ),
    nextOffset: cursor,
  };
}

function decodeWide(view: DataView, offset: number): DecodeStep {
  if (offset + 2 > view.byteLength) {
    return STOP;
  }
  const form = WIDENED_FORMS.get(view.getUint8(offset + 1));
  if (form === undefined) {
    return STOP;
  }

  const nextOffset = offset + 2 + form.operandBytes;
  if (nextOffset > view.byteLength) {
    return STOP;
  }

  return {
    kind: 'decoded',
    instruction: instructionOf(
      offset,
      form.opcode,
      form.mnemonic,
      readOperands(view, offset + 2, form.operands, offset),
      { unsupported: form.unsupported },
    ),
    nextOffset,
  };
}

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
    case 'i4':
      return view.getInt32(offset);
  }
}
