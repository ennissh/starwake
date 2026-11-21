/**
 * Seeded PRNG (sfc32). Everything random in the rules, sim and enemy AI goes through this:
 * never Math.random() in packages/shared (a lint rule enforces it). The state is four uint32s,
 * so it serialises into a save and the same seed + inputs replay identically.
 */
export type RngState = readonly [number, number, number, number];

/** Hash a string or number seed into an initial state (splitmix32 over the seed's chars). */
export function seedRng(seed: string | number): RngState {
  let h = 0x9e3779b9;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
    h = (h << 13) | (h >>> 19);
  }
  const next = (): number => {
    h = (h + 0x9e3779b9) | 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  const state: [number, number, number, number] = [next(), next(), next(), next()];
  // Warm up so similar seeds diverge.
  let st: RngState = state;
  for (let i = 0; i < 12; i++) st = nextUint32(st)[1];
  return st;
}

/** Pure step: returns [value, nextState]. */
export function nextUint32(state: RngState): [number, RngState] {
  let [a, b, c, d] = state;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]];
}

/**
 * Mutable convenience wrapper for hot loops (sim ticks). Read `.state` to persist it.
 */
export class Rng {
  state: RngState;
  constructor(seedOrState: string | number | RngState) {
    this.state = Array.isArray(seedOrState)
      ? (seedOrState as RngState)
      : seedRng(seedOrState as string | number);
  }
  /** Uniform float in [0, 1). */
  next(): number {
    const [v, s] = nextUint32(this.state);
    this.state = s;
    return v / 4294967296;
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list');
    return items[this.int(0, items.length - 1)] as T;
  }
  /** Weighted pick; weights must be >= 0 and not all 0. */
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    if (total <= 0) throw new Error('Rng.weighted with no positive weight');
    let r = this.next() * total;
    for (const i of items) {
      r -= Math.max(0, i.weight);
      if (r < 0) return i.item;
    }
    return items[items.length - 1]!.item;
  }
}
