import { describe, expect, it } from 'vitest';
import { DEFAULT_STICK, moveStick, stickAxes, stickFromCursor } from '../src/input/joystick.js';

const o = DEFAULT_STICK;

describe('virtual joystick', () => {
  it('stays put without movement and accumulates movement', () => {
    let s = { x: 0, y: 0 };
    s = moveStick(s, 26, 0, o);
    s = moveStick(s, 26, 0, o);
    expect(s.x).toBeCloseTo(0.2, 6);
    expect(stickAxes(s, o).yaw).toBeLessThan(0);
  });

  it('is clamped to the unit disk', () => {
    const s = moveStick({ x: 0, y: 0 }, 10000, 10000, o);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1, 9);
  });

  it('has a dead zone', () => {
    expect(stickAxes({ x: 0.05, y: -0.05 }, o)).toEqual({ pitch: 0, yaw: -0 });
  });

  it('full deflection gives full axis', () => {
    expect(stickAxes({ x: -1, y: 0 }, o).yaw).toBeCloseTo(1, 9);
    expect(stickAxes({ x: 0, y: 1 }, o).pitch).toBeCloseTo(1, 9);
  });

  it('mouse toward you (down) climbs; invertY flips it', () => {
    expect(stickAxes({ x: 0, y: 0.5 }, o).pitch).toBeGreaterThan(0);
    expect(stickAxes({ x: 0, y: 0.5 }, { ...o, invertY: true }).pitch).toBeLessThan(0);
  });

  it('sensitivity scales travel', () => {
    const slow = moveStick({ x: 0, y: 0 }, 50, 0, { ...o, sensitivity: 0.5 });
    const fast = moveStick({ x: 0, y: 0 }, 50, 0, { ...o, sensitivity: 2 });
    expect(fast.x).toBeCloseTo(slow.x * 4, 9);
  });

  it('absolute cursor mode: centre is neutral, edges are full', () => {
    expect(stickFromCursor(500, 400, 1000, 800, o)).toEqual({ x: 0, y: 0 });
    expect(stickFromCursor(1000, 400, 1000, 800, o).x).toBeCloseTo(1, 6);
  });
});
