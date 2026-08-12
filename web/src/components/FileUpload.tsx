import { type ChangeEvent, type DragEvent, useId, useRef, useState } from 'react';

import { MAX_UPLOAD_LABEL } from '../services/app-state';

import { buttonSurface } from './ui/button-surface';

export type FileUploadVariant = 'compact' | 'zone';

interface FileUploadProps {
  readonly onFileSelected: (file: File) => void;
  readonly variant?: FileUploadVariant;
}

const CONTAINER: Record<FileUploadVariant, string> = {
  compact: '-my-1 flex shrink-0 items-center gap-2 rounded-control p-1',
  zone: 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-panel px-5 py-4 shadow-panel',
};

const IDLE_SURFACE: Record<FileUploadVariant, string> = {
  compact: '',
  zone: 'bg-panel',
};

export function FileUpload({ onFileSelected, variant = 'compact' }: FileUploadProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    depth.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDragEnter(): void {
    depth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(): void {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setIsDragging(false);
    }
  }

  return (
    <div
      data-testid="file-drop-zone"
      data-variant={variant}
      data-dragging={isDragging}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`focus-ring-within ${CONTAINER[variant]} transition-colors duration-150 ${
        isDragging ? 'bg-accent-wash' : IDLE_SURFACE[variant]
      }`}
    >
      <label htmlFor={inputId} className={buttonSurface('prominent', 'md', 'cursor-pointer')}>
        Open .class…
      </label>
      {variant === 'zone' ? (
        <span className="text-meta text-fg-3">
          {`or drop a .class file here (up to ${MAX_UPLOAD_LABEL}, parsed in this tab)`}
        </span>
      ) : null}
      <input
        id={inputId}
        type="file"
        accept=".class,application/java-vm"
        onChange={handleInputChange}
        className="sr-only"
      />
    </div>
  );
}
