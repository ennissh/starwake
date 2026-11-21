import type { FlightInput, FlightState } from '../flight.js';
import { type Vec3, clamp } from '../math.js';
import { toLocalDir } from './geometry.js';

/**
 * Turn a desired world point into flight input (used by enemy AI, homing drones and the drone
 * autopilot). Returns the input and the angle (radians) between the nose and the point.
 */
export function steerToward(f: FlightState, target: Vec3, throttle: number, gain = 2.5): { input: FlightInput; angle: number } {
  const d = toLocalDir(f.pos, f.rot, target);
  const yawErr = Math.atan2(-d.x, -d.z); // + when the point is to the left (-x)
  const pitchErr = Math.atan2(d.y, Math.hypot(d.x, d.z)); // + when above
  const angle = Math.acos(clamp(-d.z, -1, 1));
  // Damp with current angular velocity so the nose settles instead of oscillating.
  const yaw = clamp(yawErr * gain - f.angVel.y * 0.6, -1, 1);
  const pitch = clamp(pitchErr * gain - f.angVel.x * 0.6, -1, 1);
  const roll = clamp(-f.angVel.z * 0.5, -1, 1);
  return { input: { pitch, yaw, roll, throttleRate: 0, throttleSet: clamp(throttle, 0, 1) }, angle };
}
