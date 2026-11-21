import * as THREE from 'three';
import {
  type ContentBundle,
  type FlightInput,
  type FlightState,
  type FlightStats,
  clamp,
  forwardSpeed,
  initialFlight,
  len,
  stepFlight,
} from '@starwake/shared';
import { CAMERA_LABEL, CameraRig } from '../camera/rig.js';
import { type Action, ACTIONS } from '../input/keymap.js';
import { stickAxes } from '../input/joystick.js';
import type { Input } from '../input/input.js';
import { buildStarwake, type StarwakeModel } from '../models/starwake.js';
import { buildBuoy, buildPlanet } from '../models/planet.js';
import { buildSpace, type Space } from '../scene/space.js';
import { Hud, type SystemStatus } from '../hud/hud.js';
import { type Contact, Radar } from '../hud/radar.js';
import type { Renderer } from '../render.js';

const STEP = 1 / 60;
/** Throttle travel per second while W/S is held (full range in 2 s). */
const THROTTLE_RATE = 0.5;

/**
 * M1 flight test: the Starwake in open space near a planet and a ring of nav buoys. Flies with the
 * shared flight model at a fixed 60 Hz step, interpolated for rendering.
 */
export class FlightScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 400_000);
  readonly rig: CameraRig;
  readonly hud: Hud;
  private ship: StarwakeModel;
  private space: Space;
  private radar = new Radar();
  private contacts: Contact[] = [];
  private stats: FlightStats;
  state: FlightState = initialFlight();
  private prev: FlightState = this.state;
  private acc = 0;
  private pendingSet: number | undefined;

  constructor(
    private readonly r: Renderer,
    uiRoot: HTMLElement,
    private readonly input: Input,
    content: ContentBundle,
    private readonly onComingSoon: (a: Action, milestone: string) => void = () => {},
  ) {
    this.stats = content.player.flight;
    const sunDir = new THREE.Vector3(0.5, 0.25, -0.8).normalize();
    this.space = buildSpace({ seed: 'harbor', tint: '#1d3350', starColor: '#ffd9a0', sunDir });
    this.scene.add(this.space.group);

    this.ship = buildStarwake();
    this.scene.add(this.ship.group);

    const planet = buildPlanet('rock', 6000, 'harbor-1');
    planet.position.set(-18_000, -4_000, -42_000);
    this.scene.add(planet);
    this.contacts.push({ pos: planet.position, kind: 'planet' });

    // A slalom of buoys ahead: something to fly through and see on the radar.
    for (let i = 0; i < 12; i++) {
      const b = buildBuoy(i % 4 === 0 ? 0xf0c060 : 0x2fd3c4);
      b.position.set(Math.sin(i * 0.9) * 900, Math.cos(i * 0.6) * 300, -2_000 - i * 1_800);
      this.scene.add(b);
      this.contacts.push({ pos: b.position, kind: 'buoy' });
    }

    this.rig = new CameraRig(this.camera, {
      ship: this.ship.group,
      bridge: this.ship.mounts.bridge,
      turret: this.ship.mounts.turret,
    });
    this.hud = new Hud(uiRoot);
    this.input.mouseFlies = this.rig.mouseFlies();
  }

  handle(a: Action): boolean {
    switch (a) {
      case 'throttleFull':
        this.pendingSet = 1;
        return true;
      case 'throttleStop':
        this.pendingSet = 0;
        return true;
      case 'flightAssist':
        this.state = { ...this.state, assist: !this.state.assist };
        this.hud.toast(this.state.assist ? 'Flight assist ON' : 'Drift mode: momentum is kept');
        return true;
      case 'cycleCamera': {
        const m = this.rig.cycle();
        this.input.mouseFlies = this.rig.mouseFlies();
        if (this.input.mouseFlies) this.input.centreStick();
        this.hud.toast(CAMERA_LABEL[m]);
        return true;
      }
      default: {
        const def = ACTIONS[a];
        if ('comingIn' in def) {
          this.onComingSoon(a, def.comingIn);
          this.hud.toast(`${def.label}: arrives in ${def.comingIn}`);
          return true;
        }
        return false;
      }
    }
  }

  private flightInput(): FlightInput {
    const i = this.input;
    const key = (pos: Action, neg: Action) => (i.held(pos) ? 1 : 0) - (i.held(neg) ? 1 : 0);
    let pitch = key('pitchUp', 'pitchDown');
    let yaw = key('yawLeft', 'yawRight');
    if (i.mouseFlies) {
      const s = stickAxes(i.stick, i.stickOpts);
      pitch += s.pitch;
      yaw += s.yaw;
    }
    const inp: FlightInput = {
      pitch: clamp(pitch, -1, 1),
      yaw: clamp(yaw, -1, 1),
      roll: key('rollLeft', 'rollRight'),
      throttleRate: key('throttleUp', 'throttleDown') * THROTTLE_RATE,
      throttleSet: this.pendingSet,
    };
    this.pendingSet = undefined;
    return inp;
  }

  /** Advance the sim by real time `dt` (seconds). */
  update(dt: number, paused: boolean): void {
    if (!paused) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= STEP) {
        this.prev = this.state;
        this.state = stepFlight(this.state, this.flightInput(), this.stats, STEP);
        this.acc -= STEP;
      }
    }
    // Interpolate between the last two sim states for smooth rendering at any refresh rate.
    const a = paused ? 1 : this.acc / STEP;
    const p = this.prev.pos;
    const s = this.state.pos;
    this.ship.group.position.set(p.x + (s.x - p.x) * a, p.y + (s.y - p.y) * a, p.z + (s.z - p.z) * a);
    const q0 = new THREE.Quaternion(this.prev.rot.x, this.prev.rot.y, this.prev.rot.z, this.prev.rot.w);
    const q1 = new THREE.Quaternion(this.state.rot.x, this.state.rot.y, this.state.rot.z, this.state.rot.w);
    this.ship.group.quaternion.slerpQuaternions(q0, q1, a);

    this.rig.update(dt, paused ? { dx: 0, dy: 0, wheel: 0 } : this.input.consumeLook());
    this.space.update(this.camera);
    this.space.setPixelScale(this.r.vga ? 0.5 : 1);
    this.radar.update(this.ship.group.position, this.ship.group.quaternion, this.contacts);
    this.hud.update({
      camera: CAMERA_LABEL[this.rig.mode],
      assist: this.state.assist,
      speed: len(this.state.vel),
      maxSpeed: this.stats.maxSpeed,
      throttle: this.state.throttle,
      stick: this.input.stick,
      showStick: this.input.mouseFlies,
      stickRadiusPx: this.input.pointerLocked
        ? 120
        : (Math.min(window.innerWidth, window.innerHeight) / 2) * 0.8,
      systems: this.systems(),
    });
  }

  render(): void {
    this.r.render(this.scene, this.camera);
    this.radar.render(this.r.gl, this.hud.radarRect());
  }

  /** Ship systems for the status icons. Outputs arrive with the engine room (M4). */
  private systems(): SystemStatus[] {
    return [
      { id: 'fold', label: 'Fold', output: null },
      { id: 'thrusters', label: 'Thrust', output: null },
      { id: 'lance', label: 'Lance', output: null },
      { id: 'turret', label: 'Turret', output: null },
      { id: 'foreShield', label: 'Fore sh.', output: null },
      { id: 'aftShield', label: 'Aft sh.', output: null },
    ];
  }

  /** Test/debug view of the flight state. */
  snapshot() {
    return {
      camera: this.rig.mode,
      assist: this.state.assist,
      throttle: this.state.throttle,
      speed: len(this.state.vel),
      forwardSpeed: forwardSpeed(this.state),
      pos: { ...this.state.pos },
    };
  }

  dispose(): void {
    this.hud.dispose();
    this.ship.dispose();
    this.space.dispose();
  }
}
