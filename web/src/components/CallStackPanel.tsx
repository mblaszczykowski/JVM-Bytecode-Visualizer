import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';
import { CURRENT_ROW, EMPTY_STATE, PILL, PILL_ACCENT } from './theme';

interface CallStackPanelProps {
  /** Ramki w kolejności z kontraktu: `[0]` = najstarsza. Panel renderuje je odwrotnie. */
  readonly frames: readonly StackFrame[];
}

/**
 * Głębokość nie istnieje w modelu danych (plan §14 pkt 4) — liczymy ją z pozycji w tablicy
 * i sygnalizujemy kryciem, nie wcięciem.
 */
const OPACITY_BY_DISTANCE = [1, 0.72, 0.54, 0.42] as const;
const DEEPEST_OPACITY = 0.34;

function frameOpacity(distanceFromTop: number): number {
  return OPACITY_BY_DISTANCE[distanceFromTop] ?? DEEPEST_OPACITY;
}

export function CallStackPanel({ frames }: CallStackPanelProps) {
  const topIndex = frames.length - 1;

  return (
    <Panel title="Stos wywołań" meta={`głębokość ${String(frames.length)}`}>
      {frames.length === 0 ? (
        <p className={EMPTY_STATE}>Brak aktywnej ramki — wykonanie zakończone.</p>
      ) : (
        <ol className="flex flex-col gap-[5px] px-[10px]">
          {frames
            .map((frame, index) => ({ frame, index }))
            .reverse()
            .map(({ frame, index }) => {
              const isTop = index === topIndex;

              return (
                <li
                  key={`${String(index)}:${frame.methodName}${frame.methodDescriptor}`}
                  data-testid="call-frame"
                  data-frame-index={index}
                  aria-current={isTop ? 'true' : undefined}
                  style={{ opacity: frameOpacity(topIndex - index) }}
                  className={`flex items-center gap-2 rounded-[12px] px-[13px] py-[9px] text-[12px] ${
                    isTop ? CURRENT_ROW : 'bg-white/5 text-white/70'
                  }`}
                >
                  <span className="w-4 shrink-0 font-mono text-[10px] text-white/40">{index}</span>
                  <span className="font-medium">{frame.methodName}</span>
                  <span className="truncate font-mono text-[11px] text-white/40">
                    {frame.methodDescriptor}
                  </span>
                  <span className={`ml-auto ${isTop ? PILL_ACCENT : PILL}`}>pc {frame.pc}</span>
                </li>
              );
            })}
        </ol>
      )}
    </Panel>
  );
}
