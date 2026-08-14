import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { listingOf } from '../components/__fixtures__/factorial-run';
import type { StructureView } from '../components/chrome/StructureTabs';
import { methodKeyOf } from '../services/views/program-view';

import { useSelection } from './useSelection';

const FACTORIAL = listingOf('factorial', '(I)I');

function renderSelection(defaultStructureView: StructureView = 'source') {
  return renderHook((view: StructureView) => useSelection(view), {
    initialProps: defaultStructureView,
  });
}

describe('useSelection', () => {
  it('opens on the bytecode panel, with nothing followed and nothing dismissed', () => {
    const { result } = renderSelection();

    expect(result.current.visiblePanel).toBe('bytecode');
    expect(result.current.structureView).toBe('source');
    expect(result.current.viewedMethodKey).toBeUndefined();
    expect(result.current.selectedConstant).toBeUndefined();
    expect(result.current.linkedLine).toBeUndefined();
    expect(result.current.dismissed).toBeUndefined();
  });

  it('shows the class file of a program that has no source to show', () => {
    const { result } = renderSelection('class');

    expect(result.current.structureView).toBe('class');
  });

  it('moves the left panel and the switch together', () => {
    const { result } = renderSelection();

    act(() => {
      result.current.selectPanel('class');
    });

    expect(result.current.visiblePanel).toBe('class');
    expect(result.current.structureView).toBe('class');

    act(() => {
      result.current.selectPanel('state');
    });

    expect(result.current.visiblePanel).toBe('state');
    expect(result.current.structureView).toBe('class');
  });

  it('opens the listing of a method that was picked, and drops the linked line', () => {
    const { result } = renderSelection();

    act(() => {
      result.current.linkLine(17);
      result.current.selectPanel('class');
    });
    act(() => {
      result.current.selectMethod(FACTORIAL);
    });

    expect(result.current.viewedMethodKey).toBe(methodKeyOf(FACTORIAL));
    expect(result.current.linkedLine).toBeUndefined();
    expect(result.current.visiblePanel).toBe('bytecode');
  });

  it('follows a constant from the listing into the class panel', () => {
    const { result } = renderSelection();

    act(() => {
      result.current.followConstantFromListing(7);
    });

    expect(result.current.selectedConstant).toBe(7);
    expect(result.current.visiblePanel).toBe('class');
    expect(result.current.structureView).toBe('class');
  });

  it('puts every choice back when the next program is loaded', () => {
    const { result } = renderSelection();

    act(() => {
      result.current.selectMethod(FACTORIAL);
      result.current.linkLine(17);
      result.current.dismiss('Stopped after 20,000 steps.');
    });
    act(() => {
      result.current.followConstantFromListing(7);
    });

    expect(result.current.visiblePanel).toBe('class');

    act(() => {
      result.current.reset();
    });

    expect(result.current.visiblePanel).toBe('bytecode');
    expect(result.current.structureView).toBe('source');
    expect(result.current.viewedMethodKey).toBeUndefined();
    expect(result.current.selectedConstant).toBeUndefined();
    expect(result.current.linkedLine).toBeUndefined();
    expect(result.current.dismissed).toBeUndefined();
  });
});
