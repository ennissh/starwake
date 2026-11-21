import { Rng, type RngState } from '../../rng.js';
import { type ContentBundle, type Drone, type Hull, type Roster, type Weapon, SYSTEM_IDS, byId } from '../../schemas/content.js';
import { type FlightInput, type FlightState, NO_INPUT, initialFlight, stepFlight } from '../flight.js';
import { type Vec3, add, dist, forwardOf, len, normalize, qConj, qFromAxisAngle, qRotate, scale, sub, v3 } from '../math.js';
import { type AiWorld, think } from './ai.js';
import { angleBetween, jitter, leadPoint, segmentSphere, toWorld } from './geometry.js';
import { type HitBlock, hitBlockedBy } from './rules.js';
import { steerToward } from './steer.js';
import type {
  Bolt,
  CombatEvent,
  DroneType,
  EncounterResult,
  Ent,
  InstalledComponent,
  Outcome,
  PlayerCommand,
  SubState,
} from './types.js';

export const TICK = 1 / 60;
const DOCK_DIST = 70;
/** Drones lose interest in targets further than this. */
const DRONE_SEEK = 3500;
const PLAYER_ID = 'starwake';

export const IDLE_COMMAND: PlayerCommand = {
  flight: NO_INPUT,
  fireLance: false,
  turret: { mode: 'wake' },
  targetId: null,
  subsystemId: null,
  launch: null,
  recall: false,
  drone: null,
  emergencyFold: false,
};

export interface EncounterOptions {
  seed: string | number;
  content: ContentBundle;
  roster: Roster;
  /** Distance from the player where hostiles start, units. */
  distance: number;
  /** Installed components (defaults to the content loadout at 100%). */
  installed?: InstalledComponent[];
  /** Drone frames carried (defaults to the bay's capacity). */
  frames?: number;
  /** Starting hull fraction 0..1. */
  hullFraction?: number;
  /** Where the player starts (defaults to the origin, flying -Z). */
  playerFlight?: FlightState;
}

/** Default installed components from the content loadout, all at 100% condition. */
export function defaultInstalled(c: ContentBundle): InstalledComponent[] {
  const out: InstalledComponent[] = [];
  for (const system of SYSTEM_IDS) {
    (c.player.loadout[system] ?? []).forEach((componentId, slot) => {
      if (componentId) out.push({ system, slot, componentId, condition: 100 });
    });
  }
  return out;
}

/**
 * One fight, simulated at a fixed 60 Hz with a seeded RNG: given the same options and the same
 * command per tick, it produces the same result on any machine (PLAN §0.4). The client runs it in
 * real time; the server can replay the command log to check a result (M3).
 */
export class Encounter {
  readonly c: ContentBundle;
  readonly rng: Rng;
  t = 0;
  tick = 0;
  ents: Ent[] = [];
  bolts: Bolt[] = [];
  reserve: string[];
  shields: { fore: number; aft: number };
  lastPlayerHit = -999;
  lanceCharge: number;
  turretCd = 0;
  frames: number;
  crippled = false;
  outcome: Outcome = 'ongoing';
  installed: InstalledComponent[];
  lost: InstalledComponent[] = [];
  salvage: string[] = [];
  destroyed: { id: string; hullId: string }[] = [];
  fled: { id: string; hullId: string }[] = [];
  dronesLost: Record<DroneType, number> = { hornet: 0, lance: 0, ram: 0 };
  private nextId = 1;
  private boltId = 1;
  private events: CombatEvent[] = [];
  private weapons: Map<string, Weapon>;

  constructor(o: EncounterOptions) {
    this.c = o.content;
    this.rng = new Rng(`encounter:${o.seed}`);
    this.weapons = new Map(o.content.weapons.map((w) => [w.id, w]));
    const p = o.content.player;
    this.shields = { fore: p.shields.fore, aft: p.shields.aft };
    this.lanceCharge = this.weapon(p.lance.weapon).cooldown;
    this.frames = o.frames ?? p.droneBay.frames;
    this.installed = (o.installed ?? defaultInstalled(o.content)).map((x) => ({ ...x }));
    this.reserve = [...o.roster.reserve];

    const player: Ent = this.blankEnt(PLAYER_ID, 'starwake', 'player', p.name);
    player.f = o.playerFlight ?? initialFlight();
    player.stats = p.flight;
    player.maxHp = p.hp;
    player.hp = p.hp * (o.hullFraction ?? 1);
    player.radius = 160;
    this.ents.push(player);

    // Hostiles start ahead of the player, spread in a loose arc.
    const fwd = forwardOf(player.f.rot);
    o.roster.hulls.forEach((hullId, i) => {
      const spread = (i - (o.roster.hulls.length - 1) / 2) * 400;
      const side = normalize({ x: -fwd.z, y: 0, z: fwd.x });
      const at = add(add(player.f.pos, scale(fwd, o.distance + this.rng.range(-200, 200))), add(scale(side, spread), v3(0, this.rng.range(-150, 150), 0)));
      this.spawnHull(hullId, at);
    });
  }

