import { type ChangeEvent, type DragEvent, useId, useState } from 'react';

import { CONTROL, FOCUS_RING } from './theme';

interface FileUploadProps {
  /** Sam wybór pliku. Walidacja i parsowanie to Faza 7 — komponent niczego nie czyta. */
  readonly onFileSelected: (file: File) => void;
}

export function FileUpload({ onFileSelected }: FileUploadProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(): void {
    setIsDragging(false);
  }

  return (
    <div
      data-testid="file-drop-zone"
      data-dragging={isDragging}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`flex items-center gap-2 rounded-full px-1 py-1 transition-colors ${
        isDragging ? 'bg-[rgb(10_132_255/0.22)]' : ''
      }`}
    >
      <label htmlFor={inputId} className={`${CONTROL} cursor-pointer`}>
        Otwórz plik .class…
      </label>
      <span className="hidden text-[11px] text-white/35 lg:inline">albo upuść tutaj</span>
      <input
        id={inputId}
        type="file"
        accept=".class,application/java-vm"
        onChange={handleInputChange}
        className={`sr-only ${FOCUS_RING}`}
      />
    </div>
  );
}
