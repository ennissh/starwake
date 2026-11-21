import { type ContentBundle, SYSTEM_IDS, type SystemId } from '../schemas/content.js';
import type { InstalledComponent } from '../sim/combat/types.js';

/**
 * System output (PLAN §1.6): the sum of each slot's component output, scaled by its condition,
 * divided by the system's max. An empty slot outputs 0. Not capped: Mk III parts can exceed 100%
 * only if content makes maxOutput smaller than a full Mk III set.
 */
export function systemOutputs(
  installed: readonly InstalledComponent[],
  c: ContentBundle,
): Record<SystemId, number> {
  const comps = new Map(c.components.map((x) => [x.id, x]));
  const out = {} as Record<SystemId, number>;
  for (const s of SYSTEM_IDS) {
    let sum = 0;
    for (const i of installed) {
      if (i.system !== s) continue;
      const comp = comps.get(i.componentId);
      if (comp) sum += comp.output * (Math.max(0, Math.min(100, i.condition)) / 100);
    }
    out[s] = sum / c.player.systems[s].maxOutput;
  }
  return out;
}
