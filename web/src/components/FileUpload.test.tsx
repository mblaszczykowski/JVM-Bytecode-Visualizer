import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload } from './FileUpload';

function classFile(): File {
  return new File([new Uint8Array([0xca, 0xfe, 0xba, 0xbe])], 'Factorial.class');
}

describe('FileUpload', () => {
  it('zgłasza plik wybrany przez okno systemowe', () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);

    const file = classFile();
    fireEvent.change(screen.getByLabelText('Otwórz plik .class…'), { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('zgłasza plik upuszczony na strefę drop', () => {
    const onFileSelected = vi.fn();
    render(<FileUpload onFileSelected={onFileSelected} />);

    const file = classFile();
    fireEvent.drop(screen.getByTestId('file-drop-zone'), { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('podświetla strefę drop w trakcie przeciągania', () => {
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
});
