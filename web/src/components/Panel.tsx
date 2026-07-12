import type { ReactNode, RefObject } from 'react';

export type PanelVariant = 'code' | 'state';

interface PanelProps {
  /** Accessible name of the region; repeated visually next to the metadata. */
  readonly title: string;
  /** Right-hand metadata: file name, method signature, stack depth. */
  readonly meta?: ReactNode;
  /**
   * `code` is a light pane floating on the glass; `state` is a section inside the State
   * column, which owns the surface for all three of its panels.
   */
  readonly variant?: PanelVariant;
  readonly footer?: ReactNode;
  /** Scroll container, so the owning panel can drive `scrollTop` itself. */
  readonly contentRef?: RefObject<HTMLDivElement> | undefined;
  readonly contentClassName?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

const SURFACE: Record<PanelVariant, string> = {
  code: 'rounded-panel bg-panel/[0.045] shadow-panel',
  state: '',
};

const TITLE: Record<PanelVariant, string> = {
  code: 'text-white/50',
  state: 'text-white/55',
};

/**
 * Shared panel frame: header, independently scrolling body, optional footer.
 * `min-h-0` at both levels keeps panel content from stretching the surrounding grid.
 */
export function Panel({
  title,
  meta,
  variant = 'code',
  footer,
  contentRef,
  contentClassName = 'min-h-0 flex-1 overflow-auto scroll-slim',
  className = '',
  children,
}: PanelProps) {
  return (
    <section
      role="region"
      aria-label={title}
      className={`flex min-h-0 flex-col ${SURFACE[variant]} ${className}`}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-3 px-[18px] pt-[14px] pb-[10px]">
        <h2 className="sr-only">{title}</h2>
        <span aria-hidden="true" className={`text-[11.5px] font-semibold ${TITLE[variant]}`}>
          {title}
        </span>
        <span className="truncate font-mono text-[11px] text-white/32">{meta}</span>
      </header>

      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>

      {footer === undefined ? null : (
        <div className="shrink-0 px-[14px] pt-[10px] pb-[14px]">{footer}</div>
      )}
    </section>
  );
}
