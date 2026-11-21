import * as THREE from 'three';

/**
 * Camera modes (PLAN §1.4): bridge, chase, orbit, turret and drone cockpit, with smooth blends
 * between them. The rig reads the ship's transform and mount points; it never moves the ship.
 */
export const CAMERA_MODES = ['bridge', 'chase', 'orbit', 'turret', 'drone'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  bridge: 'Bridge',
  chase: 'Chase',
  orbit: 'Orbit',
  turret: 'Turret',
  drone: 'Drone cockpit',
};

const FOV: Record<CameraMode, number> = { bridge: 70, chase: 60, orbit: 50, turret: 65, drone: 75 };
const BLEND_S = 0.45;

export interface RigTargets {
  ship: THREE.Object3D;
  bridge: THREE.Object3D;
  turret: THREE.Object3D;
  /** The drone being ridden, if any (M2). */
  drone?: (() => THREE.Object3D | null) | undefined;
}

export class CameraRig {
  mode: CameraMode = 'chase';
  readonly orbit = { yaw: 0.6, pitch: 0.25, dist: 900 };
  readonly turret = { yaw: 0, pitch: 0.12 };
  private blend: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; t: number } | null = null;
  private chasePos = new THREE.Vector3();
  private chaseQuat = new THREE.Quaternion();
  private chaseInit = false;
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private shipQuat = new THREE.Quaternion();
  private shipPos = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly t: RigTargets,
  ) {}

  /** Modes available right now (drone only while one is flying). */
  available(): CameraMode[] {
    return CAMERA_MODES.filter((m) => m !== 'drone' || !!this.t.drone?.());
  }

  cycle(): CameraMode {
    const modes = this.available();
    const i = modes.indexOf(this.mode);
    this.setMode(modes[(i + 1) % modes.length]!);
    return this.mode;
  }

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    this.blend = {
      pos: this.camera.position.clone(),
      quat: this.camera.quaternion.clone(),
      fov: this.camera.fov,
      t: 0,
    };
    if (m === 'chase') this.chaseInit = false;
    this.mode = m;
  }

  /** Does the mouse steer the ship in this mode (else it moves the view)? */
  mouseFlies(): boolean {
    return this.mode === 'bridge' || this.mode === 'chase' || this.mode === 'drone';
  }

  /** World-space aim of the turret (for M2 firing). */
  turretAim(out = new THREE.Vector3()): THREE.Vector3 {
    this.t.ship.getWorldQuaternion(this.shipQuat);
    return out.set(0, 0, -1).applyQuaternion(this.turretLocalQuat(this.tmpQuat).premultiply(this.shipQuat));
  }

  update(dt: number, look: { dx: number; dy: number; wheel: number }): void {
    if (this.mode === 'drone' && !this.t.drone?.()) this.setMode('chase');
    const { ship } = this.t;
    ship.updateWorldMatrix(true, true);
    ship.getWorldPosition(this.shipPos);
    ship.getWorldQuaternion(this.shipQuat);
    const pos = this.tmpPos;
    const quat = this.tmpQuat;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.shipQuat);

    switch (this.mode) {
      case 'bridge': {
        this.t.bridge.getWorldPosition(pos);
        quat.copy(this.shipQuat);
        break;
      }
      case 'chase': {
        const desired = new THREE.Vector3(0, 75, 430).applyQuaternion(this.shipQuat).add(this.shipPos);
        const aim = new THREE.Vector3(0, 0, -180).applyQuaternion(this.shipQuat).add(this.shipPos);
        const m = new THREE.Matrix4().lookAt(desired, aim, up);
        const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(m);
        if (!this.chaseInit) {
          this.chasePos.copy(desired);
          this.chaseQuat.copy(desiredQuat);
          this.chaseInit = true;
        }
        const k = 1 - Math.exp(-5 * dt);
        this.chasePos.lerp(desired, k);
        this.chaseQuat.slerp(desiredQuat, k);
        pos.copy(this.chasePos);
        quat.copy(this.chaseQuat);
        break;
      }
      case 'orbit': {
        this.orbit.yaw -= look.dx * 0.005;
        this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + look.dy * 0.005, -1.45, 1.45);
        this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * Math.pow(1.12, look.wheel), 220, 6000);
        const o = this.orbit;
        pos
          .set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch))
          .multiplyScalar(o.dist)
          .add(this.shipPos);
        quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, this.shipPos, new THREE.Vector3(0, 1, 0)));
        break;
      }
      case 'turret': {
        this.turret.yaw -= look.dx * 0.003;
        this.turret.pitch = THREE.MathUtils.clamp(this.turret.pitch - look.dy * 0.003, -0.08, 1.4);
        this.t.turret.getWorldPosition(pos);
        pos.addScaledVector(up, 12);
        quat.copy(this.shipQuat).multiply(this.turretLocalQuat(new THREE.Quaternion()));
        break;
      }
      case 'drone': {
        const d = this.t.drone?.();
        if (d) {
          d.getWorldPosition(pos);
          d.getWorldQuaternion(quat);
        }
        break;
      }
    }

    let fov = FOV[this.mode];
    if (this.blend) {
      this.blend.t += dt / BLEND_S;
      const s = THREE.MathUtils.smootherstep(Math.min(1, this.blend.t), 0, 1);
      pos.lerpVectors(this.blend.pos, pos, s);
      quat.slerpQuaternions(this.blend.quat, quat, s);
      fov = THREE.MathUtils.lerp(this.blend.fov, fov, s);
      if (this.blend.t >= 1) this.blend = null;
    }
    this.camera.position.copy(pos);
    this.camera.quaternion.copy(quat);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private turretLocalQuat(out: THREE.Quaternion): THREE.Quaternion {
    return out.setFromEuler(new THREE.Euler(this.turret.pitch, this.turret.yaw, 0, 'YXZ'));
  }
}
