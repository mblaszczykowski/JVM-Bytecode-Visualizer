import { CALL_SCOPE_NOTE, capabilitySummary } from '../services/capabilities';

/**
 * The honest sentence about the machine, next to the thing it is about.
 *
 * Twenty-one realistic Java programs were compiled and replayed here; four ran to the end. A
 * reader about to hand over a file from their own project deserves to know that before the
 * upload, not from a red banner afterwards — but the welcome screen is also the first frame
 * anyone sees, so the admission has to be one line until someone asks for the rest.
 *
 * Both halves come from `services/capabilities`, which reads the opcode table: the breakdown
 * cannot describe an instruction set the interpreter no longer has.
 */
export function CapabilityNote() {
  const { executable, assigned, families, gaps } = capabilitySummary();

  return (
    <details
      data-testid="welcome-capabilities"
      className="group rounded-panel bg-white/[0.03] shadow-panel"
    >
      <summary className="focus-ring flex cursor-pointer list-none items-baseline gap-3 rounded-panel px-[16px] py-[12px] text-[11.5px] leading-[18px] text-white/55 transition-colors hover:text-white/75 [&::-webkit-details-marker]:hidden">
        <span className="grow">
          Runs the integer subset of the JVM —{' '}
          <span className="font-mono text-white/75 tabular-nums">{executable}</span> of{' '}
          <span className="font-mono text-white/75 tabular-nums">{assigned}</span> instructions.
          Most real-world <code className="font-mono text-white/75">.class</code> files stop on an
          instruction this machine does not implement.
        </span>
        {/* Two spans rather than state: the disclosure already knows whether it is open. */}
        <span aria-hidden="true" className="shrink-0 text-[11px] text-white/45 group-open:hidden">
          What runs
        </span>
        <span
          aria-hidden="true"
          className="hidden shrink-0 text-[11px] text-white/45 group-open:inline"
        >
          Hide
        </span>
      </summary>

      <div className="grid gap-[16px] px-[16px] pt-[2px] pb-[14px] md:grid-cols-2">
        <section>
          <h4 className="text-[11.5px] font-semibold text-white/50">Executable instructions</h4>
          <dl className="mt-[8px] flex flex-col gap-[5px]">
            {families.map((family) => (
              <div key={family.name} data-testid="capability-family" className="flex gap-[10px]">
                <dt className="w-[112px] shrink-0 text-[11px] leading-[16px] text-white/55">
                  {family.name}
                </dt>
                <dd className="font-mono text-[11px] leading-[16px] text-white/60">
                  {family.mnemonics.join(' ')}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h4 className="text-[11.5px] font-semibold text-white/50">Not implemented yet</h4>
          <ul className="mt-[8px] flex flex-col gap-[5px]">
            {gaps.map((gap) => (
              <li
                key={gap.title}
                data-testid="capability-gap"
                className="text-[11px] leading-[16px] text-white/60"
              >
                {gap.title} <span className="font-mono text-white/55">{gap.missing.join(' ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-[10px] text-[11px] leading-[16px] text-white/55">{CALL_SCOPE_NOTE}</p>
        </section>
      </div>
    </details>
  );
}
