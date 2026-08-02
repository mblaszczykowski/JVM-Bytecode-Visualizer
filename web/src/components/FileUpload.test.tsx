import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload } from './FileUpload';

function classFile(): File {
  return new File([new Uint8Array([0xca, 0xfe, 0xba, 0xbe])], 'Factorial.class');
}

describe('FileUpload', () => {
  it('reports a file chosen through the system dialog', () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);

    const file = classFile();
    fireEvent.change(screen.getByLabelText('Open .class…'), { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('reports a file dropped on the drop zone', () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);

    const file = classFile();
    fireEvent.drop(screen.getByTestId('file-drop-zone'), { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('highlights the drop zone while a file is dragged over it', () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);

    const zone = screen.getByTestId('file-drop-zone');
    expect(zone).toHaveAttribute('data-dragging', 'false');

    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveAttribute('data-dragging', 'true');

    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute('data-dragging', 'false');
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it('keeps a drop hint in both variants', () => {
    const { rerender } = render(<FileUpload onFileSelected={vi.fn()} />);

    // The toolbar variant hides its hint below `lg`; it is a breakpoint, not a casualty of
    // the row running out of width.
    const compact = screen.getByText('or drop it here');
    expect(compact.className).toContain('hidden');
    expect(compact.className).toContain('lg:inline');

    rerender(<FileUpload onFileSelected={vi.fn()} variant="zone" />);

    expect(screen.getByText(/or drop a \.class file here/)).toBeVisible();
  });

  it('stays highlighted while the pointer crosses the elements inside the zone', () => {
    render(<FileUpload onFileSelected={vi.fn()} variant="zone" />);

    const zone = screen.getByTestId('file-drop-zone');
    const label = screen.getByText('Open .class…');

    // A drag entering a child fires `dragleave` on the parent first; counting the two
    // against each other is what stops the highlight flickering on every element crossed.
    fireEvent.dragEnter(zone);
    fireEvent.dragEnter(label);
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute('data-dragging', 'true');

    fireEvent.dragLeave(label);
    expect(zone).toHaveAttribute('data-dragging', 'false');
  });
});
