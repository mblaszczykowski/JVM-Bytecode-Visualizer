import { type ChangeEvent, useId } from 'react';

import { FOCUS_RING } from './theme';

interface TransportControlsProps {
  /** Indeks bieżącego snapshotu w historii (0-indeksowany). */
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: number;
  readonly onSeek: (index: number) => void;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onSpeedChange: (speed: number) => void;
}

/** Prędkości odtwarzania z plan §9 Faza 6 — tu wyłącznie jako wartości selektora. */
const SPEEDS = [0.5, 1, 2, 4, 8];

const BUTTON_BASE = `flex items-center justify-center rounded-full text-white/85 transition-colors disabled:opacity-30 ${FOCUS_RING}`;

function StepBackIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M4 3h2v10H4zM13 3v10L6 8z" />
    </svg>
  );
}

function StepForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M10 3h2v10h-2zM3 3l7 5-7 5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M5 3l8 5-8 5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M4 3h3v10H4zM9 3h3v10H9z" />
    </svg>
  );
}

/**
 * Komponent jest w pełni sterowany: cały stan (indeks, play/pause, prędkość) mieszka wyżej.
 * Timer odtwarzania to zadanie `useExecutionPlayer` z Fazy 6 — tutaj świadomie go nie ma.
 */
export function TransportControls({
  stepIndex,
  stepCount,
  isPlaying,
  speed,
  onSeek,
  onTogglePlay,
  onStepForward,
  onStepBack,
  onSpeedChange,
}: TransportControlsProps) {
  const speedId = useId();
  const lastIndex = Math.max(stepCount - 1, 0);

  function handleSeek(event: ChangeEvent<HTMLInputElement>): void {
    onSeek(Number(event.target.value));
  }

  function handleSpeed(event: ChangeEvent<HTMLSelectElement>): void {
    onSpeedChange(Number(event.target.value));
  }

  return (
    <div className="flex items-center gap-4 px-[18px] pt-[14px] pb-[18px]">
      <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.28)]">
        <button
          type="button"
          aria-label="Krok wstecz"
          title="Krok wstecz (←)"
          disabled={stepIndex <= 0}
          onClick={onStepBack}
          className={`${BUTTON_BASE} h-8 w-[38px] hover:bg-white/10`}
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? 'Wstrzymaj' : 'Odtwórz'}
          aria-pressed={isPlaying}
          title="Odtwarzanie (spacja)"
          onClick={onTogglePlay}
          className={`${BUTTON_BASE} h-8 w-[46px] ${
            isPlaying ? 'bg-white/90 text-slate-900' : 'hover:bg-white/10'
          }`}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          aria-label="Krok naprzód"
          title="Krok naprzód (→)"
          disabled={stepIndex >= lastIndex}
          onClick={onStepForward}
          className={`${BUTTON_BASE} h-8 w-[38px] hover:bg-white/10`}
        >
          <StepForwardIcon />
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={lastIndex}
        step={1}
        value={stepIndex}
        onChange={handleSeek}
        aria-label="Pozycja w historii wykonania"
        aria-valuetext={`krok ${String(stepIndex + 1)} z ${String(stepCount)}`}
        className={`h-1.5 grow cursor-pointer appearance-none rounded-full bg-white/15 accent-[#0a84ff] ${FOCUS_RING}`}
      />

      <output data-testid="step-counter" className="shrink-0 font-mono text-[12px] text-white/70">
        krok {stepIndex + 1} / {stepCount}
      </output>

      <div className="flex shrink-0 items-center gap-2">
        <label htmlFor={speedId} className="text-[11px] text-white/45">
          Prędkość
        </label>
        <select
          id={speedId}
          value={speed}
          onChange={handleSpeed}
          className={`rounded-full bg-white/10 px-2 py-1 font-mono text-[12px] text-white/80 ${FOCUS_RING}`}
        >
          {SPEEDS.map((option) => (
            <option key={option} value={option} className="bg-slate-900">
              {option}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
