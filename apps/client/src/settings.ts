import { isThemeId, type ThemeId } from '@starwake/shared';
import { type KeyMap, defaultKeyMap, sanitizeKeyMap } from './input/keymap.js';

/**
 * Per-profile player settings: key bindings, mouse, theme. Kept in the browser under the profile id
 * (M1: the local "pilot" profile). From M3 the server's profile record is the source of truth and
 * this becomes its cache.
 */
export interface Settings {
  bindings: KeyMap;
  mouseSensitivity: number;
  invertY: boolean;
  /** The mouse steers the ship in bridge/chase views (off: a free cursor; arrows steer). */
  mouseSteering: boolean;
  /** The first-flight tutorial was finished or skipped. */
  tutorialDone: boolean;
  /** Audio volumes, 0..1 (M6). */
  volume: { master: number; sfx: number; music: number };
  theme: ThemeId | null;
}

export const DEFAULT_PROFILE = 'pilot';
const key = (profile: string) => `sw-settings:${profile}`;

export function defaultSettings(): Settings {
  return {
    bindings: defaultKeyMap(),
    mouseSensitivity: 1,
    invertY: false,
    mouseSteering: false,
    tutorialDone: false,
    volume: { master: 0.8, sfx: 0.8, music: 0.5 },
    theme: null,
  };
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const sens = Number(r.mouseSensitivity);
  return {
    bindings: sanitizeKeyMap(r.bindings),
    mouseSensitivity: Number.isFinite(sens) ? Math.min(4, Math.max(0.25, sens)) : d.mouseSensitivity,
    invertY: r.invertY === true,
    mouseSteering: r.mouseSteering === true,
    tutorialDone: r.tutorialDone === true,
    volume: (() => {
      const v = (r.volume ?? {}) as Record<string, unknown>;
      const one = (x: unknown, dflt: number) => {
        const n = Number(x);
        return x !== undefined && x !== null && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt;
      };
      return {
        master: one(v.master, d.volume.master),
        sfx: one(v.sfx, d.volume.sfx),
        music: one(v.music, d.volume.music),
      };
    })(),
    theme: isThemeId(r.theme) ? r.theme : null,
  };
}

export function loadSettings(profile = DEFAULT_PROFILE): Settings {
  try {
    const raw = localStorage.getItem(key(profile));
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings, profile = DEFAULT_PROFILE): void {
  try {
    localStorage.setItem(key(profile), JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this session only */
  }
}
