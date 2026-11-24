import {
  type Quat,
  type Vec3,
  add,
  approach,
  clamp,
  dot,
  forwardOf,
  len,
  moveToward,
  qFromAxisAngle,
  qMul,
  qNormalize,
  scale,
  sub,
} from './math.js';

/**
 * Arcade-Newtonian flight (PLAN §1.4). Pure and deterministic: the client flies the player with it
 * and the encounter sim (M2) flies everything else with it, so the same inputs give the same path.
 *
 * Units: distance in model units (1 = 10 m), time in seconds, angles in radians.
 */
export interface FlightStats {
  /** Top speed, units/s. */
  maxSpeed: number;
  /** Linear acceleration, units/s². */
  accel: number;
  /** Max turn rates, rad/s. */
  pitchRate: number;
  yawRate: number;
  rollRate: number;
  /** How fast turn rates change, rad/s². Low = a heavy ship that takes time to start and stop turning. */
  angAccel: number;
  /** Drift mode: fraction of velocity lost per second with no thrust (0 = pure Newtonian). */
  driftDamping: number;
}

export interface FlightState {
  pos: Vec3;
  vel: Vec3;
  rot: Quat;
  /** Angular velocity in the ship's local frame: x = pitch, y = yaw, z = roll (rad/s). */
  angVel: Vec3;
  /** 0..1 */
  throttle: number;
  /** Assisted: velocity aligns to heading. Drift: throttle is thrust and momentum is kept. */
  assist: boolean;
}

export interface FlightInput {
  /** -1..1 each: pitch up+, yaw left+, roll left+ (right-handed, local axes). */
  pitch: number;
  yaw: number;
  roll: number;
  /** Throttle change per second (-1..1 of full range per second). */
  throttleRate: number;
  /** If set, jump the throttle to this value (full / stop / match). */
  throttleSet?: number | undefined;
}

export const NO_INPUT: FlightInput = { pitch: 0, yaw: 0, roll: 0, throttleRate: 0 };

/** Max ratio of turning while the ship is crippled or immobile is handled by the caller via stats. */
export function stepFlight(s: FlightState, input: FlightInput, stats: FlightStats, dt: number): FlightState {
  if (dt <= 0) return s;

  // Throttle.
  let throttle = s.throttle + clamp(input.throttleRate, -1, 1) * dt;
  if (input.throttleSet !== undefined) throttle = input.throttleSet;
  throttle = clamp(throttle, 0, 1);

  // Angular velocity eases toward the commanded rates (heavy-ship feel).
  const target = {
    x: clamp(input.pitch, -1, 1) * stats.pitchRate,
    y: clamp(input.yaw, -1, 1) * stats.yawRate,
    z: clamp(input.roll, -1, 1) * stats.rollRate,
  };
  const dA = stats.angAccel * dt;
  const angVel = {
    x: approach(s.angVel.x, target.x, dA),
    y: approach(s.angVel.y, target.y, dA),
    z: approach(s.angVel.z, target.z, dA),
  };

  // Integrate orientation with the local-frame angular velocity: q' = q · Δq(local).
  const w = len(angVel);
  let rot = s.rot;
  if (w > 1e-9) {
    rot = qNormalize(qMul(s.rot, qFromAxisAngle(angVel, w * dt)));
  }

  // Linear.
  const fwd = forwardOf(rot);
  let vel: Vec3;
  if (s.assist) {
    // Velocity is steered toward heading × throttle speed, limited by acceleration.
    vel = moveToward(s.vel, scale(fwd, throttle * stats.maxSpeed), stats.accel * dt);
  } else {
    vel = add(s.vel, scale(fwd, throttle * stats.accel * dt));
    if (throttle === 0 && stats.driftDamping > 0) vel = scale(vel, Math.max(0, 1 - stats.driftDamping * dt));
    const sp = len(vel);
    if (sp > stats.maxSpeed) vel = scale(vel, stats.maxSpeed / sp);
  }
  const pos = add(s.pos, scale(add(s.vel, vel), 0.5 * dt));

  return { pos, vel, rot, angVel, throttle, assist: s.assist };
}

/** Speed along the ship's heading (negative when sliding backward in drift). */
export function forwardSpeed(s: FlightState): number {
  return dot(s.vel, forwardOf(s.rot));
}

/** Lateral slip: the part of velocity not along the heading. */
export function slipSpeed(s: FlightState): number {
  const fwd = forwardOf(s.rot);
  return len(sub(s.vel, scale(fwd, dot(s.vel, fwd))));
}

export function initialFlight(pos: Vec3 = { x: 0, y: 0, z: 0 }): FlightState {
  return {
    pos,
    vel: { x: 0, y: 0, z: 0 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { x: 0, y: 0, z: 0 },
    throttle: 0,
    assist: true,
  };
}

/** Throttle value that matches a given speed (for the match-speed key). */
export function throttleForSpeed(speed: number, stats: FlightStats): number {
  return clamp(speed / stats.maxSpeed, 0, 1);
}
