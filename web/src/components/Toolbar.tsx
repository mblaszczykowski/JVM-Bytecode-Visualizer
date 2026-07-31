import { type ExampleOption, ExamplePicker } from './ExamplePicker';
import { FileUpload } from './FileUpload';
import { Segment, SegmentedControl } from './ui/SegmentedControl';

/** `hidden` until a compile backend is configured and reachable. */
export type CompilerStatus = 'hidden' | 'online' | 'offline';

/**
 * Below 768px the panels share one cell and this picks which of them holds it. `source` and
 * `class` are the two faces of the left column everywhere else, so choosing one here also
 * chooses which of them that column shows.
 */
export type PanelName = 'source' | 'class' | 'bytecode' | 'state';

const PANEL_NAMES: readonly { readonly id: PanelName; readonly label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'class', label: 'Class' },
  { id: 'bytecode', label: 'Bytecode' },
  { id: 'state', label: 'State' },
];

interface PanelSwitch {
  readonly selected: PanelName;
  readonly onSelect: (panel: PanelName) => void;
}

interface ToolbarProps {
  readonly appName: string;
  readonly examples: readonly ExampleOption[];
  readonly selectedExampleId: string | undefined;
  readonly onExampleSelected: (id: string) => void;
  readonly onFileSelected: (file: File) => void;
  readonly compilerStatus: CompilerStatus;
  /** Absent unless a compile service is configured and answered its health check. */
  readonly onWriteJava?: (() => void) | undefined;
  /** Absent while there is nothing to look at — the welcome screen owns the whole width. */
  readonly panelSwitch?: PanelSwitch | undefined;
}

function HealthBadge({ status }: { readonly status: Exclude<CompilerStatus, 'hidden'> }) {
  const online = status === 'online';

  return (
    <div
      data-testid="compiler-health"
      data-status={status}
      title={online ? 'Compile service reachable' : 'Compile service unreachable'}
      className="flex shrink-0 items-center gap-[6px] rounded-full bg-white/6 px-[10px] py-[5px] text-[11px] text-white/55"
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
  onWriteJava,
  panelSwitch,
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
        {onWriteJava === undefined ? null : (
          <button
            type="button"
            onClick={onWriteJava}
            className="focus-ring shrink-0 rounded-full bg-white/9 px-3 py-1.5 text-[12px] text-white/80 shadow-control-raised transition-colors hover:bg-white/15"
          >
            Write Java…
          </button>
        )}
        <FileUpload onFileSelected={onFileSelected} />
        {compilerStatus === 'hidden' ? null : <HealthBadge status={compilerStatus} />}
      </div>

      {/* Full width so it wraps onto a line of its own rather than squeezing the row. */}
      {panelSwitch === undefined ? null : (
        <div data-testid="panel-switch" className="w-full md:hidden">
          <SegmentedControl label="Visible panel" className="w-full p-1">
            {PANEL_NAMES.map(({ id, label }) => (
              <Segment
                key={id}
                label={label}
                labelIsVisible
                selected={panelSwitch.selected === id}
                onClick={() => {
                  panelSwitch.onSelect(id);
                }}
                className="h-11 flex-1"
              >
                {label}
              </Segment>
            ))}
          </SegmentedControl>
        </div>
      )}
    </header>
  );
}
