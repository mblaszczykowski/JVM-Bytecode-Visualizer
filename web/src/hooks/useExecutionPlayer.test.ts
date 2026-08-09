import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Snapshot, StackFrame } from '../core/interpreter/types';
import { BASE_STEP_INTERVAL_MS, useExecutionPlayer } from './useExecutionPlayer';

function historyOf(steps: number): readonly Snapshot[] {
  return Array.from({ length: steps }, (_, step) => ({ step, callStack: [] }));
}

const FRAME: StackFrame = {
  methodName: 'f',
  methodDescriptor: '()V',
  pc: 0,
  operandStack: [],
  locals: [],
  localNames: [],
};

function historyOfDepths(depths: readonly number[]): readonly Snapshot[] {
  return depths.map((depth, step) => ({
    step,
    callStack: Array.from({ length: depth }, () => FRAME),
  }));
}

function renderPlayer(snapshots: readonly Snapshot[]) {
  return renderHook(
    ({ history }: { history: readonly Snapshot[] }) => useExecutionPlayer(history),
    {
      initialProps: { history: snapshots },
    },
  );
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useExecutionPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts paused on the first step', () => {
    const { result } = renderPlayer(historyOf(10));

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.stepCount).toBe(10);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.speed).toBe(1);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(false);
  });

  it('advances one step per interval while playing', () => {
    const { result } = renderPlayer(historyOf(10));

    act(() => {
      result.current.play();
    });
    expect(result.current.isPlaying).toBe(true);

    advance(BASE_STEP_INTERVAL_MS - 1);
    expect(result.current.stepIndex).toBe(0);

    advance(1);
    expect(result.current.stepIndex).toBe(1);

    advance(BASE_STEP_INTERVAL_MS * 3);
    expect(result.current.stepIndex).toBe(4);
  });

  it('stops advancing once paused', () => {
    const { result } = renderPlayer(historyOf(10));

    act(() => {
      result.current.play();
    });
    advance(BASE_STEP_INTERVAL_MS * 2);

    act(() => {
      result.current.pause();
    });
    advance(BASE_STEP_INTERVAL_MS * 5);

    expect(result.current.stepIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('toggles between playing and paused', () => {
    const { result } = renderPlayer(historyOf(10));

    act(() => {
      result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it('ticks twice as often after switching to 2× mid-playback', () => {
    const { result } = renderPlayer(historyOf(20));

    act(() => {
      result.current.play();
    });
    advance(BASE_STEP_INTERVAL_MS / 2);
    expect(result.current.stepIndex).toBe(0);

    act(() => {
      result.current.setSpeed(2);
    });
    expect(result.current.speed).toBe(2);

    advance(BASE_STEP_INTERVAL_MS / 2);
    expect(result.current.stepIndex).toBe(1);

    advance(BASE_STEP_INTERVAL_MS / 2);
    expect(result.current.stepIndex).toBe(2);

    expect(result.current.isPlaying).toBe(true);
  });

  it('snaps an unsupported speed to the nearest supported one', () => {
    const { result } = renderPlayer(historyOf(10));

    act(() => {
      result.current.setSpeed(7);
    });
    expect(result.current.speed).toBe(8);

    act(() => {
      result.current.setSpeed(0.1);
    });
    expect(result.current.speed).toBe(0.5);
  });

  it('pauses on the last step instead of running past it', () => {
    const { result } = renderPlayer(historyOf(4));

    act(() => {
      result.current.play();
    });
    advance(BASE_STEP_INTERVAL_MS * 10);

    expect(result.current.stepIndex).toBe(3);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.atEnd).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays from the top when play is pressed on the last step', () => {
    const { result } = renderPlayer(historyOf(3));

    act(() => {
      result.current.seekTo(2);
    });
    act(() => {
      result.current.play();
    });

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);

    advance(BASE_STEP_INTERVAL_MS);
    expect(result.current.stepIndex).toBe(1);
  });

  it('clamps stepping at both ends of the history', () => {
    const { result } = renderPlayer(historyOf(3));

    act(() => {
      result.current.stepBack();
    });
    expect(result.current.stepIndex).toBe(0);

    act(() => {
      result.current.stepForward();
      result.current.stepForward();
      result.current.stepForward();
      result.current.stepForward();
    });
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.atEnd).toBe(true);

    act(() => {
      result.current.stepBack();
    });
    expect(result.current.stepIndex).toBe(1);
  });

  const NESTED = [1, 1, 1, 2, 2, 3, 3, 2, 1, 0];

  it('steps over a call, past the whole callee', () => {
    const { result } = renderPlayer(historyOfDepths(NESTED));

    act(() => {
      result.current.seekTo(2);
    });
    act(() => {
      result.current.stepOver();
    });

    expect(result.current.stepIndex).toBe(8);
    expect(result.current.canStepOver).toBe(true);
  });

  it('steps forward when the current instruction opens no frame', () => {
    const { result } = renderPlayer(historyOfDepths(NESTED));

    act(() => {
      result.current.stepOver();
    });

    expect(result.current.stepIndex).toBe(1);
  });

  it('steps out to where the frame on top has returned', () => {
    const { result } = renderPlayer(historyOfDepths(NESTED));

    act(() => {
      result.current.seekTo(5);
    });
    act(() => {
      result.current.stepOut();
    });

    expect(result.current.stepIndex).toBe(7);
  });

  it('has nothing to step out of on a step with no frame', () => {
    const { result } = renderPlayer(historyOfDepths(NESTED));

    act(() => {
      result.current.seekTo(9);
    });

    expect(result.current.canStepOut).toBe(false);
    expect(result.current.canStepOver).toBe(false);

    act(() => {
      result.current.stepOut();
    });
    expect(result.current.stepIndex).toBe(9);
  });

  it('stays put rather than jumping when the history ends inside the callee', () => {
    const { result } = renderPlayer(historyOfDepths([1, 2, 3, 4]));

    act(() => {
      result.current.seekTo(1);
    });

    expect(result.current.canStepOver).toBe(false);
    expect(result.current.canStepOut).toBe(false);

    act(() => {
      result.current.stepOver();
      result.current.stepOut();
    });
    expect(result.current.stepIndex).toBe(1);
  });

  it('clamps a seek below zero or past the last step', () => {
    const { result } = renderPlayer(historyOf(5));

    act(() => {
      result.current.seekTo(-3);
    });
    expect(result.current.stepIndex).toBe(0);

    act(() => {
      result.current.seekTo(99);
    });
    expect(result.current.stepIndex).toBe(4);
  });

  it('keeps playing when stepping or seeking inside the history', () => {
    const { result } = renderPlayer(historyOf(20));

    act(() => {
      result.current.play();
    });

    act(() => {
      result.current.stepForward();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.seekTo(10);
    });
    expect(result.current.isPlaying).toBe(true);

    advance(BASE_STEP_INTERVAL_MS);
    expect(result.current.stepIndex).toBe(11);
  });

  it('pauses when a seek lands on the last step', () => {
    const { result } = renderPlayer(historyOf(8));

    act(() => {
      result.current.play();
    });
    act(() => {
      result.current.seekTo(7);
    });

    expect(result.current.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rewinds and stops on reset, keeping the chosen speed', () => {
    const { result } = renderPlayer(historyOf(10));

    act(() => {
      result.current.setSpeed(4);
      result.current.seekTo(6);
      result.current.play();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.speed).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rewinds and stops when a different history arrives', () => {
    const { result, rerender } = renderPlayer(historyOf(10));

    act(() => {
      result.current.seekTo(5);
    });
    act(() => {
      result.current.play();
    });

    rerender({ history: historyOf(10) });

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps its position when the same history is re-rendered', () => {
    const snapshots = historyOf(10);
    const { result, rerender } = renderPlayer(snapshots);

    act(() => {
      result.current.seekTo(4);
    });
    rerender({ history: snapshots });

    expect(result.current.stepIndex).toBe(4);
  });

  it('clears the playback timer on unmount', () => {
    const { result, unmount } = renderPlayer(historyOf(50));

    act(() => {
      result.current.play();
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats every control as a no-op for an empty history', () => {
    const { result, rerender } = renderPlayer([]);

    expect(result.current.stepCount).toBe(0);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(true);
    expect(result.current.canStepOver).toBe(false);
    expect(result.current.canStepOut).toBe(false);

    act(() => {
      result.current.play();
      result.current.stepForward();
      result.current.stepBack();
      result.current.stepOver();
      result.current.stepOut();
      result.current.seekTo(7);
    });

    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    rerender({ history: [] });
    expect(result.current.stepIndex).toBe(0);
  });
});
