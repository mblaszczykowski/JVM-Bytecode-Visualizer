import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';
import { CURRENT_ROW, EMPTY_STATE } from './theme';

interface OperandStackPanelProps {
  /** Ramka wierzchnia bieżącego snapshotu; `undefined`, gdy stos wywołań jest pusty. */
  readonly frame: StackFrame | undefined;
}

/** Kreska zamykająca dno stosu — bez niej lista wygląda jak ucięta, a nie jak stos. */
const BASE_LINE =
  'h-px flex-1 bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.16)_0_5px,transparent_5px_11px)]';

export function OperandStackPanel({ frame }: OperandStackPanelProps) {
  if (frame === undefined) {
    return (
      <Panel title="Stos operandów" meta="—">
        <p className={EMPTY_STATE}>Brak aktywnej ramki.</p>
      </Panel>
    );
  }

  const { operandStack } = frame;
  const topIndex = operandStack.length - 1;

  return (
    <Panel title="Stos operandów" meta={`wysokość ${String(operandStack.length)}`}>
      {operandStack.length === 0 ? (
        <p className={EMPTY_STATE}>Stos pusty.</p>
      ) : (
        <ol className="flex flex-col gap-[5px] px-[10px]">
          {operandStack
            .map((value, index) => ({ value, index }))
            .reverse()
            .map(({ value, index }) => {
              const isTop = index === topIndex;

              return (
                <li
                  key={index}
                  data-testid="operand-cell"
                  data-stack-index={index}
                  className="flex items-center gap-2"
                >
                  <span className="w-8 shrink-0 text-[9px] tracking-[0.1em] text-[#6cb2ff]">
                    {isTop ? 'TOP' : ''}
                  </span>
                  <span
                    className={`flex-1 rounded-[12px] px-[13px] py-[9px] text-right font-mono text-[15px] ${
                      isTop ? CURRENT_ROW : 'bg-white/5 text-white/75'
                    }`}
                  >
                    {value}
                  </span>
                </li>
              );
            })}
        </ol>
      )}
      <div className="flex items-center gap-2 px-[10px] pt-2">
        <span className="w-8 shrink-0 text-[9px] tracking-[0.1em] text-white/25">BASE</span>
        <span className={BASE_LINE} />
      </div>
    </Panel>
  );
}
