import { openGlossary } from '../services/glossary-store';

import { type ExampleOption, ExamplePicker } from './ExamplePicker';
import { FileUpload } from './FileUpload';
import { KeyboardHelp, type ShortcutGroup } from './KeyboardHelp';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/Button';
import { Segment, SegmentedControl } from './ui/SegmentedControl';

export type CompilerStatus = 'hidden' | 'online' | 'offline';

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
  readonly onWriteJava?: (() => void) | undefined;
  readonly panelSwitch?: PanelSwitch | undefined;
  readonly shortcuts?: readonly ShortcutGroup[] | undefined;
}

function HealthBadge({ status }: { readonly status: Exclude<CompilerStatus, 'hidden'> }) {
  const online = status === 'online';

  return (
    <div
      data-testid="compiler-health"
      data-status={status}
      title={online ? 'Compile service reachable' : 'Compile service unreachable'}
      className="text-meta flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-fg-3"
    >
      <span
        aria-hidden="true"
        // eslint-disable-next-line no-restricted-syntax -- genuinely circular: a 6px status dot.
        className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-ok shadow-glow-ok' : 'bg-fg-dim'}`}
      />
      Compiler
    </div>
  );
}

export function Toolbar({
  appName,
  examples,
  selectedExampleId,
  onExampleSelected,
  onFileSelected,
  compilerStatus,
  onWriteJava,
  panelSwitch,
  shortcuts,
}: ToolbarProps) {
  return (
    <header className="shrink-0 border-b border-line px-3.5 py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <h1 className="text-brand col-start-1 col-end-2 row-start-1 min-w-0 truncate font-semibold tracking-[-0.02em] text-fg">
          {appName}
        </h1>

        <div
          className={`row-start-2 flex min-w-0 md:col-start-2 md:col-end-3 md:row-start-1 ${
            panelSwitch === undefined ? 'col-start-1 col-end-3' : 'col-start-1 col-end-2'
          }`}
        >
          <ExamplePicker
            examples={examples}
            selectedId={selectedExampleId}
            onExampleSelected={onExampleSelected}
            collapsible={panelSwitch !== undefined}
          />
        </div>

        {panelSwitch === undefined ? null : (
          <div data-testid="panel-switch" className="col-start-2 col-end-3 row-start-2 md:hidden">
            <SegmentedControl label="Visible panel" className="w-full p-1">
              {PANEL_NAMES.map(({ id, label }) => (
                <Segment
                  key={id}
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

        <div className="col-start-2 col-end-3 row-start-1 flex items-center gap-1.5 md:col-start-3 md:col-end-4">
          <Button
            data-testid="toolbar-glossary"
            onClick={() => {
              openGlossary();
            }}
            className="shrink-0"
          >
            Glossary
          </Button>
          {shortcuts === undefined ? null : <KeyboardHelp groups={shortcuts} />}
          <ThemeToggle />
          {onWriteJava === undefined ? null : (
            <Button tone="prominent" onClick={onWriteJava} className="shrink-0">
              Write Java…
            </Button>
          )}
          <FileUpload onFileSelected={onFileSelected} />
          {compilerStatus === 'hidden' ? null : <HealthBadge status={compilerStatus} />}
        </div>
      </div>
    </header>
  );
}
