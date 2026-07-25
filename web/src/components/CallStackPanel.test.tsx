import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { firstStepOf, snapshotAt } from './__fixtures__/factorial-run';
import { CallStackPanel } from './CallStackPanel';

/**
 * The deepest point of the real run: main → factorial(4) → … → factorial(1), five frames,
 * taken at the moment the base case is entered.
 */
const deepestFrames = snapshotAt(firstStepOf('iload_0', 5)).callStack;

function deepStack(depth: number): readonly StackFrame[] {
  return Array.from({ length: depth }, (_, index) => ({
    methodName: 'fib',
    methodDescriptor: '(I)I',
    pc: index,
    operandStack: [],
    locals: [depth - index],
    localNames: ['n'],
  }));
}

function frameAt(position: number): HTMLElement {
  const frame = screen.getAllByTestId('call-frame')[position];
  if (frame === undefined) {
    throw new Error(`No frame rendered at position ${String(position)}`);
  }
  return frame;
}

describe('CallStackPanel', () => {
  it('puts the top frame at the bottom, next to the locals that describe it', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    // `flex-col-reverse` flips the DOM order, so the newest frame is first in the DOM
    // and last on screen.
    expect(screen.getByTestId('call-frame-list')).toHaveClass('flex-col-reverse');
    expect(screen.getAllByTestId('call-frame').map((frame) => frame.dataset.frameIndex)).toEqual([
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    expect(frameAt(0)).toHaveAttribute('aria-current', 'true');
    expect(frameAt(4)).not.toHaveAttribute('aria-current');
  });

  it('shows the method name, its first argument and the pc of the top frame', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    const top = within(frameAt(0));
    expect(top.getByText('factorial')).toBeInTheDocument();
    expect(top.getByText('n=1')).toBeInTheDocument();
    expect(top.getByText('pc 0')).toBeInTheDocument();

    // Only the top frame carries a pc pill; the descriptor moves out of the row into `title`.
    const oldest = frameAt(4);
    expect(within(oldest).getByText('main')).toBeInTheDocument();
    expect(oldest).toHaveAttribute('title', 'main([Ljava/lang/String;)V');
    expect(within(oldest).queryByText(/^pc /)).not.toBeInTheDocument();
  });

  it('fades older frames by depth instead of indenting them', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    expect(frameAt(0)).toHaveStyle({ opacity: '1' });
    expect(frameAt(1)).toHaveStyle({ opacity: '0.76' });
    expect(frameAt(2)).toHaveStyle({ opacity: '0.58' });
    // Past the fourth frame the fade bottoms out, so `main` stays as readable as its caller.
    expect(frameAt(3)).toHaveStyle({ opacity: '0.42' });
    expect(frameAt(4)).toHaveStyle({ opacity: '0.42' });
  });

  it('folds the middle of a deep stack into one expandable row', () => {
    render(<CallStackPanel frames={deepStack(12)} />);

    expect(screen.getAllByTestId('call-frame')).toHaveLength(7);
    const collapsed = screen.getByTestId('collapsed-frames');
    expect(collapsed).toHaveTextContent('… 5 more frames');

    fireEvent.click(collapsed);

    expect(screen.getAllByTestId('call-frame')).toHaveLength(12);
    expect(screen.queryByTestId('collapsed-frames')).not.toBeInTheDocument();
  });

  it('shows a readable empty state for the terminal snapshot', () => {
    render(<CallStackPanel frames={[]} />);

    expect(screen.queryByTestId('call-frame')).not.toBeInTheDocument();
    expect(screen.getByText(/No active frame/)).toBeInTheDocument();
    expect(screen.getByText('depth 0')).toBeInTheDocument();
  });
});
