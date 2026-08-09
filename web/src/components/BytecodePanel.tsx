import { Fragment, useState } from 'react';

import type { ConstantPool } from '../core/classfile';
import type { Construct } from '../services/constructs';
import type { Instruction } from '../core/disassembler/types';

import { BranchGutter } from './BranchGutter';
import {
  constantIndexOf,
  describeStackEffect,
  formatOperands,
  operandTokens,
  stackEffectOf,
  type OperandToken,
  type StackEffect,
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
  readonly currentOffset: number | undefined;
  readonly constantPool?: ConstantPool | undefined;
  readonly constructs?: ReadonlyMap<number, Construct> | undefined;
  readonly comments?: ReadonlyMap<number, string> | undefined;
  readonly deadOffsets?: ReadonlySet<number> | undefined;
  readonly truncatedAtOffset?: number | undefined;
  readonly next?: NextInstructionCardProps | undefined;
  readonly help?: ReadonlyMap<string, string> | undefined;
  readonly stepForOffset?: ReadonlyMap<number, number> | undefined;
  readonly onSeek?: ((step: number) => void) | undefined;
  readonly selectedConstant?: number | undefined;
  readonly onSelectConstant?: ((index: number) => void) | undefined;
  readonly sourceLineForOffset?: ReadonlyMap<number, number> | undefined;
  readonly linkedLine?: number | undefined;
  readonly onLinkedLineChange?: ((line: number | undefined) => void) | undefined;
  readonly animateHighlight?: boolean;
  readonly isPlaying?: boolean;
  readonly className?: string;
}

interface ConstantLinkProps {
  readonly token: OperandToken;
  readonly index: number;
  readonly position: number;
  readonly navigation: RowNavigation;
  readonly isFollowed: boolean;
  readonly isCurrentRow: boolean;
  readonly onSelect: (index: number) => void;
}

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
    ? 'bg-accent/25 text-accent-text'
    : isCurrentRow
      ? 'hover:bg-raised-active'
      : 'text-accent-dim hover:bg-raised-active';

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
      className={`focus-ring relative z-10 -mx-1 rounded-[4px] px-1 transition-colors duration-150 ${tone}`}
    >
      {token.text}
    </button>
  );
}

interface StackEffectCellProps {
  readonly effect: StackEffect | 'varies' | undefined;
  readonly isCurrent: boolean;
}

function StackEffectCell({ effect, isCurrent }: StackEffectCellProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="stack-effect"
      className={`flex shrink-0 gap-1 text-micro select-none ${
        isCurrent ? 'text-accent-dim' : 'text-fg-3'
      }`}
    >
      {effect === 'varies' ? (
        <span className="w-[44px] text-right">varies</span>
      ) : (
        <>
          <span className="w-[20px] text-right">
            {effect === undefined || effect.pops === 0 ? '' : `−${String(effect.pops)}`}
          </span>
          <span className="w-[20px] text-right">
            {effect === undefined || effect.pushes === 0 ? '' : `+${String(effect.pushes)}`}
          </span>
        </>
      )}
    </span>
  );
}

