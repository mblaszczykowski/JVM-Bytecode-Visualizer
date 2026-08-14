import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RunPreview } from '../../services/loading/program';

import { GlossaryDialog } from '../dialogs/GlossaryDialog';
import { WelcomeScreen, type WelcomeExample } from './WelcomeScreen';

const PREVIEW: RunPreview = {
  steps: 118,
  maxDepth: 4,
  profile: Array.from({ length: 32 }, (_, bucket) => (bucket % 4) + 1),
};

const EXAMPLES: readonly WelcomeExample[] = [
  {
    id: 'factorial',
    title: 'Factorial',
    tagline: 'Recursion, four frames deep.',
    preview: PREVIEW,
  },
  { id: 'gcd', title: 'GCD', tagline: 'A loop with a backward jump.' },
];

function renderWelcome(overrides: Partial<Parameters<typeof WelcomeScreen>[0]> = {}) {
  const props = {
    examples: EXAMPLES,
    onExampleSelected: vi.fn(),
    onFileSelected: vi.fn(),
    ...overrides,
  };
  render(<WelcomeScreen {...props} />);
  return props;
}

describe('WelcomeScreen', () => {
  it('offers every example as its own target', () => {
    const { onExampleSelected } = renderWelcome();

    const cards = screen.getAllByTestId('welcome-example');
    expect(cards).toHaveLength(EXAMPLES.length);

    fireEvent.click(cards[0] ?? document.body);
    expect(onExampleSelected).toHaveBeenCalledWith('factorial');
  });

  it('shows the shape of a run only once it has been measured', () => {
    renderWelcome();
    const [factorial, gcd] = screen.getAllByTestId('welcome-example');

    expect(within(factorial ?? document.body).getAllByTestId('welcome-sparkline-bar')).toHaveLength(
      32,
    );
    expect(factorial).toHaveTextContent('118 steps · depth 4');
    expect(within(gcd ?? document.body).queryAllByTestId('welcome-sparkline-bar')).toHaveLength(0);
  });

  it('names the three stages as terms with their definitions', () => {
    renderWelcome();

    const pipeline = within(screen.getByTestId('pipeline'));

    expect(pipeline.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Parse',
      'Disassemble',
      'Execute',
    ]);
    expect(pipeline.getAllByRole('definition')).toHaveLength(3);
  });

  it('hides the compile entry point until a service answers for it', () => {
    renderWelcome();

    expect(screen.queryByTestId('welcome-write-java')).not.toBeInTheDocument();
  });

  it('offers the editor once a compile service is there', () => {
    const onWriteJava = vi.fn();
    renderWelcome({ onWriteJava });

    fireEvent.click(screen.getByTestId('welcome-write-java'));

    expect(onWriteJava).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed load inside the screen it came from', () => {
    const onDismiss = vi.fn();
    renderWelcome({
      notice: { severity: 'error', message: 'Not a .class file.', onDismiss },
    });

    const banner = screen.getByTestId('error-banner');

    expect(banner).toHaveTextContent('Not a .class file.');
    expect(screen.getByTestId('welcome-screen')).toContainElement(banner);
    expect(
      banner.compareDocumentPosition(screen.getByTestId('file-drop-zone')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('states what the machine can run right below the drop zone', () => {
    renderWelcome();

    const note = screen.getByTestId('welcome-capabilities');
    const dropZone = screen.getByTestId('file-drop-zone');

    expect(note).toHaveTextContent(/Runs the integer subset of the JVM/);
    expect(dropZone.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the vocabulary without pushing the examples down', () => {
    render(
      <>
        <WelcomeScreen examples={EXAMPLES} onExampleSelected={vi.fn()} onFileSelected={vi.fn()} />
        <GlossaryDialog />
      </>,
    );

    const pointer = screen.getByTestId('welcome-glossary');
    const firstExample = screen.getAllByTestId('welcome-example')[0] ?? document.body;
    expect(
      pointer.compareDocumentPosition(firstExample) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(pointer);

    expect(screen.getByRole('dialog', { name: 'Glossary' })).toBeInTheDocument();
  });

  it('keeps the examples ahead of the note, so the first frame is still the examples', () => {
    renderWelcome();

    const note = screen.getByTestId('welcome-capabilities');
    const lastExample = screen.getAllByTestId('welcome-example').at(-1) ?? document.body;

    expect(note).not.toHaveAttribute('open');
    expect(
      lastExample.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
