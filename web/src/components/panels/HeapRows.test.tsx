import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ArrayObject } from '../../core/interpreter';

import { HEAP_ELEMENTS_PER_PAGE, HeapArrayRow } from './HeapRows';

function arrayOf(length: number): ArrayObject {
  return { kind: 'int-array', length, elements: Array.from({ length }, (_, index) => index) };
}

describe('HeapArrayRow', () => {
  it('bounds the rendered cells and lets every page be inspected', () => {
    const array = arrayOf(HEAP_ELEMENTS_PER_PAGE * 2 + 5);
    render(
      <ol>
        <HeapArrayRow array={array} handle={0} />
      </ol>,
    );

    expect(screen.getAllByTestId('heap-cell')).toHaveLength(HEAP_ELEMENTS_PER_PAGE);
    expect(screen.getAllByTestId('heap-cell')[0]).toHaveAttribute('data-index', '0');
    expect(screen.getByRole('button', { name: 'Previous elements of array @0' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next elements of array @0' }));
    expect(screen.getAllByTestId('heap-cell')[0]).toHaveAttribute(
      'data-index',
      String(HEAP_ELEMENTS_PER_PAGE),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next elements of array @0' }));

    expect(screen.getAllByTestId('heap-cell')).toHaveLength(5);
    expect(screen.getAllByTestId('heap-cell').at(-1)).toHaveTextContent(String(array.length - 1));
    expect(screen.getByRole('button', { name: 'Next elements of array @0' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous elements of array @0' }));
    expect(screen.getAllByTestId('heap-cell')[0]).toHaveAttribute(
      'data-index',
      String(HEAP_ELEMENTS_PER_PAGE),
    );
  });

  it('follows the accessed element and keeps that page after the instruction completes', () => {
    const array = arrayOf(10_000);
    const { rerender } = render(
      <ol>
        <HeapArrayRow array={array} handle={0} focus={{ index: 9_999, handle: 0, mode: 'read' }} />
      </ol>,
    );

    expect(screen.getAllByTestId('heap-cell').length).toBeLessThanOrEqual(HEAP_ELEMENTS_PER_PAGE);
    expect(screen.getByText('9999', { selector: '[data-testid="heap-cell"]' })).toHaveAttribute(
      'data-current',
      'true',
    );

    rerender(
      <ol>
        <HeapArrayRow array={array} handle={0} />
      </ol>,
    );
    expect(screen.getByText('9999', { selector: '[data-testid="heap-cell"]' })).toBeInTheDocument();

    rerender(
      <ol>
        <HeapArrayRow array={array} handle={0} focus={{ index: 1, handle: 0, mode: 'write' }} />
      </ol>,
    );
    expect(screen.getAllByTestId('heap-cell')[0]).toHaveAttribute('data-index', '0');
    expect(screen.getByText('1', { selector: '[data-testid="heap-cell"]' })).toHaveAttribute(
      'data-current',
      'true',
    );
  });
});
