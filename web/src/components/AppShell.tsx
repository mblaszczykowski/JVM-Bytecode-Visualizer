import type { ReactNode } from 'react';

interface AppShellProps {
  readonly toolbar: ReactNode;
  /** The three panels of the grid: Source, Bytecode, State. */
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

/**
 * The single sheet of glass the whole app sits on, and the only element in the application
 * with a `backdrop-filter`. Blur stacked on blur wrecks scrolling performance, so inner
 * panels are plain translucent surfaces.
 *
 * `dvh` rather than `vh`: on mobile the address bar makes `vh` overshoot the visible area.
 */
export function AppShell({ toolbar, children, footer }: AppShellProps) {
  return (
    <div className="p-0 md:p-[14px] xl:p-[28px]">
      <div className="flex h-dvh min-h-0 flex-col rounded-none border-white/12 bg-shell shadow-shell backdrop-blur-[40px] backdrop-saturate-[1.8] md:h-[calc(100dvh-28px)] md:rounded-shell md:border xl:h-[calc(100dvh-56px)]">
        {toolbar}

        {/*
          Explicit `minmax(0, …)` rows at every breakpoint: with auto rows the panels size to
          their content and push the grid past the height of the shell instead of scrolling.
        */}
        <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-3 gap-[14px] px-[14px] md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_minmax(0,34%)] lg:grid-cols-[1fr_1fr_280px] lg:grid-rows-1 xl:grid-cols-[1fr_1fr_328px]">
          {children}
        </main>

        {footer}
      </div>
    </div>
  );
}
