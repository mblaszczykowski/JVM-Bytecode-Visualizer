import { type ChangeEvent, type DragEvent, useId, useState } from 'react';

interface FileUploadProps {
  /** Only the choice of file. Validation and parsing happen upstream. */
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
      className={`flex items-center gap-2 rounded-full p-1 transition-colors ${
        isDragging ? 'bg-accent/[0.22]' : ''
      }`}
    >
      <label
        htmlFor={inputId}
        className="cursor-pointer rounded-full bg-white/9 px-3 py-1.5 text-[12px] text-white/80 shadow-control-raised transition-colors hover:bg-white/15"
      >
        Open .class…
      </label>
      <span className="hidden text-[11px] text-white/32 lg:inline">or drop it here</span>
      <input
        id={inputId}
        type="file"
        accept=".class,application/java-vm"
        onChange={handleInputChange}
        className="focus-ring sr-only"
      />
    </div>
  );
}
