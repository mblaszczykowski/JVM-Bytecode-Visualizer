import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { HeapObject, StackFrame } from '../core/interpreter/types';

import { referenceLabel } from './heap-view';
import { EmptyState, Panel } from './Panel';
import { ReferenceChip } from './ui/ReferenceChip';
import { useRowNavigation } from './useRowNavigation';

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
  /**
   * Follow a cell back to the step that pushed it. Omitted, the origins stay data the panel
   * does not offer to act on and no cell grows a control.
   */
  readonly onSeekToStep?: ((step: number) => void) | undefined;
}

/**
 * Without a visible floor the list reads as cut off rather than as a stack. A solid hairline
 * rather than the dashed rule that was here: the dashes were the fussiest three pixels on the
 * screen, and a floor does not need to be decorated to be understood as a floor.
 */
const BASE_LINE = 'h-px flex-1 bg-line';

const LABEL_COLUMN = 'w-[30px] shrink-0 text-legend tracking-[0.1em]';

/**
 * Where a value came from is not what the machine is doing now, so it is deliberately the
 * quietest thing in the row: no fill until it is pointed at, one notch under the annotation,
 * and identical on the top cell and below it — a treatment that changed with the state would
 * read as a second accent (design §12).
 */
const ORIGIN_BUTTON =
  'focus-ring shrink-0 rounded-[4px] px-[4px] font-ui text-micro text-fg-3 transition-colors duration-150 hover:bg-raised-active hover:text-fg';

/** Stable identity for the int-only runs, which never hand the panel a heap of their own. */
const NO_HEAP: readonly HeapObject[] = [];

export function OperandStackPanel({
  frame,
  frameIndex = 0,
  annotations,
  heap = NO_HEAP,
  onSeekToStep,
}: OperandStackPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const duration = reduced ? 0 : 0.16;

  /**
   * Stack indices that know where they came from, ordered top-first like the list itself, so
   * Up/Down move the way the cells are drawn. Built before the empty branch below because the
   * roving tabindex over them is a hook.
   *
   * A snapshot is the state *before* its instruction runs, so an origin is always a step
   * strictly earlier than the one on screen: following one can never be a jump to where the
   * reader already is, and there is no no-op case to suppress.
   */
  const traceable = (frame?.operandStack ?? [])
    .map((_, index) => index)
    .filter((index) => frame?.operandOrigins?.[index] !== undefined)
    .reverse();
  const origins = useRowNavigation(traceable.length, 0, 'data-origin-row');
  const originRow = new Map(traceable.map((index, position) => [index, position]));

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
      <ol className="flex flex-col gap-[3px] px-[8px]">
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
              const origin = frame.operandOrigins?.[index];
              const originPosition = originRow.get(index);

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
                    className={`flex flex-1 items-center gap-3 rounded-row px-[10px] py-[6px] ${
                      isTop ? 'now-row text-accent-text' : 'bg-raised text-fg-2'
                    }`}
                  >
                    {isReference ? (
                      <ReferenceChip heap={heap} handle={value} onAccent={isTop} />
                    ) : (
                      <span className="font-mono text-body">{value}</span>
                    )}
                    <span className="grow" />
                    {/* Left of the annotation, so the annotations keep their column at the
                        edge of the row rather than jittering with the width of a step number. */}
                    {origin === undefined ||
                    originPosition === undefined ||
                    onSeekToStep === undefined ? null : (
                      <button
                        type="button"
                        data-testid="operand-origin"
                        data-origin-row={originPosition}
                        tabIndex={originPosition === origins.anchorIndex ? 0 : -1}
                        aria-label={`Go to step ${String(origin + 1)}, where ${
                          isReference ? referenceLabel(heap, value) : String(value)
                        } was pushed`}
                        onClick={() => {
                          onSeekToStep(origin);
                        }}
                        onKeyDown={(event) => {
                          origins.onKeyDown(event, originPosition);
                        }}
                        className={ORIGIN_BUTTON}
                      >
                        {/* 1-based, like the step counter and the shareable link: the
                            history is indexed from 0 but nothing the reader sees is. */}
                        {`from ${String(origin + 1)}`}
                      </button>
                    )}
                    {annotation === undefined ? null : (
                      <span
                        className={`shrink-0 font-ui text-micro ${
                          isTop ? 'text-accent-soft' : 'text-fg-3'
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

      <div className="flex items-center gap-2 px-[8px] pt-[6px]">
        <span className={`${LABEL_COLUMN} text-fg-3`}>BASE</span>
        <span className={BASE_LINE} />
      </div>
    </Panel>
  );
}
