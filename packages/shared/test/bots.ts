import { type Encounter, IDLE_COMMAND } from '../src/sim/combat/encounter.js';
import { toWorld } from '../src/sim/combat/geometry.js';
import { steerToward } from '../src/sim/combat/steer.js';
import type { Ent, PlayerCommand } from '../src/sim/combat/types.js';
import { dist, normalize, sub } from '../src/sim/math.js';

/** Does nothing; WAKE still crews the turret (the ship's default). */
export const passivePilot = (): PlayerCommand => IDLE_COMMAND;

/**
 * "Sensible tactics" (PLAN M2 acceptance): put the Lance on the big ship, let WAKE's turret handle
 * fighters, send Lance drones at shield emitters and finish emitters with the turret, Rams at a base.
 */
export function sensiblePilot(enc: Encounter): PlayerCommand {
  const p = enc.player;
  const hostiles = enc.hostiles();
  const main: Ent | undefined =
    hostiles.find((h) => h.hullClass === 'base' || h.hullClass === 'capital' || h.hullClass === 'frigate') ??
    hostiles[0];
  if (!main) return IDLE_COMMAND;
  const emitter = main.subs.find((s) => s.kind === 'emitter' && s.alive) ?? null;
  const d = dist(p.f.pos, main.f.pos);
  // Hold just outside the big guns' reach; a frigate is closed on, a base is besieged.
  const hold = main.hullClass === 'base' ? 2150 : 2000;
  const steer = steerToward(p.f, main.f.pos, d > hold + 900 ? 0.6 : d > hold ? 0.25 : 0, 2);
  const onTarget = steer.angle < Math.atan2(main.radius * 0.6, d);
  // Subsystem priority: a base turret that can reach us, then shield emitters.
  const mount = toWorld(p.f.pos, p.f.rot, enc.c.player.turret.mount);
  const subPos = (id: string) => toWorld(main.f.pos, main.f.rot, main.subs.find((s) => s.id === id)!.offset);
  const threats = main.subs
    .filter(
      (s) =>
        s.alive && s.kind === 'turret' && dist(toWorld(main.f.pos, main.f.rot, s.offset), p.f.pos) < 2100,
    )
    .sort((a, b) => dist(subPos(a.id), mount) - dist(subPos(b.id), mount));
  const prioritySub = threats[0] ?? emitter;
  const cmd: PlayerCommand = {
    ...IDLE_COMMAND,
    flight: steer.input,
    targetId: main.id,
    subsystemId: prioritySub?.id ?? null,
    fireLance: onTarget && d < 4800 && !emitter,
  };
  const fighterClose = hostiles.some((h) => h.hullClass === 'fighter' && dist(h.f.pos, p.f.pos) < 900);
  if (prioritySub && !fighterClose) {
    const at = subPos(prioritySub.id);
    if (dist(mount, at) < 2380) cmd.turret = { mode: 'manual', aim: normalize(sub(at, mount)), fire: true };
  }
  // Drones: a Hornet first, then one-use drones every few seconds while there's room.
  const room = enc.drones().length < enc.c.player.droneBay.maxActive && enc.frames > 0;
  if (enc.tick === 60) cmd.launch = 'hornet';
  else if (room && enc.tick % 240 === 0 && enc.tick > 0) {
    if (main.hullClass === 'frigate' && enc.frames > 1) cmd.launch = 'lance';
    else if (main.hullClass === 'base') cmd.launch = prioritySub ? 'lance' : 'ram';
  }
  return cmd;
}
