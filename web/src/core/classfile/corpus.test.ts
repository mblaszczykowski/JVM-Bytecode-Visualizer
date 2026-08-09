import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { disassemble, OPCODES } from '../disassembler';
import { EXECUTABLE_OPCODES } from '../interpreter';
import { findEntryMethod } from '../interpreter/interpreter';

import { ClassFileError } from './errors';
import { parseClassFile } from './parser';
import type { ClassFile } from './types';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '../../../corpus/.cache');
const CLASSES = join(CACHE, 'classes');
const hasCorpus = existsSync(CLASSES);

function corpusFiles(): readonly string[] {
  return execFileSync('find', [CLASSES, '-name', '*.class'], { maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split('\n')
    .filter(Boolean);
}

function bytesOf(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

interface Failure {
  readonly file: string;
  readonly stage: 'parse' | 'disassemble';
  readonly error: string;
  readonly typed: boolean;
}

interface Scan {
  readonly files: number;
  readonly methods: number;
  readonly instructions: number;
  readonly failures: readonly Failure[];
  readonly opcodeCounts: ReadonlyMap<number, number>;
  readonly majorVersions: ReadonlyMap<number, number>;
  readonly withRunnableEntry: number;
  readonly truncated: number;
  readonly fullyExecutableMethods: number;
}

function scanCorpus(files: readonly string[]): Scan {
  const failures: Failure[] = [];
  const opcodeCounts = new Map<number, number>();
  const majorVersions = new Map<number, number>();
  let methods = 0;
  let instructions = 0;
  let withRunnableEntry = 0;
  let truncated = 0;
  let fullyExecutableMethods = 0;

  for (const file of files) {
    let classFile: ClassFile;
    try {
      classFile = parseClassFile(bytesOf(file));
    } catch (error) {
      failures.push({
        file,
        stage: 'parse',
        error: error instanceof Error ? error.message : String(error),
        typed: error instanceof ClassFileError,
      });
      continue;
    }

    majorVersions.set(classFile.majorVersion, (majorVersions.get(classFile.majorVersion) ?? 0) + 1);
    if (findEntryMethod(classFile) !== undefined) {
      withRunnableEntry += 1;
    }

    for (const method of classFile.methods) {
      const { code } = method;
      if (code === undefined) {
        continue;
      }
      methods += 1;
      try {
        const decoded = disassemble(code.code);
        if (decoded.truncatedAtOffset !== undefined) {
          truncated += 1;
        }
        let whole = decoded.instructions.length > 0;
        for (const instruction of decoded.instructions) {
          instructions += 1;
          opcodeCounts.set(instruction.opcode, (opcodeCounts.get(instruction.opcode) ?? 0) + 1);
          whole &&= EXECUTABLE_OPCODES.has(instruction.opcode);
        }
        if (whole) {
          fullyExecutableMethods += 1;
        }
      } catch (error) {
        failures.push({
          file,
          stage: 'disassemble',
          error: error instanceof Error ? error.message : String(error),
          typed: false,
        });
      }
    }
  }

  return {
    files: files.length,
    methods,
    instructions,
    failures,
    opcodeCounts,
    majorVersions,
    withRunnableEntry,
    truncated,
    fullyExecutableMethods,
  };
}

const NO_SCAN: Scan = {
  files: 0,
  methods: 0,
  instructions: 0,
  failures: [],
  opcodeCounts: new Map(),
  majorVersions: new Map(),
  withRunnableEntry: 0,
  truncated: 0,
  fullyExecutableMethods: 0,
};

describe.skipIf(!hasCorpus)('the parser and disassembler against a real-world corpus', () => {
  const scan = hasCorpus ? scanCorpus(corpusFiles()) : NO_SCAN;

  it('has enough files, from enough compilers, to be worth running', () => {
    expect(scan.files).toBeGreaterThan(5_000);
    expect(scan.majorVersions.size).toBeGreaterThan(3);
  });

  it('parses and disassembles every class file without throwing', () => {
    expect(scan.failures.slice(0, 10)).toEqual([]);
    expect(scan.failures).toHaveLength(0);
  });

  it('decodes every method to the end', () => {
    expect(scan.truncated).toBe(0);
  });

  it('records what the executable subset covers', () => {
    const executable = [...scan.opcodeCounts]
      .filter(([opcode]) => EXECUTABLE_OPCODES.has(opcode))
      .reduce((total, [, count]) => total + count, 0);

    const distinctSeen = scan.opcodeCounts.size;
    const distinctExecutable = [...scan.opcodeCounts.keys()].filter((opcode) =>
      EXECUTABLE_OPCODES.has(opcode),
    ).length;

    const top = [...scan.opcodeCounts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([opcode, count]) => ({
        mnemonic: OPCODES.get(opcode)?.mnemonic ?? `0x${opcode.toString(16)}`,
        count,
        executable: EXECUTABLE_OPCODES.has(opcode),
      }));

    const summary = {
      files: scan.files,
      methodsWithCode: scan.methods,
      instructions: scan.instructions,
      classFileMajorVersions: [...scan.majorVersions.keys()].sort((a, b) => a - b),
      classesWithRunnableEntry: scan.withRunnableEntry,
      fullyExecutableMethods: scan.fullyExecutableMethods,
      fullyExecutableMethodPercent:
        Math.round((scan.fullyExecutableMethods / scan.methods) * 1000) / 10,
      distinctOpcodesSeen: distinctSeen,
      distinctOpcodesExecutable: distinctExecutable,
      instructionsExecutable: executable,
      instructionCoveragePercent: Math.round((executable / scan.instructions) * 1000) / 10,
      mostCommon: top,
    };
    writeFileSync(join(CACHE, 'scan.json'), `${JSON.stringify(summary, null, 2)}\n`);

    expect(summary.instructionCoveragePercent).toBeGreaterThan(30);
    expect(scan.instructions).toBeGreaterThan(1_000_000);
  });
});