export function BytecodePanel({
  methodName,
  methodDescriptor,
  maxStack,
  maxLocals,
  instructions,
  currentOffset,
  constantPool,
  constructs,
  comments,
  deadOffsets,
  truncatedAtOffset,
  next,
  help,
  stepForOffset,
  onSeek,
  selectedConstant,
  onSelectConstant,
  sourceLineForOffset,
  linkedLine,
  onLinkedLineChange,
  animateHighlight = false,
  isPlaying = false,
  className = '',
}: BytecodePanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const pointAt = (index: number | undefined) => {
    setActiveIndex(index);
    if (onLinkedLineChange === undefined) {
      return;
    }
    const offset = index === undefined ? undefined : instructions[index]?.offset;
    onLinkedLineChange(offset === undefined ? undefined : sourceLineForOffset?.get(offset));
  };

  const currentIndex = instructions.findIndex(
    (instruction) => instruction.offset === currentOffset,
  );
  const current = currentIndex < 0 ? undefined : instructions[currentIndex];

  const constantRows = instructions
    .map((instruction, index) => ({ index, constant: constantIndexOf(instruction) }))
    .filter((row): row is { index: number; constant: number } => row.constant !== undefined);
  const followedRow = constantRows.findIndex((row) => row.constant === selectedConstant);
  const constantNav = useRowNavigation(
    constantRows.length,
    followedRow < 0 ? undefined : followedRow,
    'data-constant-row',
  );

  const followedIndex = constantRows[followedRow]?.index;
  const constantPositionOf = new Map(constantRows.map((row, position) => [row.index, position]));
  const contentRef = useScrollFollow(currentIndex < 0 ? followedIndex : currentIndex);
  const rows = useRowNavigation(instructions.length, currentIndex < 0 ? undefined : currentIndex);

  const meta = (
    <>
      {methodName}
      <GlossaryLink term="descriptor" text={methodDescriptor} />
      {` · max ${String(maxStack)}/${String(maxLocals)}`}
    </>
  );
  const currentOperands = current === undefined ? '' : formatOperands(current);
  const currentEffect =
    current === undefined || constantPool === undefined
      ? undefined
      : describeStackEffect(stackEffectOf(current, constantPool));

  return (
    <Panel
      title="Bytecode"
      meta={meta}
      contentRef={contentRef}
      className={className}
      footer={next === undefined ? undefined : <NextInstructionCard {...next} />}
    >
      <p className="sr-only" aria-live={isPlaying ? 'off' : 'polite'}>
        {current === undefined
          ? 'No active instruction.'
          : `pc ${String(current.offset)} · ${current.mnemonic}${currentOperands === '' ? '' : ` ${currentOperands}`}${currentEffect === undefined ? '' : ` · ${currentEffect}`}`}
      </p>

      <div
        className="relative px-2.5"
        onMouseLeave={() => {
          pointAt(undefined);
        }}
      >
        <BranchGutter
          instructions={instructions}
          currentIndex={currentIndex < 0 ? undefined : currentIndex}
          hoveredIndex={activeIndex}
        />

        {}
        <ol className="isolate pl-6">
          {instructions.map((instruction, index) => {
            const isCurrent = index === currentIndex;
            const isUnsupported = instruction.unsupported === true;
            const isDead = deadOffsets?.has(instruction.offset) === true;
            const comment = comments?.get(instruction.offset);
            const explanation = help?.get(instruction.mnemonic);
            const step = stepForOffset?.get(instruction.offset);
            const construct = constructs?.get(instruction.offset);
            const isLinked =
              !isCurrent &&
              linkedLine !== undefined &&
              sourceLineForOffset?.get(instruction.offset) === linkedLine;

            return (
              <li
                key={instruction.offset}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={isCurrent ? 'current-instruction' : 'instruction'}
                data-offset={instruction.offset}
                data-linked={isLinked ? 'true' : undefined}
                title={explanation}
                onMouseEnter={() => {
                  pointAt(index);
                }}
                className={`${CODE_ROW} ${
                  isCurrent ? 'text-accent-text' : isLinked ? 'bg-raised text-fg' : 'text-fg-2'
                } ${isUnsupported ? 'row-unsupported' : isDead ? 'row-unreached' : ''}`}
              >
                {isCurrent ? (
                  <CurrentRowHighlight layoutId="pc-highlight" animate={animateHighlight} />
                ) : null}
                <span
                  className={`w-7 shrink-0 text-right select-none ${
                    isCurrent ? 'text-accent-dim' : isLinked ? 'text-fg-3' : 'text-fg-3'
                  }`}
                >
                  {instruction.offset}
                </span>
                <span className={`w-[106px] shrink-0 ${isUnsupported ? 'text-error' : ''}`}>
                  {instruction.mnemonic}
                </span>
                {instruction.operands.length === 0 ? null : (
                  <span>
                    {operandTokens(instruction).map((token, position) => (
                      <Fragment key={`${String(position)}:${token.text}`}>
                        {position === 0 ? null : <span className="text-fg-3">, </span>}
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
                  <span className={isCurrent ? 'text-accent-dim' : 'text-fg-3'}>{comment}</span>
                )}
                <span className="grow" />
                {construct === undefined ? null : (
                  <span
                    data-testid="construct-tag"
                    data-construct={construct.label}
                    title={construct.detail}
                    className="shrink-0 text-micro text-fg-3 select-none"
                  >
                    {construct.label}
                  </span>
                )}
                {isUnsupported ? <Pill tone="error">unsupported</Pill> : null}
                {}
                {constantPool === undefined ? null : (
                  <StackEffectCell
                    effect={stackEffectOf(instruction, constantPool)}
                    isCurrent={isCurrent}
                  />
                )}

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
                      pointAt(index);
                    }}
                    onBlur={() => {
                      pointAt(undefined);
                    }}
                    className="focus-ring absolute inset-0 rounded-code"
                  />
                )}
              </li>
            );
          })}

          {truncatedAtOffset === undefined ? null : (
            <li className={`${CODE_ROW} text-fg-3`}>… not decoded</li>
          )}
        </ol>
      </div>
    </Panel>
  );
}
