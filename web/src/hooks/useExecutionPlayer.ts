import { useCallback, useEffect, useState } from 'react';

import type { Snapshot } from '../core/interpreter/types';

/** Multipliers over BASE_STEP_INTERVAL_MS; the transport speed pill cycles through them. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Delay between steps at 1× — slow enough to follow a stack push by eye. */
export const BASE_STEP_INTERVAL_MS = 600;

export const DEFAULT_SPEED: PlaybackSpeed = 1;

export interface ExecutionPlayer {
  /** Index into the history passed to the hook; 0 when the history is empty. */
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly togglePlay: () => void;
  readonly stepForward: () => void;
  readonly stepBack: () => void;
  readonly seekTo: (index: number) => void;
  /** Any number is accepted and snapped to PLAYBACK_SPEEDS. */
  readonly setSpeed: (speed: number) => void;
  /** Rewinds to the first step and stops; the speed setting survives. */
  readonly reset: () => void;
}

function nearestSpeed(value: number): PlaybackSpeed {
  return PLAYBACK_SPEEDS.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
  );
}

/**
 * Headless transport over an execution history. Owns nothing but the position, the play
 * flag and the speed — snapshots are read by the caller, which already holds the array.
 *
 * `snapshots` must be a stable reference (state or `useMemo`); a fresh non-empty array on
 * every render reads as a new program and rewinds the player.
 */
export function useExecutionPlayer(snapshots: readonly Snapshot[]): ExecutionPlayer {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(DEFAULT_SPEED);
  const [trackedSnapshots, setTrackedSnapshots] = useState(snapshots);

  const stepCount = snapshots.length;
  const lastIndex = Math.max(stepCount - 1, 0);

  // A different history is a different program: rewind during render, so no commit ever
  // pairs a fresh history with a stale index. Empty is empty regardless of identity —
  // otherwise a `[]` literal in the caller's render would spin this forever.
  if (snapshots !== trackedSnapshots && (stepCount > 0 || trackedSnapshots.length > 0)) {
    setTrackedSnapshots(snapshots);
    setStepIndex(0);
    setIsPlaying(false);
  }

  // The only place playback stops by itself — covers the timer, stepping and seeking alike.
  if (isPlaying && stepIndex >= lastIndex) {
    setIsPlaying(false);
  }

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const id = setInterval(() => {
      setStepIndex((index) => Math.min(index + 1, lastIndex));
    }, BASE_STEP_INTERVAL_MS / speed);

    return () => {
      clearInterval(id);
    };
  }, [isPlaying, speed, lastIndex]);

  const play = useCallback(() => {
    if (stepIndex < lastIndex) {
      setIsPlaying(true);
    }
  }, [stepIndex, lastIndex]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const stepForward = useCallback(() => {
    setStepIndex((index) => Math.min(index + 1, lastIndex));
  }, [lastIndex]);

  const stepBack = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0));
  }, []);

  const seekTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), lastIndex));
    },
    [lastIndex],
  );

  const setSpeed = useCallback((value: number) => {
    setSpeedState(nearestSpeed(value));
  }, []);

  const reset = useCallback(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, []);

  return {
    stepIndex,
    stepCount,
    isPlaying,
    speed,
    atStart: stepIndex === 0,
    atEnd: stepIndex >= lastIndex,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBack,
    seekTo,
    setSpeed,
    reset,
  };
}
