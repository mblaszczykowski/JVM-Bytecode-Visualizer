import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import {
  NO_EXTERNALS,
  NO_HEAP,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { describeValue } from '../../services/views/heap-view';

import { useRowNavigation } from '../../hooks/useRowNavigation';

import { OriginButton } from '../ui/OriginButton';
import { EmptyState, Panel } from './Panel';
import { ReferenceChip } from '../ui/ReferenceChip';
import { PANEL_INSET } from '../ui/rhythm';

interface OperandStackPanelProps {
  readonly frame: StackFrame | undefined;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly frameIndex?: number;
  readonly annotations?: readonly (string | undefined)[] | undefined;
  readonly onSeekToStep?: ((step: number) => void) | undefined;
}

const BASE_LINE = 'h-px flex-1 bg-line';

const LABEL_COLUMN = 'w-[30px] shrink-0 text-legend tracking-[0.1em]';

export function OperandStackPanel({
  frame,
  frameIndex = 0,
  annotations,
  heap = NO_HEAP,
  externals = NO_EXTERNALS,
  onSeekToStep,
}: OperandStackPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const duration = reduced ? 0 : 0.16;

  const traceable = (frame?.operandStack ?? [])
    .map((_, index) => index)
    .filter((index) => frame?.operandOrigins[index] !== undefined)
    .reverse();
  const origins = useRowNavigation(traceable.length, 0, 'data-origin-row');
  const originRow = new Map(traceable.map((index, position) => [index, position]));

  if (frame === undefined) {
    return (
      <Panel title="Operand stack" term="operand-stack" meta="–" variant="state" className="grow">
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
      term="operand-stack"
      meta={`height ${String(operandStack.length)}`}
      variant="state"
      className="grow"
    >
      <ol className={`flex flex-col gap-0.5 ${PANEL_INSET}`}>
        <AnimatePresence initial={false} mode="popLayout">
          {operandStack
            .map((value, index) => ({ value, index }))
            .reverse()
            .map(({ value, index }) => {
              const isTop = index === topIndex;
              const annotation = annotations?.[index];
              const kind = frame.operandKinds[index];
              const isReference = kind === 'ref' || kind === 'external';
              const label = isReference
                ? describeValue(kind, value, heap, externals)
                : String(value);
              const origin = frame.operandOrigins[index];
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
                    className={`flex flex-1 items-center gap-3 rounded-row px-2.5 py-1.5 ${
                      isTop ? 'now-row text-accent-text' : 'bg-raised text-fg-2'
                    }`}
                  >
                    {isReference ? (
                      <ReferenceChip label={label} onAccent={isTop} />
                    ) : (
                      <span className="font-mono text-body">{value}</span>
                    )}
                    <span className="grow" />
                    {origin === undefined ||
                    originPosition === undefined ||
                    onSeekToStep === undefined ? null : (
                      <OriginButton
                        step={origin}
                        sentence={`${label} was pushed`}
                        testId="operand-origin"
                        row={originPosition}
                        anchorRow={origins.anchorIndex}
                        onSeekToStep={onSeekToStep}
                        onKeyDown={origins.onKeyDown}
                      />
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

      <div className={`flex items-center gap-2 pt-1.5 ${PANEL_INSET}`}>
        <span className={`${LABEL_COLUMN} text-fg-3`}>BASE</span>
        <span className={BASE_LINE} />
      </div>
    </Panel>
  );
}