  // ---- public API -------------------------------------------------------------------------------
  get player(): Ent {
    return this.ents[0]!;
  }

  get over(): boolean {
    return this.outcome !== 'ongoing';
  }

  get rngState(): RngState {
    return this.rng.state;
  }

  hostiles(): Ent[] {
    return this.ents.filter((e) => e.side === 'hostile' && e.alive && !e.fled);
  }

  drones(): Ent[] {
    return this.ents.filter((e) => e.kind === 'drone' && e.alive);
  }

  get(id: string | null): Ent | undefined {
    return id ? this.ents.find((e) => e.id === id) : undefined;
  }

  weapon(id: string): Weapon {
    const w = this.weapons.get(id);
    if (!w) throw new Error(`unknown weapon ${id}`);
    return w;
  }

  emittersAlive(e: Ent): boolean {
    return e.subs.some((s) => s.kind === 'emitter' && s.alive);
  }

  /** Advance one fixed tick. Returns the events of this tick. */
  step(cmd: PlayerCommand): CombatEvent[] {
    this.events = [];
    if (this.over) return this.events;
    const dt = TICK;

    if (cmd.emergencyFold) {
      this.finishEmergencyFold();
      return this.events;
    }
    if (this.crippled) return this.events; // the fight waits for the crippled choice

    this.stepPlayer(cmd, dt);
    this.stepDrones(cmd, dt);
    this.stepHostiles(dt);
    this.stepBolts(dt);
    this.cleanup();

    this.t += dt;
    this.tick++;
    if (!this.crippled && this.hostiles().length === 0) this.finish('victory');
    return this.events;
  }

  /** After the Starwake is crippled the player chooses how to get out (PLAN §1.5). */
  chooseCrippled(choice: 'emergencyFold' | 'lifeboat'): void {
    if (!this.crippled || this.over) return;
    if (choice === 'emergencyFold') this.finishEmergencyFold();
    else this.finish('lifeboat');
  }

  result(): EncounterResult {
    return {
      outcome: this.outcome,
      ticks: this.tick,
      destroyed: [...this.destroyed],
      fled: [...this.fled],
      salvage: [...this.salvage],
      installed: this.installed.map((x) => ({ ...x })),
      lost: this.lost.map((x) => ({ ...x })),
      hullFraction: Math.max(0, this.player.hp / this.player.maxHp),
      framesLeft: this.frames + this.drones().filter((d) => d.droneType === 'hornet').length,
      dronesLost: { ...this.dronesLost },
    };
  }

  // ---- setup ------------------------------------------------------------------------------------
  private blankEnt(id: string, kind: Ent['kind'], side: Ent['side'], name: string): Ent {
    return {
      id,
      kind,
      side,
      name,
      hullId: null,
      hullClass: null,
      droneType: null,
      f: initialFlight(),
      stats: null,
      hp: 1,
      maxHp: 1,
      armor: 0,
      radius: 10,
      subs: [],
      mounts: [],
      alive: true,
      fled: false,
      ai: { mode: 'approach', timer: 0, targetId: null, jink: v3(0, 1, 0), calledHelp: false, lastHitT: -999, launchTimer: 0 },
      life: Infinity,
      targetId: null,
      targetSubId: null,
      docking: false,
    };
  }

