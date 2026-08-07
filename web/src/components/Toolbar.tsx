import { type ExampleOption, ExamplePicker } from './ExamplePicker';
import { FileUpload } from './FileUpload';
import { GlossaryDialog } from './GlossaryDialog';
import { openGlossary } from './glossary-store';
import { KeyboardHelp, type ShortcutGroup } from './KeyboardHelp';
import { ThemeToggle } from './ThemeToggle';
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
  /**
   * Supplied by the caller rather than written here, so the sheet lists the handlers that are
   * actually installed. Absent while nothing is bound to the keyboard.
   */
  readonly shortcuts?: readonly ShortcutGroup[] | undefined;
}

function HealthBadge({ status }: { readonly status: Exclude<CompilerStatus, 'hidden'> }) {
  const online = status === 'online';

  return (
    <div
      data-testid="compiler-health"
      data-status={status}
      title={online ? 'Compile service reachable' : 'Compile service unreachable'}
      className="text-meta flex shrink-0 items-center gap-[6px] rounded-control px-[8px] py-[5px] text-fg-3"
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

/**
 * A hairline separates it from the grid; nothing else does. Deliberately no window chrome:
 * this is a web app, and fake traffic lights would be an unclickable prop and an
 * accessibility trap.
 *
 * Everything here recedes. The header is the one fixture on screen in every state of the
 * application, so every pixel it takes is a pixel the disassembly never gets.
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
  shortcuts,
}: ToolbarProps) {
  return (
    <header className="shrink-0 border-b border-line px-[14px] py-[9px]">
      {/*
        Three zones rather than one wrapping row. Only the middle zone may shrink, so an
        example list too long for the width can no longer drag the actions onto a second line:
        the header keeps the ~56px of design.md §6.1 at every width from 768px up.

        Below 768px the actions ride beside the name and the examples take the line under
        them — that zone is the one worth the full width, and the actions are two pills that
        would leave the rail nothing. DOM order stays name → examples → actions, so the
        reading order is the visual order everywhere the three share a line.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <h1 className="text-brand col-start-1 col-end-2 row-start-1 min-w-0 truncate font-semibold tracking-[-0.02em] text-fg">
          {appName}
        </h1>

        <div className="col-start-1 col-end-3 row-start-2 flex min-w-0 md:col-start-2 md:col-end-3 md:row-start-1">
          <ExamplePicker
            examples={examples}
            selectedId={selectedExampleId}
            onExampleSelected={onExampleSelected}
          />
        </div>

        <div className="col-start-2 col-end-3 row-start-1 flex items-center gap-[6px] md:col-start-3 md:col-end-4">
          {/* The way in that does not depend on which panel is on screen. */}
          <button
            type="button"
            data-testid="toolbar-glossary"
            onClick={() => {
              openGlossary();
            }}
            className="focus-ring text-meta shrink-0 rounded-control px-[8px] py-[5px] text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
          >
            Glossary
          </button>
          {shortcuts === undefined ? null : <KeyboardHelp groups={shortcuts} />}
          <ThemeToggle />
          {onWriteJava === undefined ? null : (
            <button
              type="button"
              onClick={onWriteJava}
              className="focus-ring text-label shrink-0 rounded-control bg-raised px-[10px] py-[5px] text-fg shadow-control-raised transition-colors duration-150 hover:bg-raised-hover"
            >
              Write Java…
            </button>
          )}
          <FileUpload onFileSelected={onFileSelected} />
          {compilerStatus === 'hidden' ? null : <HealthBadge status={compilerStatus} />}
        </div>
      </div>

      {/* A line of its own: at this width the panels are one cell and this is what picks it. */}
      {panelSwitch === undefined ? null : (
        <div data-testid="panel-switch" className="mt-3 md:hidden">
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

      {/* Mounted here because the toolbar is on screen in every state of the application; it
          renders nothing until something asks for a term. */}
      <GlossaryDialog />
    </header>
  );
}
