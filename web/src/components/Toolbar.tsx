import { type ExampleOption, ExamplePicker } from './ExamplePicker';
import { FileUpload } from './FileUpload';

/** `hidden` until a compile backend is configured and reachable. */
export type CompilerStatus = 'hidden' | 'online' | 'offline';

interface ToolbarProps {
  readonly appName: string;
  readonly examples: readonly ExampleOption[];
  readonly selectedExampleId: string | undefined;
  readonly onExampleSelected: (id: string) => void;
  readonly onFileSelected: (file: File) => void;
  readonly compilerStatus: CompilerStatus;
}

function HealthBadge({ status }: { readonly status: Exclude<CompilerStatus, 'hidden'> }) {
  const online = status === 'online';

  return (
    <div
      data-testid="compiler-health"
      data-status={status}
      title={online ? 'Compile service reachable' : 'Compile service unreachable'}
      className="flex shrink-0 items-center gap-[6px] rounded-full bg-white/6 px-[10px] py-[5px] text-[11px] text-white/50"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-ok shadow-glow-ok' : 'bg-white/25'}`}
      />
      Compiler
    </div>
  );
}

/**
 * Floats on the glass with no hairline beneath it — only the gap separates it from the grid.
 * Deliberately no window chrome: this is a web app, and fake traffic lights would be an
 * unclickable prop and an accessibility trap.
 */
export function Toolbar({
  appName,
  examples,
  selectedExampleId,
  onExampleSelected,
  onFileSelected,
  compilerStatus,
}: ToolbarProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 px-[18px] py-[13px]">
      <h1 className="shrink-0 text-[13.5px] font-semibold tracking-[-0.015em] text-white/95">
        {appName}
      </h1>

      <ExamplePicker
        examples={examples}
        selectedId={selectedExampleId}
        onExampleSelected={onExampleSelected}
      />

      <div className="ml-auto flex items-center gap-3">
        <FileUpload onFileSelected={onFileSelected} />
        {compilerStatus === 'hidden' ? null : <HealthBadge status={compilerStatus} />}
      </div>
    </header>
  );
}
