import { describe, expect, it } from 'vitest';
import { CampaignStateSchema, type CampaignState } from '../src/schemas/campaign.js';
import { RESOURCE_KINDS } from '../src/schemas/content.js';
import { RuleError } from '../src/rules/errors.js';
import { applyAction, applyEncounterResult, defaultLoadout, newGame } from '../src/rules/campaign.js';
import { hopsFrom, parsecsBetween } from '../src/rules/graph.js';
import { readiness } from '../src/rules/readiness.js';
import { brokenFlag, relationLabel } from '../src/rules/relations.js';
import { fuelPerParsec, itemQty, jumpRange } from '../src/rules/ship.js';
import { systemOutputs } from '../src/rules/systems.js';
import type { EncounterResult } from '../src/sim/combat/types.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const act = (s: CampaignState, a: Parameters<typeof applyAction>[1]) => {
  const r = applyAction(s, a, c);
  CampaignStateSchema.parse(r.state); // every reducer output is a valid save
  return r;
};
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as RuleError).code;
  }
  return null;
};
/** A state with no hostiles in the way (to test movement without fights). */
const peaceful = (seed = 'peace'): CampaignState => {
  const s = newGame(c, seed);
  return { ...s, relations: Object.fromEntries(Object.keys(s.relations).map((k) => [k, 0])) };
};

describe('the Shoal content', () => {
  it('has six systems, all reachable from Harbor by lanes', () => {
    expect(c.systems).toHaveLength(6);
    expect(hopsFrom(c, 'harbor').size).toBe(6);
  });
  it('can meet every quota and has a habitable Cradle', () => {
    const avail = Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0]));
    for (const s of c.systems)
      for (const p of s.planets) for (const r of p.resources) avail[r.kind]! += r.yield;
    for (const k of RESOURCE_KINDS) expect(avail[k], k).toBeGreaterThanOrEqual(c.rules.readiness.quotas[k]);
    expect(c.systems.find((s) => s.id === 'verdance')!.planets.some((p) => p.habitable)).toBe(true);
  });
  it('puts Cinder Gate (Vosk) within 2 jumps of the Cradle (PLAN §1.8)', () => {
    expect(hopsFrom(c, 'verdance').get('cinder-gate')).toBeLessThanOrEqual(2);
  });
  it('every lane is within reach of a stock Nav Core except the long shortcut', () => {
    const range = jumpRange(defaultLoadout(c), c);
    const long = c.lanes.filter((l) => parsecsBetween(c, l.a, l.b) > range).map((l) => `${l.a}-${l.b}`);
    expect(long).toEqual(['glass-reach-saltmarrow']);
  });
});

describe('new game', () => {
  it('starts in Harbor with a full tank, 3 beacons, the clock at 10 years', () => {
    const s = newGame(c, 'x');
    expect(s).toMatchObject({
      systemId: 'harbor',
      clock: 10,
      fuel: 100,
      beacons: 3,
      hull: 1,
      outcome: 'ongoing',
    });
    expect(itemQty(s, 'data-core')).toBe(2);
    expect(relationLabel(s.relations.vosk!, c)).toBe('hostile');
    CampaignStateSchema.parse(s);
  });
  it('is deterministic for a seed', () => {
    expect(newGame(c, 'same')).toEqual(newGame(c, 'same'));
  });
});

