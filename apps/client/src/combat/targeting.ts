/** Target selection (T / Shift+T / Y). Pure so it can be tested. */
export interface Targetable {
  id: string;
  distance: number;
}

/** Next (dir 1) or previous (-1) target, ordered nearest first; wraps around. */
export function cycleTarget(list: readonly Targetable[], current: string | null, dir: 1 | -1): string | null {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const i = sorted.findIndex((t) => t.id === current);
  if (i < 0) return dir === 1 ? sorted[0]!.id : sorted[sorted.length - 1]!.id;
  return sorted[(i + dir + sorted.length) % sorted.length]!.id;
}

/** Next live subsystem of the target; after the last one, back to the whole ship (null). */
export function cycleSubsystem(
  subs: readonly { id: string; alive: boolean }[],
  current: string | null,
): string | null {
  const live = subs.filter((s) => s.alive);
  if (!live.length) return null;
  const i = live.findIndex((s) => s.id === current);
  if (i < 0) return live[0]!.id;
  return i + 1 < live.length ? live[i + 1]!.id : null;
}

/** Keep a selection valid as things die or flee. */
export function validTarget(list: readonly Targetable[], current: string | null): string | null {
  return current && list.some((t) => t.id === current) ? current : null;
}
