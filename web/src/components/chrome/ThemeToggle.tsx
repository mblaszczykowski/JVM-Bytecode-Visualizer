import { useState } from 'react';

import {
  applyTheme,
  nextTheme,
  storedTheme,
  storeTheme,
  THEME_LABELS,
  type ThemeChoice,
} from '../../services/session/theme';

function ThemeIcon({ choice }: { readonly choice: ThemeChoice }) {
  if (choice === 'light') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3.1" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
        </g>
      </svg>
    );
  }

  if (choice === 'dark') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M13.4 9.9A5.9 5.9 0 0 1 6.1 2.6a5.9 5.9 0 1 0 7.3 7.3z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path fill="currentColor" d="M8 2.6a5.4 5.4 0 0 1 0 10.8z" />
    </svg>
  );
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  function handleClick(): void {
    const next = nextTheme(choice);
    setChoice(next);
    applyTheme(next);
    storeTheme(next);
  }

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-choice={choice}
      aria-label={`Theme: ${THEME_LABELS[choice]}. Change theme`}
      title={`Theme: ${THEME_LABELS[choice]}`}
      onClick={handleClick}
      className="focus-ring flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-control text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
    >
      <ThemeIcon choice={choice} />
    </button>
  );
}
