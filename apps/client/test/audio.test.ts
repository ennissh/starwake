import { describe, expect, it } from 'vitest';
import { motifFromSeed } from '../src/audio/audio.js';
import { sanitizeSettings, defaultSettings } from '../src/settings.js';

describe('procedural leitmotifs (M6)', () => {
  it('the same seed gives the same tune; different races sound different', () => {
    expect(motifFromSeed(3141)).toEqual(motifFromSeed(3141));
    const a = motifFromSeed(3141);
    const b = motifFromSeed(2718);
    const c = motifFromSeed(1618);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(c));
  });
  it('a motif is about 16 beats, in a sane tempo and range', () => {
    for (const seed of [1, 99, 3141, 2718, 1618, 424242]) {
      const m = motifFromSeed(seed);
      const beats = m.notes.reduce((n, x) => n + x[1], 0);
      expect(beats).toBeGreaterThanOrEqual(16);
      expect(beats).toBeLessThan(18.5);
      expect(m.bpm).toBeGreaterThanOrEqual(64);
      expect(m.bpm).toBeLessThan(120);
      for (const [semi] of m.notes) if (semi !== null) expect(m.root + semi).toBeLessThan(100);
    }
  });
});

describe('audio settings', () => {
  it('volumes default sensibly and are clamped to 0..1', () => {
    expect(defaultSettings().volume).toEqual({ master: 0.8, sfx: 0.8, music: 0.5 });
    expect(sanitizeSettings({ volume: { master: 3, sfx: -1, music: 'x' } }).volume).toEqual({
      master: 1,
      sfx: 0,
      music: 0.5,
    });
    expect(sanitizeSettings({}).volume).toEqual(defaultSettings().volume);
  });
});
