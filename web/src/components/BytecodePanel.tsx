import { useState } from 'react';

import type { Instruction } from '../core/disassembler/types';

import { BranchGutter } from './BranchGutter';
import { formatOperands } from './bytecode-format';
import { NextInstructionCard, type NextInstructionCardProps } from './NextInstructionCard';
import { Panel } from './Panel';
import { CODE_ROW } from './rhythm';
import { Pill } from './ui/Pill';
import { useScrollFollow } from './useScrollFollow';

interface BytecodePanelProps {
  readonly methodName: string;
  readonly methodDescriptor: string;
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  /**
   * `pc` of the top frame — the offset of the instruction about to run.
   * `undefined` when the call stack is empty (terminal snapshot).
   */
  readonly currentOffset: number | undefined;
  /** javap-style trailing comments, keyed by instruction offset. */
  readonly comments?: ReadonlyMap<number, string> | undefined;
  /** Offsets never reached in this run — dimmed, because they did not shape the result. */
  readonly deadOffsets?: ReadonlySet<number> | undefined;
  /**
   * Offset where decoding stopped. Variable-length instructions cannot be skipped reliably,
   * so the rest of the method is reported as undecoded instead of being guessed at.
   */
  readonly truncatedAtOffset?: number | undefined;
  readonly next?: NextInstructionCardProps | undefined;
}

export function BytecodePanel({
  methodName,
  methodDescriptor,
  maxStack,
  maxLocals,
  instructions,
  currentOffset,
  comments,
  deadOffsets,
  truncatedAtOffset,
  next,
}: BytecodePanelProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>(undefined);

  const currentIndex = instructions.findIndex(
    (instruction) => instruction.offset === currentOffset,
  );
  const current = currentIndex < 0 ? undefined : instructions[currentIndex];
  const contentRef = useScrollFollow(currentIndex < 0 ? undefined : currentIndex);

  const meta = `${methodName}${methodDescriptor} · max ${String(maxStack)}/${String(maxLocals)}`;
  const currentOperands = current === undefined ? '' : formatOperands(current);

  return (
    <Panel
      title="Bytecode"
      meta={meta}
      contentRef={contentRef}
      footer={next === undefined ? undefined : <NextInstructionCard {...next} />}
    >
      {/* The highlight must not be the only carrier of "which step is this". */}
      <p className="sr-only" aria-live="polite">
        {current === undefined
          ? 'No active instruction.'
          : `pc ${String(current.offset)} · ${current.mnemonic}${currentOperands === '' ? '' : ` ${currentOperands}`}`}
      </p>

      <div
        className="relative px-[10px]"
        onMouseLeave={() => {
          setHoveredIndex(undefined);
        }}
      >
        <BranchGutter
          instructions={instructions}
          currentIndex={currentIndex < 0 ? undefined : currentIndex}
          hoveredIndex={hoveredIndex}
        />

        <ol className="pl-[26px]">
          {instructions.map((instruction, index) => {
            const isCurrent = index === currentIndex;
            const isUnsupported = instruction.unsupported === true;
            const isDead = deadOffsets?.has(instruction.offset) === true;
            const operands = formatOperands(instruction);
            const comment = comments?.get(instruction.offset);

            return (
              <li
                key={instruction.offset}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={isCurrent ? 'current-instruction' : 'instruction'}
                data-offset={instruction.offset}
                onMouseEnter={() => {
                  setHoveredIndex(index);
                }}
                className={`${CODE_ROW} ${
                  isCurrent ? 'bg-accent/[0.22] text-accent-text shadow-current' : 'text-white/60'
                } ${isUnsupported ? 'opacity-75' : isDead ? 'opacity-45' : ''}`}
              >
                <span
                  className={`w-7 shrink-0 text-right select-none ${
                    isCurrent ? 'text-accent-dim' : 'text-white/24'
                  }`}
                >
                  {instruction.offset}
                </span>
                {/* Mnemonics are never colour-coded: the listing has to read as one block. */}
                <span className={`w-[106px] shrink-0 ${isUnsupported ? 'text-error' : ''}`}>
                  {instruction.mnemonic}
                </span>
                {operands === '' ? null : (
                  <span className={isCurrent ? undefined : 'text-accent-dim'}>{operands}</span>
                )}
                {comment === undefined ? null : (
                  <span className={isCurrent ? 'opacity-70' : 'text-white/32'}>{comment}</span>
                )}
                <span className="grow" />
                {isUnsupported ? <Pill tone="error">unsupported</Pill> : null}
              </li>
            );
          })}

          {truncatedAtOffset === undefined ? null : (
            <li className={`${CODE_ROW} text-white/24`}>… not decoded</li>
          )}
        </ol>
      </div>
    </Panel>
  );
}
