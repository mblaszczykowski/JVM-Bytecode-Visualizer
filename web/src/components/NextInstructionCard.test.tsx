import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { firstStepOf, nextInstructionAt } from './__fixtures__/factorial-run';
import { NextInstructionCard, type NextInstructionCardProps } from './NextInstructionCard';

/** The card as the app fills it at `step` of the real `factorial(4)` run. */
function detailsAt(step: number): NextInstructionCardProps {
  const details = nextInstructionAt(step);
  if (details === undefined) {
    throw new Error(`step ${String(step)} of the Factorial run has no next instruction`);
  }
  return details;
}

describe('NextInstructionCard', () => {
  it('renders the stack effect pills and the explanation', () => {
    // Step 1: `invokestatic #7` in main, with the argument 4 already on the stack.
    render(<NextInstructionCard {...detailsAt(1)} />);

    expect(screen.getByText('pop 1')).toBeInTheDocument();
    expect(screen.getByText('push frame')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pops 4 and calls factorial(I)I with it in slot 0 — the callee starts at pc 0 and ' +
          'main resumes at pc 4.',
      ),
    ).toBeInTheDocument();
  });

  it('omits the constant pool chain when the instruction has no CP operand', () => {
    // Step 0: `iconst_4`, which names nothing in the pool.
    render(<NextInstructionCard {...detailsAt(0)} />);

    expect(screen.queryByTestId('cp-chain')).not.toBeInTheDocument();
  });

  it('resolves the constant pool reference of invokestatic down to the method name', () => {
    render(<NextInstructionCard {...detailsAt(firstStepOf('invokestatic', 2))} />);

    const chain = within(screen.getByTestId('cp-chain'));

    expect(chain.getByText('#7')).toBeInTheDocument();
    expect(chain.getByText('Methodref')).toBeInTheDocument();
    expect(chain.getByText('Factorial.factorial:(I)I')).toBeInTheDocument();
  });

  it('describes the effect of the instruction on the values of the current snapshot', () => {
    // The first `isub` computes the argument of the recursive call: 4 − 1 = 3.
    render(<NextInstructionCard {...detailsAt(firstStepOf('isub'))} />);

    expect(screen.getByText('pop 2')).toBeInTheDocument();
    expect(screen.getByText(/pushes 4 − 1 = 3/)).toBeInTheDocument();
  });

  it('has no card to render for the terminal snapshot', () => {
    expect(nextInstructionAt(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });
});
