import type { Instruction } from '../core/disassembler/types';

import { Panel } from './Panel';
import { CODE, CURRENT_ROW, GUTTER, GUTTER_CURRENT, IDLE_ROW, PILL_ERROR, ROW } from './theme';

interface BytecodePanelProps {
  readonly methodName: string;
  readonly methodDescriptor: string;
  readonly instructions: readonly Instruction[];
  /**
   * `pc` ramki wierzchniej — offset instrukcji, która zaraz zostanie wykonana.
   * `undefined`, gdy stos wywołań jest pusty (snapshot terminalny).
   */
  readonly currentOffset: number | undefined;
}

/**
 * Mnemoniki, których operandem jest indeks constant poolu — renderowane jako `#7`,
 * a nie jako goła liczba (kolejność wg tabeli opcode'ów z plan §6).
 */
const CONSTANT_POOL_OPERANDS = new Set([
  'invokestatic',
  'invokevirtual',
  'invokespecial',
  'invokeinterface',
  'getstatic',
  'putstatic',
  'getfield',
  'putfield',
  'ldc',
  'ldc_w',
  'new',
  'checkcast',
  'instanceof',
]);

function formatOperands(instruction: Instruction): string {
  // Dla skoków pokazujemy offset absolutny, nie surową deltę — tak samo robi `javap -c`.
  if (instruction.branchTarget !== undefined) {
    return String(instruction.branchTarget);
  }
  if (CONSTANT_POOL_OPERANDS.has(instruction.mnemonic)) {
    return instruction.operands.map((operand) => `#${String(operand)}`).join(', ');
  }
  return instruction.operands.join(', ');
}

export function BytecodePanel({
  methodName,
  methodDescriptor,
  instructions,
  currentOffset,
}: BytecodePanelProps) {
  const current = instructions.find((instruction) => instruction.offset === currentOffset);

  return (
    <Panel title="Bajtkod" meta={`${methodName}${methodDescriptor}`}>
      {/* Podświetlenie nie może być jedynym nośnikiem informacji o bieżącym kroku (design.md §9). */}
      <p className="sr-only" aria-live="polite">
        {current === undefined
          ? 'Brak aktywnej instrukcji.'
          : `Bieżąca instrukcja: pc ${String(current.offset)}, ${current.mnemonic}`}
      </p>
      <ol className="px-[10px]">
        {instructions.map((instruction) => {
          const isCurrent = instruction.offset === currentOffset;
          const operands = formatOperands(instruction);

          return (
            <li
              key={instruction.offset}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={isCurrent ? 'current-instruction' : 'instruction'}
              data-offset={instruction.offset}
              className={`${ROW} ${CODE} ${isCurrent ? CURRENT_ROW : IDLE_ROW} ${
                instruction.unsupported === true ? 'opacity-75' : ''
              }`}
            >
              <span className={isCurrent ? GUTTER_CURRENT : GUTTER}>{instruction.offset}</span>
              <span
                className={
                  instruction.unsupported === true
                    ? 'w-28 shrink-0 text-[#ff8a80]'
                    : 'w-28 shrink-0'
                }
              >
                {instruction.mnemonic}
              </span>
              <span className="grow text-[#6cb2ff]">{operands}</span>
              {instruction.unsupported === true ? (
                <span className={PILL_ERROR}>unsupported</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
