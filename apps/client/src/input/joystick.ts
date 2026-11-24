/**
 * Virtual joystick (R16): mouse movement moves a cursor inside a unit disk; its offset from the
 * centre sets the turn rate. It stays where you leave it, like a stick, until you move it back.
 */
export interface Stick {
  x: number;
  y: number;
}

export interface StickOptions {
  /** Pixels of mouse travel from centre to full deflection, at sensitivity 1. */
  radiusPx: number;
  /** 0.25..4 multiplier. */
  sensitivity: number;
  invertY: boolean;
  deadZone: number;
}

export const DEFAULT_STICK: StickOptions = { radiusPx: 260, sensitivity: 1, invertY: false, deadZone: 0.06 };

/** Apply a relative mouse movement (pointer-lock movementX/Y). */
export function moveStick(s: Stick, dx: number, dy: number, o: StickOptions): Stick {
  const k = o.sensitivity / o.radiusPx;
  let x = s.x + dx * k;
  let y = s.y + dy * k;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x, y };
}

/** Absolute mode (no pointer lock): the cursor's offset from screen centre is the stick. */
export function stickFromCursor(cx: number, cy: number, w: number, h: number, o: StickOptions): Stick {
  const r = (Math.min(w, h) / 2) * 0.8;
  return moveStick({ x: 0, y: 0 }, cx - w / 2, cy - h / 2, { ...o, radiusPx: r, sensitivity: 1 });
}

/**
 * Stick → flight axes, flight-sim convention like a real stick: pull the mouse toward you (screen
 * down, +y) to climb, push it away to dive. `invertY` flips that. Matches the arrow keys (↓ = climb).
 * Returns pitch (+ up), yaw (+ left), each -1..1, with a dead zone and a gentle response curve.
 */
export function stickAxes(s: Stick, o: StickOptions): { pitch: number; yaw: number } {
  const shape = (v: number): number => {
    const a = Math.abs(v);
    if (a <= o.deadZone) return 0;
    const t = (a - o.deadZone) / (1 - o.deadZone);
    return Math.sign(v) * Math.pow(t, 1.4);
  };
  const pitch = shape(s.y) * (o.invertY ? -1 : 1);
  const yaw = -shape(s.x);
  return { pitch, yaw };
}
