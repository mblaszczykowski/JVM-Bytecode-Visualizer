import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';

interface LocalsPanelProps {
  /** Top frame of the current snapshot; `undefined` when the call stack is empty. */
  readonly frame: StackFrame | undefined;
}

/** `undefined` in the contract means "not initialised yet", not zero. */
const UNINITIALISED = '·';

export function LocalsPanel({ frame }: LocalsPanelProps) {
  if (frame === undefined) {
    return (
      <Panel title="Locals" meta="—" variant="state" contentClassName="shrink-0">
        <p className="px-[18px] py-3 text-[12px] text-white/30">No active frame.</p>
      </Panel>
    );
  }

  const { locals, localNames } = frame;

  return (
    <Panel
      title="Locals"
      meta={`${String(locals.length)} slots`}
      variant="state"
      contentClassName="shrink-0"
    >
      {locals.length === 0 ? (
        <p className="px-[23px] py-2 text-[12px] text-white/30">no local slots</p>
      ) : (
        <ul className="flex flex-col gap-[5px] px-[10px] pb-[2px]">
          {locals.map((value, slot) => {
            // Names come from the LocalVariableTable (javac -g); without it only the slot is left.
            const name = localNames[slot] ?? `slot ${String(slot)}`;
            const isInitialised = value !== undefined;

            return (
              <li
                key={slot}
                data-testid="local-slot"
                data-slot={slot}
                className={`flex items-center gap-2 rounded-row px-[13px] py-[8px] text-[12px] ${
                  isInitialised ? 'bg-white/5' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]'
                }`}
              >
                <span className="w-3 shrink-0 font-mono text-[10px] text-white/32">{slot}</span>
                <span className={isInitialised ? 'text-white/75' : 'text-white/30'}>{name}</span>
                {/* The supported instruction subset only models int locals. */}
                {isInitialised ? (
                  <span className="font-mono text-[11px] text-white/35">: I</span>
                ) : null}
                <span className="grow" />
                <span
                  className={`font-mono text-[14px] ${
                    isInitialised ? 'text-white/90' : 'text-white/30'
                  }`}
                >
                  {isInitialised ? value : UNINITIALISED}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
