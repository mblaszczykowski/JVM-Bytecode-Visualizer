import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'accent' | 'error' | 'warn';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-raised text-fg-3',
  accent: 'bg-accent-fill text-accent-text',
  error: 'bg-error-wash text-error',
  warn: 'bg-warn-wash text-warn',
};

interface PillProps {
  readonly tone?: PillTone;
  readonly title?: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Pill({ tone = 'neutral', title, className = '', children }: PillProps) {
  return (
    <span
      title={title}
      className={`shrink-0 self-center rounded-chip px-1.5 py-px text-micro leading-none ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
