import { Fragment } from 'react';

import type { EffectPill } from '../../services/derivations';

import { Pill } from '../ui/Pill';

export interface NextInstructionCardProps {
  readonly effects: readonly EffectPill[];
  readonly explanation: string;
  readonly cpChain?: readonly string[] | undefined;
}

export function NextInstructionCard({ effects, explanation, cpChain }: NextInstructionCardProps) {
  return (
    <div data-testid="next-instruction-card" className="rounded-card bg-raised px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-title font-medium text-fg">Next</span>
        {effects.map((effect) => (
          <Pill key={effect.label} tone="accent">
            {effect.label}
          </Pill>
        ))}
      </div>

      <p className="mt-1.5 text-label text-fg-2">{explanation}</p>

      {cpChain === undefined || cpChain.length === 0 ? null : (
        <div
          data-testid="cp-chain"
          className="mt-2 flex flex-wrap items-center gap-1 font-mono text-micro"
        >
          {cpChain.map((link, index) => (
            <Fragment key={link}>
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-fg-3">
                  →
                </span>
              )}
              <span className="rounded-chip bg-raised-active px-1.5 py-0.5 text-accent-soft">
                {link}
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
