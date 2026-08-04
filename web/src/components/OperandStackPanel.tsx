import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { HeapObject, StackFrame } from '../core/interpreter/types';

import { EmptyState, Panel } from './Panel';
import { ReferenceChip } from './ui/ReferenceChip';

interface OperandStackPanelProps {
  /** Top frame of the current snapshot; `undefined` when the call stack is empty. */
  readonly frame: StackFrame | undefined;
  /** Objects of the current snapshot, so a `ref` cell can name what it points at. */
  readonly heap?: readonly HeapObject[] | undefined;
  /**
   * Depth of the frame the cells belong to. It is part of the cell keys, so a value left on
   * a caller's stack never animates into a same-valued cell of the callee.
   */
  readonly frameIndex?: number;
  /**
   * Role of each cell, indexed like `StackFrame.operandStack` — what the current instruction
   * is about to do with the value, or which later instruction is waiting for it.
   */
  readonly annotations?: readonly (string | undefined)[] | undefined;
}

/** Without a visible floor the list reads as cut off rather than as a stack. */
const BASE_LINE =
  'h-px flex-1 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.16)_0_5px,transparent_5px_11px)]';

const LABEL_COLUMN = 'w-[30px] shrink-0 text-legend tracking-[0.1em]';

/** Stable identity for the int-only runs, which never hand the panel a heap of their own. */
const NO_HEAP: readonly HeapObject[] = [];

export function OperandStackPanel({
  frame,
  frameIndex = 0,
  annotations,
  heap = NO_HEAP,
}: OperandStackPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const duration = reduced ? 0 : 0.16;

  if (frame === undefined) {
    return (
      <Panel title="Operand stack" meta="—" variant="state" className="grow">
        <EmptyState
          status="no active frame"
          detail="An operand stack belongs to a frame, and the run has none left."
        />
      </Panel>
    );
  }

  const { operandStack } = frame;
  const topIndex = operandStack.length - 1;

  return (
    <Panel
      title="Operand stack"
      meta={`height ${String(operandStack.length)}`}
      variant="state"
      className="grow"
    >
      {/* The list stays mounted even when empty: unmounting it would cut the exit short. */}
      <ol className="flex flex-col gap-[5px] px-[10px]">
        {/* `popLayout` takes the leaving cell out of flow, so the rows below never jump. */}
        <AnimatePresence initial={false} mode="popLayout">
          {operandStack
            .map((value, index) => ({ value, index }))
            .reverse()
            .map(({ value, index }) => {
              const isTop = index === topIndex;
              const annotation = annotations?.[index];
              // A reference is a heap handle; the array behind it is what the cell is about.
              const isReference = frame.operandKinds?.[index] === 'ref';

              return (
                <motion.li
                  key={`${String(frameIndex)}:${String(index)}`}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration, ease: 'easeOut' }}
                  data-testid="operand-cell"
                  data-stack-index={index}
                  className="flex items-center gap-2"
                >
                  <span className={`${LABEL_COLUMN} text-accent-dim`}>{isTop ? 'TOP' : ''}</span>
                  <span
                    className={`flex flex-1 items-center gap-3 rounded-row px-[13px] py-[9px] ${
                      isTop
                        ? 'bg-accent/[0.22] text-accent-text shadow-current'
                        : 'bg-white/5 text-white/75'
                    }`}
                  >
                    {isReference ? (
                      <ReferenceChip heap={heap} handle={value} onAccent={isTop} />
                    ) : (
                      <span className="font-mono text-brand">{value}</span>
                    )}
                    <span className="grow" />
                    {annotation === undefined ? null : (
                      <span
                        className={`shrink-0 font-ui text-micro ${
                          isTop ? 'text-accent-soft' : 'text-white/55'
                        }`}
                      >
                        {annotation}
                      </span>
                    )}
                  </span>
                </motion.li>
              );
            })}
        </AnimatePresence>
      </ol>
      {operandStack.length === 0 ? (
        <EmptyState
          status="empty"
          detail="Values appear here as instructions push them, and are taken off the top."
        />
      ) : null}

      <div className="flex items-center gap-2 px-[10px] pt-2">
        <span className={`${LABEL_COLUMN} text-white/25`}>BASE</span>
        <span className={BASE_LINE} />
      </div>
    </Panel>
  );
}