  private spawnHull(hullId: string, at: Vec3): Ent {
    const h: Hull = byId(this.c.hulls, hullId);
    const e = this.blankEnt(`h${this.nextId++}`, 'hull', 'hostile', h.name);
    e.hullId = h.id;
    e.hullClass = h.class;
    e.stats = h.flight;
    e.hp = e.maxHp = h.hp;
    e.armor = h.armor;
    e.radius = h.radius;
    e.f = { ...initialFlight(at), rot: this.facing(at, this.player.f.pos) };
    e.mounts = h.weapons.map((w) => ({ weaponId: w.weapon, offset: w.offset, cooldown: this.rng.range(0, 1) }));
    e.subs = h.subsystems.map(
      (s): SubState => ({
        id: s.id,
        kind: s.kind,
        offset: s.offset,
        radius: s.radius,
        hp: s.hp,
        maxHp: s.hp,
        armor: s.armor,
        weaponId: s.weapon ?? null,
        cooldown: this.rng.range(0, 1.5),
        alive: true,
      }),
    );
    if (h.launchInterval) {
      e.ai.timer = h.launchInterval;
      e.ai.launchTimer = h.launchInterval * 0.4;
    }
    this.ents.push(e);
    return e;
  }

  /** Rotation that points -Z from `from` toward `to` (yaw then pitch, no roll). */
  private facing(from: Vec3, to: Vec3) {
    const d = normalize(sub(to, from));
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    const qy = qFromAxisAngle(v3(0, 1, 0), yaw);
    const qx = qFromAxisAngle(v3(1, 0, 0), pitch);
    return {
      x: qy.w * qx.x + qy.x * qx.w + qy.y * qx.z - qy.z * qx.y,
      y: qy.w * qx.y - qy.x * qx.z + qy.y * qx.w + qy.z * qx.x,
      z: qy.w * qx.z + qy.x * qx.y - qy.y * qx.x + qy.z * qx.w,
      w: qy.w * qx.w - qy.x * qx.x - qy.y * qx.y - qy.z * qx.z,
    };
  }

  private releaseReserve(n: number, by: Ent): number {
    let count = 0;
    while (count < n && this.reserve.length) {
      const hullId = this.reserve.shift()!;
      const at = add(by.f.pos, v3(this.rng.range(-1, 1) * (by.radius + 80), by.radius + 60, this.rng.range(-1, 1) * (by.radius + 80)));
      this.spawnHull(hullId, at);
      count++;
    }
    if (count) this.events.push({ t: 'reinforcements', count, by: by.id });
    return count;
  }

  // ---- player -----------------------------------------------------------------------------------
  private stepPlayer(cmd: PlayerCommand, dt: number): void {
    const p = this.player;
    const sp = this.c.player;
    const riding = cmd.drone && this.get(cmd.drone.id)?.alive;
    p.f = stepFlight(p.f, riding ? { ...NO_INPUT } : cmd.flight, sp.flight, dt);

    // Shields recharge after a quiet spell.
    if (this.t - this.lastPlayerHit > sp.shields.rechargeDelayS) {
      this.shields.fore = Math.min(sp.shields.fore, this.shields.fore + sp.shields.rechargePerS * dt);
      this.shields.aft = Math.min(sp.shields.aft, this.shields.aft + sp.shields.rechargePerS * dt);
    }

    // Spinal Lance: a beam along the keel, on a recharge.
    const lance = this.weapon(sp.lance.weapon);
    this.lanceCharge = Math.min(lance.cooldown, this.lanceCharge + dt);
    if (cmd.fireLance && this.lanceCharge >= lance.cooldown) {
      this.lanceCharge = 0;
      const from = toWorld(p.f.pos, p.f.rot, sp.lance.muzzle);
      const dir = forwardOf(p.f.rot);
      const to = add(from, scale(dir, lance.range));
      const hit = this.raycast(from, to, 'hostile');
      let blocked: HitBlock = null;
      if (hit) blocked = this.applyHit(hit.ent, hit.sub, lance, hit.pos);
      this.events.push({ t: 'lance', from, to: hit ? hit.pos : to, hitId: hit?.ent.id ?? null, blocked });
    }

    // Turret: manual aim with a light assist, or crewed by WAKE (point defence against fighters).
    const turret = this.weapon(sp.turret.weapon);
    this.turretCd -= dt;
    if (this.turretCd <= 0) {
      const from = toWorld(p.f.pos, p.f.rot, sp.turret.mount);
      let dir: Vec3 | null = null;
      let spread = 0;
      if (cmd.turret.mode === 'manual') {
        if (cmd.turret.fire) {
          dir = normalize(cmd.turret.aim);
          const tgt = this.get(cmd.targetId);
          if (tgt?.alive && tgt.side === 'hostile') {
            const aimAt = this.aimPoint(tgt, cmd.subsystemId);
            const lead = leadPoint(from, v3(), aimAt, tgt.f.vel, turret.speed);
            const want = normalize(sub(lead, from));
            if (angleBetween(dir, want) < (3 * Math.PI) / 180) dir = want; // aim assist
          }
        }
      } else {
        const tgt = this.nearest(from, this.hostiles().filter((h) => h.hullClass === 'fighter'), turret.range);
        if (tgt) {
          dir = normalize(sub(leadPoint(from, v3(), tgt.f.pos, tgt.f.vel, turret.speed), from));
          spread = sp.wakeTurretSpread;
        }
      }
      if (dir) {
        this.fireBolt(turret, 'player', p.id, from, dir, spread);
        this.turretCd = turret.cooldown;
      }
    }

    // Drone launch and recall.
    if (cmd.launch) this.launch(cmd.launch, cmd.targetId, cmd.subsystemId);
    if (cmd.recall) for (const d of this.drones()) if (d.droneType === 'hornet') d.docking = true;
  }

