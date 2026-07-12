import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'accent' | 'error' | 'warn';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-white/10 text-white/55',
  accent: 'bg-accent/[0.28] text-accent-soft',
  error: 'bg-error/[0.12] text-error',
  warn: 'bg-warn/[0.14] text-warn',
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
      className={`shrink-0 self-center rounded-full px-2 py-px text-[10px] leading-none ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
