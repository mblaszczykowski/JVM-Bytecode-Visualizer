import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';

interface OperandStackPanelProps {
  /** Top frame of the current snapshot; `undefined` when the call stack is empty. */
  readonly frame: StackFrame | undefined;
  /**
   * Role of each cell, indexed like `StackFrame.operandStack` — what the current instruction
   * is about to do with the value, or which later instruction is waiting for it.
   */
  readonly annotations?: readonly (string | undefined)[] | undefined;
}

/** Without a visible floor the list reads as cut off rather than as a stack. */
const BASE_LINE =
  'h-px flex-1 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.16)_0_5px,transparent_5px_11px)]';

const LABEL_COLUMN = 'w-[30px] shrink-0 text-[9px] tracking-[0.1em]';

export function OperandStackPanel({ frame, annotations }: OperandStackPanelProps) {
  if (frame === undefined) {
    return (
      <Panel title="Operand stack" meta="—" variant="state" contentClassName="shrink-0">
        <p className="px-[18px] py-3 text-[12px] text-white/30">No active frame.</p>
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
      contentClassName="shrink-0"
    >
      {operandStack.length === 0 ? (
        <p className="px-[23px] py-2 text-[12px] text-white/30">empty</p>
      ) : (
        <ol className="flex flex-col gap-[5px] px-[10px]">
          {operandStack
            .map((value, index) => ({ value, index }))
            .reverse()
            .map(({ value, index }) => {
              const isTop = index === topIndex;
              const annotation = annotations?.[index];

              return (
                <li
                  key={index}
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
                    <span className="font-mono text-[15px]">{value}</span>
                    <span className="grow" />
                    {annotation === undefined ? null : (
                      <span
                        className={`shrink-0 font-ui text-[10px] ${
                          isTop ? 'text-accent-soft' : 'text-white/35'
                        }`}
                      >
                        {annotation}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
        </ol>
      )}

      <div className="flex items-center gap-2 px-[10px] pt-2">
        <span className={`${LABEL_COLUMN} text-white/25`}>BASE</span>
        <span className={BASE_LINE} />
      </div>
    </Panel>
  );
}