  private launch(type: DroneType, targetId: string | null, subId: string | null): void {
    const sp = this.c.player;
    const def: Drone = byId(this.c.drones, type);
    if (this.frames <= 0) return void this.events.push({ t: 'launchFailed', reason: 'No drone frames left' });
    if (this.drones().length >= sp.droneBay.maxActive)
      return void this.events.push({ t: 'launchFailed', reason: `${sp.droneBay.maxActive} drones already out` });
    const tgt = this.get(targetId);
    if (def.oneUse && !(tgt?.alive && tgt.side === 'hostile'))
      return void this.events.push({ t: 'launchFailed', reason: `${def.name} needs a target (T)` });
    const p = this.player;
    const e = this.blankEnt(`d${this.nextId++}`, 'drone', 'player', def.name);
    e.droneType = type;
    e.stats = def.flight;
    e.hp = e.maxHp = def.hp;
    e.armor = def.armor;
    e.radius = def.radius;
    e.life = def.life;
    e.targetId = def.oneUse ? targetId : null;
    e.targetSubId = def.oneUse ? subId : null;
    const at = toWorld(p.f.pos, p.f.rot, sp.droneBay.mount);
    const down = qRotate(p.f.rot, v3(0, -1, 0));
    e.f = { ...p.f, pos: at, vel: add(p.f.vel, scale(down, 30)), angVel: v3(), throttle: 1, assist: true };
    this.frames--;
    this.ents.push(e);
    this.events.push({ t: 'launch', id: e.id, drone: type });
  }

  // ---- drones -----------------------------------------------------------------------------------
  private stepDrones(cmd: PlayerCommand, dt: number): void {
    const p = this.player;
    const bay = toWorld(p.f.pos, p.f.rot, this.c.player.droneBay.mount);
    for (const d of this.drones()) {
      const def = byId(this.c.drones, d.droneType!);
      d.life -= dt;
      if (d.life <= 0) {
        this.killDrone(d, true);
        continue;
      }
      const ridden = cmd.drone?.id === d.id;
      let input: FlightInput;

      if (def.oneUse) {
        let tgt = this.get(d.targetId);
        if (!tgt?.alive || tgt.fled) {
          tgt = this.nearest(d.f.pos, this.hostiles(), DRONE_SEEK);
          d.targetId = tgt?.id ?? null;
          d.targetSubId = null;
        }
        if (!tgt) {
          this.killDrone(d, true);
          continue;
        }
        const aim = this.aimPoint(tgt, d.targetSubId);
        input = steerToward(d.f, leadPoint(d.f.pos, d.f.vel, aim, tgt.f.vel, Math.max(1, len(d.f.vel))), 1, 4).input;
        if (ridden) input = { ...cmd.drone!.flight, throttleSet: 1 };
        const sub = tgt.subs.find((s) => s.id === d.targetSubId && s.alive) ?? null;
        const reach = def.proximity + (sub ? sub.radius : tgt.radius);
        const prev = d.f.pos;
        d.f = stepFlight(d.f, input, d.stats!, dt);
        // Swept check: a fast drone can pass through its proximity sphere within one tick.
        if (segmentSphere(prev, d.f.pos, aim, reach) !== null) {
          this.applyHit(tgt, sub, this.weapon(def.weapon), d.f.pos);
          this.events.push({ t: 'detonate', id: d.id, pos: d.f.pos });
          d.alive = false;
        }
        continue;
      } else if (ridden) {
        input = cmd.drone!.flight;
        if (cmd.drone!.fire) this.fireForward(d, def.weapon);
      } else if (d.docking) {
        input = steerToward(d.f, bay, dist(d.f.pos, bay) < 400 ? 0.4 : 1).input;
        if (dist(d.f.pos, bay) < DOCK_DIST) {
          d.alive = false;
          this.frames++;
          this.events.push({ t: 'docked', id: d.id });
          continue;
        }
      } else {
        // Hornet autopilot: attack the player's target, else the nearest hostile, else escort.
        let tgt = this.get(cmd.targetId);
        if (!(tgt?.alive && tgt.side === 'hostile')) tgt = this.nearest(d.f.pos, this.hostiles(), DRONE_SEEK);
        if (tgt) {
          const w = this.weapon(def.weapon);
          const lead = leadPoint(d.f.pos, v3(), this.aimPoint(tgt, null), tgt.f.vel, w.speed);
          const s = steerToward(d.f, lead, dist(d.f.pos, tgt.f.pos) < 200 ? 0.5 : 1, 3);
          input = s.input;
          if (s.angle < (w.arc * Math.PI) / 180 && dist(d.f.pos, tgt.f.pos) < w.range) this.fireForward(d, def.weapon);
        } else {
          input = steerToward(d.f, add(p.f.pos, qRotate(p.f.rot, v3(0, 60, -400))), 0.8).input;
        }
      }
      d.f = stepFlight(d.f, input, d.stats!, dt);
    }
  }

