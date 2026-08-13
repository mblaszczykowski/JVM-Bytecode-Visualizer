import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { ExamplePicker } from './ExamplePicker';

const examples = exampleOptions();

const last = examples[examples.length - 1] ?? { id: '', name: '' };

describe('ExamplePicker', () => {
  it('renders the examples it is given', () => {
    render(
      <ExamplePicker examples={examples} selectedId={undefined} onExampleSelected={vi.fn()} />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Example programs' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(examples.length);
    expect(screen.getByRole('radio', { name: 'Fibonacci' })).toBeInTheDocument();
  });

  it('marks the selected example', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'GCD', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Factorial', checked: false })).toBeInTheDocument();
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

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(
      examples.map((_, index) => (index === examples.length - 1 ? '0' : '-1')),
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: last.name }), { key: 'ArrowRight' });

    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
    expect(onExampleSelected).not.toHaveBeenCalled();
  });

  it('keeps every option on one rail rather than wrapping some of them out of reach', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: 'Example programs' });
    const options = screen.getAllByRole('radio');

    expect(options).toHaveLength(examples.length);
    expect(options.every((option) => option.parentElement === group)).toBe(true);
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

    fireEvent.click(screen.getByRole('radio', { name: 'Sum of products' }));

    expect(onExampleSelected).toHaveBeenCalledWith('sum-of-products');
  });
});

describe('the folded picker', () => {
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

  it('keeps exactly one radiogroup, open or shut', () => {
    const { trigger } = renderCollapsed();

    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('keeps Tab inside the sheet, though only one radio is tabbable', () => {
    const { trigger } = renderCollapsed();
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog');
    const tabbable = screen.getAllByRole('radio').filter((radio) => radio.tabIndex >= 0);

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

    fireEvent.click(screen.getByRole('radio', { name: 'GCD' }));

    expect(onExampleSelected).toHaveBeenCalledWith('gcd');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('still moves between the options with the arrow keys inside the sheet', () => {
    const { trigger } = renderCollapsed();
    fireEvent.click(trigger);

    const [first, second] = examples;
    fireEvent.keyDown(screen.getByRole('radio', { name: first?.name ?? '' }), {
      key: 'ArrowDown',
    });

    expect(screen.getByRole('radio', { name: second?.name ?? '' })).toHaveFocus();
  });
});