describe('jump', () => {
  it('costs fuel by distance and Fold Drive output, and time by distance', () => {
    const s = peaceful();
    const pc = parsecsBetween(c, 'harbor', 'glass-reach');
    const { state, events } = act(s, { type: 'jump', to: 'glass-reach' });
    expect(state.systemId).toBe('glass-reach');
    expect(state.fuel).toBeCloseTo(100 - pc * fuelPerParsec(s.installed, c), 3);
    expect(state.clock).toBeCloseTo(10 - pc * c.rules.clock.jumpYearsPerParsec, 3);
    expect(events[0]).toMatchObject({ t: 'jumped', from: 'harbor', to: 'glass-reach' });
  });
  it('follows lanes only', () => {
    expect(code(() => act(peaceful(), { type: 'jump', to: 'cinder-gate' }))).toBe('NO_LANE');
  });
  it('is limited by range: the long lane needs a better Nav Core (M4: Mk II extends range)', () => {
    let s = act(peaceful(), { type: 'jump', to: 'glass-reach' }).state;
    expect(code(() => act(s, { type: 'jump', to: 'saltmarrow' }))).toBe('OUT_OF_RANGE');
    s = {
      ...s,
      installed: s.installed.map((i) =>
        i.componentId === 'navcore-1' ? { ...i, componentId: 'navcore-2' } : i,
      ),
    };
    expect(jumpRange(s.installed, c)).toBeGreaterThan(jumpRange(defaultLoadout(c), c));
    expect(act(s, { type: 'jump', to: 'saltmarrow' }).state.systemId).toBe('saltmarrow');
  });
  it('an empty Fold Drive slot raises the fuel cost', () => {
    const full = defaultLoadout(c);
    const missing = full.filter((i) => !(i.system === 'fold' && i.componentId === 'coil-1'));
    expect(systemOutputs(missing, c).fold).toBeLessThan(systemOutputs(full, c).fold);
    expect(fuelPerParsec(missing, c)).toBeGreaterThan(fuelPerParsec(full, c));
  });
  it('needs the fuel', () => {
    expect(code(() => act({ ...peaceful(), fuel: 1 }, { type: 'jump', to: 'glass-reach' }))).toBe('NO_FUEL');
  });
  it('the Caravan Clock running out loses the game', () => {
    const { state, events } = act({ ...peaceful(), clock: 0.1 }, { type: 'jump', to: 'saltmarrow' });
    expect(state.outcome).toBe('lost');
    expect(events.some((e) => e.t === 'lost')).toBe(true);
    expect(code(() => act(state, { type: 'probe' }))).toBe('GAME_OVER');
  });
});

describe('hostile space', () => {
  it('Vosk ambush the Glass Reach–Cinder Gate lane and patrol Cinder Gate (some seeds)', () => {
    let fights = 0;
    for (let i = 0; i < 40; i++) {
      let s = newGame(c, `amb${i}`);
      s = act(s, { type: 'jump', to: 'glass-reach' }).state;
      const r = act(s, { type: 'jump', to: 'cinder-gate' });
      if (r.state.pendingEncounter) {
        fights++;
        expect(r.state.pendingEncounter.raceId).toBe('vosk');
        expect(code(() => act(r.state, { type: 'probe' }))).toBe('IN_ENCOUNTER');
      }
    }
    expect(fights).toBeGreaterThan(5);
    expect(fights).toBeLessThan(40);
  });
  it('no ambushes once the Vosk are broken (R12)', () => {
    for (let i = 0; i < 20; i++) {
      let s = newGame(c, `brk${i}`);
      s = { ...s, flags: [brokenFlag('vosk')] };
      s = act(s, { type: 'jump', to: 'glass-reach' }).state;
      expect(act(s, { type: 'jump', to: 'cinder-gate' }).state.pendingEncounter).toBeNull();
    }
  });
  it('Vosk patrols can destroy beacons in Verdance (R13)', () => {
    let lost = 0;
    for (let i = 0; i < 40; i++) {
      let s: CampaignState = {
        ...newGame(c, `raid${i}`),
        claims: [{ systemId: 'verdance', planetId: 'verdance-prime' }],
      };
      s = act(s, { type: 'jump', to: 'saltmarrow' }).state;
      if (s.claims.length === 0) lost++;
    }
    expect(lost).toBeGreaterThan(0);
  });
});