  private killDrone(d: Ent, quietly: boolean): void {
    d.alive = false;
    this.dronesLost[d.droneType!]++;
    if (!quietly) this.events.push({ t: 'destroyed', id: d.id, pos: d.f.pos, radius: d.radius });
    else this.events.push({ t: 'detonate', id: d.id, pos: d.f.pos });
  }

  // ---- hostiles ---------------------------------------------------------------------------------
  private stepHostiles(dt: number): void {
    const world: AiWorld = {
      t: this.t,
      dt,
      rng: this.rng,
      player: this.player,
      playerSide: () => [this.player, ...this.drones()],
      get: (id) => this.get(id),
      releaseReserve: (n, by) => this.releaseReserve(n, by),
    };
    for (const e of this.hostiles()) {
      const out = think(e, world);
      if (e.fled) {
        this.fled.push({ id: e.id, hullId: e.hullId! });
        this.events.push({ t: 'fled', id: e.id });
        continue;
      }
      const engines = e.subs.filter((s) => s.kind === 'engine');
      const immobile = engines.length > 0 && engines.every((s) => !s.alive);
      if (e.stats) {
        e.f = stepFlight(e.f, immobile ? { ...NO_INPUT, throttleSet: 0 } : out.input, e.stats, dt);
      }
      const tgt = this.get(out.targetId);
      // Hull mounts: forward guns fire at the AI's target when it's in their arc.
      for (const m of e.mounts) {
        m.cooldown -= dt;
        if (m.cooldown > 0 || !tgt?.alive) continue;
        const w = this.weapon(m.weaponId);
        const from = toWorld(e.f.pos, e.f.rot, m.offset);
        if (dist(from, tgt.f.pos) > w.range) continue;
        const lead = leadPoint(from, v3(), tgt.f.pos, tgt.f.vel, w.speed);
        const dir = normalize(sub(lead, from));
        if (angleBetween(forwardOf(e.f.rot), dir) > (w.arc * Math.PI) / 180) continue;
        this.fireBolt(w, 'hostile', e.id, from, dir, w.spread);
        m.cooldown = w.cooldown;
      }
      // Turret subsystems pick the nearest player-side thing in range, preferring drones up close.
      for (const s of e.subs) {
        if (!s.alive || !s.weaponId) continue;
        s.cooldown -= dt;
        if (s.cooldown > 0) continue;
        const w = this.weapon(s.weaponId);
        const from = toWorld(e.f.pos, e.f.rot, s.offset);
        const near = this.nearest(from, this.drones(), Math.min(800, w.range)) ?? (dist(from, this.player.f.pos) <= w.range ? this.player : undefined);
        if (!near) continue;
        const lead = leadPoint(from, v3(), near.f.pos, near.f.vel, w.speed);
        this.fireBolt(w, 'hostile', e.id, from, normalize(sub(lead, from)), w.spread);
        s.cooldown = w.cooldown;
      }
    }
  }

