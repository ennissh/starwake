import type { ContentBundle } from '../../schemas/content.js';
import { Encounter, type EncounterOptions, defaultInstalled } from './encounter.js';
import type { EncounterResult, PlayerCommand } from './types.js';

/**
 * Encounter verification (PLAN §2.2): the client sends the commands it fed the sim; the server
 * replays them through the same deterministic sim and checks the result matches. Commands are
 * quantised before the client uses them, so both sides see identical numbers, and run-length
 * encoded because most ticks repeat the previous command.
 */
export interface CommandLog {
  runs: { n: number; cmd: PlayerCommand }[];
  crippledChoice?: 'emergencyFold' | 'lifeboat' | undefined;
}

const q = (v: number) => Math.round(v * 1000) / 1000;

export function quantize(cmd: PlayerCommand): PlayerCommand {
  const f = cmd.flight;
  const flight = {
    pitch: q(f.pitch),
    yaw: q(f.yaw),
    roll: q(f.roll),
    throttleRate: q(f.throttleRate),
    throttleSet: f.throttleSet === undefined ? undefined : q(f.throttleSet),
  };
  const turret =
    cmd.turret.mode === 'manual'
      ? {
          mode: 'manual' as const,
          aim: { x: q(cmd.turret.aim.x), y: q(cmd.turret.aim.y), z: q(cmd.turret.aim.z) },
          fire: cmd.turret.fire,
        }
      : cmd.turret;
  const drone = cmd.drone
    ? {
        id: cmd.drone.id,
        fire: cmd.drone.fire,
        flight: {
          pitch: q(cmd.drone.flight.pitch),
          yaw: q(cmd.drone.flight.yaw),
          roll: q(cmd.drone.flight.roll),
          throttleRate: q(cmd.drone.flight.throttleRate),
          throttleSet:
            cmd.drone.flight.throttleSet === undefined ? undefined : q(cmd.drone.flight.throttleSet),
        },
      }
    : null;
  return { ...cmd, flight, turret, drone };
}

export class CommandRecorder {
  private runs: CommandLog['runs'] = [];
  private last = '';
  crippledChoice: CommandLog['crippledChoice'];

  push(cmd: PlayerCommand): void {
    const key = JSON.stringify(cmd);
    const tail = this.runs[this.runs.length - 1];
    if (tail && key === this.last) tail.n++;
    else {
      this.runs.push({ n: 1, cmd: JSON.parse(key) as PlayerCommand });
      this.last = key;
    }
  }

  log(): CommandLog {
    return { runs: this.runs.map((r) => ({ ...r })), crippledChoice: this.crippledChoice };
  }
}

/** Re-run an encounter from its command log. */
export function replay(opts: EncounterOptions, log: CommandLog, maxTicks = 60 * 60 * 30): EncounterResult {
  const e = new Encounter(opts);
  let ticks = 0;
  for (const run of log.runs) {
    for (let i = 0; i < run.n; i++) {
      if (++ticks > maxTicks) throw new Error('command log too long');
      e.step(run.cmd);
    }
  }
  if (log.crippledChoice) e.chooseCrippled(log.crippledChoice);
  return e.result();
}

/**
 * Bounds check for when a replay can't be matched exactly (e.g. a browser whose Math functions
 * round differently): everything claimed must have been possible in this encounter.
 */
export function plausible(r: EncounterResult, opts: EncounterOptions, c: ContentBundle): string[] {
  const errs: string[] = [];
  const roster = [...opts.roster.hulls, ...opts.roster.reserve];
  const pool = new Map<string, number>();
  for (const h of roster) pool.set(h, (pool.get(h) ?? 0) + 1);
  for (const d of [...r.destroyed, ...r.fled]) {
    const n = pool.get(d.hullId) ?? 0;
    if (n <= 0) errs.push(`hull ${d.hullId} was not in this encounter`);
    pool.set(d.hullId, n - 1);
  }
  const tables = new Set(
    r.destroyed.flatMap(
      (d) => c.hulls.find((h) => h.id === d.hullId)?.salvage.table.map((t) => t.componentId) ?? [],
    ),
  );
  const maxSalvage = r.destroyed.reduce(
    (n, d) => n + (c.hulls.find((h) => h.id === d.hullId)?.salvage.rolls ?? 0),
    0,
  );
  if (r.salvage.length > maxSalvage) errs.push('more salvage than the wrecks could hold');
  for (const s of r.salvage)
    if (!tables.has(s)) errs.push(`salvage ${s} is not in any destroyed hull's table`);
  const start = opts.installed ?? defaultInstalled(c);
  for (const i of r.installed) {
    const was = start.find(
      (x) => x.system === i.system && x.slot === i.slot && x.componentId === i.componentId,
    );
    if (!was) errs.push(`installed ${i.componentId} was not fitted before the fight`);
    else if (i.condition > was.condition + 1e-9) errs.push(`${i.componentId} condition went up`);
  }
  if (r.hullFraction > (opts.hullFraction ?? 1) + 1e-9) errs.push('hull went up');
  if (r.framesLeft > (opts.frames ?? c.player.droneBay.frames))
    errs.push('more drone frames than at the start');
  if (r.outcome === 'victory' && r.destroyed.length + r.fled.length < opts.roster.hulls.length)
    errs.push('victory without dealing with every hostile');
  if (r.outcome === 'ongoing') errs.push('the fight is not over');
  return errs;
}
