import { motion, useReducedMotion } from 'framer-motion';

interface CurrentRowHighlightProps {
  /** Unique per panel — two rows sharing an id would make the fill jump between panels. */
  readonly layoutId: string;
  /** Off above 4× playback, where the projection lands as flicker rather than as motion. */
  readonly animate: boolean;
}

/**
 * The same mark the top frame and the top of the operand stack wear: a wash plus a rail on the
 * leading edge. The reader is tracking one position across three columns, so it has to be one
 * mark — `now-row` is where it is defined.
 */
const FILL = 'now-row absolute inset-0 -z-10 rounded-code';

/**
 * Accent fill behind the current code row. It is a sibling of the row content rather than a
 * background on the row itself, so Framer can project it from one row to the next; the
 * negative z-index inside the list's stacking context keeps it under the text.
 */
export function CurrentRowHighlight({ layoutId, animate }: CurrentRowHighlightProps) {
  const reduced = useReducedMotion() ?? false;

  if (!animate || reduced) {
    return <span aria-hidden="true" className={FILL} />;
  }

  return (
    <motion.span
      aria-hidden="true"
      layoutId={layoutId}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className={FILL}
    />
  );
}
