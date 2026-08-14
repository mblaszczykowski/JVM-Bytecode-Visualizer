import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../../core/classfile';
import { readExampleBytes } from '../../services/__fixtures__/example-files';
import { constantPoolRowsOf, type ConstantPoolRow } from '../../services/views/class-view';

import { ConstantPoolList } from './ConstantPoolList';
import { POOL_INDEX_COLUMN } from '../ui/rhythm';

const rows = constantPoolRowsOf(parseClassFile(readExampleBytes('Factorial.class')).constantPool);

const METHODREF = 'Constant pool entry #7, Methodref, Factorial.factorial:(I)I';

function rowAt(index: number): HTMLElement {
  const row = screen
    .getAllByTestId('constant-row')
    .find((element) => element.dataset.index === String(index));
  if (row === undefined) {
    throw new Error(`No constant pool row rendered for #${String(index)}`);
  }
  return row;
}

describe('ConstantPoolList', () => {
  it('renders one row per occupied slot, in index order', () => {
    render(<ConstantPoolList rows={rows} />);

    const rendered = screen.getAllByTestId('constant-row');

    expect(rendered).toHaveLength(rows.length);
    expect(rendered.map((row) => row.dataset.index)).toEqual(rows.map((row) => String(row.index)));
  });

  it('resolves a Methodref down to the method it names', () => {
    render(<ConstantPoolList rows={rows} />);

    const methodref = within(rowAt(7));

    expect(methodref.getByText('#7')).toBeInTheDocument();
    expect(methodref.getByText('Methodref')).toBeInTheDocument();
    expect(methodref.getByText('Factorial.factorial:(I)I')).toBeInTheDocument();
  });

  it('follows the entries a Methodref points at', () => {
    const onSelectIndex = vi.fn();
    render(<ConstantPoolList rows={rows} onSelectIndex={onSelectIndex} />);

    const methodref = within(rowAt(7));
    expect(methodref.getByRole('button', { name: 'Follow constant pool entry #8' })).toBeVisible();

    fireEvent.click(methodref.getByRole('button', { name: 'Follow constant pool entry #9' }));

    expect(onSelectIndex).toHaveBeenCalledWith(9);
  });

  it('selects a row when the row itself is activated', () => {
    const onSelectIndex = vi.fn();
    render(<ConstantPoolList rows={rows} onSelectIndex={onSelectIndex} />);

    fireEvent.click(screen.getByRole('button', { name: METHODREF }));

    expect(onSelectIndex).toHaveBeenCalledWith(7);
  });

  it('marks the selected entry as the reader position', () => {
    render(<ConstantPoolList rows={rows} selectedIndex={7} />);

    const selected = rowAt(7);

    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(rowAt(8)).not.toHaveAttribute('aria-current');
    expect(
      screen.getAllByTestId('constant-row').filter((row) => row.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('puts only the selected row in the tab order, its own references included', () => {
    render(<ConstantPoolList rows={rows} selectedIndex={7} onSelectIndex={vi.fn()} />);

    const reachable = screen.getAllByRole('button').filter((button) => button.tabIndex === 0);

    expect(reachable.map((button) => button.getAttribute('aria-label'))).toEqual([
      METHODREF,
      'Follow constant pool entry #8',
      'Follow constant pool entry #9',
    ]);
    expect(reachable.every((button) => rowAt(7).contains(button))).toBe(true);
  });

  it('moves the anchor with the arrow keys', () => {
    render(<ConstantPoolList rows={rows} selectedIndex={7} onSelectIndex={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: METHODREF }), { key: 'ArrowDown' });

    expect(document.activeElement).toHaveAccessibleName('Constant pool entry #8, Class, Factorial');
  });

  it('moves the anchor from a reference chip too, not only from the row', () => {
    render(<ConstantPoolList rows={rows} selectedIndex={7} onSelectIndex={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Follow constant pool entry #8' }), {
      key: 'ArrowDown',
    });

    expect(document.activeElement).toHaveAccessibleName('Constant pool entry #8, Class, Factorial');
  });

  it('leaves room for the widest index a constant pool can address', () => {
    const widest: ConstantPoolRow = {
      index: 65534,
      tagName: 'Utf8',
      text: 'the last slot a u2 pool count can address',
      references: [],
    };
    render(<ConstantPoolList rows={[widest]} />);

    expect(screen.getByText('#65534')).toHaveClass(...POOL_INDEX_COLUMN.split(' '));
  });

  it('stays readable without a selection handler, references and all', () => {
    const utf8: ConstantPoolRow = { index: 1, tagName: 'Utf8', text: 'Factorial', references: [] };
    const classEntry: ConstantPoolRow = {
      index: 2,
      tagName: 'Class',
      text: 'Factorial',
      references: [1],
    };
    render(<ConstantPoolList rows={[utf8, classEntry]} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(within(rowAt(2)).getByText('#1')).toBeInTheDocument();
  });
});
