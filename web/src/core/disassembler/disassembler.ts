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

/**
 * Sequential decoder for a method's `code[]` array (JVMS §4.7.3).
 *
 * Never throws and never reads past the buffer. Every instruction javac can emit is decoded
 * in full — operands included, whether or not the interpreter can run it — so the listing
 * stops only at bytes that are not an instruction at all: a reserved or unassigned opcode, an
 * operand cut off by the end of `code[]`, a `wide` prefix on something it cannot widen, or a
 * switch whose table runs past the end. From such a byte on, nothing is known to be an
 * instruction boundary, so decoding ends at `truncatedAtOffset` instead of guessing.
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

function decodeAt(view: DataView, offset: number): DecodeStep {
  const opcode = view.getUint8(offset);
  const info = lookupOpcode(opcode);
  if (info === undefined) {
    return STOP;
  }

  switch (info.kind) {
    case 'supported':
    case 'unsupported': {
      // The two switches are the only instructions with a stack effect and no fixed length.
      const { operandBytes } = info;
      return operandBytes === undefined
        ? decodeSwitch(view, offset, info)
        : decodeFixed(view, offset, info, operandBytes);
    }
    case 'variable-length':
      return decodeWide(view, offset);
    case 'reserved':
      return STOP;
    default:
      info satisfies never;
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

function readOperands(
  view: DataView,
  start: number,
  specs: readonly OperandSpec[],
  instructionOffset: number,
): DecodedOperands {
  const operands: number[] = [];
  let branchTarget: number | undefined;
  let cursor = start;

  for (const spec of specs) {
    const value = readOperand(view, cursor, spec.type);
    operands.push(value);
    if (spec.role === 'branch-offset') {
      // JVMS §6.5 (goto, if<cond>, goto_w, …): the delta is relative to the opcode byte
      // itself, not to the byte following the operands.
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

/**
 * JVMS §6.5 tableswitch/lookupswitch.
 *
 * Both start with 0–3 bytes of padding so that the first 4-byte operand begins on a 4-byte
 * boundary *of `code[]`* — which is why the padding is computed from the offset within the
 * method and not from the address of the buffer. After it come signed 4-byte values, and
 * every jump offset is relative to the opcode byte, exactly like a two-byte branch delta.
 *
 * The arms go into `switchTargets` rather than into `operands`: their number is decided by
 * the bytes, and the default branch has no match value to put next to it.
 */
function decodeSwitch(
  view: DataView,
  offset: number,
  info: SupportedOpcode | UnsupportedOpcode,
): DecodeStep {
  // The opcode byte sits at `offset`, so the operands start at `offset + 1` and the padding
  // is whatever it takes to round that up to a multiple of four.
  let cursor = offset + 1 + ((4 - ((offset + 1) % 4)) % 4);
  // The fixed head is `default` plus `npairs`, or `default` plus `low` and `high`.
  const isLookup = info.opcode === LOOKUPSWITCH;
  if (cursor + (isLookup ? 8 : 12) > view.byteLength) {
    return STOP;
  }

  // Frozen arm by arm: an `Instruction` is replayed by the UI, which must not be able to
  // rewrite the jump table it is drawing.
  const cases: SwitchCase[] = [
    Object.freeze({ match: undefined, target: offset + view.getInt32(cursor) }),
  ];
  cursor += 4;

  if (isLookup) {
    const npairs = view.getInt32(cursor);
    cursor += 4;
    // A negative or oversized `npairs` is a corrupt table, not a switch with many arms.
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
      { unsupported: info.kind === 'unsupported', switchTargets: Object.freeze(cases) },
    ),
    nextOffset: cursor,
  };
}

/**
 * JVMS §6.5 wide: a prefix that re-reads the local index of the following load, store or
 * `ret` as `u2`, and both the index and the constant of a following `iinc` as `u2`/`i2`.
 *
 * It is folded into the instruction it modifies rather than listed on its own, which is what
 * `javap -c` does too: it prints one row, `iload_w 257`, at the offset of the `wide` byte.
 * The `_w` suffix is javap's, the operands are the widened ones, and `opcode` stays the
 * *widened* instruction's — 0x15 for `iload_w` — so the interpreter dispatches, and the UI
 * explains the stack effect, exactly as they do for the narrow form. The only difference
 * between the two rows is the operand width, and that is already decoded by the time anyone
 * reads it.
 */
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
    case 'i4':
      return view.getInt32(offset);
    default:
      operandType satisfies never;
      return 0;
  }
}
