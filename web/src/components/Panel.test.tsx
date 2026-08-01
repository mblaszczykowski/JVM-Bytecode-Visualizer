import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GlossaryDialog } from './GlossaryDialog';
import { closeGlossary } from './glossary-store';
import { Panel } from './Panel';

afterEach(() => {
  act(() => {
    closeGlossary();
  });
});

describe('Panel', () => {
  it('names its region once, and repeats the name where it can be seen', () => {
    render(
      <Panel title="Operand stack" meta="height 2">
        <p>cells</p>
      </Panel>,
    );

    const region = screen.getByRole('region', { name: 'Operand stack' });
    expect(region).toHaveTextContent('height 2');
    // The visible copy is decoration over the heading; announcing it twice says nothing.
    expect(screen.getByRole('heading', { level: 2, name: 'Operand stack' })).toBeInTheDocument();
  });

  it('offers an explanation of the concept its header names', () => {
    render(
      <>
        <Panel title="Operand stack">
          <p>cells</p>
        </Panel>
        <GlossaryDialog />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'What is the operand stack?' }));

    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'operand-stack');
  });

  it.each([
    ['Call stack', 'call-stack'],
    ['Locals', 'local-variable-slot'],
    ['Bytecode', 'opcode'],
    ['Class file', 'constant-pool'],
    ['Source', 'line-number-table'],
  ])('points the %s panel at its own term', (title, term) => {
    const { getByTestId } = render(
      <Panel title={title}>
        <p>body</p>
      </Panel>,
    );

    expect(getByTestId('glossary-trigger')).toHaveAttribute('data-term', term);
  });

  it('adds nothing to a panel that draws no concept of its own', () => {
    render(
      <Panel title="Console" meta="4 lines">
        <p>output</p>
      </Panel>,
    );

    expect(screen.queryByTestId('glossary-trigger')).not.toBeInTheDocument();
  });
});
