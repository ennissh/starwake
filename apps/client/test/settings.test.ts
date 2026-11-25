import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from '../src/settings.js';

describe('settings', () => {
  it('clamps sensitivity and drops a bad theme', () => {
    const s = sanitizeSettings({ mouseSensitivity: 99, invertY: true, theme: 'neon' });
    expect(s.mouseSensitivity).toBe(4);
    expect(s.invertY).toBe(true);
    expect(s.theme).toBeNull();
  });
  it('mouse steering is off by default and only a real true turns it on', () => {
    expect(defaultSettings().mouseSteering).toBe(false);
    expect(sanitizeSettings({}).mouseSteering).toBe(false);
    expect(sanitizeSettings({ mouseSteering: 'yes' }).mouseSteering).toBe(false);
    expect(sanitizeSettings({ mouseSteering: true }).mouseSteering).toBe(true);
  });
  it('round-trips through JSON', () => {
    const s = { ...defaultSettings(), theme: 'vga' as const, mouseSensitivity: 1.5 };
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
