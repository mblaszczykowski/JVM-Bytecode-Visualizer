import { CALL_SCOPE_NOTE, capabilitySummary } from '../services/capabilities';

export function CapabilityNote() {
  const { executable, assigned, families, gaps } = capabilitySummary();

  return (
    <details
      data-testid="welcome-capabilities"
      className="group rounded-panel bg-raised shadow-panel"
    >
      <summary className="focus-ring flex cursor-pointer list-none items-baseline gap-3 rounded-panel px-4 py-3 text-label text-fg-3 transition-colors duration-150 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
        <span className="grow">
          Runs the integer subset of the JVM:{' '}
          <span className="font-mono text-fg-2 tabular-nums">{executable}</span> of{' '}
          <span className="font-mono text-fg-2 tabular-nums">{assigned}</span> instructions. Most
          real-world <code className="font-mono text-fg-2">.class</code> files stop on an
          instruction this machine does not implement.
        </span>
        <span aria-hidden="true" className="shrink-0 text-meta text-fg-3 group-open:hidden">
          What runs
        </span>
        <span aria-hidden="true" className="hidden shrink-0 text-meta text-fg-3 group-open:inline">
          Hide
        </span>
      </summary>

      <div className="grid gap-x-6 gap-y-4 border-t border-line px-4 pt-3.5 pb-4 md:grid-cols-2">
        <section>
          <h3 className="text-label font-medium text-fg-2">Executable instructions</h3>
          <dl className="mt-2.5 flex flex-col gap-1.5">
            {families.map((family) => (
              <div key={family.name} data-testid="capability-family" className="flex gap-2.5">
                <dt className="w-[136px] shrink-0 text-meta text-fg-3">{family.name}</dt>
                <dd className="font-mono text-meta text-fg-2">{family.mnemonics.join(' ')}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="text-label font-medium text-fg-2">Not implemented yet</h3>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {gaps.map((gap) => (
              <li key={gap.title} data-testid="capability-gap" className="text-meta text-fg-3">
                {gap.title} <span className="font-mono text-fg-2">{gap.missing.join(' ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-meta text-fg-3">{CALL_SCOPE_NOTE}</p>
        </section>
      </div>
    </details>
  );
}
