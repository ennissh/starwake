import { describe, expect, it } from 'vitest';
import { applyAction, defaultLoadout, newGame } from '../src/rules/campaign.js';
import { applyMoves } from '../src/rules/refit.js';
import { effect, shipStats } from '../src/rules/stats.js';
import { RuleError } from '../src/rules/errors.js';
import type { CampaignState } from '../src/schemas/campaign.js';
import { Encounter } from '../src/sim/combat/encounter.js';
import type { InstalledComponent } from '../src/sim/combat/types.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const base = () => defaultLoadout(c);
const swap = (xs: InstalledComponent[], system: string, slot: number, componentId: string | null) => [
  ...xs.filter((x) => !(x.system === system && x.slot === slot)),
  ...(componentId ? [{ system, slot, componentId, condition: 100 } as InstalledComponent] : []),
];
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as RuleError).code;
  }
  return null;
};

describe('M4 stat formulas', () => {
  it('effect is linear in output and bounded', () => {
    const e = { at0: 0.5, at1: 1.5 };
    expect(effect(e, 0)).toBe(0.5);
    expect(effect(e, 1)).toBe(1.5);
    expect(effect(e, 0.5)).toBe(1);
    expect(effect(e, -3)).toBe(0.5);
    expect(effect(e, 9)).toBe(effect(e, 1.5));
  });

  it('the starting loadout lands near 1.0 on every multiplier (M2 balance kept)', () => {
    const s = shipStats(base(), c);
    for (const [k, v] of Object.entries(s.mult)) {
      expect(v, k).toBeGreaterThan(0.8);
      expect(v, k).toBeLessThan(1.2);
    }
  });

  it('ACCEPT: a Nav Core Mk II measurably increases jump range', () => {
    const a = shipStats(base(), c).range;
    const b = shipStats(swap(base(), 'fold', 3, 'navcore-2'), c).range;
    expect(b - a).toBeGreaterThanOrEqual(1);
  });

  it('ACCEPT: an empty Fold Drive slot raises fuel cost', () => {
    const a = shipStats(base(), c).fuelPerParsec;
    const b = shipStats(swap(base(), 'fold', 0, null), c).fuelPerParsec;
    expect(b).toBeGreaterThan(a);
  });

  it('better parts raise each stat; worn parts lower it', () => {
    const s0 = shipStats(base(), c);
    const up = (sys: string, id: string) => shipStats(swap(base(), sys, 0, id), c);
    expect(up('thrusters', 'manifold-3').flight.maxSpeed).toBeGreaterThan(s0.flight.maxSpeed);
    expect(up('lance', 'lens-3').lance.dps).toBeGreaterThan(s0.lance.dps);
    expect(up('turret', 'lens-3').turret.dps).toBeGreaterThan(s0.turret.dps);
    expect(up('foreShield', 'emitter-3').shields.fore).toBeGreaterThan(s0.shields.fore);
    const worn = base().map((x) => (x.system === 'lance' ? { ...x, condition: 30 } : x));
    expect(shipStats(worn, c).lance.dps).toBeLessThan(s0.lance.dps);
  });

  it('the combat sim uses the same stats', () => {
    const def = c.encounters[0]!;
    const fast = swap(
      swap(swap(base(), 'thrusters', 0, 'manifold-3'), 'thrusters', 1, 'gyro-3'),
      'thrusters',
      2,
      'coil-3',
    );
    const e = new Encounter({
      seed: 1,
      content: c,
      roster: def.roster,
      distance: def.distance,
      installed: fast,
    });
    expect(e.ship.flight.maxSpeed).toBeCloseTo(shipStats(fast, c).flight.maxSpeed);
    expect(e.ship.flight.maxSpeed).toBeGreaterThan(c.player.flight.maxSpeed);
  });
});

