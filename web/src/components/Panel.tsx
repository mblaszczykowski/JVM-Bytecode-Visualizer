import { type ReactNode, useId } from 'react';

import { PANEL } from './theme';

interface PanelProps {
  /** Widoczny nagłówek panelu; jednocześnie dostępna nazwa regionu. */
  readonly title: string;
  /** Metadane po prawej stronie nagłówka (nazwa pliku, sygnatura metody, głębokość stosu). */
  readonly meta: ReactNode;
  readonly children: ReactNode;
}

/**
 * Wspólna rama paneli: nagłówek + samodzielnie skrolująca treść.
 * `min-h-0` na obu poziomach jest wymagane, żeby treść nie rozpychała siatki layoutu.
 */
export function Panel({ title, meta, children }: PanelProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`flex min-h-0 flex-1 flex-col ${PANEL}`}>
      <header className="flex shrink-0 items-baseline justify-between gap-3 px-[18px] pt-[14px] pb-[10px]">
        <h2 id={headingId} className="text-[11.5px] font-semibold text-white/55">
          {title}
        </h2>
        <span className="truncate font-mono text-[11px] text-white/30">{meta}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto pb-2">{children}</div>
    </section>
  );
}
