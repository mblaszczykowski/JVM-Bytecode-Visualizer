import type { ReactNode } from 'react';

import { GlossaryDialog } from './GlossaryDialog';

interface AppShellProps {
  readonly toolbar: ReactNode;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly isDropTarget?: boolean;
}

export function AppShell({ toolbar, children, footer, isDropTarget = false }: AppShellProps) {
  return (
    <div data-testid="app-shell" className="relative flex h-dvh min-h-0 flex-col bg-app">
      {isDropTarget ? (
        <div
          data-testid="drop-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-scrim shadow-drop-target"
        >
          <p className="rounded-card bg-accent-wash px-4 py-2.5 text-body text-accent-text shadow-current-strong">
            Drop a .class file to run it
          </p>
        </div>
      ) : null}

      {toolbar}

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2.5 px-2.5 pt-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_minmax(0,34%)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_296px] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        {children}
      </main>

      <footer className="sticky bottom-0 shrink-0">{footer}</footer>

      <GlossaryDialog />
    </div>
  );
}
