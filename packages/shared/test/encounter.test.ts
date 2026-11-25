import { describe, expect, it } from 'vitest';
import { Encounter, IDLE_COMMAND, TICK, defaultInstalled } from '../src/sim/combat/encounter.js';
import { toWorld } from '../src/sim/combat/geometry.js';
import { steerToward } from '../src/sim/combat/steer.js';
import type { CombatEvent, PlayerCommand } from '../src/sim/combat/types.js';
import { normalize, sub } from '../src/sim/math.js';
import { passivePilot, sensiblePilot } from '../src/sim/combat/pilots.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const roster = (id: string) => c.encounters.find((e) => e.id === id)!;

function make(
  id: string,
  seed: string | number,
  extra: Partial<ConstructorParameters<typeof Encounter>[0]> = {},
) {
  const def = roster(id);
  return new Encounter({ seed, content: c, roster: def.roster, distance: def.distance, ...extra });
}

function run(enc: Encounter, pilot: (e: Encounter) => PlayerCommand, seconds: number): CombatEvent[] {
  const all: CombatEvent[] = [];
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks && !enc.over && !enc.crippled; i++) all.push(...enc.step(pilot(enc)));
  return all;
}

describe('encounter: determinism', () => {
  it('same seed and commands give the same result and RNG state', () => {
    const a = make('arena-patrol', 7);
    const b = make('arena-patrol', 7);
    run(a, sensiblePilot, 60);
    run(b, sensiblePilot, 60);
    expect(a.result()).toEqual(b.result());
    expect(a.rngState).toEqual(b.rngState);
    expect(a.player.f).toEqual(b.player.f);
  });

  it('different seeds play out differently', () => {
    const a = make('arena-patrol', 1);
    const b = make('arena-patrol', 2);
    run(a, sensiblePilot, 30);
    run(b, sensiblePilot, 30);
    expect(a.player.f.pos).not.toEqual(b.player.f.pos);
  });
});

describe('encounter: M2 acceptance — 1 frigate + 4 fighters', () => {
  for (const seed of [11, 22, 33]) {
    it(`seed ${seed}: winnable with sensible tactics within 4 minutes`, () => {
      const e = make('arena-patrol', seed);
      run(e, sensiblePilot, 240);
      expect(e.outcome).toBe('victory');
      expect(e.crippled).toBe(false);
      expect(e.result().destroyed.length + e.result().fled.length).toBe(5);
    });

    it(`seed ${seed}: losable without them (passive pilot is crippled)`, () => {
      const e = make('arena-patrol', seed);
      run(e, passivePilot, 300);
      expect(e.crippled).toBe(true);
      expect(e.outcome).toBe('ongoing'); // waiting for the crippled choice
    });
  }
});

