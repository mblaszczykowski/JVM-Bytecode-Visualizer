export type ButtonTone = 'quiet' | 'raised' | 'prominent' | 'nested';

export type ButtonSize = 'sm' | 'md';

const TONE: Record<ButtonTone, string> = {
  quiet: 'text-fg-2 hover:bg-raised hover:text-fg',
  raised: 'bg-raised text-fg-2 hover:bg-raised-hover hover:text-fg',
  prominent: 'bg-raised text-fg shadow-control-raised hover:bg-raised-hover',
  nested: 'bg-raised-active text-fg-2 hover:text-fg',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2 py-0.5 text-meta',
  md: 'px-2.5 py-1 text-label',
};

const BASE =
  'focus-ring inline-flex items-center justify-center gap-1 rounded-control transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40';

export const SELECTED_SURFACE = 'bg-raised-active text-fg shadow-control-raised';

export function buttonSurface(
  tone: ButtonTone = 'quiet',
  size: ButtonSize = 'md',
  className = '',
): string {
  return `${BASE} ${TONE[tone]} ${SIZE[size]} ${className}`;
}
