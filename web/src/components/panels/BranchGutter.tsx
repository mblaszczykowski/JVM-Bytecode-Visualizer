import { Fragment } from 'react';

import type { Instruction } from '../../core/disassembler';

import { ROW_HEIGHT } from '../ui/rhythm';

interface BranchGutterProps {
  readonly instructions: readonly Instruction[];
  readonly currentIndex?: number | undefined;
  readonly hoveredIndex?: number | undefined;
}

interface Arc {
  readonly fromIndex: number;
  readonly toIndex: number;
}

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
  const changes = new Int32Array(rowCount + 1);
  for (const arc of arcs) {
    const first = Math.min(arc.fromIndex, arc.toIndex);
    const last = Math.max(arc.fromIndex, arc.toIndex);
    changes[first] = (changes[first] ?? 0) + 1;
    changes[last + 1] = (changes[last + 1] ?? 0) - 1;
  }
  let coverage = 0;
  let highest = 0;
  for (const change of changes) {
    coverage += change;
    highest = Math.max(highest, coverage);
  }
  return highest;
}

export function BranchGutter({ instructions, currentIndex, hoveredIndex }: BranchGutterProps) {
  const arcs = buildArcs(instructions);
  const gutter = { arcs, crowded: maxOverlap(arcs, instructions.length) > MAX_OVERLAP };

  const visible = gutter.crowded
    ? gutter.arcs.filter(
        (arc) =>
          arc.fromIndex === currentIndex ||
          arc.fromIndex === hoveredIndex ||
          arc.toIndex === hoveredIndex,
      )
    : gutter.arcs;

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
              className="absolute left-[10px] w-[11px] rounded-l-code border border-r-0 border-line-strong"
              style={{
                top: (first + 0.5) * ROW_HEIGHT,
                height: span * ROW_HEIGHT,
              }}
            />
            <div
              data-testid="branch-arrow"
              className="absolute left-[17px] h-1.5 w-1.5 border-r border-b border-fg-dim"
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
