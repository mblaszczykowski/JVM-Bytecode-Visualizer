/**
 * Disassembler contract. The interpreter and the UI depend on these shapes,
 * so changing them is an architectural decision, not a refactor.
 */

/** One arm of a `tableswitch` or a `lookupswitch` (JVMS §6.5). */
export interface SwitchCase {
  /** Value that selects this arm; `undefined` marks the default branch. */
  readonly match: number | undefined;
  /** Absolute target, already resolved from the delta relative to the opcode byte. */
  readonly target: number;
}

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
   * Arms of a `tableswitch`/`lookupswitch`, default branch first. Absent on every other
   * instruction: the switches are the only ones with more than one target.
   */
  readonly switchTargets?: readonly SwitchCase[];
  /**
   * Opcode outside the executable subset: the instruction is decoded and listed in full, but
   * executing it ends the run with a VM error. Says nothing about how well it is decoded.
   */
  readonly unsupported?: true;
}

export interface DisassembledCode {
  readonly instructions: readonly Instruction[];
  /** The interpreter and the bytecode panel address instructions by byte offset. */
  readonly indexByOffset: ReadonlyMap<number, number>;
  /**
   * Offset at which decoding stopped, and only ever for bytes that are genuinely undecodable:
   * a reserved or unassigned opcode, an operand cut off by the end of `code[]`, a `wide`
   * prefix on an instruction it cannot widen, or a switch whose table does not fit. Every
   * instruction javac can emit is decoded, so a legal method is never truncated.
   */
  readonly truncatedAtOffset?: number;
}
