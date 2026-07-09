/**
 * Mock historii wykonania na potrzeby Fazy 5 (plan §9): panele renderują się na ręcznie
 * zbudowanym `Snapshot[]`, zanim powstanie prawdziwy interpreter (Faza 3) i player (Faza 6).
 *
 * Program: rekurencyjna silnia wywołana dla `n = 2`, więc stos wywołań rośnie do trzech ramek
 * (`main` → `factorial` → `factorial`), zwija się i kończy snapshotem terminalnym.
 *
 * Disassembly odpowiada temu, co javac emituje dla źródła z `mockSourceLines`
 * (offsety i kolejność jak w `javap -c`), a mapowanie na linie źródła jest zgodne
 * z regułą „największy `startPc` ≤ `pc`" (plan §8 pkt 11).
 */

import type { Instruction } from '../../core/disassembler/types';
import type { Snapshot, StackFrame } from '../../core/interpreter/types';
import type { ExampleOption } from '../ExamplePicker';

export interface MockMethod {
  readonly name: string;
  readonly descriptor: string;
  readonly instructions: readonly Instruction[];
}

export const mockSourceFileName = 'Factorial.java';

export const mockSourceLines: readonly string[] = [
  'public final class Factorial {',
  '    static int factorial(int n) {',
  '        if (n <= 1) {',
  '            return 1;',
  '        }',
  '        return n * factorial(n - 1);',
  '    }',
  '',
  '    public static void main(String[] args) {',
  '        int result = factorial(2);',
  '    }',
  '}',
];

const MAIN_DESCRIPTOR = '([Ljava/lang/String;)V';
const FACTORIAL_DESCRIPTOR = '(I)I';

