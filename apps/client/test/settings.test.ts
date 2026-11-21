import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from '../src/settings.js';

describe('settings', () => {
  it('clamps sensitivity and drops a bad theme', () => {
    const s = sanitizeSettings({ mouseSensitivity: 99, invertY: true, theme: 'neon' });
    expect(s.mouseSensitivity).toBe(4);
    expect(s.invertY).toBe(true);
    expect(s.theme).toBeNull();
  });
  it('round-trips through JSON', () => {
    const s = { ...defaultSettings(), theme: 'vga' as const, mouseSensitivity: 1.5 };
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
