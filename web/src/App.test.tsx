import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { mockHistory } from './components/__fixtures__/mock-history';

describe('App', () => {
  it('renderuje nagłówek aplikacji', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'JVM Bytecode Visualizer' }),
    ).toBeVisible();
  });

  it('składa layout z pięciu paneli stanu', () => {
    render(<App />);

    for (const name of ['Źródło', 'Bajtkod', 'Stos wywołań', 'Stos operandów', 'Zmienne lokalne']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('startuje na pierwszym snapshocie mockowej historii', () => {
    render(<App />);

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `krok 1 / ${String(mockHistory.length)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('iconst_2');
    expect(screen.getByTestId('current-source-line')).toHaveTextContent(
      'int result = factorial(2);',
    );
  });

  it('przesuwa historię przyciskami kroku', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Krok naprzód' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `krok 2 / ${String(mockHistory.length)}`,
    );
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('invokestatic');

    fireEvent.click(screen.getByRole('button', { name: 'Krok wstecz' }));

    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `krok 1 / ${String(mockHistory.length)}`,
    );
  });

  it('pokazuje najgłębszy stos wywołań po przewinięciu scrubberem', () => {
    render(<App />);

    fireEvent.change(screen.getByRole('slider', { name: 'Pozycja w historii wykonania' }), {
      target: { value: '10' },
    });

    expect(screen.getAllByTestId('call-frame')).toHaveLength(3);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('iload_0');
    expect(screen.getAllByTestId('local-slot')).toHaveLength(1);
  });

  it('pokazuje puste panele w snapshocie terminalnym', () => {
    render(<App />);

    fireEvent.change(screen.getByRole('slider', { name: 'Pozycja w historii wykonania' }), {
      target: { value: String(mockHistory.length - 1) },
    });

    expect(screen.queryByTestId('call-frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();
    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
    expect(screen.getAllByText('Brak aktywnej ramki.')).toHaveLength(2);
  });

  it('przełącza przycisk odtwarzania między play i pauzą', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Odtwórz' }));

    expect(screen.getByRole('button', { name: 'Wstrzymaj' })).toBeInTheDocument();
  });
});