describe('encounter: shield emitters block the Lance', () => {
  it('beam hits on the base are blocked while emitters live, then do damage', () => {
    const e = make('arena-base', 5);
    const base = e.hostiles().find((h) => h.hullClass === 'base')!;
    // Point the keel at the base (the real path: steering input) and fire whenever charged.
    const fire = (): PlayerCommand => ({
      ...IDLE_COMMAND,
      flight: steerToward(e.player.f, base.f.pos, 0, 2).input,
      fireLance: true,
      targetId: base.id,
    });
    let blocked = 0;
    for (let i = 0; i < 60 * 20; i++) {
      for (const ev of e.step(fire()))
        if (ev.t === 'lance' && ev.hitId === base.id && ev.blocked === 'emitters') blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(base.hp).toBe(base.maxHp);
    for (const s of base.subs) if (s.kind === 'emitter') s.alive = false;
    let damage = 0;
    for (let i = 0; i < 60 * 6 && !damage; i++) {
      for (const ev of e.step(fire()))
        if (ev.t === 'hit' && ev.weaponId === 'spinal-lance' && ev.blocked === null) damage += ev.damage;
    }
    expect(damage).toBe(c.weapons.find((w) => w.id === 'spinal-lance')!.damage);
  });

  it('turret bolts kill emitters (armour 1) but are deflected by the base hull (armour 2)', () => {
    const e = make('arena-base', 9, { distance: 2150 });
    const base = e.hostiles().find((h) => h.hullClass === 'base')!;
    const emitter = base.subs.find((s) => s.kind === 'emitter')!;
    const events: CombatEvent[] = [];
    for (let i = 0; i < 60 * 40 && emitter.alive; i++) {
      const mount = toWorld(e.player.f.pos, e.player.f.rot, c.player.turret.mount);
      const at = toWorld(base.f.pos, base.f.rot, emitter.offset);
      events.push(
        ...e.step({
          ...IDLE_COMMAND,
          turret: { mode: 'manual', aim: normalize(sub(at, mount)), fire: true },
          flight: { ...IDLE_COMMAND.flight, throttleSet: 0 },
        }),
      );
    }
    expect(emitter.alive).toBe(false);
    // Now aim at bare hull (low on the front face, clear of subsystems): every hit is deflected.
    for (let i = 0; i < 60 * 5; i++) {
      const mount = toWorld(e.player.f.pos, e.player.f.rot, c.player.turret.mount);
      const at = toWorld(base.f.pos, base.f.rot, { x: 0, y: -160, z: -120 });
      events.push(
        ...e.step({
          ...IDLE_COMMAND,
          turret: { mode: 'manual', aim: normalize(sub(at, mount)), fire: true },
          flight: { ...IDLE_COMMAND.flight, throttleSet: 0 },
        }),
      );
    }
    const hullHits = events.filter(
      (ev): ev is Extract<CombatEvent, { t: 'hit' }> =>
        ev.t === 'hit' && ev.targetId === base.id && ev.subId === null && ev.weaponId === 'wake-turret',
    );
    expect(hullHits.length).toBeGreaterThan(0);
    for (const h of hullHits) expect(h.blocked).toBe('armor');
    expect(base.hp).toBe(base.maxHp);
  });
});

describe('encounter: drones', () => {
  it('respects the active cap and frame count; one-use drones need a target', () => {
    const e = make('arena-patrol', 3, { frames: 4 });
    const launches: CombatEvent[] = [];
    for (let i = 0; i < 4; i++) launches.push(...e.step({ ...IDLE_COMMAND, launch: 'hornet' }));
    expect(launches.filter((x) => x.t === 'launch')).toHaveLength(3);
    expect(launches.some((x) => x.t === 'launchFailed')).toBe(true);
    expect(e.frames).toBe(1);
    const noTarget = e.step({ ...IDLE_COMMAND, launch: 'lance' });
    expect(noTarget.some((x) => x.t === 'launchFailed')).toBe(true);
  });

  it('a detonated one-use drone counts as spent', () => {
    const e = make('arena-patrol', 3);
    const tgt = e.hostiles().find((h) => h.hullClass === 'frigate')!;
    e.step({ ...IDLE_COMMAND, launch: 'lance', targetId: tgt.id });
    let boom = false;
    for (let i = 0; i < 60 * 20 && !boom; i++) boom = e.step(IDLE_COMMAND).some((x) => x.t === 'detonate');
    expect(boom).toBe(true);
    expect(e.result().dronesLost.lance).toBe(1);
  });

  it('a recalled Hornet docks and returns its frame', () => {
    const e = make('arena-patrol', 4, { frames: 2, distance: 30000 } as never);
    e.step({ ...IDLE_COMMAND, launch: 'hornet' });
    expect(e.frames).toBe(1);
    for (let i = 0; i < 120; i++) e.step(IDLE_COMMAND);
    let docked = false;
    for (let i = 0; i < 60 * 30 && !docked; i++)
      docked = e.step({ ...IDLE_COMMAND, recall: true }).some((x) => x.t === 'docked');
    expect(docked).toBe(true);
    expect(e.frames).toBe(2);
  });
});

describe('encounter: damage to the player, crippling, endings', () => {
  it('hull damage wears installed components and cripples at 0 hull', () => {
    const e = make('arena-patrol', 8, { hullFraction: 0.05 });
    const events = run(e, passivePilot, 300);
    expect(events.some((x) => x.t === 'componentWorn' || x.t === 'componentDestroyed')).toBe(true);
    expect(events.some((x) => x.t === 'crippled')).toBe(true);
    expect(e.player.f.vel).toEqual({ x: 0, y: 0, z: 0 });
    // While crippled, time stands still until the player chooses.
    const tick = e.tick;
    e.step(IDLE_COMMAND);
    expect(e.tick).toBe(tick);
  });

  it('emergency fold loses 2–3 installed components and leaves the salvage behind', () => {
    const e = make('arena-patrol', 12, { hullFraction: 0.05 });
    run(e, passivePilot, 300);
    const before = e.installed.length;
    e.chooseCrippled('emergencyFold');
    const r = e.result();
    expect(r.outcome).toBe('emergencyFold');
    expect(before - r.installed.length).toBeGreaterThanOrEqual(2);
    expect(before - r.installed.length).toBeLessThanOrEqual(3);
    expect(r.salvage).toEqual([]);
  });

  it('lifeboat ends the fight', () => {
    const e = make('arena-patrol', 13, { hullFraction: 0.05 });
    run(e, passivePilot, 300);
    e.chooseCrippled('lifeboat');
    expect(e.result().outcome).toBe('lifeboat');
  });

  it('starts with the content loadout at 100%', () => {
    expect(make('arena-patrol', 1).installed).toEqual(defaultInstalled(c));
  });
});

describe('encounter: salvage and reserves', () => {
  it('salvage only comes from hulls that were destroyed, from their tables', () => {
    const e = make('arena-patrol', 22);
    run(e, sensiblePilot, 240);
    const r = e.result();
    const allowed = new Set(
      r.destroyed.flatMap((d) =>
        c.hulls.find((h) => h.id === d.hullId)!.salvage.table.map((t) => t.componentId),
      ),
    );
    for (const s of r.salvage) expect(allowed.has(s)).toBe(true);
  });

  it('a base launches only its finite reserve (no infinite respawn)', () => {
    const def = roster('arena-base');
    const e = make('arena-base', 6);
    run(e, passivePilot, 400);
    const spawned = new Set([
      ...e.result().destroyed.map((d) => d.id),
      ...e.result().fled.map((d) => d.id),
      ...e.hostiles().map((h) => h.id),
    ]);
    expect(spawned.size).toBeLessThanOrEqual(def.roster.hulls.length + def.roster.reserve.length);
    expect(e.reserve.length).toBe(0);
  });

  it('the base can be beaten with sensible tactics within 10 minutes', () => {
    const e = make('arena-base', 31);
    run(e, sensiblePilot, 600);
    expect(e.outcome).toBe('victory');
  });
});

describe('encounter: Lance aim assist and face target (playtest batch 1)', () => {
  const target = (e: Encounter) => e.hostiles().find((h) => h.kind !== 'drone') ?? e.hostiles()[0]!;

  it('face target turns the nose onto the target and keeps it there', () => {
    const e = make('arena-patrol', 3);
    const t = target(e);
    const start = e.lanceAlignment(t.id, null)!;
    let a = start;
    for (let i = 0; i < 60 * 6; i++) {
      e.step({ ...IDLE_COMMAND, targetId: t.id, faceTarget: true });
      a = e.lanceAlignment(t.id, null) ?? a;
      if (!t.alive) break;
    }
    expect(a.deg).toBeLessThan(Math.max(start.deg, 10));
    expect(a.deg).toBeLessThan(5);
  });

  it('without face target the same commands leave the nose where it was', () => {
    const e = make('arena-patrol', 3);
    const t = target(e);
    const before = e.player.f.rot;
    for (let i = 0; i < 60; i++) e.step({ ...IDLE_COMMAND, targetId: t.id });
    expect(e.player.f.rot).toEqual(before);
  });

  it('the beam bends onto a target inside the cone, and not one outside it', () => {
    const cone = c.player.lance.assistConeDeg;
    const fire = (e: Encounter, id: string) => {
      const ev = e.step({ ...IDLE_COMMAND, targetId: id, fireLance: true });
      return ev.find((x) => x.t === 'lance') as Extract<CombatEvent, { t: 'lance' }> | undefined;
    };
    // Inside: face the target, then fire.
    const a = make('arena-patrol', 4);
    const ta = target(a);
    for (let i = 0; i < 60 * 8 && (a.lanceAlignment(ta.id, null)?.deg ?? 180) >= cone * 0.6; i++)
      a.step({ ...IDLE_COMMAND, targetId: ta.id, faceTarget: true });
    const al = a.lanceAlignment(ta.id, null)!;
    expect(al.deg).toBeLessThan(cone);
    // Charge the Lance with the nose held on target.
    for (let i = 0; i < 60 * 10; i++) a.step({ ...IDLE_COMMAND, targetId: ta.id, faceTarget: true });
    expect(a.lanceAlignment(ta.id, null)?.inCone).toBe(true);
    expect(fire(a, ta.id)!.hitId).toBe(ta.id);
    // Outside: a target behind the nose is never hit by assist.
    const b = make('arena-patrol', 4);
    const tb = target(b);
    const alb = b.lanceAlignment(tb.id, null)!;
    expect(alb.deg).toBeGreaterThan(cone);
    for (let i = 0; i < 60 * 10; i++) b.step({ ...IDLE_COMMAND, targetId: tb.id });
    expect(b.lanceAlignment(tb.id, null)!.deg).toBeGreaterThan(cone);
    expect(fire(b, tb.id)!.hitId).not.toBe(tb.id);
  });

  it('face target replays identically (it is part of the command log)', () => {
    const cmd = (e: Encounter): PlayerCommand => ({ ...sensiblePilot(e), faceTarget: true });
    const a = make('arena-patrol', 9);
    const b = make('arena-patrol', 9);
    run(a, cmd, 20);
    run(b, cmd, 20);
    expect(a.player.f).toEqual(b.player.f);
  });
});