  // ---- projectiles and hits ---------------------------------------------------------------------
  /** Bolts fly along the aim line at the weapon's speed (no inherited velocity), so aim is WYSIWYG. */
  private fireBolt(w: Weapon, side: Ent['side'], ownerId: string, from: Vec3, dir: Vec3, spreadDeg: number): void {
    const d = spreadDeg > 0 ? jitter(dir, spreadDeg, this.rng.next(), this.rng.next()) : dir;
    this.bolts.push({
      id: this.boltId++,
      weaponId: w.id,
      side,
      ownerId,
      pos: from,
      vel: scale(d, w.speed),
      ttl: w.range / w.speed,
    });
    this.events.push({ t: 'shot', weaponId: w.id, side, from });
  }

  private fireForward(e: Ent, weaponId: string): void {
    const w = this.weapon(weaponId);
    // Drones have no AI tree; ai.timer holds the time their gun is next ready.
    if (e.ai.timer > this.t) return;
    e.ai.timer = this.t + w.cooldown;
    this.fireBolt(w, e.side, e.id, add(e.f.pos, scale(forwardOf(e.f.rot), e.radius + 2)), forwardOf(e.f.rot), 0);
  }

  private stepBolts(dt: number): void {
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      const next = add(b.pos, scale(b.vel, dt));
      const targets = b.side === 'player' ? 'hostile' : 'player';
      const hit = this.raycast(b.pos, next, targets, b.ownerId);
      if (hit) {
        this.applyHit(hit.ent, hit.sub, this.weapon(b.weaponId), hit.pos);
        continue;
      }
      b.pos = next;
      b.ttl -= dt;
      if (b.ttl > 0) keep.push(b);
    }
    this.bolts = keep;
  }

  /** Nearest hit along a segment against one side's entities: subsystems first, then hulls. */
  private raycast(from: Vec3, to: Vec3, side: Ent['side'], ignoreId?: string): { ent: Ent; sub: SubState | null; pos: Vec3 } | null {
    let best: { ent: Ent; sub: SubState | null; t: number } | null = null;
    for (const e of this.ents) {
      if (!e.alive || e.fled || e.side !== side || e.id === ignoreId) continue;
      // Cheap reject: bounding sphere around everything on the entity.
      const bound = e.radius + (e.subs.length ? 60 : 0) + (e.kind === 'starwake' ? 60 : 0);
      if (segmentSphere(from, to, e.f.pos, bound) === null) continue;
      for (const s of e.subs) {
        if (!s.alive) continue;
        const t = segmentSphere(from, to, toWorld(e.f.pos, e.f.rot, s.offset), s.radius);
        if (t !== null && (!best || t < best.t)) best = { ent: e, sub: s, t };
      }
      if (e.kind === 'starwake') {
        for (const hs of this.c.player.hitSpheres) {
          const t = segmentSphere(from, to, toWorld(e.f.pos, e.f.rot, hs.offset), hs.radius);
          if (t !== null && (!best || t < best.t)) best = { ent: e, sub: null, t };
        }
      } else {
        const t = segmentSphere(from, to, e.f.pos, e.radius);
        if (t !== null && (!best || t < best.t)) best = { ent: e, sub: null, t };
      }
    }
    if (!best) return null;
    return { ent: best.ent, sub: best.sub, pos: add(from, scale(sub(to, from), best.t)) };
  }

  /** Apply a weapon hit; returns why it was blocked, or null if it did damage. */
  private applyHit(e: Ent, s: SubState | null, w: Weapon, pos: Vec3) {
    if (e.kind === 'starwake') {
      this.hitPlayer(w.damage, pos);
      return null;
    }
    const blocked = hitBlockedBy({ weapon: w, armor: s ? s.armor : e.armor, emittersAlive: e.kind === 'hull' && this.emittersAlive(e) });
    this.events.push({ t: 'hit', targetId: e.id, subId: s?.id ?? null, weaponId: w.id, damage: blocked ? 0 : w.damage, blocked, pos });
    e.ai.lastHitT = this.t;
    if (blocked) return blocked;
    if (s) {
      s.hp -= w.damage;
      if (s.hp <= 0) {
        s.alive = false;
        s.hp = 0;
        this.events.push({ t: 'subDestroyed', targetId: e.id, subId: s.id, pos: toWorld(e.f.pos, e.f.rot, s.offset) });
      }
    } else {
      e.hp -= w.damage;
    }
    return null;
  }

  private hitPlayer(damage: number, pos: Vec3): void {
    const p = this.player;
    const local = qRotate(qConj(p.f.rot), sub(pos, p.f.pos));
    const region = local.z < 0 ? 'fore' : 'aft';
    const absorbed = Math.min(this.shields[region], damage);
    this.shields[region] -= absorbed;
    const hull = damage - absorbed;
    this.lastPlayerHit = this.t;
    this.events.push({ t: 'playerHit', region, absorbed, hull, pos });
    if (hull <= 0) return;
    p.hp -= hull;
    this.wear(hull * this.c.player.wearPerHullHp);
    if (p.hp <= 0 && !this.crippled) {
      p.hp = 0;
      this.crippled = true;
      p.f = { ...p.f, vel: v3(), angVel: v3(), throttle: 0 };
      this.bolts = this.bolts.filter((b) => b.side === 'player');
      this.events.push({ t: 'crippled' });
    }
  }

  /** Hull damage wears a random installed component; at 0% it is destroyed. */
  private wear(points: number): void {
    const live = this.installed.filter((x) => x.condition > 0);
    if (!live.length || points <= 0) return;
    const c = this.rng.pick(live);
    c.condition = Math.max(0, Math.round((c.condition - points) * 100) / 100);
    if (c.condition <= 0) {
      this.installed = this.installed.filter((x) => x !== c);
      this.lost.push({ ...c });
      this.events.push({ t: 'componentDestroyed', system: c.system, slot: c.slot, componentId: c.componentId });
    } else {
      this.events.push({ t: 'componentWorn', system: c.system, slot: c.slot, componentId: c.componentId, condition: c.condition });
    }
  }

  private cleanup(): void {
    for (const e of this.ents) {
      if (!e.alive || e.kind === 'starwake') continue;
      if (e.hp <= 0) {
        e.alive = false;
        if (e.kind === 'drone') {
          this.dronesLost[e.droneType!]++;
          this.events.push({ t: 'destroyed', id: e.id, pos: e.f.pos, radius: e.radius });
        } else {
          this.destroyed.push({ id: e.id, hullId: e.hullId! });
          this.events.push({ t: 'destroyed', id: e.id, pos: e.f.pos, radius: e.radius });
          this.rollSalvage(e);
        }
      }
    }
    // Drop dead drones and fled hulls from the live list but keep destroyed hulls for the scene.
    this.ents = this.ents.filter((e) => e.kind === 'starwake' || e.alive || (e.kind === 'hull' && !e.fled));
  }

  private rollSalvage(e: Ent): void {
    const h = byId(this.c.hulls, e.hullId!);
    for (let i = 0; i < h.salvage.rolls; i++) {
      if (!this.rng.chance(h.salvage.chance)) continue;
      this.salvage.push(this.rng.weighted(h.salvage.table.map((x) => ({ item: x.componentId, weight: x.weight }))));
    }
  }

  // ---- endings ----------------------------------------------------------------------------------
  private finishEmergencyFold(): void {
    const fl = this.c.player.emergencyFoldLoses;
    const n = this.rng.int(fl.min, fl.max);
    for (let i = 0; i < n && this.installed.length; i++) {
      const c = this.rng.pick(this.installed);
      this.installed = this.installed.filter((x) => x !== c);
      this.lost.push({ ...c });
    }
    this.salvage = []; // you leave the wrecks behind
    this.finish('emergencyFold');
  }

  private finish(o: Outcome): void {
    this.outcome = o;
    this.events.push({ t: 'over', outcome: o });
  }

  // ---- helpers ----------------------------------------------------------------------------------
  /** Where to aim at an entity: its chosen live subsystem, else its centre. */
  aimPoint(e: Ent, subId: string | null): Vec3 {
    const s = subId ? e.subs.find((x) => x.id === subId && x.alive) : undefined;
    return s ? toWorld(e.f.pos, e.f.rot, s.offset) : e.f.pos;
  }

  private nearest(from: Vec3, xs: Ent[], range: number): Ent | undefined {
    let best: Ent | undefined;
    let bd = range;
    for (const x of xs) {
      const d = dist(from, x.f.pos);
      if (d <= bd) {
        bd = d;
        best = x;
      }
    }
    return best;
  }
}
