import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'accent' | 'error' | 'warn';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-raised text-fg-3',
  accent: 'bg-accent/25 text-accent-text',
  error: 'bg-error/12 text-error',
  warn: 'bg-warn/15 text-warn',
};

interface PillProps {
  readonly tone?: PillTone;
  readonly title?: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Inline label used inside code rows and list rows. `leading-none` plus a sub-pixel vertical
 * padding is deliberate: anything taller grows the line box and breaks the 26px row rhythm.
 */
export function Pill({ tone = 'neutral', title, className = '', children }: PillProps) {
  return (
    <span
      title={title}
      className={`shrink-0 self-center rounded-[4px] px-[6px] py-px text-micro leading-none ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
