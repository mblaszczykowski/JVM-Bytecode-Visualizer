/**
 * Disassembler contract. The interpreter and the UI depend on these shapes,
 * so changing them is an architectural decision, not a refactor.
 */

export interface Instruction {
  /** Byte offset of the opcode within `code[]`. */
  readonly offset: number;
  readonly opcode: number;
  readonly mnemonic: string;
  /** Already decoded — signed wherever the JVM specification requires it. */
  readonly operands: readonly number[];
  /** Absolute target of a branch (instruction offset + signed delta). */
  readonly branchTarget?: number;
  /**
   * Opcode outside the MVP subset: the instruction is listed, but executing it
   * ends the run with a VM error.
   */
  readonly unsupported?: true;
}

export interface DisassembledCode {
  readonly instructions: readonly Instruction[];
  /** The interpreter and the bytecode panel address instructions by byte offset. */
  readonly indexByOffset: ReadonlyMap<number, number>;
  /**
   * Offset at which decoding stopped. Variable-length instructions
   * (`tableswitch`/`lookupswitch`/`wide`), reserved opcodes and operands truncated by the
   * end of `code[]` leave the following bytes without known instruction boundaries.
   */
  readonly truncatedAtOffset?: number;
}
