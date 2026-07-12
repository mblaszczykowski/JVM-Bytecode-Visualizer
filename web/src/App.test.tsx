import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { mockHistory } from './components/__fixtures__/mock-history';

const SCRUBBER = { name: 'Execution history position' };

function seekTo(step: number): void {
  fireEvent.change(screen.getByRole('slider', SCRUBBER), { target: { value: String(step) } });
}

describe('App', () => {
  it('names the application', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'JVM Bytecode Visualizer' }),
    ).toBeVisible();
  });

  it('composes the layout from the five panels', () => {
    render(<App />);

    for (const name of ['Source', 'Bytecode', 'Call stack', 'Operand stack', 'Locals']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('starts on the first snapshot of the mock history', () => {
    render(<App />);

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(mockHistory.length)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('iconst_2');
    expect(screen.getByTestId('current-source-line')).toHaveTextContent(
      'int result = factorial(2);',
    );
  });

  it('moves through the history with the step buttons', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 2 / ${String(mockHistory.length)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('invokestatic');

    fireEvent.click(screen.getByRole('button', { name: 'Step back' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `step 1 / ${String(mockHistory.length)}`,
    );
  });

  it('shows the deepest call stack after scrubbing into the recursion', () => {
    render(<App />);

    seekTo(10);

    expect(screen.getAllByTestId('call-frame')).toHaveLength(3);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('iload_0');
    expect(screen.getAllByTestId('local-slot')).toHaveLength(1);
  });

  it('explains what the next instruction does to the current values', () => {
    render(<App />);

    seekTo(9);

    expect(screen.getByTestId('cp-chain')).toHaveTextContent('#18 factorial:(I)I');
    expect(screen.getByText(/opens a frame for factorial\(I\)I/)).toBeInTheDocument();
    // The value under the argument is the multiplicand `imul` will need after the call.
    expect(screen.getByText('waiting for imul')).toBeInTheDocument();
  });

  it('maps the current source line back to a range of byte offsets', () => {
    render(<App />);

    seekTo(9);

    expect(screen.getByText('pc 7–15')).toBeInTheDocument();
    expect(screen.getByText('LineNumberTable · largest startPc ≤ 11 → line 6')).toBeInTheDocument();
  });

  it('empties the state panels on the terminal snapshot', () => {
    render(<App />);

    seekTo(mockHistory.length - 1);

    expect(screen.queryByTestId('call-frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-instruction-card')).not.toBeInTheDocument();
    expect(screen.getAllByText('No active frame.')).toHaveLength(2);
  });

  it('toggles the transport button between play and pause', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
});
