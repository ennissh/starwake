import { describe, expect, it } from 'vitest';
import {
  type FlightInput,
  type FlightState,
  type FlightStats,
  NO_INPUT,
  forwardSpeed,
  initialFlight,
  slipSpeed,
  stepFlight,
  throttleForSpeed,
} from '../src/sim/flight.js';
import { forwardOf, len } from '../src/sim/math.js';

const stats: FlightStats = {
  maxSpeed: 60,
  accel: 10,
  pitchRate: 0.3,
  yawRate: 0.3,
  rollRate: 0.5,
  angAccel: 0.3,
  driftDamping: 0,
};

function run(s: FlightState, input: FlightInput, seconds: number, dt = 1 / 60): FlightState {
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepFlight(s, input, stats, dt);
  return s;
}

describe('flight', () => {
  it('is pure and deterministic', () => {
    const a = run(initialFlight(), { ...NO_INPUT, throttleSet: 1, yaw: 0.5 }, 3);
    const b = run(initialFlight(), { ...NO_INPUT, throttleSet: 1, yaw: 0.5 }, 3);
    expect(a).toEqual(b);
  });

  it('assisted: accelerates to throttle × maxSpeed and no faster', () => {
    const s = run(initialFlight(), { ...NO_INPUT, throttleSet: 0.5 }, 10);
    expect(forwardSpeed(s)).toBeCloseTo(30, 5);
    const full = run(s, { ...NO_INPUT, throttleSet: 1 }, 20);
    expect(len(full.vel)).toBeCloseTo(60, 5);
  });

  it('assisted: acceleration is limited by accel', () => {
    const s = run(initialFlight(), { ...NO_INPUT, throttleSet: 1 }, 1);
    expect(len(s.vel)).toBeCloseTo(10, 3);
  });

  it('forward is -Z at identity', () => {
    const s = run(initialFlight(), { ...NO_INPUT, throttleSet: 1 }, 2);
    expect(s.pos.z).toBeLessThan(0);
    expect(Math.abs(s.pos.x)).toBeLessThan(1e-9);
  });

  it('turn rate ramps up at angAccel and caps at the max rate', () => {
    const s1 = run(initialFlight(), { ...NO_INPUT, yaw: 1 }, 0.5);
    expect(s1.angVel.y).toBeCloseTo(0.15, 3);
    const s2 = run(s1, { ...NO_INPUT, yaw: 1 }, 3);
    expect(s2.angVel.y).toBeCloseTo(0.3, 6);
    const s3 = run(s2, NO_INPUT, 2);
    expect(s3.angVel.y).toBeCloseTo(0, 6);
  });

  it('yaw left (+) turns the nose toward -X', () => {
    const s = run(initialFlight(), { ...NO_INPUT, yaw: 1 }, 2);
    expect(forwardOf(s.rot).x).toBeLessThan(0);
  });

  it('pitch up (+) turns the nose toward +Y', () => {
    const s = run(initialFlight(), { ...NO_INPUT, pitch: 1 }, 2);
    expect(forwardOf(s.rot).y).toBeGreaterThan(0);
  });

  it('keeps the rotation a unit quaternion over long runs', () => {
    const s = run(initialFlight(), { pitch: 0.7, yaw: -0.4, roll: 1, throttleRate: 0 }, 120);
    expect(Math.hypot(s.rot.x, s.rot.y, s.rot.z, s.rot.w)).toBeCloseTo(1, 9);
  });

  it('drift: momentum is kept while turning (slip), assist removes it', () => {
    let s = run(initialFlight(), { ...NO_INPUT, throttleSet: 1 }, 8);
    s = { ...s, assist: false };
    const drifted = run(s, { ...NO_INPUT, throttleSet: 0, yaw: 1 }, 4);
    expect(slipSpeed(drifted)).toBeGreaterThan(10);
    expect(len(drifted.vel)).toBeCloseTo(len(s.vel), 6);
    const assisted = run({ ...drifted, assist: true }, { ...NO_INPUT, throttleSet: 0.5 }, 12);
    expect(slipSpeed(assisted)).toBeLessThan(1e-6);
  });

  it('drift: thrust never exceeds maxSpeed', () => {
    const s = run({ ...initialFlight(), assist: false }, { ...NO_INPUT, throttleSet: 1 }, 30);
    expect(len(s.vel)).toBeLessThanOrEqual(60 + 1e-9);
  });

  it('throttle rate and clamping', () => {
    const s = run(initialFlight(), { ...NO_INPUT, throttleRate: 1 }, 0.5);
    expect(s.throttle).toBeCloseTo(0.5, 6);
    const s2 = run(s, { ...NO_INPUT, throttleRate: 1 }, 3);
    expect(s2.throttle).toBe(1);
    const s3 = run(s2, { ...NO_INPUT, throttleRate: -1 }, 5);
    expect(s3.throttle).toBe(0);
  });

  it('throttleForSpeed clamps', () => {
    expect(throttleForSpeed(30, stats)).toBe(0.5);
    expect(throttleForSpeed(600, stats)).toBe(1);
    expect(throttleForSpeed(-3, stats)).toBe(0);
  });

  it('dt <= 0 is a no-op', () => {
    const s = initialFlight();
    expect(stepFlight(s, NO_INPUT, stats, 0)).toBe(s);
  });
});
