import type { ReactNode, RefObject } from 'react';

import { glossaryTermForPanel } from '../services/glossary';

import { GlossaryButton } from './GlossaryTrigger';

export type PanelVariant = 'code' | 'state';

interface PanelProps {
  /** Accessible name of the region; repeated visually next to the metadata. */
  readonly title: string;
  /** Right-hand metadata: file name, method signature, stack depth. */
  readonly meta?: ReactNode;
  /**
   * Replaces the visible title with a control that names the panel — the Source/Class switch
   * in the left column. The `<h2>` still carries `title`, so the region keeps its name whether
   * or not the switch is on screen.
   */
  readonly titleControl?: ReactNode;
  /**
   * `code` is a pane of ink floating on the glass; `state` is a section inside the State
   * column, which owns the surface for all of its panels.
   */
  readonly variant?: PanelVariant;
  readonly footer?: ReactNode;
  /** Scroll container, so the owning panel can drive `scrollTop` itself. */
  readonly contentRef?: RefObject<HTMLDivElement> | undefined;
  /**
   * Whether the body scrolls on its own. A scrollable body must be reachable by keyboard,
   * so it takes a tab stop.
   */
  readonly scrolls?: boolean;
  /** Extra classes on the scroll container, e.g. the Source panel's right-edge fade. */
  readonly bodyClassName?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Content is ink, chrome is glass. A listing sits on a matte surface darker than the sheet it
 * floats on, so it reads as the thing being looked at rather than as one more translucent card;
 * the toolbar and the transport keep the glass and stay light.
 */
const SURFACE: Record<PanelVariant, string> = {
  code: 'rounded-panel bg-ink shadow-panel-ink',
  state: '',
};

/**
 * Shared panel frame: header, independently scrolling body, optional footer.
 * `min-h-0` at both levels keeps panel content from stretching the surrounding grid.
 */
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
  // The body takes the section it is given and no more. How much that is belongs one level up:
  // in the column, which hands each section the height its content asks for.
  const body = scrolls ? 'focus-ring scroll-visible min-h-0 flex-1 overflow-auto' : 'shrink-0';
  /**
   * The moment someone asks what the operand stack is, they are looking at the panel headed
   * "Operand stack" — so the way to the explanation is in that header, not only in a menu.
   */
  const term = glossaryTermForPanel(title);

  return (
    <section
      role="region"
      aria-label={title}
      className={`flex min-h-0 flex-col ${SURFACE[variant]} ${className}`}
    >
      <header
        className={`flex shrink-0 justify-between gap-3 px-[18px] pt-[14px] pb-[10px] ${
          titleControl === undefined ? 'items-baseline' : 'items-center'
        }`}
      >
        <h2 className="sr-only">{title}</h2>
        <span className="flex min-w-0 items-center gap-[6px]">
          {titleControl ?? (
            <span aria-hidden="true" className="text-title font-medium text-white/80">
              {title}
            </span>
          )}
          {term === undefined ? null : <GlossaryButton term={term} />}
        </span>
        <span className="truncate font-mono text-meta text-white/32">{meta}</span>
      </header>

      <div
        ref={contentRef}
        tabIndex={scrolls ? 0 : undefined}
        className={`${body} ${bodyClassName}`}
      >
        {children}
      </div>

      {footer === undefined ? null : (
        <div className="shrink-0 px-[14px] pt-[10px] pb-[14px]">{footer}</div>
      )}
    </section>
  );
}

interface EmptyStateProps {
  /** In the lower-case voice of the panel's own metadata: `empty`, `no active frame`. */
  readonly status: string;
  /** What would put something here. One sentence — the reader is watching a run, not reading. */
  readonly detail: ReactNode;
}

/**
 * Step 0 and the terminal snapshot are the frames people look at longest, and half the State
 * column is empty in both. A section with nothing in it keeps the row grammar of the rows it
 * would otherwise hold, and says what fills it rather than only that it is empty.
 */
export function EmptyState({ status, detail }: EmptyStateProps) {
  return (
    <div className="px-[10px] pb-[2px]">
      <div className="rounded-row px-[13px] py-[11px] shadow-row-outline">
        <p className="text-label text-white/65">{status}</p>
        <p className="mt-[3px] text-body text-white/45">{detail}</p>
      </div>
    </div>
  );
}
