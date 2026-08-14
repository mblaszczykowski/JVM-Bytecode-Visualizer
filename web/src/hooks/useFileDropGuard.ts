import { useEffect, useRef, useState } from 'react';

export function useFileDropGuard(onFileDropped: (file: File) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const latest = useRef(onFileDropped);

  useEffect(() => {
    latest.current = onFileDropped;
  });

  useEffect(() => {
    let depth = 0;

    function carriesFiles(event: DragEvent): boolean {
      return event.dataTransfer?.types.includes('Files') ?? false;
    }

    function handleDragEnter(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth += 1;
      setIsDragging(true);
    }

    function handleDragOver(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }

    function handleDragLeave(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setIsDragging(false);
      }
    }

    function handleDrop(event: DragEvent): void {
      depth = 0;
      setIsDragging(false);
      if (!carriesFiles(event)) {
        return;
      }
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        latest.current(file);
      }
    }

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return isDragging;
}