describe('probe, claim, dock', () => {
  it('one probe per visit', () => {
    let s = act(peaceful(), { type: 'probe' }).state;
    expect(s.known).toContain('harbor');
    expect(code(() => act(s, { type: 'probe' }))).toBe('PROBE_USED');
    s = act(s, { type: 'jump', to: 'glass-reach' }).state;
    s = act(s, { type: 'jump', to: 'harbor' }).state;
    expect(() => act(s, { type: 'probe' })).not.toThrow();
  });
  it('claims need a probe and a beacon; one per planet', () => {
    let s = peaceful();
    expect(code(() => act(s, { type: 'claim', planetId: 'anvil' }))).toBe('NOT_PROBED');
    s = act(s, { type: 'probe' }).state;
    s = act(s, { type: 'claim', planetId: 'anvil' }).state;
    expect(s.beacons).toBe(2);
    expect(code(() => act(s, { type: 'claim', planetId: 'anvil' }))).toBe('ALREADY_CLAIMED');
    expect(code(() => act({ ...s, beacons: 0 }, { type: 'claim', planetId: 'anvil' }))).toBe(
      'ALREADY_CLAIMED',
    );
    expect(code(() => act(s, { type: 'claim', planetId: 'lumen' }))).toBe('NOT_HERE');
  });
  it('claiming in an occupied system without permission angers the occupant', () => {
    let s = act(peaceful(), { type: 'jump', to: 'glass-reach' }).state;
    s = act(s, { type: 'probe' }).state;
    const before = s.relations.quillari!;
    const r = act(s, { type: 'claim', planetId: 'frostglass' });
    expect(r.state.relations.quillari).toBeLessThan(before);
    expect(r.events.some((e) => e.t === 'relation' && e.raceId === 'quillari')).toBe(true);
  });
  it('docking refuels, repairs, restocks, fabricates Provender, and costs refit time', () => {
    const s: CampaignState = {
      ...peaceful(),
      fuel: 10,
      hull: 0.4,
      beacons: 0,
      droneFrames: 2,
      installed: defaultLoadout(c).map((i) => ({ ...i, condition: 50 })),
    };
    const r = act(s, { type: 'dock' }).state;
    expect(r).toMatchObject({ fuel: 100, hull: 1, beacons: 3, droneFrames: 8 });
    expect(r.installed.every((i) => i.condition === 100)).toBe(true);
    expect(itemQty(r, 'provender')).toBe(c.rules.waystation.provenderPerDock);
    expect(r.clock).toBeCloseTo(s.clock - c.rules.clock.refitYears, 6);
    const moved = act(peaceful(), { type: 'jump', to: 'glass-reach' }).state;
    expect(code(() => act(moved, { type: 'dock' }))).toBe('NO_STATION');
  });
  it('Provender is endless but the hold is not', () => {
    let s = peaceful();
    for (let i = 0; i < 20; i++) s = act(s, { type: 'dock' }).state;
    expect(itemQty(s, 'provender')).toBeLessThanOrEqual((c.rules.start.hold - 1) * 5);
  });
  it('the Waystation sells Mk I parts for Data Cores', () => {
    let s = act(peaceful(), { type: 'buy', componentId: 'coil-1' }).state;
    expect(s.hold.some((h) => h.type === 'component' && h.componentId === 'coil-1')).toBe(true);
    expect(itemQty(s, 'data-core')).toBe(1);
    s = act(s, { type: 'buy', componentId: 'gyro-1' }).state;
    expect(code(() => act(s, { type: 'buy', componentId: 'lens-1' }))).toBe('CANT_AFFORD');
  });
});

describe('Colony Readiness', () => {
  const ready = (): CampaignState => ({
    ...peaceful(),
    systemId: 'verdance',
    claims: [
      { systemId: 'verdance', planetId: 'verdance-prime' },
      { systemId: 'saltmarrow', planetId: 'brinehold' },
      { systemId: 'glass-reach', planetId: 'frostglass' },
      { systemId: 'harbor', planetId: 'anvil' },
      { systemId: 'verdance', planetId: 'thorn' },
      { systemId: 'saltmarrow', planetId: 'marrow' },
      { systemId: 'cinder-gate', planetId: 'slag' },
    ],
  });
  it('all four met at the Cradle → signal → won', () => {
    const r = readiness(ready(), c);
    expect(r.cradle.ok && r.safety.ok && r.clock.ok).toBe(true);
    for (const k of RESOURCE_KINDS) expect(r.quotas[k].ok, k).toBe(true);
    expect(r.canSignal).toBe(true);
    expect(act(ready(), { type: 'signalCaravan' }).state.outcome).toBe('won');
  });
  it('hostile Vosk within two jumps block safety until broken', () => {
    const s = { ...ready(), relations: { ...ready().relations, vosk: -60 } };
    expect(readiness(s, c).safety).toEqual({ ok: false, threats: ['vosk'] });
    expect(code(() => act(s, { type: 'signalCaravan' }))).toBe('NOT_READY');
    expect(readiness({ ...s, flags: [brokenFlag('vosk')] }, c).safety.ok).toBe(true);
  });
  it('no Cradle yet: not safe, cannot signal', () => {
    const r = readiness(newGame(c, 'r'), c);
    expect(r.cradle.ok).toBe(false);
    expect(r.canSignal).toBe(false);
  });
  it('must signal from the Cradle system', () => {
    expect(readiness({ ...ready(), systemId: 'harbor' }, c).canSignal).toBe(false);
  });
});

