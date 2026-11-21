import { type Quat, type Vec3, add, dot, len, normalize, qConj, qRotate, scale, sub } from '../math.js';

/**
 * First intersection of segment p0→p1 with a sphere, as a fraction t in [0, 1] along the segment,
 * or null. A segment starting inside the sphere hits at t = 0.
 */
export function segmentSphere(p0: Vec3, p1: Vec3, c: Vec3, r: number): number | null {
  const d = sub(p1, p0);
  const f = sub(p0, c);
  const a = dot(d, d);
  const cc = dot(f, f) - r * r;
  if (cc <= 0) return 0;
  if (a < 1e-12) return null;
  const b = 2 * dot(f, d);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Where to aim so a projectile of `speed` meets a target moving at constant velocity.
 * Falls back to the target's current position when no solution exists.
 */
export function leadPoint(shooter: Vec3, shooterVel: Vec3, target: Vec3, targetVel: Vec3, speed: number): Vec3 {
  const rp = sub(target, shooter);
  const rv = sub(targetVel, shooterVel);
  const a = dot(rv, rv) - speed * speed;
  const b = 2 * dot(rp, rv);
  const c = dot(rp, rp);
  let t: number;
  if (Math.abs(a) < 1e-9) t = b !== 0 ? -c / b : 0;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return target;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0) || t > 30) return target;
  return add(target, scale(rv, t));
}

/** Angle in radians between two vectors. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-12 || lb < 1e-12) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
}

/** World position of a ship-local offset. */
export function toWorld(pos: Vec3, rot: Quat, offset: Vec3): Vec3 {
  return add(pos, qRotate(rot, offset));
}

/** Ship-local direction of a world point. */
export function toLocalDir(pos: Vec3, rot: Quat, world: Vec3): Vec3 {
  return normalize(qRotate(qConj(rot), sub(world, pos)));
}

/** Rotate `dir` by a small random cone of half-angle `deg` using two uniform numbers in [0,1). */
export function jitter(dir: Vec3, deg: number, u1: number, u2: number): Vec3 {
  if (deg <= 0) return normalize(dir);
  const n = normalize(dir);
  // Any perpendicular basis.
  const ref = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const p1 = normalize({ x: n.y * ref.z - n.z * ref.y, y: n.z * ref.x - n.x * ref.z, z: n.x * ref.y - n.y * ref.x });
  const p2 = { x: n.y * p1.z - n.z * p1.y, y: n.z * p1.x - n.x * p1.z, z: n.x * p1.y - n.y * p1.x };
  const ang = ((deg * Math.PI) / 180) * Math.sqrt(u1);
  const phi = u2 * Math.PI * 2;
  const off = Math.tan(ang);
  return normalize(add(n, add(scale(p1, Math.cos(phi) * off), scale(p2, Math.sin(phi) * off))));
}
