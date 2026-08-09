import { methodModifiersOf } from '../services/class-view';
import { describeNotRunnable, type MethodListing } from '../services/program';

import { Pill } from './ui/Pill';

export interface MethodPickerProps {
  readonly methods: readonly MethodListing[];
  readonly selected: MethodListing | undefined;
  readonly onSelect: (method: MethodListing) => void;
  readonly onRun?: ((method: MethodListing) => void) | undefined;
  readonly entry?: MethodListing | undefined;
}

function signatureOf(method: MethodListing): string {
  return `${method.name}${method.descriptor}`;
}

export function MethodPicker({ methods, selected, onSelect, onRun, entry }: MethodPickerProps) {
  if (methods.length === 0) {
    return <p className="px-6 py-2 text-label text-fg-3">This class declares no methods.</p>;
  }

  const selectedSignature = selected === undefined ? undefined : signatureOf(selected);
  const entrySignature = entry === undefined ? undefined : signatureOf(entry);

  return (
    <ol className="flex flex-col gap-1 px-2.5">
      {methods.map((method) => {
        const signature = signatureOf(method);
        const isSelected = signature === selectedSignature;
        const META = isSelected ? 'text-fg-2' : 'text-fg-3';
        const reason = method.notRunnable;
        const modifiers = methodModifiersOf(method.accessFlags).join(' ');
        const count = method.instructions.length;

        return (
          <li
            key={signature}
            data-testid="method-row"
            data-method={signature}
            aria-current={isSelected ? 'true' : undefined}
            title={
              reason === undefined ? undefined : `Listing only: ${describeNotRunnable(reason)}`
            }
            className={`flex items-center gap-2 rounded-row px-3 py-2 text-label ${
              isSelected ? 'bg-raised-active text-fg shadow-control-raised' : 'bg-raised'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelect(method);
              }}
              className="focus-ring flex min-w-0 grow items-center gap-2 rounded-row text-left"
            >
              <span className="shrink-0 font-medium text-fg">{method.name}</span>
              <span className={`min-w-0 grow truncate font-mono text-meta ${META}`}>
                {method.descriptor}
              </span>
              {modifiers === '' ? null : (
                <span className={`shrink-0 font-mono text-meta ${META}`}>{modifiers}</span>
              )}
              {count === 0 ? null : (
                <span className={`shrink-0 font-mono text-meta ${META}`}>
                  {count === 1 ? '1 instruction' : `${String(count)} instructions`}
                </span>
              )}
              {}
              {reason === undefined ? null : (
                <span className="sr-only">Listing only: {describeNotRunnable(reason)}</span>
              )}
            </button>

            {signature === entrySignature ? (
              <Pill tone="neutral" title="The current run started from this method">
                entry
              </Pill>
            ) : null}

            {reason === undefined ? (
              onRun === undefined ? null : (
                <button
                  type="button"
                  aria-label={`Run ${signature}`}
                  onClick={() => {
                    onRun(method);
                  }}
                  className="focus-ring shrink-0 rounded-control bg-raised px-2.5 py-0.5 text-meta text-fg shadow-control-raised hover:bg-raised-active"
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
