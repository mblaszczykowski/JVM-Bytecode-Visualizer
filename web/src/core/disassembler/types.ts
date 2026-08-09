export interface SwitchCase {
  readonly match: number | undefined;
  readonly target: number;
}

export interface Instruction {
  readonly offset: number;
  readonly opcode: number;
  readonly mnemonic: string;
  readonly operands: readonly number[];
  readonly branchTarget?: number;
  readonly switchTargets?: readonly SwitchCase[];
  readonly unsupported?: true;
}

export interface DisassembledCode {
  readonly instructions: readonly Instruction[];
  readonly indexByOffset: ReadonlyMap<number, number>;
  readonly truncatedAtOffset?: number;
}
