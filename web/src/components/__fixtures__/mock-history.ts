/**
 * Hand-built execution history used while the panels are developed against mock data,
 * before the real interpreter and player exist.
 *
 * Program: recursive factorial called with `n = 2`, so the call stack grows to three frames
 * (`main` → `factorial` → `factorial`), unwinds, and ends with a terminal snapshot.
 *
 * The disassembly matches what javac emits for the source in `mockSourceLines` (offsets and
 * ordering as in `javap -c`), and the line mapping follows the LineNumberTable rule: the
 * entry with the largest `startPc <= pc` wins.
 */

import type { Instruction } from '../../core/disassembler/types';
import type { Snapshot, StackFrame } from '../../core/interpreter/types';
import type { ExampleOption } from '../ExamplePicker';

export interface MockLineNumber {
  readonly startPc: number;
  readonly lineNumber: number;
}

export interface MockMethod {
  readonly name: string;
  readonly descriptor: string;
  /** From the Code attribute — shown in the Bytecode panel header as `max 2/1`. */
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  readonly lineNumberTable: readonly MockLineNumber[];
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

/** `javap -c Factorial` → `static int factorial(int)`. `if_icmpgt` skips the `return 1` branch. */
const factorialInstructions: readonly Instruction[] = [
  { offset: 0, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
  { offset: 1, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
  // Branch targets are relative to the opcode of the jump itself: 2 + 5 = 7 (JVMS §6.5).
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
  maxStack: 2,
  maxLocals: 1,
  instructions: factorialInstructions,
  lineNumberTable: [
    { startPc: 0, lineNumber: 3 },
    { startPc: 5, lineNumber: 4 },
    { startPc: 7, lineNumber: 6 },
  ],
};

export const mockMainMethod: MockMethod = {
  name: 'main',
  descriptor: MAIN_DESCRIPTOR,
  maxStack: 1,
  maxLocals: 2,
  instructions: mainInstructions,
  lineNumberTable: [
    { startPc: 0, lineNumber: 10 },
    { startPc: 5, lineNumber: 11 },
  ],
};

/**
 * A method outside the supported instruction subset — used only by the Bytecode panel tests
 * to exercise the `unsupported` marking.
 */
export const mockUnsupportedMethod: MockMethod = {
  name: 'print',
  descriptor: '(I)V',
  maxStack: 2,
  maxLocals: 1,
  instructions: [
    { offset: 0, opcode: 0xb2, mnemonic: 'getstatic', operands: [2], unsupported: true },
    { offset: 3, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
    { offset: 4, opcode: 0xb6, mnemonic: 'invokevirtual', operands: [3], unsupported: true },
    { offset: 7, opcode: 0xb1, mnemonic: 'return', operands: [] },
  ],
  lineNumberTable: [{ startPc: 0, lineNumber: 1 }],
};

export const mockMethods: readonly MockMethod[] = [mockMainMethod, mockFactorialMethod];

export function findMockMethod(name: string, descriptor: string): MockMethod | undefined {
  return mockMethods.find((method) => method.name === name && method.descriptor === descriptor);
}

/**
 * The constant pool entries the mock disassembly refers to. The UI shows the whole resolution
 * chain, `#7` down to a method name, not just the index.
 */
export interface MockConstant {
  /** Resolution chain, rendered left to right in the "Next" card. */
  readonly chain: readonly string[];
  /** javap-style trailing comment for the instruction row. */
  readonly comment: string;
  readonly methodName: string;
  readonly methodDescriptor: string;
}

export const mockConstantPool: ReadonlyMap<number, MockConstant> = new Map([
  [
    7,
    {
      chain: ['#7', 'Methodref', '#2 Class Factorial', '#18 factorial:(I)I'],
      comment: '// Method factorial:(I)I',
      methodName: 'factorial',
      methodDescriptor: FACTORIAL_DESCRIPTOR,
    },
  ],
]);

function instructionAt(instructions: readonly Instruction[], offset: number): Instruction {
  const instruction = instructions.find((candidate) => candidate.offset === offset);
  if (instruction === undefined) {
    // The mock is written by hand — a typo in an offset must fail when the module loads.
    throw new Error(`Mock disassembly has no instruction at offset ${String(offset)}`);
  }
  return instruction;
}

const main = (offset: number): Instruction => instructionAt(mainInstructions, offset);
const fact = (offset: number): Instruction => instructionAt(factorialInstructions, offset);

/**
 * A frame's `pc` is the offset of the NEXT instruction of that frame: for the top frame it is
 * the offset of `currentInstruction`, for calling frames the instruction after `invokestatic`.
 */
function mainFrame(pc: number, operandStack: readonly number[], result?: number): StackFrame {
  return {
    methodName: 'main',
    methodDescriptor: MAIN_DESCRIPTOR,
    pc,
    operandStack,
    // Slot 0 = `args`: a sentinel that no supported instruction can read.
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

export const mockTerminalSnapshot: Snapshot = { step: 19, callStack: [] };

/**
 * 20 snapshots of the full run `main` → `factorial(2)` → `factorial(1)`.
 * Snapshot[i] is the state BEFORE executing `snapshot[i].currentInstruction`.
 */
export const mockHistory: readonly Snapshot[] = [
  // --- main: prepare the argument and call ---
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

  // --- factorial(2): `n <= 1` is false, so the jump takes the recursive branch ---
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

  // --- factorial(1): third frame, base case true, returns through `return 1` ---
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

  // --- unwinding: 1 → factorial(2) → 2 → main ---
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

export function mockSnapshotAt(index: number): Snapshot {
  const clamped = Math.min(Math.max(index, 0), mockHistory.length - 1);
  return mockHistory[clamped] ?? mockTerminalSnapshot;
}

/** Example programs — at mock stage they only populate the toolbar picker. */
export const mockExamples: readonly ExampleOption[] = [
  { id: 'factorial', name: 'Factorial', description: 'Recursion — factorial(4) = 24' },
  { id: 'fibonacci', name: 'Fibonacci', description: 'Branching recursion — fib(7) = 13' },
  { id: 'sum-of-squares', name: 'SumOfSquares', description: 'Nested for loops — 441' },
  { id: 'gcd', name: 'Gcd', description: 'while loop + irem — gcd(1071, 462) = 21' },
];
