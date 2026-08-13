import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '../../hooks/useExecutionPlayer';
import type { TimelineEvent } from '../../services/views/timeline';

import { DepthTrack } from './DepthTrack';
import { Button } from '../ui/Button';
import { Segment, SegmentedControl } from '../ui/SegmentedControl';

interface TransportControlsProps {
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly depths: readonly number[];
  readonly events: readonly TimelineEvent[];
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-line bg-app px-3.5 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-2.5">
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
          primary
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

      <Button
        tone="prominent"
        aria-label={`Playback speed ${String(speed)}×`}
        title="Playback speed: click to cycle 0.5× to 8×"
        onClick={() => {
          onSpeedChange(nextSpeed(speed));
        }}
        className="h-11 shrink-0 font-mono md:h-auto md:py-1.5"
      >
        {speed}×
      </Button>

      <div className="order-last flex basis-full items-center gap-3.5 md:order-none md:basis-auto md:grow">
        <DepthTrack
          depths={depths}
          events={events}
          stepIndex={stepIndex}
          onSeek={onSeek}
          label="Execution history position"
        />

        <output
          data-testid="step-counter"
          aria-live={isPlaying ? 'off' : 'polite'}
          className="shrink-0 font-mono text-label text-fg-2 tabular-nums"
        >
          step {stepIndex + 1} / {stepCount}
        </output>
      </div>
    </div>
  );
}
