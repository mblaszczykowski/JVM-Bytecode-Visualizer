import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { describeNextInstruction } from './__fixtures__/mock-derivations';
import { mockSnapshotAt } from './__fixtures__/mock-history';
import { NextInstructionCard, type NextInstructionCardProps } from './NextInstructionCard';

function detailsAt(step: number): NextInstructionCardProps {
  const details = describeNextInstruction(mockSnapshotAt(step));
  if (details === undefined) {
    throw new Error(`Mock step ${String(step)} has no next instruction`);
  }
  return details;
}

describe('NextInstructionCard', () => {
  it('renders the stack effect pills and the explanation', () => {
    render(
      <NextInstructionCard
        effects={[{ label: 'pop 1' }, { label: 'push frame' }]}
        explanation="Pops 1 off the stack and opens a frame for factorial(I)I with that value in slot 0."
      />,
    );

    expect(screen.getByText('pop 1')).toBeInTheDocument();
    expect(screen.getByText('push frame')).toBeInTheDocument();
    expect(screen.getByText(/opens a frame for factorial\(I\)I/)).toBeInTheDocument();
  });

  it('omits the constant pool chain when the instruction has no CP operand', () => {
    render(<NextInstructionCard effects={[{ label: 'push int' }]} explanation="Pushes 1." />);

    expect(screen.queryByTestId('cp-chain')).not.toBeInTheDocument();
  });

  it('resolves the constant pool reference of invokestatic down to the method name', () => {
    // Step 9 of the mock run: `invokestatic #7` inside factorial(2).
    render(<NextInstructionCard {...detailsAt(9)} />);

    const chain = within(screen.getByTestId('cp-chain'));

    expect(chain.getByText('#7')).toBeInTheDocument();
    expect(chain.getByText('Methodref')).toBeInTheDocument();
    expect(chain.getByText('#2 Class Factorial')).toBeInTheDocument();
    expect(chain.getByText('#18 factorial:(I)I')).toBeInTheDocument();
  });

  it('describes the effect of the instruction on the values of the current snapshot', () => {
    // Step 8 is `isub` with [2, 2, 1] on the stack: 2 − 1 = 1.
    render(<NextInstructionCard {...detailsAt(8)} />);

    expect(screen.getByText('pop 2')).toBeInTheDocument();
    expect(screen.getByText(/pushes 2 − 1 = 1/)).toBeInTheDocument();
  });

  it('has no card to render for the terminal snapshot', () => {
    expect(describeNextInstruction(mockSnapshotAt(19))).toBeUndefined();
  });
});
