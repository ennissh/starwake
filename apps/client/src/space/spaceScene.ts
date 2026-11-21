import * as THREE from 'three';
import {
  type CombatEvent,
  type ContentBundle,
  type DroneType,
  Encounter,
  type EncounterResult,
  type Ent,
  type FlightInput,
  type PlayerCommand,
  type SystemId,
  IDLE_COMMAND,
  NO_INPUT,
  TICK,
  byId,
  clamp,
  leadPoint,
  len,
  systemOutputs,
  toWorld,
} from '@starwake/shared';
import { CAMERA_LABEL, CameraRig } from '../camera/rig.js';
import { type Action, ACTIONS } from '../input/keymap.js';
import { stickAxes } from '../input/joystick.js';
import type { Input } from '../input/input.js';
import { buildStarwake, type StarwakeModel } from '../models/starwake.js';
import { buildBuoy, buildPlanet, type PlanetKind } from '../models/planet.js';
import { type HullModel, buildVoskBase, buildVoskFighter, buildVoskFrigate } from '../models/vosk.js';
import { buildHornet, buildLanceDrone, buildRam } from '../models/drones.js';
import { buildSpace, type Space } from '../scene/space.js';
import { Fx } from '../scene/fx.js';
import { Hud, type SystemStatus } from '../hud/hud.js';
import { CombatHud, type CombatHudData, type TargetHud } from '../hud/combatHud.js';
import { Hologram } from '../hud/hologram.js';
import { type Contact, Radar } from '../hud/radar.js';
import { cycleSubsystem, cycleTarget, validTarget } from '../combat/targeting.js';
import type { Renderer } from '../render.js';

/** Throttle travel per second while W/S is held (full range in 2 s). */
const THROTTLE_RATE = 0.5;
const FOLD_HOLD_S = 1;

export interface Backdrop {
  seed: string;
  tint: string;
  starColor: string;
  sunDir: THREE.Vector3;
  planets: { kind: PlanetKind; radius: number; pos: THREE.Vector3; seed: string }[];
  buoys: boolean;
}

export interface SceneOptions {
  /** 'flight' = open space, nothing hostile; 'fight' = an encounter that ends in a result. */
  mode: 'flight' | 'fight';
  encounterId?: string;
  seed: string;
  backdrop: Backdrop;
  onCrippled?: () => void;
  onEnd?: (r: EncounterResult) => void;
}

const SUB_LABEL: Record<string, string> = { emitter: 'Emitter', turret: 'Turret', engine: 'Engine' };
const SYSTEM_LABEL: Record<SystemId, string> = {
  fold: 'Fold',
  thrusters: 'Thrust',
  lance: 'Lance',
  turret: 'Turret',
  foreShield: 'Fore sh.',
  aftShield: 'Aft sh.',
};

/**
 * The 3D space view: the Starwake, its drones and any hostiles, all driven by the shared
 * deterministic encounter sim at a fixed 60 Hz (interpolated for rendering).
 */
