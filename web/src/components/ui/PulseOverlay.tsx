import { motion, useReducedMotion } from 'framer-motion';

interface PulseOverlayProps {
  readonly pulse: number;
  readonly className?: string;
  readonly testId?: string | undefined;
}

export function PulseOverlay({ pulse, className = '', testId }: PulseOverlayProps) {
  const reduced = useReducedMotion() ?? false;

  if (pulse === 0) {
    return null;
  }

  return (
    <motion.span
      key={pulse}
      data-testid={testId}
      aria-hidden="true"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
      className={`pointer-events-none absolute inset-0 -z-10 bg-accent-fill ${className}`}
    />
  );
}
