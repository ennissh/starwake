import { THEMES, isThemeId, type ThemeId } from '@starwake/shared';
import '@fontsource/inter-tight/latin-400.css';
import '@fontsource/inter-tight/latin-600.css';
import '@fontsource/inter-tight/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/vt323/latin-400.css';
import './tokens.css';

const KEY = 'sw-theme';
type Listener = (t: ThemeId) => void;
const listeners = new Set<Listener>();

/** Saved choice, else the OS preference. Profiles (M3) override this with their stored theme. */
export function initialTheme(): ThemeId {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  if (isThemeId(saved)) return saved;
  return matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme(): ThemeId {
  const t = document.documentElement.dataset.theme;
  return isThemeId(t) ? t : 'dark';
}

export function setTheme(t: ThemeId): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked */
  }
  for (const l of listeners) l(t);
}

export function onThemeChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Read a CSS custom property (for the 3D scene to follow the theme). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export { THEMES };
