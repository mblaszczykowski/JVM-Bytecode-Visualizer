import { methodModifiersOf } from '../services/class-view';
import { describeNotRunnable, type MethodListing } from '../services/program';

import { Pill } from './ui/Pill';

export interface MethodPickerProps {
  readonly methods: readonly MethodListing[];
  /** The method whose listing the Bytecode panel is currently showing. */
  readonly selected: MethodListing | undefined;
  /** Show this method's listing. Called for every method, runnable or not. */
  readonly onSelect: (method: MethodListing) => void;
  /** Start a new run from this method. Absent when re-running is not offered at all. */
  readonly onRun?: ((method: MethodListing) => void) | undefined;
  /** The method the current run started from, if any. */
  readonly entry?: MethodListing | undefined;
}

/** Name and descriptor together identify a method; overloads share the name (JVMS §4.6). */
function signatureOf(method: MethodListing): string {
  return `${method.name}${method.descriptor}`;
}

/**
 * Every method the class declares, in declaration order.
 *
 * The ones this machine cannot enter are listed too, and marked rather than hidden: a private
 * constructor and a helper taking three ints are most of what a utility class *is*, and their
 * disassembly is worth reading whether or not a run can start there.
 *
 * Looking and running are separate actions. Selecting a row swaps the listing on screen, which
 * costs nothing; starting a run replays a whole program, so it stays behind its own control.
 */
export function MethodPicker({ methods, selected, onSelect, onRun, entry }: MethodPickerProps) {
  if (methods.length === 0) {
    return (
      <p className="px-[23px] py-2 text-label text-white/55">This class declares no methods.</p>
    );
  }

  const selectedSignature = selected === undefined ? undefined : signatureOf(selected);
  const entrySignature = entry === undefined ? undefined : signatureOf(entry);

  return (
    <ol className="flex flex-col gap-[5px] px-[10px]">
      {methods.map((method) => {
        const signature = signatureOf(method);
        const isSelected = signature === selectedSignature;
        const reason = method.notRunnable;
        const modifiers = methodModifiersOf(method.accessFlags).join(' ');
        const count = method.instructions.length;

        return (
          <li
            key={signature}
            data-testid="method-row"
            data-method={signature}
            // Selected is where the reader is; entry is a fact about the run. Only the first
            // of those is a current state, so only the first one is accented (design §2.4).
            aria-current={isSelected ? 'true' : undefined}
            title={
              reason === undefined ? undefined : `Listing only — ${describeNotRunnable(reason)}`
            }
            className={`flex items-center gap-2 rounded-row px-[13px] py-[8px] text-label ${
              isSelected ? 'bg-accent/[0.22] text-accent-text shadow-current' : 'bg-white/5'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelect(method);
              }}
              className="focus-ring flex min-w-0 grow items-center gap-2 rounded-row text-left"
            >
              {/* The name is what the reader is looking for, so it never gives way; the
                  descriptor is the widest thing in the row and is what has to. */}
              <span className={`shrink-0 font-medium ${isSelected ? '' : 'text-white/85'}`}>
                {method.name}
              </span>
              <span
                className={`min-w-0 grow truncate font-mono text-meta ${
                  isSelected ? 'text-accent-soft' : 'text-white/55'
                }`}
              >
                {method.descriptor}
              </span>
              {modifiers === '' ? null : (
                <span
                  className={`shrink-0 font-mono text-meta ${
                    isSelected ? 'text-accent-soft' : 'text-white/55'
                  }`}
                >
                  {modifiers}
                </span>
              )}
              {count === 0 ? null : (
                <span className="shrink-0 font-mono text-meta text-white/32">
                  {count === 1 ? '1 instruction' : `${String(count)} instructions`}
                </span>
              )}
              {/* The pill says "listing only"; the reason has to reach a reader who cannot hover. */}
              {reason === undefined ? null : (
                <span className="sr-only">Listing only — {describeNotRunnable(reason)}</span>
              )}
            </button>

            {signature === entrySignature ? (
              <Pill tone="neutral" title="The current run started from this method">
                entry
              </Pill>
            ) : null}

            {reason === undefined ? (
              // A nested control inside a clickable row is an accessibility violation, so Run
              // is a sibling of the row's own control rather than a button inside a button.
              onRun === undefined ? null : (
                <button
                  type="button"
                  aria-label={`Run ${signature}`}
                  onClick={() => {
                    onRun(method);
                  }}
                  className="focus-ring shrink-0 rounded-full bg-white/9 px-[10px] py-[3px] text-meta text-white/85 shadow-control-raised hover:bg-white/[0.14]"
                >
                  Run
                </button>
              )
            ) : (
              <Pill tone="neutral" title={describeNotRunnable(reason)}>
                listing only
              </Pill>
            )}
          </li>
        );
      })}
    </ol>
  );
}
