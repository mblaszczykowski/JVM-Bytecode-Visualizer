import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunPreview } from '../services/program';

import { GlossaryDialog } from './GlossaryDialog';
import { closeGlossary } from './glossary-store';
import { WelcomeScreen, type WelcomeExample } from './WelcomeScreen';

afterEach(() => {
  act(() => {
    closeGlossary();
  });
});

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
    // Ahead of the drop zone, not after the last section: the column is top-anchored, so a
    // banner at the end of it is below the fold on an ordinary laptop.
    expect(
      banner.compareDocumentPosition(screen.getByTestId('file-drop-zone')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  /**
   * The capability note is the answer to "will my own file work", so it has to be readable at
   * the moment that question comes up: after the drop zone, before anyone picks a file.
   */
  it('states what the machine can run right below the drop zone', () => {
    renderWelcome();

    const note = screen.getByTestId('welcome-capabilities');
    const dropZone = screen.getByTestId('file-drop-zone');

    expect(note).toHaveTextContent(/Runs the integer subset of the JVM/);
    expect(dropZone.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * The first screen is where a reader decides whether any of this is for them, and it is the
   * only screen with no panel headers to ask from — so the invitation lives on the heading's
   * own line, ahead of the cards and costing them no room.
   */
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

  /**
   * jsdom has no layout, so the guard is on the two class-level decisions that produce it:
   * a column main axis (auto margins collapse to zero on overflow and anchor the block to
   * the top) and the mask that makes a cut edge read as more content.
   */
  it('spills off the bottom on a short viewport instead of losing the headline off the top', () => {
    renderWelcome();

    const screenEl = screen.getByTestId('welcome-screen');
    const content = screenEl.firstElementChild;

    expect(screenEl.className).toContain('flex-col');
    expect(screenEl.className).toContain('fade-y');
    expect(content?.className).toContain('m-auto');
  });

  it('anchors the type scale on the headline rather than on more small grey text', () => {
    renderWelcome();

    const headline = screen.getByRole('heading', { name: /Watch a Java program run/ });

    expect(headline.className).toContain('text-display');
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
