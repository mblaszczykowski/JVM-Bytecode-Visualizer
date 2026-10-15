import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../../core/interpreter';
import { frameOf } from '../../core/interpreter/__fixtures__/snapshots';

import { firstStepOf, snapshotAt } from '../__fixtures__/factorial-run';
import { CallStackPanel } from './CallStackPanel';

const deepestFrames = snapshotAt(firstStepOf('iload_0', { depth: 5 })).callStack;

function deepStack(depth: number): readonly StackFrame[] {
  return Array.from({ length: depth }, (_, index) =>
    frameOf({
      methodName: 'fib',
      methodDescriptor: '(I)I',
      pc: index,
      operandStack: [],
      locals: [depth - index],
      localNames: ['n'],
    }),
  );
}

function frameAt(position: number): HTMLElement {
  const frame = screen.getAllByTestId('call-frame')[position];
  if (frame === undefined) {
    throw new Error(`No frame rendered at position ${String(position)}`);
  }
  return frame;
}

describe('CallStackPanel', () => {
  it('describes reference arguments as objects or null instead of raw numeric handles', () => {
    const reference = (value: number) =>
      frameOf({
        methodName: 'consume',
        methodDescriptor: '([I)V',
        pc: 0,
        operandStack: [],
        locals: [value],
        localNames: ['array'],
        localKinds: ['ref'],
      });
    const { rerender } = render(
      <CallStackPanel
        frames={[reference(0)]}
        heap={[{ kind: 'int-array', length: 2, elements: [1, 2] }]}
      />,
    );

    expect(screen.getByText('array=int[2]@0')).toBeInTheDocument();

    rerender(<CallStackPanel frames={[reference(-1)]} />);
    expect(screen.getByText('array=null')).toBeInTheDocument();
  });

  it('puts the top frame at the bottom, next to the locals that describe it', () => {
    render(<CallStackPanel frames={deepestFrames} />);

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

    const oldest = frameAt(4);
    expect(within(oldest).getByText('main')).toBeInTheDocument();
    expect(oldest).toHaveAttribute('title', 'main([Ljava/lang/String;)V');
    expect(within(oldest).queryByText(/^pc /)).not.toBeInTheDocument();
  });

  it('recedes the older frames by a text step, then by the declared row utility', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    expect(frameAt(0)).toHaveClass('text-accent-text');
    expect(frameAt(1)).toHaveClass('text-fg-2');
    expect(frameAt(2)).toHaveClass('text-fg-2');
    expect(frameAt(3)).toHaveClass('row-unreached', 'text-fg-3');
    expect(frameAt(4)).toHaveClass('row-unreached', 'text-fg-3');

    const classNames = screen.getAllByTestId('call-frame').flatMap((frame) => [...frame.classList]);
    expect(classNames.filter((name) => name.startsWith('opacity-'))).toEqual([]);
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
    expect(screen.getByText('no active frame')).toBeInTheDocument();
    expect(screen.getByText(/popped the last frame/)).toBeInTheDocument();
    expect(screen.getByText('depth 0')).toBeInTheDocument();
  });
});
