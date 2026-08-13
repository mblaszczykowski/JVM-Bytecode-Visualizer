import type { ReactNode, RefObject } from 'react';

import { glossaryTermForPanel } from '../../services/glossary';

import { GlossaryButton } from '../chrome/GlossaryButton';

export type PanelVariant = 'code' | 'state';

interface PanelProps {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly titleControl?: ReactNode;
  readonly variant?: PanelVariant;
  readonly footer?: ReactNode;
  readonly contentRef?: RefObject<HTMLDivElement> | undefined;
  readonly scrolls?: boolean;
  readonly bodyClassName?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

const SURFACE: Record<PanelVariant, string> = {
  code: 'rounded-panel bg-ink shadow-panel-ink',
  state: '',
};

export function Panel({
  title,
  meta,
  titleControl,
  variant = 'code',
  footer,
  contentRef,
  scrolls = true,
  bodyClassName = '',
  className = '',
  children,
}: PanelProps) {
  const body = scrolls
    ? 'focus-ring scroll-visible min-h-0 flex-initial overflow-auto'
    : 'shrink-0';
  const term = glossaryTermForPanel(title);

  return (
    <section
      role="region"
      aria-label={title}
      className={`flex min-h-0 flex-col ${SURFACE[variant]} ${className}`}
    >
      <header
        className={`flex shrink-0 justify-between gap-3 px-3 pt-2.5 pb-1.5 ${
          titleControl === undefined ? 'items-baseline' : 'items-center'
        }`}
      >
        <h2 className="sr-only">{title}</h2>
        <span className="flex min-w-0 items-center gap-1.5">
          {titleControl ?? (
            <span aria-hidden="true" className="text-title font-medium text-fg">
              {title}
            </span>
          )}
          {term === undefined ? null : <GlossaryButton term={term} />}
        </span>
        <span className="truncate font-mono text-meta text-fg-3">{meta}</span>
      </header>

      <div
        ref={contentRef}
        tabIndex={scrolls ? 0 : undefined}
        data-scroll-region={scrolls ? '' : undefined}
        className={`${body} ${bodyClassName}`}
      >
        {children}
      </div>

      {footer === undefined ? null : <div className="shrink-0 px-3 pt-2 pb-2.5">{footer}</div>}
    </section>
  );
}

interface EmptyStateProps {
  readonly status: string;
  readonly detail: ReactNode;
}

export function EmptyState({ status, detail }: EmptyStateProps) {
  return (
    <div className="px-2.5 pb-0.5">
      <p className="text-label text-fg-2">{status}</p>
      <p className="mt-0.5 max-w-[46ch] text-body text-fg-3">{detail}</p>
    </div>
  );
}
