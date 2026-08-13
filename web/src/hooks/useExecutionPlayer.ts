import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Snapshot } from '../core/interpreter';
import { depthsOf } from '../services/program';
import { stepOutTarget, stepOverTarget } from '../services/timeline';

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const BASE_STEP_INTERVAL_MS = 600;

const DEFAULT_SPEED: PlaybackSpeed = 1;

export interface ExecutionPlayer {
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly depths: readonly number[];
  readonly play: () => void;
  readonly pause: () => void;
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

  const play = useCallback(() => {
    if (stepCount === 0) {
      return;
    }
    if (stepIndex >= lastIndex) {
      setStepIndex(0);
    }
    setIsPlaying(true);
  }, [stepIndex, lastIndex, stepCount]);

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

  const depths = useMemo(() => depthsOf(snapshots), [snapshots]);
  const overTarget = stepOverTarget(depths, stepIndex);
  const outTarget = stepOutTarget(depths, stepIndex);

  const stepOver = useCallback(() => {
    if (overTarget !== undefined) {
      setStepIndex(overTarget);
    }
  }, [overTarget]);

  const stepOut = useCallback(() => {
    if (outTarget !== undefined) {
      setStepIndex(outTarget);
    }
  }, [outTarget]);

  const seekTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), lastIndex));
    },
    [lastIndex],
  );

  const setSpeed = useCallback((value: number) => {
    setSpeedState(nearestSpeed(value));
  }, []);

  return {
    stepIndex,
    stepCount,
    isPlaying,
    speed,
    depths,
    play,
    pause,
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
