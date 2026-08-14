import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Snapshot } from '../core/interpreter';
import { depthsOf } from '../services/loading/program';
import { stepOutTarget, stepOverTarget } from '../services/views/timeline';

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export function nextSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  return PLAYBACK_SPEEDS[index + 1] ?? PLAYBACK_SPEEDS[0];
}

export const BASE_STEP_INTERVAL_MS = 600;

const DEFAULT_SPEED: PlaybackSpeed = 1;

export interface ExecutionPlayer {
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly depths: readonly number[];
  readonly togglePlay: () => void;
  readonly stepForward: () => void;
  readonly stepBack: () => void;
  readonly stepOver: () => void;
  readonly stepOut: () => void;
  readonly canStepOver: boolean;
  readonly canStepOut: boolean;
  readonly seekTo: (index: number) => void;
  readonly setSpeed: (speed: number) => void;
}

function nearestSpeed(value: number): PlaybackSpeed {
  return PLAYBACK_SPEEDS.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
  );
}

export function useExecutionPlayer(snapshots: readonly Snapshot[]): ExecutionPlayer {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(DEFAULT_SPEED);
  const [trackedSnapshots, setTrackedSnapshots] = useState(snapshots);

  const stepCount = snapshots.length;
  const lastIndex = Math.max(stepCount - 1, 0);

  if (snapshots !== trackedSnapshots && (stepCount > 0 || trackedSnapshots.length > 0)) {
    setTrackedSnapshots(snapshots);
    setStepIndex(0);
    setIsPlaying(false);
  }

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

  function play(): void {
    if (stepCount === 0) {
      return;
    }
    if (stepIndex >= lastIndex) {
      setStepIndex(0);
    }
    setIsPlaying(true);
  }

  function togglePlay(): void {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      play();
    }
  }

  function stepForward(): void {
    setStepIndex((index) => Math.min(index + 1, lastIndex));
  }

  function stepBack(): void {
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  const depths = useMemo(() => depthsOf(snapshots), [snapshots]);
  const overTarget = stepOverTarget(depths, stepIndex);
  const outTarget = stepOutTarget(depths, stepIndex);

  function stepOver(): void {
    if (overTarget !== undefined) {
      setStepIndex(overTarget);
    }
  }

  function stepOut(): void {
    if (outTarget !== undefined) {
      setStepIndex(outTarget);
    }
  }

  const seekTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), lastIndex));
    },
    [lastIndex],
  );

  function setSpeed(value: number): void {
    setSpeedState(nearestSpeed(value));
  }

  return {
    stepIndex,
    stepCount,
    isPlaying,
    speed,
    depths,
    togglePlay,
    stepForward,
    stepBack,
    stepOver,
    stepOut,
    canStepOver: overTarget !== undefined,
    canStepOut: outTarget !== undefined,
    seekTo,
    setSpeed,
  };
}