/** `javap -c Factorial` → `static int factorial(int)`. Skok `if_icmpgt` omija gałąź `return 1`. */
const factorialInstructions: readonly Instruction[] = [
  { offset: 0, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
  { offset: 1, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
  // Cel skoku liczony od offsetu opcode'u: 2 + 5 = 7 (plan §8 pkt 2).
  { offset: 2, opcode: 0xa3, mnemonic: 'if_icmpgt', operands: [5], branchTarget: 7 },
  { offset: 5, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
  { offset: 6, opcode: 0xac, mnemonic: 'ireturn', operands: [] },
  { offset: 7, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
  { offset: 8, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
  { offset: 9, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
  { offset: 10, opcode: 0x64, mnemonic: 'isub', operands: [] },
  { offset: 11, opcode: 0xb8, mnemonic: 'invokestatic', operands: [7] },
  { offset: 14, opcode: 0x68, mnemonic: 'imul', operands: [] },
  { offset: 15, opcode: 0xac, mnemonic: 'ireturn', operands: [] },
];

/** `javap -c Factorial` → `public static void main(java.lang.String[])`. */
const mainInstructions: readonly Instruction[] = [
  { offset: 0, opcode: 0x05, mnemonic: 'iconst_2', operands: [] },
  { offset: 1, opcode: 0xb8, mnemonic: 'invokestatic', operands: [7] },
  { offset: 4, opcode: 0x3c, mnemonic: 'istore_1', operands: [] },
  { offset: 5, opcode: 0xb1, mnemonic: 'return', operands: [] },
];

export const mockFactorialMethod: MockMethod = {
  name: 'factorial',
  descriptor: FACTORIAL_DESCRIPTOR,
  instructions: factorialInstructions,
};

export const mockMainMethod: MockMethod = {
  name: 'main',
  descriptor: MAIN_DESCRIPTOR,
  instructions: mainInstructions,
};

/**
 * Metoda spoza zakresu MVP (plan §6) — używana wyłącznie w testach `BytecodePanel`,
 * żeby pokazać oznaczenie instrukcji `unsupported`.
 */
export const mockUnsupportedMethod: MockMethod = {
  name: 'print',
  descriptor: '(I)V',
  instructions: [
    { offset: 0, opcode: 0xb2, mnemonic: 'getstatic', operands: [2], unsupported: true },
    { offset: 3, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
    { offset: 4, opcode: 0xb6, mnemonic: 'invokevirtual', operands: [3], unsupported: true },
    { offset: 7, opcode: 0xb1, mnemonic: 'return', operands: [] },
  ],
};

export const mockMethods: readonly MockMethod[] = [mockMainMethod, mockFactorialMethod];

export function findMockMethod(name: string, descriptor: string): MockMethod | undefined {
  return mockMethods.find((method) => method.name === name && method.descriptor === descriptor);
}

function instructionAt(instructions: readonly Instruction[], offset: number): Instruction {
  const instruction = instructions.find((candidate) => candidate.offset === offset);
  if (instruction === undefined) {
    // Mock jest budowany ręcznie — literówka w offsecie ma się wywalić przy ładowaniu modułu.
    throw new Error(`Mock disassembly nie zawiera instrukcji na offsecie ${String(offset)}`);
  }
  return instruction;
}

const main = (offset: number): Instruction => instructionAt(mainInstructions, offset);
const fact = (offset: number): Instruction => instructionAt(factorialInstructions, offset);

/**
 * `pc` ramki to offset NASTĘPNEJ instrukcji tej ramki: dla ramki wierzchniej jest to
 * offset `currentInstruction`, dla ramek wołających — instrukcja tuż za `invokestatic`.
 */
function mainFrame(pc: number, operandStack: readonly number[], result?: number): StackFrame {
  return {
    methodName: 'main',
    methodDescriptor: MAIN_DESCRIPTOR,
    pc,
    operandStack,
    // Slot 0 = `args`: wartownik, którego żadna wspierana instrukcja nie odczyta (plan §5.4).
    locals: [undefined, result],
    localNames: ['args', 'result'],
  };
}

function factorialFrame(pc: number, operandStack: readonly number[], n: number): StackFrame {
  return {
    methodName: 'factorial',
    methodDescriptor: FACTORIAL_DESCRIPTOR,
    pc,
    operandStack,
    locals: [n],
    localNames: ['n'],
  };
}

/** Snapshot terminalny: pusty stos wywołań, bez `currentInstruction` (plan §5.3). */
export const mockTerminalSnapshot: Snapshot = { step: 19, callStack: [] };

/**
 * 20 snapshotów pełnego przebiegu `main` → `factorial(2)` → `factorial(1)`.
 * Snapshot[i] to stan PRZED wykonaniem `snapshot[i].currentInstruction`.
 */
export const mockHistory: readonly Snapshot[] = [
  // --- main: przygotowanie argumentu i wywołanie ---
  {
    step: 0,
    callStack: [mainFrame(0, [])],
    currentInstruction: main(0),
    sourceLine: 10,
  },
  {
    step: 1,
    callStack: [mainFrame(1, [2])],
    currentInstruction: main(1),
    sourceLine: 10,
  },

  // --- factorial(2): warunek n <= 1 fałszywy, skok do gałęzi rekurencyjnej ---
  {
    step: 2,
    callStack: [mainFrame(4, []), factorialFrame(0, [], 2)],
    currentInstruction: fact(0),
    sourceLine: 3,
  },
  {
    step: 3,
    callStack: [mainFrame(4, []), factorialFrame(1, [2], 2)],
    currentInstruction: fact(1),
    sourceLine: 3,
  },
  {
    step: 4,
    callStack: [mainFrame(4, []), factorialFrame(2, [2, 1], 2)],
    currentInstruction: fact(2),
    sourceLine: 3,
  },
  {
    step: 5,
    callStack: [mainFrame(4, []), factorialFrame(7, [], 2)],
    currentInstruction: fact(7),
    sourceLine: 6,
  },
  {
    step: 6,
    callStack: [mainFrame(4, []), factorialFrame(8, [2], 2)],
    currentInstruction: fact(8),
    sourceLine: 6,
  },
  {
    step: 7,
    callStack: [mainFrame(4, []), factorialFrame(9, [2, 2], 2)],
    currentInstruction: fact(9),
    sourceLine: 6,
  },
  {
    step: 8,
    callStack: [mainFrame(4, []), factorialFrame(10, [2, 2, 1], 2)],
    currentInstruction: fact(10),
    sourceLine: 6,
  },
  {
    step: 9,
    callStack: [mainFrame(4, []), factorialFrame(11, [2, 1], 2)],
    currentInstruction: fact(11),
    sourceLine: 6,
  },

  // --- factorial(1): trzecia ramka, warunek prawdziwy, powrót przez gałąź `return 1` ---
  {
    step: 10,
    callStack: [mainFrame(4, []), factorialFrame(14, [2], 2), factorialFrame(0, [], 1)],
    currentInstruction: fact(0),
    sourceLine: 3,
  },
  {
    step: 11,
    callStack: [mainFrame(4, []), factorialFrame(14, [2], 2), factorialFrame(1, [1], 1)],
    currentInstruction: fact(1),
    sourceLine: 3,
  },
  {
    step: 12,
    callStack: [mainFrame(4, []), factorialFrame(14, [2], 2), factorialFrame(2, [1, 1], 1)],
    currentInstruction: fact(2),
    sourceLine: 3,
  },
  {
    step: 13,
    callStack: [mainFrame(4, []), factorialFrame(14, [2], 2), factorialFrame(5, [], 1)],
    currentInstruction: fact(5),
    sourceLine: 4,
  },
  {
    step: 14,
    callStack: [mainFrame(4, []), factorialFrame(14, [2], 2), factorialFrame(6, [1], 1)],
    currentInstruction: fact(6),
    sourceLine: 4,
  },

  // --- powroty: 1 → factorial(2) → 2 → main ---
  {
    step: 15,
    callStack: [mainFrame(4, []), factorialFrame(14, [2, 1], 2)],
    currentInstruction: fact(14),
    sourceLine: 6,
  },
  {
    step: 16,
    callStack: [mainFrame(4, []), factorialFrame(15, [2], 2)],
    currentInstruction: fact(15),
    sourceLine: 6,
  },
  {
    step: 17,
    callStack: [mainFrame(4, [2])],
    currentInstruction: main(4),
    sourceLine: 10,
  },
  {
    step: 18,
    callStack: [mainFrame(5, [], 2)],
    currentInstruction: main(5),
    sourceLine: 11,
  },

  mockTerminalSnapshot,
];

/** Zwraca snapshot dla indeksu przyciętego do zakresu historii. */
export function mockSnapshotAt(index: number): Snapshot {
  const clamped = Math.min(Math.max(index, 0), mockHistory.length - 1);
  return mockHistory[clamped] ?? mockTerminalSnapshot;
}

/** Lista przykładów z plan §7 — w Fazie 5 wyłącznie do wypełnienia `ExamplePicker`. */
export const mockExamples: readonly ExampleOption[] = [
  { id: 'factorial', name: 'Factorial', description: 'Rekurencja — factorial(4) = 24' },
  { id: 'fibonacci', name: 'Fibonacci', description: 'Rekurencja rozgałęziona — fib(7) = 13' },
  { id: 'sum-of-squares', name: 'SumOfSquares', description: 'Zagnieżdżone pętle for' },
  { id: 'gcd', name: 'Gcd', description: 'Pętla while + irem — gcd(1071, 462) = 21' },
];
