import { describe, expect, it } from 'vitest';
import { hitBlockedBy, penetrates } from '../src/sim/combat/rules.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();

// PLAN §1.5 armour table, by target.
const TARGETS = [
  { name: 'fighter', armor: 0 },
  { name: 'frigate', armor: 1 },
  { name: 'capital/base', armor: 2 },
  { name: 'subsystem', armor: 1 },
];

describe('armour rule: damage applies iff penetration >= armour', () => {
  it('content hulls carry the armour PLAN §1.5 assigns their class', () => {
    const want = { fighter: 0, frigate: 1, capital: 2, base: 2 };
    for (const h of c.hulls) {
      expect(h.armor, h.id).toBe(want[h.class]);
      for (const s of h.subsystems) expect(s.armor, `${h.id}.${s.id}`).toBe(1);
    }
  });

  const player = ['spinal-lance', 'wake-turret', 'hornet-gun', 'lance-warhead', 'ram-warhead'];
  for (const wid of player) {
    const w = c.weapons.find((x) => x.id === wid)!;
    for (const t of TARGETS) {
      const expected = w.penetration >= t.armor;
      it(`${w.name} (pen ${w.penetration}) vs ${t.name} (armour ${t.armor}) → ${expected ? 'damages' : 'deflected'}`, () => {
        expect(penetrates(w.penetration, t.armor)).toBe(expected);
        expect(hitBlockedBy({ weapon: w, armor: t.armor, emittersAlive: false })).toBe(
          expected ? null : 'armor',
        );
      });
    }
  }

  it('PLAN weapon penetrations: Lance 3, Turret 1, Hornet 1, Lance drone 2, Ram 3', () => {
    const pen = (id: string) => c.weapons.find((w) => w.id === id)!.penetration;
    expect([
      pen('spinal-lance'),
      pen('wake-turret'),
      pen('hornet-gun'),
      pen('lance-warhead'),
      pen('ram-warhead'),
    ]).toEqual([3, 1, 1, 2, 3]);
  });

  it('live shield emitters block beams on every part, but never bolts', () => {
    const beam = { kind: 'beam' as const, penetration: 3 };
    const bolt = { kind: 'bolt' as const, penetration: 3 };
    for (const armor of [0, 1, 2]) {
      expect(hitBlockedBy({ weapon: beam, armor, emittersAlive: true })).toBe('emitters');
      expect(hitBlockedBy({ weapon: bolt, armor, emittersAlive: true })).toBeNull();
      expect(hitBlockedBy({ weapon: beam, armor, emittersAlive: false })).toBeNull();
    }
  });
});
