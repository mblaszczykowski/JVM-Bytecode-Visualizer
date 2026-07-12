import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { commentsFor } from './__fixtures__/mock-derivations';
import { mockFactorialMethod, mockUnsupportedMethod } from './__fixtures__/mock-history';
import { BytecodePanel } from './BytecodePanel';
import { ROW_HEIGHT } from './rhythm';

function renderFactorial(currentOffset: number | undefined) {
  return render(
    <BytecodePanel
      methodName={mockFactorialMethod.name}
      methodDescriptor={mockFactorialMethod.descriptor}
      maxStack={mockFactorialMethod.maxStack}
      maxLocals={mockFactorialMethod.maxLocals}
      instructions={mockFactorialMethod.instructions}
      currentOffset={currentOffset}
    />,
  );
}

describe('BytecodePanel', () => {
  it('renders the listing of the current method with its signature and Code limits', () => {
    renderFactorial(undefined);

    expect(screen.getByRole('region', { name: 'Bytecode' })).toBeInTheDocument();
    expect(screen.getByText('factorial(I)I · max 2/1')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(mockFactorialMethod.instructions.length);
  });

  it('highlights the instruction under the pc of the top frame', () => {
    renderFactorial(11);

    const current = screen.getByTestId('current-instruction');

    expect(current).toHaveAttribute('data-offset', '11');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('invokestatic');
    expect(screen.getAllByTestId('current-instruction')).toHaveLength(1);
  });

  it('announces the current instruction for assistive technology', () => {
    renderFactorial(11);

    expect(screen.getByText('pc 11 · invokestatic #7')).toBeInTheDocument();
  });

  it('highlights nothing when the call stack is empty', () => {
    renderFactorial(undefined);

    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();
    expect(screen.getByText('No active instruction.')).toBeInTheDocument();
  });

  it('shows the absolute jump target instead of the raw delta', () => {
    renderFactorial(2);
    const row = within(screen.getByTestId('current-instruction'));

    expect(row.getByText('if_icmpgt')).toBeInTheDocument();
    // The operand in the stream is the delta 5; the target (2 + 5) is 7, which is what shows.
    expect(row.getByText('7')).toBeInTheDocument();
    expect(row.queryByText('5')).not.toBeInTheDocument();
  });

  it('renders the invokestatic operand as a constant pool reference', () => {
    renderFactorial(11);

    expect(within(screen.getByTestId('current-instruction')).getByText('#7')).toBeInTheDocument();
  });

  it('draws a branch arc spanning the rows between the jump and its target', () => {
    renderFactorial(2);

    const arc = screen.getByTestId('branch-arc');

    // `if_icmpgt` is row 2 and targets offset 7, which is row 5.
    expect(arc).toHaveStyle({ height: `${String((5 - 2) * ROW_HEIGHT)}px` });
  });

  it('shows the resolved constant pool entry as a javap-style comment', () => {
    render(
      <BytecodePanel
        methodName={mockFactorialMethod.name}
        methodDescriptor={mockFactorialMethod.descriptor}
        maxStack={mockFactorialMethod.maxStack}
        maxLocals={mockFactorialMethod.maxLocals}
        instructions={mockFactorialMethod.instructions}
        currentOffset={11}
        comments={commentsFor(mockFactorialMethod)}
      />,
    );

    expect(
      within(screen.getByTestId('current-instruction')).getByText('// Method factorial:(I)I'),
    ).toBeInTheDocument();
  });

  it('marks instructions outside the supported subset as unsupported', () => {
    render(
      <BytecodePanel
        methodName={mockUnsupportedMethod.name}
        methodDescriptor={mockUnsupportedMethod.descriptor}
        maxStack={mockUnsupportedMethod.maxStack}
        maxLocals={mockUnsupportedMethod.maxLocals}
        instructions={mockUnsupportedMethod.instructions}
        currentOffset={0}
      />,
    );

    expect(screen.getAllByText('unsupported')).toHaveLength(2);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('getstatic');
  });

  it('reports the rest of the method as undecoded after a variable-length instruction', () => {
    render(
      <BytecodePanel
        methodName={mockUnsupportedMethod.name}
        methodDescriptor={mockUnsupportedMethod.descriptor}
        maxStack={mockUnsupportedMethod.maxStack}
        maxLocals={mockUnsupportedMethod.maxLocals}
        instructions={mockUnsupportedMethod.instructions}
        currentOffset={0}
        truncatedAtOffset={7}
      />,
    );

    expect(screen.getByText('… not decoded')).toBeInTheDocument();
  });
});
