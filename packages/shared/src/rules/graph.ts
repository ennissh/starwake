import type { ContentBundle, Lane, StarSystem } from '../schemas/content.js';

/** The Shoal's fold lanes (R10): jumps follow lanes; "within N jumps" counts lane hops. */
export function system(c: ContentBundle, id: string): StarSystem {
  const s = c.systems.find((x) => x.id === id);
  if (!s) throw new Error(`unknown system ${id}`);
  return s;
}

export function parsecsBetween(c: ContentBundle, a: string, b: string): number {
  const p = system(c, a).position;
  const q = system(c, b).position;
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

export function laneBetween(c: ContentBundle, a: string, b: string): Lane | undefined {
  return c.lanes.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

export function neighbours(c: ContentBundle, id: string): string[] {
  return c.lanes.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a));
}

/** Lane hops from `from` to every reachable system (BFS). */
export function hopsFrom(c: ContentBundle, from: string): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of neighbours(c, cur)) {
      if (!d.has(n)) {
        d.set(n, d.get(cur)! + 1);
        q.push(n);
      }
    }
  }
  return d;
}
