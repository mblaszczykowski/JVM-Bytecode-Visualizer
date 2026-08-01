import { Fragment, useState } from 'react';

import type { Instruction } from '../core/disassembler/types';

import { BranchGutter } from './BranchGutter';
import {
  constantIndexOf,
  formatOperands,
  operandTokens,
  type OperandToken,
} from './bytecode-format';
import { CurrentRowHighlight } from './CurrentRowHighlight';
import { GlossaryLink } from './GlossaryTrigger';
import { NextInstructionCard, type NextInstructionCardProps } from './NextInstructionCard';
import { Panel } from './Panel';
import { CODE_ROW } from './rhythm';
import { Pill } from './ui/Pill';
import { useRowNavigation, type RowNavigation } from './useRowNavigation';
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
  /** What each mnemonic does, regardless of this run — the tooltip on any row. */
  readonly help?: ReadonlyMap<string, string> | undefined;
  /** First step of the run that stood at each offset; a row without one cannot be sought to. */
  readonly stepForOffset?: ReadonlyMap<number, number> | undefined;
  readonly onSeek?: ((step: number) => void) | undefined;
  /**
   * Constant pool index the reader is following. Every `#n` naming it is marked, and with no
   * pc to follow the listing scrolls to the first of them.
   */
  readonly selectedConstant?: number | undefined;
  /** Follow a `#n` operand into the constant pool table; omitted, the operands stay text. */
  readonly onSelectConstant?: ((index: number) => void) | undefined;
  /** Slide the highlight between instructions; switched off above 4× playback. */
  readonly animateHighlight?: boolean;
  /** Silences the live region during playback — one announcement per tick is unusable. */
  readonly isPlaying?: boolean;
  readonly className?: string;
}

interface ConstantLinkProps {
  readonly token: OperandToken;
  readonly index: number;
  /** Position of this link among the listing's links — the roving tabindex counts these. */
  readonly position: number;
  readonly navigation: RowNavigation;
  readonly isFollowed: boolean;
  readonly isCurrentRow: boolean;
  readonly onSelect: (index: number) => void;
}

/**
 * A `#n` operand as what it is: a lookup into a table the reader can open. It sits above the
 * row's seek overlay (`z-10`) so the click lands here, and its horizontal padding is cancelled
 * by an equal negative margin — the row is 26px of fixed rhythm and a link may not widen it.
 *
 * The followed entry wears the pool-reference grammar of design §2.4 rather than the pc
 * highlight: two accents claiming "current" in one row would read as one thing.
 */
