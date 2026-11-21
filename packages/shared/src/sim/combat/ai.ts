import type { Rng } from '../../rng.js';
import type { HullClass } from '../../schemas/content.js';
import { type FlightInput, NO_INPUT } from '../flight.js';
import { type Vec3, add, cross, dist, normalize, scale, sub } from '../math.js';
import { type BtNode, action, condition, selector, sequence } from './bt.js';
import { steerToward } from './steer.js';
import type { Ent } from './types.js';

/**
 * Enemy behaviour trees, one per hull class (PLAN §1.5): approach, attack run, evade, retreat at low
 * HP, call for help. Deterministic: every random choice uses the encounter's seeded Rng.
 * Numbers here are behaviour shape (distances in units, times in seconds), not balance; hull stats
 * and weapons come from content.
 */
export interface AiWorld {
  t: number;
  dt: number;
  rng: Rng;
  player: Ent;
  /** Player-side entities that can be targeted (Starwake and live drones). */
  playerSide(): Ent[];
  get(id: string | null): Ent | undefined;
  /** Release up to n reserve hulls near `by`; returns how many came. */
  releaseReserve(n: number, by: Ent): number;
}

export interface AiCtx {
  self: Ent;
  w: AiWorld;
  out: { input: FlightInput; targetId: string | null };
}

const RETREAT_HP = 0.25;
const FLEE_DIST = 7000;
const BREAKOFF_DIST = 260;
const STANDOFF_MIN = 1700;
const STANDOFF_MAX = 2400;

const hpFrac = (e: Ent) => e.hp / e.maxHp;

function pickTarget(c: AiCtx): Ent {
  const { self, w } = c;
  const cur = w.get(self.ai.targetId);
  if (cur && cur.alive && !cur.fled && w.t % 4 > w.dt) return cur; // re-think every ~4 s
  // Fighters peel off to chase a nearby drone 40% of the time; otherwise the Starwake.
  const drones = w.playerSide().filter((e) => e.kind === 'drone' && dist(e.f.pos, self.f.pos) < 900);
  const pick =
    drones.length && self.hullClass === 'fighter' && w.rng.chance(0.4) ? w.rng.pick(drones) : w.player;
  self.ai.targetId = pick.id;
  return pick;
}

// ---- leaves -------------------------------------------------------------------------------------
const retreat = action<AiCtx>((c) => {
  const { self, w } = c;
  self.ai.mode = 'retreat';
  const away = add(self.f.pos, scale(normalize(sub(self.f.pos, w.player.f.pos)), 5000));
  c.out.input = steerToward(self.f, away, 1).input;
  c.out.targetId = null;
  if (dist(self.f.pos, w.player.f.pos) > FLEE_DIST) self.fled = true;
  return 'running';
});

const evade = action<AiCtx>((c) => {
  const { self, w } = c;
  if (self.ai.mode !== 'evade') {
    self.ai.mode = 'evade';
    self.ai.timer = w.rng.range(1.0, 2.0);
    self.ai.jink = normalize({ x: w.rng.range(-1, 1), y: w.rng.range(-1, 1), z: w.rng.range(-1, 1) });
  }
  self.ai.timer -= w.dt;
  const p = add(self.f.pos, scale(add(self.ai.jink, scale(normalize(self.f.vel), 0.5)), 800));
  c.out.input = steerToward(self.f, p, 1).input;
  if (self.ai.timer <= 0) {
    self.ai.mode = 'approach';
    return 'success';
  }
  return 'running';
});

const attackRun = action<AiCtx>((c) => {
  const { self, w } = c;
  const tgt = pickTarget(c);
  c.out.targetId = tgt.id;
  const d = dist(self.f.pos, tgt.f.pos);
  if (self.ai.mode === 'breakoff') {
    self.ai.timer -= w.dt;
    // Swing out past the target, then come round again.
    const side = normalize(cross(sub(tgt.f.pos, self.f.pos), { x: 0, y: 1, z: 0 }));
    const p = add(tgt.f.pos, add(scale(side, 1200), scale(self.ai.jink, 500)));
    c.out.input = steerToward(self.f, p, 1).input;
    if (self.ai.timer <= 0) self.ai.mode = 'approach';
    return 'running';
  }
  self.ai.mode = 'approach';
  c.out.input = steerToward(self.f, tgt.f.pos, 1).input;
  if (d < BREAKOFF_DIST + tgt.radius) {
    self.ai.mode = 'breakoff';
    self.ai.timer = w.rng.range(2.0, 3.5);
    self.ai.jink = normalize({ x: w.rng.range(-1, 1), y: w.rng.range(-0.5, 0.5), z: w.rng.range(-1, 1) });
  }
  return 'running';
});

const callForHelp = action<AiCtx>((c) => {
  const { self, w } = c;
  self.ai.calledHelp = true;
  w.releaseReserve(2, self);
  return 'failure'; // a side effect; the tree carries on to the next behaviour
});

const standoff = action<AiCtx>((c) => {
  const { self, w } = c;
  const tgt = w.player;
  c.out.targetId = tgt.id;
  self.ai.mode = 'standoff';
  const d = dist(self.f.pos, tgt.f.pos);
  const toT = normalize(sub(tgt.f.pos, self.f.pos));
  let goal: Vec3;
  if (d > STANDOFF_MAX) goal = tgt.f.pos;
  else if (d < STANDOFF_MIN) goal = add(self.f.pos, scale(toT, -2000));
  else goal = add(self.f.pos, scale(normalize(cross(toT, { x: 0, y: 1, z: 0 })), 1500)); // circle
  c.out.input = steerToward(self.f, goal, d > STANDOFF_MAX ? 1 : 0.6).input;
  return 'running';
});

const baseHold = action<AiCtx>((c) => {
  const { self, w } = c;
  self.ai.mode = 'hold';
  c.out.input = NO_INPUT;
  c.out.targetId = w.player.id;
  self.ai.launchTimer -= w.dt;
  if (self.ai.launchTimer <= 0) {
    self.ai.launchTimer = self.ai.timer; // the hull's launch interval, set at spawn
    w.releaseReserve(2, self);
  }
  return 'running';
});

// ---- trees ----------------------------------------------------------------------------------------
const recentlyHit = (c: AiCtx) => c.w.t - c.self.ai.lastHitT < 0.5;

const fighterTree: BtNode<AiCtx> = selector(
  sequence(
    condition((c) => hpFrac(c.self) < RETREAT_HP),
    retreat,
  ),
  sequence(
    condition((c) => c.self.ai.mode === 'evade' || (recentlyHit(c) && c.w.rng.chance(0.08))),
    evade,
  ),
  attackRun,
);

const shipTree: BtNode<AiCtx> = selector(
  sequence(
    condition((c) => hpFrac(c.self) < 0.2),
    retreat,
  ),
  sequence(
    condition((c) => hpFrac(c.self) < 0.5 && !c.self.ai.calledHelp),
    callForHelp,
  ),
  standoff,
);

const baseTree: BtNode<AiCtx> = baseHold;

export const TREES: Record<HullClass, BtNode<AiCtx>> = {
  fighter: fighterTree,
  frigate: shipTree,
  capital: shipTree,
  base: baseTree,
};

export function think(self: Ent, w: AiWorld): AiCtx['out'] {
  const ctx: AiCtx = { self, w, out: { input: NO_INPUT, targetId: null } };
  if (self.hullClass) TREES[self.hullClass](ctx);
  return ctx.out;
}
