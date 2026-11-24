/** UI themes (R20). The ids are stored per profile and in localStorage; CSS keys off data-theme. */
export const THEMES = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'vga', name: 'VGA 1990' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
