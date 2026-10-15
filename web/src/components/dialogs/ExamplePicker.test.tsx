import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleOptions } from '../__fixtures__/factorial-run';
import { ExamplePicker } from './ExamplePicker';

const examples = exampleOptions();

const last = examples[examples.length - 1] ?? { id: '', name: '' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function options(): HTMLElement[] {
  return screen.getAllByTestId('example-option');
}

describe('ExamplePicker', () => {
  it('renders the examples it is given', () => {
    render(
      <ExamplePicker examples={examples} selectedId={undefined} onExampleSelected={vi.fn()} />,
    );

    expect(screen.getByRole('group', { name: 'Example programs' })).toBeInTheDocument();
    expect(options()).toHaveLength(examples.length);
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeInTheDocument();
  });

  it('marks the selected example the way every other single-select control does', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'GCD', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Factorial', pressed: false })).toBeInTheDocument();
  });

  it('keeps one tab stop and moves the focus with the arrow keys', () => {
    const onExampleSelected = vi.fn();
    render(
      <ExamplePicker
        examples={examples}
        selectedId={last.id}
        onExampleSelected={onExampleSelected}
      />,
    );

    expect(options().map((option) => option.getAttribute('tabindex'))).toEqual(
      examples.map((_, index) => (index === examples.length - 1 ? '0' : '-1')),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: last.name }), { key: 'ArrowRight' });

    expect(options()[0]).toHaveFocus();
    expect(onExampleSelected).not.toHaveBeenCalled();
  });

  it('keeps every option on one rail rather than wrapping some of them out of reach', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Example programs' });

    expect(options()).toHaveLength(examples.length);
    expect(options().every((option) => option.parentElement === group)).toBe(true);
  });

  it('reports the id of the example that was clicked', () => {
    const onExampleSelected = vi.fn();
    render(
      <ExamplePicker
        examples={examples}
        selectedId="factorial"
        onExampleSelected={onExampleSelected}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sum of products' }));

    expect(onExampleSelected).toHaveBeenCalledWith('sum-of-products');
  });

  it('keeps an option tabbable when the focused position disappears from the catalogue', () => {
    const { rerender } = render(
      <ExamplePicker examples={examples} selectedId={undefined} onExampleSelected={vi.fn()} />,
    );
    const first = options()[0];
    if (first === undefined) {
      throw new Error('the first example is missing');
    }
    fireEvent.keyDown(first, { key: 'ArrowLeft' });

    rerender(
      <ExamplePicker
        examples={examples.slice(0, 2)}
        selectedId={undefined}
        onExampleSelected={vi.fn()}
      />,
    );

    expect(options().filter((option) => option.tabIndex === 0)).toHaveLength(1);
  });
});

describe('the folded picker', () => {
  it('releases the mobile modal when the viewport switches to the desktop rail', () => {
    const mediaEvents = new EventTarget();
    const media = {
      matches: false,
      addEventListener: mediaEvents.addEventListener.bind(mediaEvents),
      removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents),
    };
    vi.stubGlobal('matchMedia', () => media);
    const { trigger } = renderCollapsed();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      media.matches = true;
      mediaEvents.dispatchEvent(new Event('change'));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('example-picker-scrim')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  function renderCollapsed(onExampleSelected = vi.fn()) {
    render(
      <ExamplePicker
        examples={examples}
        selectedId="factorial"
        onExampleSelected={onExampleSelected}
        collapsible
      />,
    );
    return {
      onExampleSelected,
      trigger: screen.getByTestId('example-picker-trigger'),
    };
  }

  it('names the current example on the trigger and says the sheet is shut', () => {
    const { trigger } = renderCollapsed();

    expect(trigger).toHaveAccessibleName('Example program: Factorial. Choose another');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a named dialog and takes the focus', () => {
    const { trigger } = renderCollapsed();
    trigger.focus();

    fireEvent.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Example programs' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps exactly one group of options, open or shut', () => {
    const { trigger } = renderCollapsed();

    expect(screen.getAllByRole('group', { name: 'Example programs' })).toHaveLength(1);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('group', { name: 'Example programs' })).toHaveLength(1);
  });

  it('keeps Tab inside the sheet, though only one option is tabbable', () => {
    const { trigger } = renderCollapsed();
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog');
    const tabbable = options().filter((option) => option.tabIndex >= 0);

    expect(tabbable).toHaveLength(1);
    const anchor = tabbable[0];
    if (anchor === undefined) {
      throw new Error('the roving tab stop is missing');
    }
    anchor.focus();

    const forward = createEvent.keyDown(sheet, { key: 'Tab' });
    fireEvent(sheet, forward);

    expect(forward.defaultPrevented).toBe(true);
    expect(anchor).toHaveFocus();
  });

  it('closes on Escape and hands the focus back to the trigger', () => {
    const { trigger } = renderCollapsed();
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on the scrim, choosing nothing', () => {
    const { trigger, onExampleSelected } = renderCollapsed();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('example-picker-scrim'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onExampleSelected).not.toHaveBeenCalled();
  });

  it('picks an example and folds itself away again', () => {
    const { trigger, onExampleSelected } = renderCollapsed();
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('button', { name: 'GCD' }));

    expect(onExampleSelected).toHaveBeenCalledWith('gcd');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('still moves between the options with the arrow keys inside the sheet', () => {
    const { trigger } = renderCollapsed();
    fireEvent.click(trigger);

    const [first, second] = examples;
    fireEvent.keyDown(screen.getByRole('button', { name: first?.name ?? '' }), {
      key: 'ArrowDown',
    });

    expect(screen.getByRole('button', { name: second?.name ?? '' })).toHaveFocus();
  });
});
