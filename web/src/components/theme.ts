/**
 * Jedyne miejsce z literałami kolorów warstwy UI (design.md §2 — „nie rozsypywać rgba()
 * po komponentach"). Tailwind v4 konfiguruje się z poziomu `index.css`; dopóki tokeny tam
 * nie trafią, trzymamy je tu jako nazwane zestawy klas.
 *
 * Zasada nadrzędna: kolor niesie informację. Akcent (#0a84ff) oznacza WYŁĄCZNIE stan bieżący —
 * bieżącą linię źródła, bieżącą instrukcję, ramkę wierzchnią i wierzchołek stosu operandów.
 */

/** Trzy nieruchome światła pod „szybą" — bez nich `backdrop-blur` nie ma czego rozmywać. */
export const AMBIENT_BACKGROUND =
  'radial-gradient(90% 70% at 12% -10%, rgb(90 130 255 / 0.30) 0%, rgb(90 130 255 / 0) 60%), ' +
  'radial-gradient(70% 60% at 95% 8%, rgb(180 120 255 / 0.16) 0%, rgb(180 120 255 / 0) 62%), ' +
  'radial-gradient(120% 120% at 50% 120%, rgb(0 140 255 / 0.10) 0%, rgb(0 0 0 / 0) 60%)';

export const SHELL =
  'rounded-[28px] border border-white/10 bg-[rgb(22_26_37/0.55)] backdrop-blur-[40px] ' +
  'shadow-[0_32px_80px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.16)]';

export const PANEL =
  'rounded-[20px] bg-white/[0.045] ' +
  'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07),inset_0_1px_0_rgb(255_255_255/0.08)]';

/** Rytm 26px — wspólny dla obu paneli kodu i list stanu (design.md §1). */
export const ROW = 'flex h-[26px] shrink-0 items-center gap-3 rounded-[10px] px-2';

export const CODE = 'font-mono text-[12.5px] whitespace-pre';

/** Wiersz bieżący: wypełnienie + inset obrys, bez zmiany wysokości wiersza. */
export const CURRENT_ROW =
  'bg-[rgb(10_132_255/0.22)] text-[#eaf2ff] ' +
  'shadow-[inset_0_0_0_1px_rgb(10_132_255/0.45),0_4px_14px_rgb(10_132_255/0.18)]';

export const IDLE_ROW = 'text-white/60';

/** Numery linii i offsety bajtowe — treść zdublowana gdzie indziej, wolno zejść poniżej 0.55. */
export const GUTTER = 'w-9 shrink-0 text-right text-white/25 select-none';
export const GUTTER_CURRENT = 'w-9 shrink-0 text-right text-[#6cb2ff] select-none';

export const PILL =
  'shrink-0 self-center rounded-full bg-white/10 px-2 py-px text-[10px] leading-none text-white/55';
export const PILL_ACCENT =
  'shrink-0 self-center rounded-full bg-[rgb(10_132_255/0.28)] px-2 py-px text-[10px] leading-none text-[#9ccaff]';
export const PILL_ERROR =
  'shrink-0 self-center rounded-full bg-[rgb(255_69_58/0.14)] px-2 py-px text-[10px] leading-none text-[#ff8a80]';

export const EMPTY_STATE = 'px-[18px] py-3 text-[12px] text-white/30';

/** Na szkle zwykły cień focusa jest niewidoczny — ring musi być pełnokolorowy (design.md §9). */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a84ff]';

export const CONTROL = `rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10 ${FOCUS_RING}`;