export class SpaceScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 400_000);
  readonly rig: CameraRig;
  readonly hud: Hud;
  readonly sim: Encounter;
  private chud: CombatHud;
  private holo = new Hologram();
  private ship: StarwakeModel;
  private space: Space;
  private fx = new Fx();
  private radar = new Radar();
  private staticContacts: Contact[] = [];
  private views = new Map<string, { model: HullModel; ent: Ent }>();
  private prev = new Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }>();
  private acc = 0;
  private pendingThrottle: number | undefined;
  private pendingLaunch: DroneType | null = null;
  private pendingRecall = false;
  private pendingFold = false;
  private foldHoldStart: number | null = null;
  private targetId: string | null = null;
  private subId: string | null = null;
  private ridingId: string | null = null;
  private lastLaunched: string | null = null;
  private ended = false;
  private holoT = 0;

  constructor(
    private readonly r: Renderer,
    uiRoot: HTMLElement,
    private readonly input: Input,
    private readonly content: ContentBundle,
    private readonly o: SceneOptions,
  ) {
    const def = o.encounterId ? byId(content.encounters, o.encounterId) : null;
    this.sim = new Encounter({
      seed: o.seed,
      content,
      roster: def?.roster ?? { hulls: [], reserve: [] },
      distance: def?.distance ?? 3000,
      endWhenClear: o.mode === 'fight',
    });

    const b = o.backdrop;
    this.space = buildSpace({ seed: b.seed, tint: b.tint, starColor: b.starColor, sunDir: b.sunDir });
    this.scene.add(this.space.group, this.fx.group);
    for (const p of b.planets) {
      const m = buildPlanet(p.kind, p.radius, p.seed);
      m.position.copy(p.pos);
      this.scene.add(m);
      this.staticContacts.push({ pos: m.position, kind: 'planet' });
    }
    if (b.buoys) {
      for (let i = 0; i < 12; i++) {
        const m = buildBuoy(i % 4 === 0 ? 0xf0c060 : 0x2fd3c4);
        m.position.set(Math.sin(i * 0.9) * 900, Math.cos(i * 0.6) * 300, -2_000 - i * 1_800);
        this.scene.add(m);
        this.staticContacts.push({ pos: m.position, kind: 'buoy' });
      }
    }

    this.ship = buildStarwake();
    this.scene.add(this.ship.group);
    this.rig = new CameraRig(this.camera, {
      ship: this.ship.group,
      bridge: this.ship.mounts.bridge,
      turret: this.ship.mounts.turret,
      drone: () => (this.ridingId ? (this.views.get(this.ridingId)?.model.group ?? null) : null),
    });
    this.hud = new Hud(uiRoot);
    this.chud = new CombatHud(this.hud.el);
    this.hud.el.classList.toggle('hud--combat', o.mode === 'fight');
    this.input.mouseFlies = this.rig.mouseFlies();
    this.syncViews();
  }

  // ---- input ------------------------------------------------------------------------------------
  handle(a: Action): boolean {
    const sim = this.sim;
    switch (a) {
      case 'throttleFull':
        this.pendingThrottle = 1;
        return true;
      case 'throttleStop':
        this.pendingThrottle = 0;
        return true;
      case 'flightAssist':
        sim.player.f = { ...sim.player.f, assist: !sim.player.f.assist };
        this.hud.toast(sim.player.f.assist ? 'Flight assist ON' : 'Drift mode: momentum is kept');
        return true;
      case 'cycleCamera': {
        if (!this.ridingId) this.ridingId = this.pickRide();
        const m = this.rig.cycle();
        if (m !== 'drone') this.ridingId = null;
        this.input.mouseFlies = this.rig.mouseFlies();
        if (this.input.mouseFlies) this.input.centreStick();
        this.hud.toast(m === 'drone' ? `Riding ${sim.get(this.ridingId)?.name ?? 'drone'}` : CAMERA_LABEL[m]);
        return true;
      }
      case 'targetNext':
      case 'targetPrev': {
        const list = sim.hostiles().map((h) => ({
          id: h.id,
          distance: len({
            x: h.f.pos.x - sim.player.f.pos.x,
            y: h.f.pos.y - sim.player.f.pos.y,
            z: h.f.pos.z - sim.player.f.pos.z,
          }),
        }));
        this.targetId = cycleTarget(list, this.targetId, a === 'targetNext' ? 1 : -1);
        this.subId = null;
        if (!this.targetId) this.hud.toast('Nothing to target');
        return true;
      }
      case 'targetSubsystem': {
        const t = sim.get(this.targetId);
        if (!t) return (void this.hud.toast('Target a ship first (T)'), true);
        if (!t.subs.length) return (void this.hud.toast(`${t.name} has no targetable subsystems`), true);
        this.subId = cycleSubsystem(t.subs, this.subId);
        this.hud.toast(
          this.subId
            ? `Subsystem: ${SUB_LABEL[t.subs.find((s) => s.id === this.subId)!.kind]}`
            : 'Whole ship',
        );
        return true;
      }
      case 'matchSpeed': {
        const t = sim.get(this.targetId);
        if (!t) return (void this.hud.toast('No target to match'), true);
        this.pendingThrottle = clamp(len(t.f.vel) / this.content.player.flight.maxSpeed, 0, 1);
        this.hud.toast('Matching target speed');
        return true;
      }
      case 'droneHornet':
      case 'droneLance':
      case 'droneRam':
        if (this.o.mode !== 'fight' && a !== 'droneHornet')
          return (void this.hud.toast('Nothing to launch at'), true);
        this.pendingLaunch = a === 'droneHornet' ? 'hornet' : a === 'droneLance' ? 'lance' : 'ram';
        return true;
      case 'recallDrones':
        this.pendingRecall = true;
        this.hud.toast('Recalling Hornets');
        return true;
      case 'emergencyFold':
        if (this.o.mode !== 'fight') return (void this.hud.toast('Nothing to escape from'), true);
        this.foldHoldStart = performance.now();
        this.hud.toast('Hold for emergency fold…', 1100);
        return true;
      default: {
        const def = ACTIONS[a];
        if ('comingIn' in def) {
          this.hud.toast(`${def.label}: arrives in ${def.comingIn}`);
          return true;
        }
        return false;
      }
    }
  }

  chooseCrippled(choice: 'emergencyFold' | 'lifeboat'): void {
    this.sim.chooseCrippled(choice);
    this.finishIfOver();
  }

  private pickRide(): string | null {
    const alive = this.sim.drones();
    const last = alive.find((d) => d.id === this.lastLaunched);
    return (last ?? alive[alive.length - 1])?.id ?? null;
  }

  private axes(): FlightInput {
    const i = this.input;
    const key = (pos: Action, neg: Action) => (i.held(pos) ? 1 : 0) - (i.held(neg) ? 1 : 0);
    let pitch = key('pitchUp', 'pitchDown');
    let yaw = key('yawLeft', 'yawRight');
    if (i.mouseFlies) {
      const s = stickAxes(i.stick, i.stickOpts);
      pitch += s.pitch;
      yaw += s.yaw;
    }
    return {
      pitch: clamp(pitch, -1, 1),
      yaw: clamp(yaw, -1, 1),
      roll: key('rollLeft', 'rollRight'),
      throttleRate: key('throttleUp', 'throttleDown') * THROTTLE_RATE,
    };
  }

  private command(): PlayerCommand {
    const mode = this.rig.mode;
    const firing = this.input.held('fire');
    const riding = mode === 'drone' && this.ridingId ? this.sim.get(this.ridingId) : undefined;
    const axes = this.axes();
    const cmd: PlayerCommand = {
      ...IDLE_COMMAND,
      flight: riding ? NO_INPUT : { ...axes, throttleSet: this.pendingThrottle },
      targetId: this.targetId,
      subsystemId: this.subId,
      launch: this.pendingLaunch,
      recall: this.pendingRecall,
      emergencyFold: this.pendingFold,
      fireLance: (mode === 'bridge' || mode === 'chase' || mode === 'orbit') && firing,
      turret:
        mode === 'turret'
          ? { mode: 'manual', aim: vec(this.rig.turretAim()), fire: firing }
          : { mode: 'wake' },
      drone: riding ? { id: riding.id, flight: axes, fire: firing } : null,
    };
    this.pendingThrottle = undefined;
    this.pendingLaunch = null;
    this.pendingRecall = false;
    this.pendingFold = false;
    return cmd;
  }

  // ---- frame ------------------------------------------------------------------------------------
  update(dt: number, paused: boolean): void {
    if (!paused && !this.ended) {
      if (this.foldHoldStart !== null) {
        if (!this.input.held('emergencyFold')) this.foldHoldStart = null;
        else if (performance.now() - this.foldHoldStart >= FOLD_HOLD_S * 1000) {
          this.pendingFold = true;
          this.foldHoldStart = null;
        }
      }
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= TICK) {
        this.capturePrev();
        const events = this.sim.step(this.command());
        this.onEvents(events);
        this.acc -= TICK;
        if (this.sim.crippled || this.sim.over) break;
      }
      this.finishIfOver();
    }
    this.syncViews();
    const a = paused || this.ended ? 1 : this.acc / TICK;
    this.place(a);

    this.rig.update(dt, paused ? { dx: 0, dy: 0, wheel: 0 } : this.input.consumeLook());
    this.input.mouseFlies = this.rig.mouseFlies();
    if (this.rig.mode !== 'drone') this.ridingId = null;
    this.space.update(this.camera);
    this.space.setPixelScale(this.r.vga ? 0.5 : 1);
    this.fx.setBolts(this.sim.bolts);
    this.fx.update(paused ? 0 : dt);

    const contacts: Contact[] = [...this.staticContacts];
    for (const e of this.sim.ents) {
      if (e.kind === 'starwake' || !e.alive) continue;
      contacts.push({ pos: vec3(e.f.pos), kind: e.side === 'hostile' ? 'hostile' : 'drone' });
    }
    this.radar.update(this.ship.group.position, this.ship.group.quaternion, contacts);

    const p = this.sim.player;
    this.hud.update({
      camera:
        this.rig.mode === 'drone'
          ? `Drone: ${this.sim.get(this.ridingId)?.name ?? ''}`
          : CAMERA_LABEL[this.rig.mode],
      assist: p.f.assist,
      speed: len(p.f.vel),
      maxSpeed: this.content.player.flight.maxSpeed,
      throttle: p.f.throttle,
      stick: this.input.stick,
      showStick: this.input.mouseFlies,
      stickRadiusPx: this.input.pointerLocked
        ? 120
        : (Math.min(window.innerWidth, window.innerHeight) / 2) * 0.8,
      systems: this.systems(),
    });
    this.chud.update(dt, this.combatHud());
    this.holoT += dt;
  }

  render(): void {
    this.r.render(this.scene, this.camera);
    this.radar.render(this.r.gl, this.hud.radarRect());
    const rect = this.chud.holoRect();
    if (rect) this.holo.render(this.r.gl, rect);
  }

  // ---- sim → scene ------------------------------------------------------------------------------
  private capturePrev(): void {
    for (const e of this.sim.ents) {
      const v = this.prev.get(e.id) ?? { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
      v.pos.set(e.f.pos.x, e.f.pos.y, e.f.pos.z);
      v.rot.set(e.f.rot.x, e.f.rot.y, e.f.rot.z, e.f.rot.w);
      this.prev.set(e.id, v);
    }
  }

  private place(a: number): void {
    const q1 = new THREE.Quaternion();
    const put = (obj: THREE.Object3D, e: Ent) => {
      const pr = this.prev.get(e.id);
      const cur = vec3(e.f.pos);
      q1.set(e.f.rot.x, e.f.rot.y, e.f.rot.z, e.f.rot.w);
      if (pr) {
        obj.position.lerpVectors(pr.pos, cur, a);
        obj.quaternion.slerpQuaternions(pr.rot, q1, a);
      } else {
        obj.position.copy(cur);
        obj.quaternion.copy(q1);
      }
    };
    put(this.ship.group, this.sim.player);
    for (const { model, ent } of this.views.values()) put(model.group, ent);
  }

  private syncViews(): void {
    const live = new Set<string>();
    for (const e of this.sim.ents) {
      if (e.kind === 'starwake' || !e.alive || e.fled) continue;
      live.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = { model: this.buildModel(e), ent: e };
        this.views.set(e.id, v);
        this.scene.add(v.model.group);
      }
      v.ent = e;
      for (const s of e.subs) {
        const m = v.model.subMarkers.get(s.id);
        if (m && !s.alive && m.visible) m.visible = false;
      }
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      this.scene.remove(v.model.group);
      v.model.dispose();
      this.views.delete(id);
      this.prev.delete(id);
    }
    this.targetId = validTarget(
      this.sim.hostiles().map((h) => ({ id: h.id, distance: 0 })),
      this.targetId,
    );
    if (!this.targetId) this.subId = null;
  }

  private buildModel(e: Ent): HullModel {
    if (e.kind === 'drone')
      return e.droneType === 'hornet'
        ? buildHornet()
        : e.droneType === 'lance'
          ? buildLanceDrone()
          : buildRam();
    const hull = byId(this.content.hulls, e.hullId!);
    const pal = byId(this.content.races, hull.raceId).palette;
    if (hull.meshId === 'vosk-fighter') return buildVoskFighter(pal);
    if (hull.meshId === 'vosk-frigate') return buildVoskFrigate(pal);
    return buildVoskBase(pal, hull.subsystems);
  }

  private onEvents(events: CombatEvent[]): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'lance':
          this.fx.beam(vec3(ev.from), vec3(ev.to), ev.blocked !== null);
          if (ev.blocked === 'emitters')
            this.hud.toast('Lance blocked by shield emitters: take them out (Y)');
          break;
        case 'hit':
          this.fx.spark(vec3(ev.pos));
          break;
        case 'playerHit':
          this.fx.spark(vec3(ev.pos));
          if (ev.hull > 0) this.chud.flash();
          break;
        case 'destroyed':
          this.fx.explode(vec3(ev.pos), ev.radius * 2.5);
          break;
        case 'detonate':
          this.fx.explode(vec3(ev.pos), 40);
          break;
        case 'subDestroyed':
          this.fx.explode(vec3(ev.pos), 70);
          this.hud.toast(
            `${SUB_LABEL[this.sim.get(ev.targetId)?.subs.find((s) => s.id === ev.subId)?.kind ?? ''] ?? 'Subsystem'} destroyed`,
          );
          break;
        case 'launch':
          this.lastLaunched = ev.id;
          this.hud.toast(`${byId(this.content.drones, ev.drone).name} away`);
          break;
        case 'launchFailed':
          this.hud.toast(ev.reason);
          break;
        case 'docked':
          this.hud.toast('Hornet docked');
          break;
        case 'reinforcements':
          this.hud.toast(`${ev.count} more fighters incoming`);
          break;
        case 'componentDestroyed':
          this.hud.toast(`${byId(this.content.components, ev.componentId).name} destroyed`);
          break;
        case 'crippled':
          this.hud.toast('Hull breached: the Starwake is crippled', 3000);
          this.o.onCrippled?.();
          break;
        default:
          break;
      }
    }
  }

  private finishIfOver(): void {
    if (this.sim.over && !this.ended) {
      this.ended = true;
      this.o.onEnd?.(this.sim.result());
    }
  }

  // ---- HUD data ---------------------------------------------------------------------------------
  private systems(): SystemStatus[] {
    const out = systemOutputs(this.sim.installed, this.content);
    return (Object.keys(SYSTEM_LABEL) as SystemId[]).map((id) => ({
      id,
      label: SYSTEM_LABEL[id],
      output: out[id],
    }));
  }

  private combatHud(): CombatHudData | null {
    if (this.o.mode !== 'fight') return null;
    const sim = this.sim;
    const sp = this.content.player;
    const lance = byId(this.content.weapons, sp.lance.weapon);
    const t = sim.get(this.targetId);
    let target: TargetHud | null = null;
    if (t) {
      const hull = t.hullId ? byId(this.content.hulls, t.hullId) : null;
      this.holo.set(t.id, this.views.get(t.id)?.model.hullGeometry ?? null, t.radius, hull?.subsystems ?? []);
      this.holo.update(0.016, t.subs, this.subId);
      const centre = this.project(vec3(t.f.pos), t.radius);
      const subPos = this.subId ? this.project(vec3(sim.aimPoint(t, this.subId)), 0) : null;
      let lead = null;
      if (this.rig.mode === 'turret') {
        const turret = byId(this.content.weapons, sp.turret.weapon);
        const from = toWorld(sim.player.f.pos, sim.player.f.rot, sp.turret.mount);
        const lp = this.project(
          vec3(leadPoint(from, { x: 0, y: 0, z: 0 }, sim.aimPoint(t, this.subId), t.f.vel, turret.speed)),
          0,
        );
        lead = lp.screen;
      }
      target = {
        name: t.name,
        cls: t.hullClass ?? 'drone',
        distance: len({
          x: t.f.pos.x - sim.player.f.pos.x,
          y: t.f.pos.y - sim.player.f.pos.y,
          z: t.f.pos.z - sim.player.f.pos.z,
        }),
        hull: t.hp / t.maxHp,
        emitters: sim.emittersAlive(t),
        subs: t.subs.map((s) => ({
          id: s.id,
          label: SUB_LABEL[s.kind] ?? s.kind,
          hp: s.hp / s.maxHp,
          alive: s.alive,
          selected: s.id === this.subId,
        })),
        screen: centre.screen ? { ...centre.screen, r: centre.r } : null,
        edgeAngle: centre.edgeAngle,
        sub: subPos?.screen ?? null,
        lead,
      };
    } else {
      this.holo.set(null, null, 0, []);
    }
    return {
      hull: sim.player.hp / sim.player.maxHp,
      fore: sim.shields.fore / sp.shields.fore,
      aft: sim.shields.aft / sp.shields.aft,
      lance: sim.lanceCharge / lance.cooldown,
      turret: this.rig.mode === 'turret' ? 'Manual' : 'WAKE',
      frames: sim.frames,
      active: sim.drones().length,
      maxActive: sp.droneBay.maxActive,
      riding: this.rig.mode === 'drone' ? (sim.get(this.ridingId)?.name ?? null) : null,
      target,
      hostiles: sim.hostiles().length,
    };
  }

  /** Project a world point to CSS px; when behind the camera, report the edge direction instead. */
  private project(
    p: THREE.Vector3,
    radius: number,
  ): { screen: { x: number; y: number } | null; r: number; edgeAngle: number | null } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = p.clone().project(this.camera);
    const camSpace = p.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const dist = -camSpace.z;
    const onScreen = dist > 0 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    const r =
      dist > 0 ? (radius / (dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))) * (h / 2) : 0;
    if (onScreen) return { screen: { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }, r, edgeAngle: null };
    const ang = Math.atan2(-camSpace.y, camSpace.x);
    return { screen: null, r, edgeAngle: ang };
  }

  snapshot() {
    const p = this.sim.player;
    return {
      camera: this.rig.mode,
      assist: p.f.assist,
      throttle: p.f.throttle,
      speed: len(p.f.vel),
      pos: { ...p.f.pos },
      hostiles: this.sim.hostiles().length,
      targetId: this.targetId,
      subId: this.subId,
      drones: this.sim.drones().length,
      frames: this.sim.frames,
      crippled: this.sim.crippled,
      outcome: this.sim.outcome,
      hull: p.hp / p.maxHp,
    };
  }

  dispose(): void {
    for (const v of this.views.values()) v.model.dispose();
    this.chud.dispose();
    this.hud.dispose();
    this.holo.dispose();
    this.fx.dispose();
    this.ship.dispose();
    this.space.dispose();
  }
}

const vec3 = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const vec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
