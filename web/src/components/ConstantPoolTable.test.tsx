import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { readExampleBytes } from '../services/__fixtures__/example-files';
import { constantPoolRowsOf, type ConstantPoolRow } from '../services/class-view';

import { ConstantPoolTable } from './ConstantPoolTable';

/** The real constant pool of the committed `Factorial.class`. */
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

describe('ConstantPoolTable', () => {
  it('renders one row per occupied slot, in index order', () => {
    render(<ConstantPoolTable rows={rows} />);

    const rendered = screen.getAllByTestId('constant-row');

    expect(rendered).toHaveLength(rows.length);
    expect(rendered.map((row) => row.dataset.index)).toEqual(rows.map((row) => String(row.index)));
  });

  it('resolves a Methodref down to the method it names', () => {
    render(<ConstantPoolTable rows={rows} />);

    const methodref = within(rowAt(7));

    expect(methodref.getByText('#7')).toBeInTheDocument();
    expect(methodref.getByText('Methodref')).toBeInTheDocument();
    expect(methodref.getByText('Factorial.factorial:(I)I')).toBeInTheDocument();
  });

  it('follows the entries a Methodref points at', () => {
    const onSelectIndex = vi.fn();
    render(<ConstantPoolTable rows={rows} onSelectIndex={onSelectIndex} />);

    // #7 names its Class (#8) and its NameAndType (#9) — JVMS §4.4.2.
    const methodref = within(rowAt(7));
    expect(methodref.getByRole('button', { name: 'Follow constant pool entry #8' })).toBeVisible();

    fireEvent.click(methodref.getByRole('button', { name: 'Follow constant pool entry #9' }));

    expect(onSelectIndex).toHaveBeenCalledWith(9);
  });

  it('selects a row when the row itself is activated', () => {
    const onSelectIndex = vi.fn();
    render(<ConstantPoolTable rows={rows} onSelectIndex={onSelectIndex} />);

    fireEvent.click(screen.getByRole('button', { name: METHODREF }));

    expect(onSelectIndex).toHaveBeenCalledWith(7);
  });

  it('marks the selected entry as the reader position', () => {
    render(<ConstantPoolTable rows={rows} selectedIndex={7} />);

    const selected = rowAt(7);

    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(selected.className).toContain('bg-accent/[0.22]');
    expect(rowAt(8)).not.toHaveAttribute('aria-current');
    expect(
      screen.getAllByTestId('constant-row').filter((row) => row.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('takes a single tab stop for the whole pool, anchored on the selected row', () => {
    render(<ConstantPoolTable rows={rows} selectedIndex={7} onSelectIndex={vi.fn()} />);

    const reachable = screen.getAllByRole('button').filter((button) => button.tabIndex === 0);

    // The row itself, plus the two references it can be followed through.
    expect(reachable).toHaveLength(3);
    expect(reachable[0]).toHaveAccessibleName(METHODREF);
  });

  it('moves the anchor with the arrow keys', () => {
    render(<ConstantPoolTable rows={rows} selectedIndex={7} onSelectIndex={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: METHODREF }), { key: 'ArrowDown' });

    expect(document.activeElement).toHaveAccessibleName('Constant pool entry #8, Class, Factorial');
  });

  it('stays readable without a selection handler, references and all', () => {
    const utf8: ConstantPoolRow = { index: 1, tagName: 'Utf8', text: 'Factorial', references: [] };
    const classEntry: ConstantPoolRow = {
      index: 2,
      tagName: 'Class',
      text: 'Factorial',
      references: [1],
    };
    render(<ConstantPoolTable rows={[utf8, classEntry]} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(within(rowAt(2)).getByText('#1')).toBeInTheDocument();
  });
});
