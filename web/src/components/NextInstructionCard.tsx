import { Fragment } from 'react';

import { Pill } from './ui/Pill';

export interface StackEffect {
  /** Short label such as `pop 1` or `push frame`. */
  readonly label: string;
}

export interface NextInstructionCardProps {
  /** What the instruction does to the operand stack and the frame stack. */
  readonly effects: readonly StackEffect[];
  /** One sentence about what happens to the concrete values in the current snapshot. */
  readonly explanation: string;
  /**
   * Constant pool resolution chain for instructions with a CP operand, e.g.
   * `#7 → Methodref → #2 Class Factorial → #18 factorial:(I)I`.
   */
  readonly cpChain?: readonly string[] | undefined;
}

/**
 * Footer of the Bytecode panel: what the instruction under `pc` is about to do, spelled out
 * with the values from the current snapshot. Purely presentational — every string arrives
 * through props.
 */
export function NextInstructionCard({ effects, explanation, cpChain }: NextInstructionCardProps) {
  return (
    <div data-testid="next-instruction-card" className="rounded-card bg-raised px-[12px] py-[9px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-title font-medium text-fg">Next</span>
        {effects.map((effect) => (
          <Pill key={effect.label} tone="accent">
            {effect.label}
          </Pill>
        ))}
      </div>

      <p className="mt-[7px] text-label leading-[17px] text-fg-2">{explanation}</p>

      {cpChain === undefined || cpChain.length === 0 ? null : (
        <div
          data-testid="cp-chain"
          className="mt-[9px] flex flex-wrap items-center gap-[5px] font-mono text-micro"
        >
          {cpChain.map((link, index) => (
            <Fragment key={link}>
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-fg-3">
                  →
                </span>
              )}
              <span className="rounded-[4px] bg-raised-active px-[6px] py-0.5 text-accent-soft">
                {link}
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
