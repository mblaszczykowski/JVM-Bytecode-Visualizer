import type { ReactNode } from 'react';

interface AppShellProps {
  readonly toolbar: ReactNode;
  /** The three panels of the grid: Source, Bytecode, State. */
  readonly children: ReactNode;
  readonly footer: ReactNode;
  /** Drawn over everything while a file is dragged across the window. */
  readonly isDropTarget?: boolean;
}

/**
 * The application frame. It fills the viewport edge to edge — there is no sheet, no margin
 * and no corner radius, because the thing being framed is a listing of every instruction a
 * program ran, and 56px of decorative padding is four rows of it that nobody gets to read.
 *
 * `dvh` rather than `vh`: on mobile the address bar makes `vh` overshoot the visible area.
 *
 * The grid drops to a single cell below 768px; the caller shows one panel at a time.
 */
export function AppShell({ toolbar, children, footer, isDropTarget = false }: AppShellProps) {
  return (
    <div data-testid="app-shell" className="relative flex h-dvh min-h-0 flex-col bg-app">
      {/*
        The whole frame is the drop target, so a file does not have to be aimed at the small
        zone. Pointer events stay off: the drop is handled on the window, not here.
      */}
      {isDropTarget ? (
        <div
          data-testid="drop-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-app/80 shadow-[inset_0_0_0_1px_var(--color-accent)]"
        >
          <p className="rounded-card bg-accent/12 px-[16px] py-[10px] text-body text-accent-text shadow-current-strong">
            Drop a .class file to run it
          </p>
        </div>
      ) : null}

      {toolbar}

      {/*
        Explicit `minmax(0, …)` on every track: with the automatic minimum, a long line of
        source or a wide disassembly row sizes its column to its content and pushes the grid
        past the frame in both directions instead of scrolling inside the panel.
      */}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-[10px] px-[10px] pt-[10px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_minmax(0,34%)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_296px] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        {children}
      </main>

      {/* A landmark, so the transport is not orphaned page content for a screen reader. */}
      <footer className="sticky bottom-0 shrink-0">{footer}</footer>
    </div>
  );
}
