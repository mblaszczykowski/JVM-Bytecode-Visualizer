import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';
import { EMPTY_STATE } from './theme';

interface LocalsPanelProps {
  /** Ramka wierzchnia bieżącego snapshotu; `undefined`, gdy stos wywołań jest pusty. */
  readonly frame: StackFrame | undefined;
}

/** Slot bez wartości — `undefined` w kontrakcie oznacza „niezainicjalizowany", nie zero. */
const UNINITIALIZED = '—';

export function LocalsPanel({ frame }: LocalsPanelProps) {
  if (frame === undefined) {
    return (
      <Panel title="Zmienne lokalne" meta="—">
        <p className={EMPTY_STATE}>Brak aktywnej ramki.</p>
      </Panel>
    );
  }

  const { locals, localNames } = frame;

  return (
    <Panel title="Zmienne lokalne" meta={`${String(locals.length)} slotów`}>
      {locals.length === 0 ? (
        <p className={EMPTY_STATE}>Metoda nie ma slotów lokalnych.</p>
      ) : (
        <table className="w-full px-[10px] text-[12px]">
          <thead>
            <tr className="text-left text-[10px] text-white/35">
              <th scope="col" className="px-[13px] pb-1 font-normal">
                slot
              </th>
              <th scope="col" className="px-[13px] pb-1 font-normal">
                nazwa
              </th>
              <th scope="col" className="px-[13px] pb-1 text-right font-normal">
                wartość
              </th>
            </tr>
          </thead>
          <tbody>
            {locals.map((value, slot) => {
              // Nazwa pochodzi z LocalVariableTable (javac -g); bez niej zostaje sam numer slotu.
              const name = localNames[slot] ?? `slot ${String(slot)}`;
              const isInitialized = value !== undefined;

              return (
                <tr key={slot} data-testid="local-slot" data-slot={slot}>
                  <td className="px-[13px] py-1 font-mono text-white/30">{slot}</td>
                  <td
                    className={`px-[13px] py-1 ${isInitialized ? 'text-white/75' : 'text-white/30'}`}
                  >
                    {name}
                  </td>
                  <td
                    className={`px-[13px] py-1 text-right font-mono text-[14px] ${
                      isInitialized ? 'text-white/90' : 'text-white/30'
                    }`}
                  >
                    {isInitialized ? value : UNINITIALIZED}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
