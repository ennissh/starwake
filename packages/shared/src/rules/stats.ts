import type { Effect, ContentBundle, SystemId } from '../schemas/content.js';
import type { FlightStats } from '../sim/flight.js';
import type { InstalledComponent } from '../sim/combat/types.js';
import { fuelPerParsec, jumpRange } from './ship.js';
import { systemOutputs } from './systems.js';

/**
 * What the installed components make the Starwake do (M4, PLAN §1.6). One pure function feeds the
 * combat sim, the campaign (range, fuel) and the engine room's live preview, so all three agree.
 */
export interface ShipStats {
  outputs: Record<SystemId, number>;
  flight: FlightStats;
  lance: { damage: number; cooldown: number; dps: number };
  turret: { cooldown: number; wakeSpread: number; dps: number };
  shields: { fore: number; aft: number; rechargePerS: number };
  range: number;
  fuelPerParsec: number;
  /** Multipliers applied (for the preview's "×1.12" labels). */
  mult: Record<keyof ContentBundle['player']['effects'], number>;
}

/** at0 + (at1 − at0) × output, output clamped to 0..1.5 (Mk III over-spec stays bounded). */
export function effect(e: Effect, output: number): number {
  const o = Math.max(0, Math.min(1.5, output));
  return e.at0 + (e.at1 - e.at0) * o;
}

export function shipStats(installed: readonly InstalledComponent[], c: ContentBundle): ShipStats {
  const p = c.player;
  const out = systemOutputs(installed, c);
  const e = p.effects;
  const mult = {
    thrusters: effect(e.thrusters, out.thrusters),
    lanceDamage: effect(e.lanceDamage, out.lance),
    lanceRecharge: effect(e.lanceRecharge, out.lance),
    turretRate: effect(e.turretRate, out.turret),
    turretTracking: effect(e.turretTracking, out.turret),
    shieldCapacity: effect(e.shieldCapacity, (out.foreShield + out.aftShield) / 2),
    shieldRecharge: effect(e.shieldRecharge, (out.foreShield + out.aftShield) / 2),
  };
  const k = mult.thrusters;
  const flight: FlightStats = {
    ...p.flight,
    maxSpeed: p.flight.maxSpeed * k,
    accel: p.flight.accel * k,
    pitchRate: p.flight.pitchRate * k,
    yawRate: p.flight.yawRate * k,
    rollRate: p.flight.rollRate * k,
    angAccel: p.flight.angAccel * k,
  };
  const lw = c.weapons.find((w) => w.id === p.lance.weapon)!;
  const tw = c.weapons.find((w) => w.id === p.turret.weapon)!;
  const lance = { damage: lw.damage * mult.lanceDamage, cooldown: lw.cooldown / mult.lanceRecharge, dps: 0 };
  lance.dps = lance.damage / lance.cooldown;
  const turret = {
    cooldown: tw.cooldown / mult.turretRate,
    wakeSpread: p.wakeTurretSpread / mult.turretTracking,
    dps: 0,
  };
  turret.dps = tw.damage / turret.cooldown;
  // Each shield's capacity follows its own system; recharge follows the pair.
  const shields = {
    fore: p.shields.fore * effect(e.shieldCapacity, out.foreShield),
    aft: p.shields.aft * effect(e.shieldCapacity, out.aftShield),
    rechargePerS: p.shields.rechargePerS * mult.shieldRecharge,
  };
  return {
    outputs: out,
    flight,
    lance,
    turret,
    shields,
    range: jumpRange(installed, c),
    fuelPerParsec: fuelPerParsec(installed, c),
    mult,
  };
}
