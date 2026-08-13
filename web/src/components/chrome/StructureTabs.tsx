import { useEffect, useRef, type ReactNode } from 'react';

import type { PanelName } from './Toolbar';
import { Segment, SegmentedControl } from '../ui/SegmentedControl';

export type StructureView = 'source' | 'class';

const STRUCTURE_VIEWS: readonly {
  readonly id: StructureView;
  readonly label: string;
  readonly name: string;
}[] = [
  { id: 'source', label: 'Source', name: 'Source: the Java this class was compiled from' },
  { id: 'class', label: 'Class', name: 'Class: the structure of the class file itself' },
];

export function structureVisibilityOf(
  panel: StructureView,
  selected: PanelName,
  shown: StructureView,
): string {
  return `${panel === selected ? '' : 'hidden'} ${panel === shown ? 'md:flex' : 'md:hidden'}`;
}

export function useStructureTabs(
  view: StructureView,
  onSelect: (view: StructureView) => void,
): ReactNode {
  const groupRef = useRef<HTMLDivElement>(null);
  const keepFocus = useRef(false);

  useEffect(() => {
    if (!keepFocus.current) {
      return;
    }
    keepFocus.current = false;
    groupRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  });

  const show = (next: StructureView): void => {
    keepFocus.current =
      next !== view && (groupRef.current?.contains(document.activeElement) ?? false);
    onSelect(next);
  };

  return (
    <SegmentedControl label="Left panel" groupRef={groupRef} className="-my-0.5 p-0.5">
      {STRUCTURE_VIEWS.map(({ id, label, name }) => (
        <Segment
          key={id}
          label={name}
          selected={view === id}
          onClick={() => {
            show(id);
          }}
          className="px-2 py-0.5 text-label"
        >
          {label}
        </Segment>
      ))}
    </SegmentedControl>
  );
}
