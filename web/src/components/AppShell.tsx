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
 * The single sheet of glass the whole app sits on, and the only element in the application
 * with a `backdrop-filter`. Blur stacked on blur wrecks scrolling performance, so inner
 * panels are plain translucent surfaces.
 *
 * `dvh` rather than `vh`: on mobile the address bar makes `vh` overshoot the visible area.
 *
 * Below 768px the glass gives up its margin and its corners and fills the screen; the caller
 * shows one panel at a time, so the grid drops to a single cell.
 */
export function AppShell({ toolbar, children, footer, isDropTarget = false }: AppShellProps) {
  return (
    <div className="p-0 md:p-4 xl:p-[28px]">
      <div
        data-testid="app-shell"
        className="relative flex h-dvh min-h-0 flex-col rounded-none border-white/12 bg-shell shadow-shell backdrop-blur-[40px] backdrop-saturate-[1.8] md:h-[calc(100dvh-32px)] md:rounded-shell md:border xl:h-[calc(100dvh-56px)]"
      >
        {/*
          The whole sheet is the drop target, so a file does not have to be aimed at the small
          zone. Pointer events stay off: the drop is handled on the window, not here.
        */}
        {isDropTarget ? (
          <div
            data-testid="drop-overlay"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-app/70 shadow-[inset_0_0_0_2px_rgb(10_132_255/0.55)] backdrop-blur-[2px]"
          >
            <p className="rounded-row bg-accent/[0.22] px-[18px] py-[11px] text-body text-accent-text shadow-current">
              Drop a .class file to run it
            </p>
          </div>
        ) : null}

        {toolbar}

        {/*
          Explicit `minmax(0, …)` on every track: with the automatic minimum, a long line of
          source or a wide disassembly row sizes its column to its content and pushes the grid
          past the shell in both directions instead of scrolling inside the panel.
        */}
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-[14px] px-[14px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_minmax(0,34%)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_328px]">
          {children}
        </main>

        {/* A landmark, so the transport is not orphaned page content for a screen reader. */}
        <footer className="sticky bottom-0 shrink-0">{footer}</footer>
      </div>
    </div>
  );
}