describe('encounter results', () => {
  const pending = (): CampaignState => {
    let s = newGame(c, 'fight');
    s = applyAction(
      { ...s, systemId: 'cinder-gate', lastSystemId: 'glass-reach' },
      { type: 'attackBase' },
      c,
    ).state;
    return s;
  };
  const base = (o: Partial<EncounterResult>): EncounterResult => ({
    outcome: 'victory',
    ticks: 600,
    destroyed: [],
    fled: [],
    salvage: [],
    installed: defaultLoadout(c),
    lost: [],
    hullFraction: 0.8,
    framesLeft: 6,
    dronesLost: { hornet: 0, lance: 2, ram: 0 },
    ...o,
  });
  it('attacking a base is a first strike and opens an encounter', () => {
    const s = pending();
    expect(s.pendingEncounter).toMatchObject({ defId: 'cinder-hold', reason: 'attack', raceId: 'vosk' });
    expect(s.relations.vosk).toBeLessThan(newGame(c, 'fight').relations.vosk!);
  });
  it('destroying the base breaks the Vosk (R12), refuels, and offers salvage', () => {
    const r = applyEncounterResult(
      pending(),
      base({ destroyed: [{ id: 'h1', hullId: 'vosk-base' }], salvage: ['coil-2', 'lens-2'] }),
      c,
    );
    expect(r.state.flags).toContain('vosk_broken');
    expect(r.state.fuel).toBe(100);
    expect(r.state.salvageOffer).toEqual(['coil-2', 'lens-2']);
    expect(r.state.pendingEncounter).toBeNull();
    expect(relationLabel(r.state.relations.vosk!, c)).toBe('hostile'); // hostile forever
    const t = applyAction(r.state, { type: 'takeSalvage', componentIds: ['lens-2'] }, c).state;
    expect(t.hold.filter((h) => h.type === 'component')).toHaveLength(1);
    expect(t.salvageOffer).toEqual([]);
  });
  it('emergency fold returns to where you came from', () => {
    const r = applyEncounterResult(
      pending(),
      base({ outcome: 'emergencyFold', hullFraction: 0, lost: [defaultLoadout(c)[0]!] }),
      c,
    );
    expect(r.state.systemId).toBe('glass-reach');
    expect(r.state.hull).toBe(c.rules.emergencyFoldHull);
  });
  it('lifeboat: Waystation, basic refit, empty hold, +1.5 years', () => {
    const s = pending();
    const r = applyEncounterResult(s, base({ outcome: 'lifeboat', hullFraction: 0 }), c);
    expect(r.state).toMatchObject({ systemId: 'harbor', hull: 1, hold: [] });
    expect(r.state.clock).toBeCloseTo(s.clock - 1.5, 6);
    expect(r.state.installed).toEqual(defaultLoadout(c));
  });
  it('salvage has diminishing returns per fight in a system per visit', () => {
    let s = pending();
    s = { ...s, visits: { ...s.visits, 'cinder-gate': { count: 1, probedOn: null, fights: 3 } } };
    const r = applyEncounterResult(s, base({ salvage: ['coil-1', 'coil-1', 'coil-1', 'coil-1'] }), c);
    expect(r.state.salvageOffer.length).toBe(1);
  });
});

describe('determinism', () => {
  it('the same seed and actions give the same state', () => {
    const run = () => {
      let s = newGame(c, 'det');
      for (const to of ['glass-reach', 'cinder-gate']) {
        const r = applyAction(s, { type: 'jump', to }, c);
        s = r.state;
        if (s.pendingEncounter) break;
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});
