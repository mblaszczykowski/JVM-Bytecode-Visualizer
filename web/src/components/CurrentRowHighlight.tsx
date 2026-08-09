import { motion, useReducedMotion } from 'framer-motion';

interface CurrentRowHighlightProps {
  readonly layoutId: string;
  readonly animate: boolean;
}

const FILL = 'now-row absolute inset-0 -z-10 rounded-code';

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
