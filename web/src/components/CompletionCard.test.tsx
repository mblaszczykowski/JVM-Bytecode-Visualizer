import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RunSummary } from '../services/program';

import { heapAt, runSummary, terminalStep } from './__fixtures__/bubble-sort-run';
import { CompletionCard } from './CompletionCard';

const SUMMARY: RunSummary = {
  resultName: 'result',
  resultValue: 24,
  totalSteps: 40,
  maxDepth: 5,
  referenceValue: 24,
};

describe('CompletionCard', () => {
  it('leads with the value the program computed', () => {
    render(<CompletionCard summary={SUMMARY} />);

    const card = within(screen.getByTestId('completion-card'));

    expect(card.getByText('result')).toBeInTheDocument();
    expect(card.getByText('24')).toBeInTheDocument();
    expect(card.getByText('40')).toBeInTheDocument();
    expect(card.getByText('5 frames')).toBeInTheDocument();
  });

  it('says the run agrees with a real JVM when it does', () => {
    render(<CompletionCard summary={SUMMARY} />);

    expect(screen.getByText(/Matches the value a real JVM computed/)).toBeInTheDocument();
  });

  it('stays quiet about the reference when there is none to quote', () => {
    render(<CompletionCard summary={{ ...SUMMARY, referenceValue: undefined }} />);

    expect(screen.queryByText(/Matches the value a real JVM/)).not.toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('leaves nothing behind on the heap out of the payoff', () => {
    render(<CompletionCard summary={runSummary()} heap={heapAt(terminalStep())} />);

    const card = within(screen.getByTestId('completion-card'));
    expect(card.getByTestId('result-value')).toHaveTextContent('1');
    expect(card.getByText('int[5]@0')).toBeInTheDocument();
    expect(card.getAllByTestId('heap-cell').map((cell) => cell.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('says nothing about the heap for a run that never allocated', () => {
    render(<CompletionCard summary={SUMMARY} />);

    expect(screen.queryByTestId('heap-array')).not.toBeInTheDocument();
    expect(screen.queryByText(/Heap as the run left it/)).not.toBeInTheDocument();
  });

  it('shows a dash rather than nothing for a program that leaves no result behind', () => {
    render(
      <CompletionCard
        summary={{ ...SUMMARY, resultValue: undefined, referenceValue: undefined }}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