function ConstantLink({
  token,
  index,
  position,
  navigation,
  isFollowed,
  isCurrentRow,
  onSelect,
}: ConstantLinkProps) {
  const tone = isFollowed
    ? 'bg-accent/[0.28] text-accent-soft'
    : isCurrentRow
      ? 'hover:bg-white/15'
      : 'text-accent-dim hover:bg-white/10';

  return (
    <button
      type="button"
      data-constant-row={position}
      data-constant-index={index}
      tabIndex={position === navigation.anchorIndex ? 0 : -1}
      aria-label={`Show constant pool entry #${String(index)}`}
      onClick={() => {
        onSelect(index);
      }}
      onKeyDown={(event) => {
        navigation.onKeyDown(event, position);
      }}
      className={`focus-ring relative z-10 -mx-[4px] rounded-[4px] px-[4px] transition-colors ${tone}`}
    >
      {token.text}
    </button>
  );
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
  help,
  stepForOffset,
  onSeek,
  selectedConstant,
  onSelectConstant,
  animateHighlight = false,
  isPlaying = false,
  className = '',
}: BytecodePanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const currentIndex = instructions.findIndex(
    (instruction) => instruction.offset === currentOffset,
  );
  const current = currentIndex < 0 ? undefined : instructions[currentIndex];

  // Instruction indices that name a pool entry, so the `#n` links form a list of their own:
  // one tab stop for the whole listing rather than one per instruction.
  const constantRows = instructions
    .map((instruction, index) => ({ index, constant: constantIndexOf(instruction) }))
    .filter((row): row is { index: number; constant: number } => row.constant !== undefined);
  const followedRow = constantRows.findIndex((row) => row.constant === selectedConstant);
  const constantNav = useRowNavigation(
    constantRows.length,
    followedRow < 0 ? undefined : followedRow,
    'data-constant-row',
  );

  // A pc always wins the scroll: it moves on its own and the reader is watching it. The
  // followed constant only drives it where there is no run to follow.
  const followedIndex = constantRows[followedRow]?.index;
  const constantPositionOf = new Map(constantRows.map((row, position) => [row.index, position]));
  const contentRef = useScrollFollow(currentIndex < 0 ? followedIndex : currentIndex);
  const rows = useRowNavigation(instructions.length, currentIndex < 0 ? undefined : currentIndex);

  /**
   * `(I)I` is the header's most cryptic three characters and the reader meets the notation
   * here first, so the notation itself is the way to the explanation of it.
   */
  const meta = (
    <>
      {methodName}
      <GlossaryLink term="descriptor" text={methodDescriptor} />
      {` · max ${String(maxStack)}/${String(maxLocals)}`}
    </>
  );
  const currentOperands = current === undefined ? '' : formatOperands(current);

  return (
    <Panel
      title="Bytecode"
      meta={meta}
      contentRef={contentRef}
      className={className}
      footer={next === undefined ? undefined : <NextInstructionCard {...next} />}
    >
      {/* The highlight must not be the only carrier of "which step is this". */}
      <p className="sr-only" aria-live={isPlaying ? 'off' : 'polite'}>
        {current === undefined
          ? 'No active instruction.'
          : `pc ${String(current.offset)} · ${current.mnemonic}${currentOperands === '' ? '' : ` ${currentOperands}`}`}
      </p>

      <div
        className="relative px-[10px]"
        onMouseLeave={() => {
          setActiveIndex(undefined);
        }}
      >
        {/* Arcs follow the pointer and the keyboard alike, so they are not a mouse-only story. */}
        <BranchGutter
          instructions={instructions}
          currentIndex={currentIndex < 0 ? undefined : currentIndex}
          hoveredIndex={activeIndex}
        />

        {/* `isolate` keeps the highlight's negative z-index from sinking below the panel. */}
        <ol className="isolate pl-[26px]">
          {instructions.map((instruction, index) => {
            const isCurrent = index === currentIndex;
            const isUnsupported = instruction.unsupported === true;
            const isDead = deadOffsets?.has(instruction.offset) === true;
            const comment = comments?.get(instruction.offset);
            const explanation = help?.get(instruction.mnemonic);
            const step = stepForOffset?.get(instruction.offset);

            return (
              <li
                key={instruction.offset}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={isCurrent ? 'current-instruction' : 'instruction'}
                data-offset={instruction.offset}
                title={explanation}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
                className={`${CODE_ROW} ${isCurrent ? 'text-accent-text' : 'text-white/60'} ${
                  isUnsupported ? 'opacity-75' : isDead ? 'opacity-45' : ''
                }`}
              >
                {isCurrent ? (
                  <CurrentRowHighlight layoutId="pc-highlight" animate={animateHighlight} />
                ) : null}
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
                {instruction.operands.length === 0 ? null : (
                  <span>
                    {operandTokens(instruction).map((token, position) => (
                      // Operands are positional; the index is the only stable key they have.
                      <Fragment key={`${String(position)}:${token.text}`}>
                        {position === 0 ? null : <span className="text-white/32">, </span>}
                        {/*
                          Blue means "current state", so only operands that point elsewhere in
                          the class file are coloured — a slot or an immediate is just a number.
                          A pool index points at a row of a table that is on screen, so it is
                          the one operand that is also a link.
                        */}
                        {token.constantIndex === undefined || onSelectConstant === undefined ? (
                          <span
                            className={
                              isCurrent || !token.isReference ? undefined : 'text-accent-dim'
                            }
                          >
                            {token.text}
                          </span>
                        ) : (
                          <ConstantLink
                            token={token}
                            index={token.constantIndex}
                            position={constantPositionOf.get(index) ?? 0}
                            navigation={constantNav}
                            isFollowed={token.constantIndex === selectedConstant}
                            isCurrentRow={isCurrent}
                            onSelect={onSelectConstant}
                          />
                        )}
                      </Fragment>
                    ))}
                  </span>
                )}
                {comment === undefined ? null : (
                  <span className={isCurrent ? 'opacity-70' : 'text-white/32'}>{comment}</span>
                )}
                <span className="grow" />
                {isUnsupported ? <Pill tone="error">unsupported</Pill> : null}

                {step === undefined || onSeek === undefined ? null : (
                  <button
                    type="button"
                    data-row-index={index}
                    tabIndex={index === rows.anchorIndex ? 0 : -1}
                    title={explanation}
                    aria-label={`Go to pc ${String(instruction.offset)}, ${instruction.mnemonic}`}
                    onClick={() => {
                      onSeek(step);
                    }}
                    onKeyDown={(event) => {
                      rows.onKeyDown(event, index);
                    }}
                    onFocus={() => {
                      setActiveIndex(index);
                    }}
                    onBlur={() => {
                      setActiveIndex(undefined);
                    }}
                    // The row is already drawn; this only has to be the target you can hit.
                    className="focus-ring absolute inset-0 rounded-code"
                  />
                )}
              </li>
            );
          })}

          {truncatedAtOffset === undefined ? null : (
            <li className={`${CODE_ROW} text-white/55`}>… not decoded</li>
          )}
        </ol>
      </div>
    </Panel>
  );
}
