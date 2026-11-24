import { describe, expect, it } from 'vitest';
import { angleBetween, jitter, leadPoint, segmentSphere } from '../src/sim/combat/geometry.js';
import { steerToward } from '../src/sim/combat/steer.js';
import { initialFlight } from '../src/sim/flight.js';
import { add, dist, scale } from '../src/sim/math.js';

const v = (x: number, y: number, z: number) => ({ x, y, z });

describe('geometry', () => {
  it('segmentSphere: hit, miss, start inside', () => {
    expect(segmentSphere(v(0, 0, 0), v(0, 0, -100), v(0, 0, -50), 10)).toBeCloseTo(0.4, 6);
    expect(segmentSphere(v(0, 0, 0), v(0, 0, -100), v(30, 0, -50), 10)).toBeNull();
    expect(segmentSphere(v(0, 0, -50), v(0, 0, -100), v(0, 0, -50), 10)).toBe(0);
    expect(segmentSphere(v(0, 0, 0), v(0, 0, -30), v(0, 0, -50), 10)).toBeNull();
  });

  it('leadPoint: a bolt fired at the lead point meets a moving target', () => {
    const shooter = v(0, 0, 0);
    const target = v(1000, 0, -1000);
    const tv = v(-50, 20, 0);
    const speed = 800;
    const aim = leadPoint(shooter, v(0, 0, 0), target, tv, speed);
    const t = dist(shooter, aim) / speed;
    expect(dist(aim, add(target, scale(tv, t)))).toBeLessThan(1e-6);
  });

  it('jitter stays within its cone', () => {
    for (let i = 0; i < 50; i++) {
      const d = jitter(v(0, 0, -1), 2, i / 50, ((i * 7) % 50) / 50);
      expect(angleBetween(d, v(0, 0, -1))).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-9);
    }
  });

  it('steerToward turns toward a point on the left and above', () => {
    const s = steerToward(initialFlight(), v(-100, 50, -100), 1);
    expect(s.input.yaw).toBeGreaterThan(0);
    expect(s.input.pitch).toBeGreaterThan(0);
    expect(steerToward(initialFlight(), v(0, 0, -1000), 1).angle).toBeCloseTo(0, 6);
  });
});
