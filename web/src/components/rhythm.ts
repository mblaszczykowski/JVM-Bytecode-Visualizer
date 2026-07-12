/**
 * Every code row in the Source and Bytecode panels is exactly this tall.
 *
 * It is not a styling preference: branch arcs are positioned arithmetically from row
 * indices and the scroll-follow logic converts an instruction index into a scroll offset.
 * Both break the moment a row grows, so the value lives in one place.
 */
export const ROW_HEIGHT = 26;

/** Shared geometry of a single code row — fixed height, never wraps. */
export const CODE_ROW =
  'relative flex h-[26px] shrink-0 items-center gap-3 rounded-code px-2 font-mono text-[12.5px] whitespace-nowrap';
