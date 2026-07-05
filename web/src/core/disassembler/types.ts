/**
 * Kontrakt disassemblera — plan.md §5.2. Zmiana kontraktu wymaga aktualizacji plan.md
 * i ADR-a w tym samym commicie.
 */

export interface Instruction {
  /** Offset bajtowy opcode'u w code[]. */
  readonly offset: number;
  readonly opcode: number;
  readonly mnemonic: string;
  /** Operandy już zdekodowane — ze znakiem tam, gdzie wymaga tego specyfikacja JVM. */
  readonly operands: readonly number[];
  /** Absolutny offset docelowy skoku (offset instrukcji + signed delta). */
  readonly branchTarget?: number;
  /**
   * Opcode spoza zakresu MVP (plan.md §6): instrukcja jest widoczna w listingu,
   * ale próba jej wykonania kończy się vm-error.
   */
  readonly unsupported?: true;
}

export interface DisassembledCode {
  readonly instructions: readonly Instruction[];
  /** Interpreter i BytecodePanel adresują instrukcje offsetem bajtowym. */
  readonly indexByOffset: ReadonlyMap<number, number>;
  /**
   * Offset, na którym przerwano dekodowanie (tableswitch/lookupswitch/wide mają
   * zmienną długość — dalszych bajtów nie da się wiarygodnie zdekodować, plan.md §8 pkt 12).
   */
  readonly truncatedAtOffset?: number;
}
