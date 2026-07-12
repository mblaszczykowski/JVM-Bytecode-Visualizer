import { Fragment, useMemo } from 'react';

import type { Instruction } from '../core/disassembler/types';

import { ROW_HEIGHT } from './rhythm';

interface BranchGutterProps {
  readonly instructions: readonly Instruction[];
  /** Row index of the instruction under `pc`; its arc is always drawn. */
  readonly currentIndex?: number | undefined;
  /** Row index under the pointer; arcs entering or leaving it are always drawn. */
  readonly hoveredIndex?: number | undefined;
}

interface Arc {
  readonly fromIndex: number;
  readonly toIndex: number;
}

/** Above this many arcs stacked over one row the gutter stops being readable. */
const MAX_OVERLAP = 3;

function buildArcs(instructions: readonly Instruction[]): readonly Arc[] {
  const indexByOffset = new Map(
    instructions.map((instruction, index) => [instruction.offset, index]),
  );

  const arcs: Arc[] = [];
  instructions.forEach((instruction, fromIndex) => {
    if (instruction.branchTarget === undefined) {
      return;
    }
    const toIndex = indexByOffset.get(instruction.branchTarget);
    if (toIndex === undefined || toIndex === fromIndex) {
      return;
    }
    arcs.push({ fromIndex, toIndex });
  });
  return arcs;
}

function maxOverlap(arcs: readonly Arc[], rowCount: number): number {
  const coverage = new Array<number>(rowCount).fill(0);
  for (const arc of arcs) {
    const first = Math.min(arc.fromIndex, arc.toIndex);
    const last = Math.max(arc.fromIndex, arc.toIndex);
    for (let row = first; row <= last; row++) {
      coverage[row] = (coverage[row] ?? 0) + 1;
    }
  }
  return coverage.reduce((highest, value) => Math.max(highest, value), 0);
}

/**
 * Jump arcs drawn next to the instruction listing. The shape is pure arithmetic on row
 * indices — `branchTarget` resolved through the offset→index map — which is the cheapest way
 * to show control flow that the disassembly text alone does not convey.
 */
export function BranchGutter({ instructions, currentIndex, hoveredIndex }: BranchGutterProps) {
  const visible = useMemo(() => {
    const arcs = buildArcs(instructions);
    if (maxOverlap(arcs, instructions.length) <= MAX_OVERLAP) {
      return arcs;
    }
    // Too dense to read: keep the current jump plus whatever touches the hovered row.
    return arcs.filter(
      (arc) =>
        arc.fromIndex === currentIndex ||
        arc.fromIndex === hoveredIndex ||
        arc.toIndex === hoveredIndex,
    );
  }, [instructions, currentIndex, hoveredIndex]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[26px]">
      {visible.map((arc) => {
        const forward = arc.toIndex > arc.fromIndex;
        const first = Math.min(arc.fromIndex, arc.toIndex);
        const span = Math.abs(arc.toIndex - arc.fromIndex);

        return (
          <Fragment key={`${String(arc.fromIndex)}→${String(arc.toIndex)}`}>
            <div
              data-testid="branch-arc"
              data-from-index={arc.fromIndex}
              data-to-index={arc.toIndex}
              className="absolute left-[10px] w-[11px] rounded-l-[5px] border border-r-0 border-[rgb(108_178_255/0.45)]"
              style={{
                top: (first + 0.5) * ROW_HEIGHT,
                height: span * ROW_HEIGHT,
              }}
            />
            <div
              data-testid="branch-arrow"
              className="absolute left-[17px] h-1.5 w-1.5 border-r border-b border-[rgb(108_178_255/0.6)]"
              style={{
                top: (arc.toIndex + 0.5) * ROW_HEIGHT - 4,
                transform: forward ? 'rotate(-45deg)' : 'rotate(135deg)',
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
