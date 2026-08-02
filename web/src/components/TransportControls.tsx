import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '../hooks/useExecutionPlayer';
import type { TimelineEvent } from '../services/timeline';

import { DepthTrack } from './DepthTrack';
import { Segment, SegmentedControl } from './ui/SegmentedControl';

interface TransportControlsProps {
  /** Index of the current snapshot in the history (0-based). */
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  /** Call stack depth per step — the background chart of the scrubber. */
  readonly depths: readonly number[];
  /** What happened at each step, marked along the scrubber. */
  readonly events: readonly TimelineEvent[];
  /** False where the history holds no step to run to; the button stays a tab stop. */
  readonly canStepOver: boolean;
  readonly canStepOut: boolean;
  readonly onSeek: (index: number) => void;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onStepOver: () => void;
  readonly onStepOut: () => void;
  readonly onSpeedChange: (speed: number) => void;
}

/** The pill cycles through the speeds the player supports and wraps back to the slowest. */
function nextSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  return PLAYBACK_SPEEDS[index + 1] ?? PLAYBACK_SPEEDS[0];
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

/** The debugger glyph: an arc that leaps over the step under it and lands after it. */
function StepOverIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
      <path
        d="M3.5 9A4.5 4.5 0 0 1 12.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path fill="currentColor" d="M10.7 7.2h3.6L12.5 10.6z" />
      <circle fill="currentColor" cx="8" cy="12.2" r="1.6" />
    </svg>
  );
}

/** An arrow leaving the frame it points away from. */
function StepOutIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 2.4l4.6 5H9.5v4.1h-3V7.4H3.4z" />
      <path fill="currentColor" d="M3 12.9h10v1.6H3z" />
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
  events,
  canStepOver,
  canStepOut,
  onSeek,
  onTogglePlay,
  onStepForward,
  onStepBack,
  onStepOver,
  onStepOut,
  onSpeedChange,
}: TransportControlsProps) {
  const lastIndex = Math.max(stepCount - 1, 0);

  return (
    /*
      On a phone the buttons take the first line and the scrubber the second, so the row gap
      is its own value rather than the 14px that separates the clusters. The bottom padding
      clears the home indicator: the footer is the last thing above the edge of the screen.
    */
    <div className="flex shrink-0 flex-wrap items-center gap-x-[14px] gap-y-[10px] px-[18px] pt-[14px] pb-[calc(18px+env(safe-area-inset-bottom))] md:pb-[18px]">
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
        {/* Raised at rest as well as when playing: it is the primary action of the screen. */}
        <Segment
          label={isPlaying ? 'Pause' : 'Play'}
          title="Play / pause (space)"
          selected={isPlaying}
          tone="inverted"
          prominent
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

      {/*
        A cluster of its own rather than two more segments in the playback pill: these run the
        machine by the shape of the call stack, not by the clock, and on a phone five buttons
        in one pill no longer fit beside the speed.
      */}
      <SegmentedControl label="Stepping" className="p-1">
        <Segment
          label="Step over"
          title="Step over (↓)"
          disabled={!canStepOver}
          onClick={onStepOver}
          className="h-11 w-11 md:h-8 md:w-[38px]"
        >
          <StepOverIcon />
        </Segment>
        <Segment
          label="Step out"
          title="Step out (↑)"
          disabled={!canStepOut}
          onClick={onStepOut}
          className="h-11 w-11 md:h-8 md:w-[38px]"
        >
          <StepOutIcon />
        </Segment>
      </SegmentedControl>

      {/*
        The label carries the value: an aria-label overrides the visible `1×`, so without it
        a screen reader is told there is a speed control but never told what it is set to.
      */}
      <button
        type="button"
        aria-label={`Playback speed ${String(speed)}×`}
        title="Playback speed — click to cycle 0.5× to 8×"
        onClick={() => {
          onSpeedChange(nextSpeed(speed));
        }}
        className="focus-ring h-11 shrink-0 rounded-full bg-white/9 px-[11px] font-mono text-label text-white/80 shadow-control-raised md:h-auto md:py-[6px]"
      >
        {speed}×
      </button>

      {/*
        Track and counter travel together: on a phone they are the second line, which keeps
        the transport two lines tall instead of three now that stepping has its own cluster.
      */}
      <div className="order-last flex basis-full items-center gap-[14px] md:order-none md:basis-auto md:grow">
        <DepthTrack
          depths={depths}
          events={events}
          stepIndex={stepIndex}
          onSeek={onSeek}
          label="Execution history position"
        />

        {/*
          `<output>` is a live region by default, which at 8× is thirteen announcements a
          second. It goes quiet while playing and reports the position again on pause.
        */}
        <output
          data-testid="step-counter"
          aria-live={isPlaying ? 'off' : 'polite'}
          className="shrink-0 font-mono text-label text-white/60 tabular-nums"
        >
          step {stepIndex + 1} / {stepCount}
        </output>
      </div>
    </div>
  );
}
