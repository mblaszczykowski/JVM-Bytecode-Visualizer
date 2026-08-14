import { useState } from 'react';

import type { StructureView } from '../components/chrome/StructureTabs';
import type { PanelName } from '../components/chrome/Toolbar';
import type { MethodListing } from '../services/loading/program';
import { methodKeyOf } from '../services/views/program-view';

export interface Selection {
  readonly visiblePanel: PanelName;
  readonly structureView: StructureView;
  readonly viewedMethodKey: string | undefined;
  readonly selectedConstant: number | undefined;
  readonly linkedLine: number | undefined;
  readonly dismissed: string | undefined;
  readonly selectPanel: (panel: PanelName) => void;
  readonly selectMethod: (method: MethodListing) => void;
  readonly selectConstant: (index: number) => void;
  readonly followConstantFromListing: (index: number) => void;
  readonly linkLine: (line: number | undefined) => void;
  readonly dismiss: (message: string | undefined) => void;
  readonly reset: () => void;
}

export function useSelection(defaultStructureView: StructureView): Selection {
  const [visiblePanel, setVisiblePanel] = useState<PanelName>('bytecode');
  const [structureChoice, setStructureChoice] = useState<StructureView | undefined>(undefined);
  const [viewedMethodKey, setViewedMethodKey] = useState<string | undefined>(undefined);
  const [selectedConstant, setSelectedConstant] = useState<number | undefined>(undefined);
  const [linkedLine, setLinkedLine] = useState<number | undefined>(undefined);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);

  function selectPanel(panel: PanelName): void {
    setVisiblePanel(panel);
    if (panel === 'source' || panel === 'class') {
      setStructureChoice(panel);
    }
  }

  function selectMethod(method: MethodListing): void {
    setViewedMethodKey(methodKeyOf(method));
    setLinkedLine(undefined);
    setVisiblePanel('bytecode');
  }

  function followConstantFromListing(index: number): void {
    setSelectedConstant(index);
    selectPanel('class');
  }

  function reset(): void {
    setVisiblePanel('bytecode');
    setStructureChoice(undefined);
    setViewedMethodKey(undefined);
    setSelectedConstant(undefined);
    setLinkedLine(undefined);
    setDismissed(undefined);
  }

  return {
    visiblePanel,
    structureView: structureChoice ?? defaultStructureView,
    viewedMethodKey,
    selectedConstant,
    linkedLine,
    dismissed,
    selectPanel,
    selectMethod,
    selectConstant: setSelectedConstant,
    followConstantFromListing,
    linkLine: setLinkedLine,
    dismiss: setDismissed,
    reset,
  };
}
