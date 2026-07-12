import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Instruction } from '../core/disassembler/types';

import { mockFactorialMethod } from './__fixtures__/mock-history';
import { BranchGutter } from './BranchGutter';
import { ROW_HEIGHT } from './rhythm';

/** A backward jump, as emitted for a `while` loop: `goto` at index 2 back to index 0. */
const backwardJump: readonly Instruction[] = [
  { offset: 0, opcode: 0x1a, mnemonic: 'iload_0', operands: [] },
  { offset: 1, opcode: 0x1a, mnemonic: 'iload_1', operands: [] },
  { offset: 2, opcode: 0xa7, mnemonic: 'goto', operands: [-2], branchTarget: 0 },
  { offset: 5, opcode: 0xb1, mnemonic: 'return', operands: [] },
];

/** Four jumps to the same row, so every arc overlaps the others. */
const denseJumps: readonly Instruction[] = [0, 1, 2, 3].map((offset) => ({
  offset,
  opcode: 0xa7,
  mnemonic: 'goto',
  operands: [5 - offset],
  branchTarget: 5,
}));

const denseMethod: readonly Instruction[] = [
  ...denseJumps,
  { offset: 4, opcode: 0x00, mnemonic: 'nop', operands: [] },
  { offset: 5, opcode: 0xb1, mnemonic: 'return', operands: [] },
];

describe('BranchGutter', () => {
  it('spans exactly the rows between the jump and its target', () => {
    render(<BranchGutter instructions={mockFactorialMethod.instructions} currentIndex={2} />);

    const arc = screen.getByTestId('branch-arc');

    // `if_icmpgt` sits at index 2 and targets offset 7, which is index 5.
    expect(arc).toHaveAttribute('data-from-index', '2');
    expect(arc).toHaveAttribute('data-to-index', '5');
    expect(arc).toHaveStyle({ height: `${String(3 * ROW_HEIGHT)}px` });
    expect(arc).toHaveStyle({ top: `${String(2.5 * ROW_HEIGHT)}px` });
  });

  it('flips the arrow head to the top for a backward jump', () => {
    render(<BranchGutter instructions={backwardJump} currentIndex={2} />);

    expect(screen.getByTestId('branch-arc')).toHaveStyle({ height: `${String(2 * ROW_HEIGHT)}px` });
    expect(screen.getByTestId('branch-arrow')).toHaveStyle({ transform: 'rotate(135deg)' });
  });

  it('renders nothing when the method has no jumps', () => {
    render(
      <BranchGutter instructions={[{ offset: 0, opcode: 0x00, mnemonic: 'nop', operands: [] }]} />,
    );

    expect(screen.queryByTestId('branch-arc')).not.toBeInTheDocument();
  });

  it('keeps only the current and hovered arcs once the gutter gets crowded', () => {
    const { rerender } = render(<BranchGutter instructions={denseMethod} currentIndex={1} />);

    const onlyCurrent = screen.getAllByTestId('branch-arc');
    expect(onlyCurrent).toHaveLength(1);
    expect(onlyCurrent[0]).toHaveAttribute('data-from-index', '1');

    rerender(<BranchGutter instructions={denseMethod} currentIndex={1} hoveredIndex={3} />);

    expect(
      screen.getAllByTestId('branch-arc').map((arc) => arc.getAttribute('data-from-index')),
    ).toEqual(['1', '3']);
  });
});
