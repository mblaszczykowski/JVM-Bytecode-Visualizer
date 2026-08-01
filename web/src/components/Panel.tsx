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
   * `code` is a light pane floating on the glass; `state` is a section inside the State
   * column, which owns the surface for all three of its panels.
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
  /**
   * Whether the scrolling body fills the panel or is capped. `capped` is the State column,
   * where the sections share a fixed height and none may push the others off screen; `short`
   * is the same idea for the section that joins them last and has the least to say.
   */
  readonly bodyFill?: 'grow' | 'capped' | 'short';
  /** Extra classes on the scroll container, e.g. the Source panel's right-edge fade. */
  readonly bodyClassName?: string;
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
 * A capped body keeps its content height until the column runs out of room; from there it
 * gives way and scrolls, rather than pushing the section below it off the screen.
 */
const BODY_FILL = {
  grow: 'min-h-0 flex-1',
  capped: 'max-h-[240px] min-h-0',
  short: 'max-h-[150px] min-h-0',
} as const;

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
  bodyFill = 'grow',
  bodyClassName = '',
  className = '',
  children,
}: PanelProps) {
  const body = scrolls
    ? `focus-ring scroll-visible overflow-auto ${BODY_FILL[bodyFill]}`
    : 'shrink-0';
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
            <span aria-hidden="true" className={`text-[11.5px] font-semibold ${TITLE[variant]}`}>
              {title}
            </span>
          )}
          {term === undefined ? null : <GlossaryButton term={term} />}
        </span>
        <span className="truncate font-mono text-[11px] text-white/32">{meta}</span>
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