describe('M4 refit', () => {
  const withHold = (s: CampaignState, ...ids: string[]): CampaignState => ({
    ...s,
    hold: [
      ...s.hold,
      ...ids.map((componentId) => ({ type: 'component' as const, componentId, condition: 100 })),
    ],
  });

  it('installs from the hold into a slot, old part goes to the hold; free at the Waystation', () => {
    const s0 = withHold(newGame(c, 'r1'), 'navcore-2');
    const idx = s0.hold.length - 1;
    const r = applyAction(
      s0,
      { type: 'refit', moves: [{ a: { hold: idx }, b: { system: 'fold', slot: 3 } }] },
      c,
    );
    expect(r.state.installed.find((x) => x.system === 'fold' && x.slot === 3)!.componentId).toBe('navcore-2');
    expect(r.state.hold.some((h) => h.type === 'component' && h.componentId === 'navcore-1')).toBe(true);
    expect(r.state.clock).toBe(s0.clock);
    expect(r.events[0]).toMatchObject({ t: 'refitted', swaps: 1, years: 0 });
  });

  it('costs swap time away from the Waystation', () => {
    let s = withHold(newGame(c, 'r2'), 'lens-2');
    s = { ...s, systemId: 'glass-reach' };
    const r = applyAction(
      s,
      {
        type: 'refit',
        moves: [
          { a: { hold: s.hold.length - 1 }, b: { system: 'lance', slot: 0 } },
          { a: { system: 'turret', slot: 0 }, b: { system: 'lance', slot: 0 } },
        ],
      },
      c,
    );
    expect(r.state.clock).toBeCloseTo(s.clock - 2 * c.rules.clock.swapYears);
  });

  it('moves between systems, removes to a new hold slot, and keeps conditions', () => {
    const s0 = newGame(c, 'r3');
    const worn = {
      ...s0,
      installed: s0.installed.map((x) =>
        x.system === 'lance' && x.slot === 1 ? { ...x, condition: 42 } : x,
      ),
    };
    const l = applyMoves(worn, [{ a: { system: 'lance', slot: 1 }, b: { hold: worn.hold.length } }], c);
    expect(l.installed.some((x) => x.system === 'lance' && x.slot === 1)).toBe(false);
    expect(l.hold.at(-1)).toEqual({ type: 'component', componentId: 'capacitor-2', condition: 42 });
    const l2 = applyMoves(l, [{ a: { hold: l.hold.length - 1 }, b: { system: 'turret', slot: 2 } }], c);
    expect(l2.installed.find((x) => x.system === 'turret' && x.slot === 2)).toMatchObject({
      componentId: 'capacitor-2',
      condition: 42,
    });
  });

  it('refuses the wrong family, items in slots, bad slots, hold shuffles, and an overfull hold', () => {
    const s0 = withHold(newGame(c, 'r4'), 'emitter-1');
    const em = s0.hold.length - 1;
    const dc = s0.hold.findIndex((h) => h.type === 'item');
    expect(code(() => applyMoves(s0, [{ a: { hold: em }, b: { system: 'fold', slot: 0 } }], c))).toBe(
      'WRONG_FAMILY',
    );
    expect(code(() => applyMoves(s0, [{ a: { hold: dc }, b: { system: 'fold', slot: 0 } }], c))).toBe(
      'NOT_A_COMPONENT',
    );
    expect(code(() => applyMoves(s0, [{ a: { hold: em }, b: { system: 'fold', slot: 9 } }], c))).toBe(
      'BAD_MOVE',
    );
    expect(code(() => applyMoves(s0, [{ a: { hold: 0 }, b: { hold: 1 } }], c))).toBe('BAD_MOVE');
    const full = withHold(newGame(c, 'r5'), ...Array(c.rules.start.hold - 1).fill('coil-1'));
    expect(
      code(() => applyMoves(full, [{ a: { system: 'fold', slot: 0 }, b: { hold: full.hold.length } }], c)),
    ).toBe('HOLD_FULL');
  });

  it('a refused refit changes nothing', () => {
    const s0 = newGame(c, 'r6');
    expect(
      code(() =>
        applyAction(
          s0,
          { type: 'refit', moves: [{ a: { system: 'fold', slot: 0 }, b: { system: 'lance', slot: 0 } }] },
          c,
        ),
      ),
    ).toBe('WRONG_FAMILY');
  });
});
