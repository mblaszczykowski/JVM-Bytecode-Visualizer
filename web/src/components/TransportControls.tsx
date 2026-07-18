import { DepthTrack } from './DepthTrack';
import { Segment, SegmentedControl } from './ui/SegmentedControl';

interface TransportControlsProps {
  /** Index of the current snapshot in the history (0-based). */
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: number;
  /** Call stack depth per step — the background chart of the scrubber. */
  readonly depths: readonly number[];
  readonly onSeek: (index: number) => void;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onSpeedChange: (speed: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

function nextSpeed(current: number): number {
  const index = SPEEDS.indexOf(current as (typeof SPEEDS)[number]);
  return SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
}

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
 * Fully controlled: index, play state and speed all live above this component. It sits
 * directly on the glass — no background of its own and no hairline above it.
 */
export function TransportControls({
  stepIndex,
  stepCount,
  isPlaying,
  speed,
  depths,
  onSeek,
  onTogglePlay,
  onStepForward,
  onStepBack,
  onSpeedChange,
}: TransportControlsProps) {
  const lastIndex = Math.max(stepCount - 1, 0);

  return (
    // On a phone the scrubber takes a line of its own and every control clears 44px.
    <div className="flex shrink-0 flex-wrap items-center gap-[14px] px-[18px] pt-[14px] pb-[18px]">
      <SegmentedControl label="Playback" className="p-1">
        <Segment
          label="Step back"
          title="Step back (←)"
          disabled={stepIndex <= 0}
          onClick={onStepBack}
          className="h-11 w-11 md:h-8 md:w-[38px]"
        >
          <StepBackIcon />
        </Segment>
        <Segment
          label={isPlaying ? 'Pause' : 'Play'}
          title="Play / pause (space)"
          selected={isPlaying}
          tone="inverted"
          onClick={onTogglePlay}
          className="h-11 w-12 md:h-8 md:w-[46px]"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </Segment>
        <Segment
          label="Step forward"
          title="Step forward (→)"
          disabled={stepIndex >= lastIndex}
          onClick={onStepForward}
          className="h-11 w-11 md:h-8 md:w-[38px]"
        >
          <StepForwardIcon />
        </Segment>
      </SegmentedControl>

      <button
        type="button"
        aria-label="Playback speed"
        title="Playback speed — click to cycle 0.5× to 8×"
        onClick={() => {
          onSpeedChange(nextSpeed(speed));
        }}
        className="focus-ring h-11 shrink-0 rounded-full bg-white/9 px-[11px] font-mono text-[12px] text-white/80 shadow-control-raised md:h-auto md:py-[6px]"
      >
        {speed}×
      </button>

      <DepthTrack
        depths={depths}
        stepIndex={stepIndex}
        onSeek={onSeek}
        label="Execution history position"
        className="order-last basis-full md:order-none md:basis-auto"
      />

      <output
        data-testid="step-counter"
        className="shrink-0 font-mono text-[12px] text-white/60 tabular-nums"
      >
        step {stepIndex + 1} / {stepCount}
      </output>
    </div>
  );
}
