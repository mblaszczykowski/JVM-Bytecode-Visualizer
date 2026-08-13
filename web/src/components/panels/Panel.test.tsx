import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GlossaryDialog } from '../dialogs/GlossaryDialog';
import { Panel } from './Panel';

describe('Panel', () => {
  it('names its region once, and repeats the name where it can be seen', () => {
    render(
      <Panel title="Operand stack" meta="height 2">
        <p>cells</p>
      </Panel>,
    );

    const region = screen.getByRole('region', { name: 'Operand stack' });
    expect(region).toHaveTextContent('height 2');
    expect(screen.getByRole('heading', { level: 2, name: 'Operand stack' })).toBeInTheDocument();
  });

  it('puts a listing on ink and leaves the State column its own surface', () => {
    const { rerender } = render(
      <Panel title="Bytecode">
        <p>rows</p>
      </Panel>,
    );

    expect(screen.getByRole('region', { name: 'Bytecode' }).className).toContain('bg-ink');

    rerender(
      <Panel title="Locals" variant="state">
        <p>slots</p>
      </Panel>,
    );

    expect(screen.getByRole('region', { name: 'Locals' }).className).not.toContain('bg-ink');
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

  it('marks a scrolling body, so the transport gives it the arrow keys', () => {
    const { rerender } = render(
      <Panel title="Locals">
        <p>slots</p>
      </Panel>,
    );

    const body = screen.getByRole('region', { name: 'Locals' }).querySelector('[tabindex="0"]');
    expect(body).toHaveAttribute('data-scroll-region');

    rerender(
      <Panel title="Locals" scrolls={false}>
        <p>slots</p>
      </Panel>,
    );

    expect(
      screen.getByRole('region', { name: 'Locals' }).querySelector('[data-scroll-region]'),
    ).toBeNull();
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
