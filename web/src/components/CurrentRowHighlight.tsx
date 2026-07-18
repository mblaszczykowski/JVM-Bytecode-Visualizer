import { motion, useReducedMotion } from 'framer-motion';

interface CurrentRowHighlightProps {
  /** Unique per panel — two rows sharing an id would make the fill jump between panels. */
  readonly layoutId: string;
  /** Off above 4× playback, where the projection lands as flicker rather than as motion. */
  readonly animate: boolean;
}

const FILL = 'absolute inset-0 -z-10 rounded-code bg-accent/[0.22] shadow-current';

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
