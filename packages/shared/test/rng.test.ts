import { describe, expect, it } from 'vitest';
import { Rng, nextUint32, seedRng } from '../src/rng.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng('shoal');
    const b = new Rng('shoal');
    const xs = Array.from({ length: 50 }, () => a.next());
    const ys = Array.from({ length: 50 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it('different seeds diverge', () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
  });

  it('resumes from a saved state', () => {
    const a = new Rng(42);
    a.next();
    a.next();
    const saved = [...a.state] as unknown as typeof a.state;
    const restored = new Rng(JSON.parse(JSON.stringify(saved)));
    expect(restored.next()).toEqual(a.next());
  });

  it('nextUint32 is pure', () => {
    const s = seedRng('x');
    expect(nextUint32(s)).toEqual(nextUint32(s));
  });

  it('int stays in range and floats in [0,1)', () => {
    const r = new Rng('range');
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('weighted respects zero weights', () => {
    const r = new Rng('w');
    for (let i = 0; i < 200; i++) {
      expect(
        r.weighted([
          { item: 'a', weight: 0 },
          { item: 'b', weight: 1 },
        ]),
      ).toBe('b');
    }
  });

  it('is roughly uniform', () => {
    const r = new Rng('uniform');
    const buckets = [0, 0, 0, 0];
    for (let i = 0; i < 40000; i++) buckets[Math.floor(r.next() * 4)]!++;
    for (const b of buckets) expect(b).toBeGreaterThan(9500);
  });
});
