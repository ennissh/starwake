import { type ContentBundle, SYSTEM_IDS, type SystemId, byId } from '../schemas/content.js';
import type { HoldEntry } from '../schemas/campaign.js';
import type { InstalledComponent } from '../sim/combat/types.js';
import { RuleError } from './errors.js';
import { holdUsed } from './ship.js';

/**
 * Engine room moves (M4, PLAN §1.6). A move swaps whatever is at two places: a system slot or a
 * hold position (`hold === hold.length` means "a new hold slot"). The client previews with the same
 * function the server applies, so the preview is exactly what you get.
 */
export type RefitLoc = { system: SystemId; slot: number } | { hold: number };
export interface RefitMove {
  a: RefitLoc;
  b: RefitLoc;
}

interface Loadout {
  installed: InstalledComponent[];
  hold: HoldEntry[];
}

type Thing =
  { kind: 'component'; componentId: string; condition: number } | { kind: 'item'; entry: HoldEntry };

const isSlot = (l: RefitLoc): l is { system: SystemId; slot: number } => 'system' in l;

function at(l: Loadout, loc: RefitLoc, c: ContentBundle): Thing | null {
  if (isSlot(loc)) {
    if (!SYSTEM_IDS.includes(loc.system)) throw new RuleError('BAD_MOVE', 'No such system.');
    const sys = c.player.systems[loc.system];
    if (loc.slot < 0 || loc.slot >= sys.slots)
      throw new RuleError('BAD_MOVE', `${sys.name} has no slot ${loc.slot + 1}.`);
    const i = l.installed.find((x) => x.system === loc.system && x.slot === loc.slot);
    return i ? { kind: 'component', componentId: i.componentId, condition: i.condition } : null;
  }
  if (loc.hold < 0 || loc.hold > l.hold.length) throw new RuleError('BAD_MOVE', 'No such hold slot.');
  const h = l.hold[loc.hold];
  if (!h) return null;
  return h.type === 'component'
    ? { kind: 'component', componentId: h.componentId, condition: h.condition }
    : { kind: 'item', entry: h };
}

function put(l: Loadout, loc: RefitLoc, t: Thing | null, c: ContentBundle): Loadout {
  if (isSlot(loc)) {
    const installed = l.installed.filter((x) => !(x.system === loc.system && x.slot === loc.slot));
    if (!t) return { ...l, installed };
    const sys = c.player.systems[loc.system];
    if (t.kind !== 'component') throw new RuleError('NOT_A_COMPONENT', 'Only components fit in a slot.');
    const comp = byId(c.components, t.componentId);
    if (!sys.accepts.includes(comp.family))
      throw new RuleError('WRONG_FAMILY', `${sys.name} doesn't take a ${comp.name}.`);
    installed.push({
      system: loc.system,
      slot: loc.slot,
      componentId: t.componentId,
      condition: t.condition,
    });
    return { ...l, installed };
  }
  const hold: (HoldEntry | null)[] = [...l.hold];
  const entry: HoldEntry | null = !t
    ? null
    : t.kind === 'component'
      ? { type: 'component', componentId: t.componentId, condition: t.condition }
      : t.entry;
  if (loc.hold === hold.length) {
    if (entry) hold.push(entry);
  } else hold[loc.hold] = entry;
  return { ...l, hold: hold as HoldEntry[] };
}

/** Apply moves in order. Throws a RuleError on the first bad one; checks the hold fits at the end. */
export function applyMoves(start: Loadout, moves: readonly RefitMove[], c: ContentBundle): Loadout {
  let l: Loadout = {
    installed: start.installed.map((x) => ({ ...x })),
    hold: start.hold.map((x) => ({ ...x })),
  };
  for (const m of moves) {
    if (!isSlot(m.a) && !isSlot(m.b)) throw new RuleError('BAD_MOVE', 'Rearranging the hold takes no refit.');
    const ta = at(l, m.a, c);
    const tb = at(l, m.b, c);
    if (!ta && !tb) throw new RuleError('BAD_MOVE', 'Both places are empty.');
    // Write both before compacting the hold, so indexes in this move stay valid.
    l = put(l, m.a, tb, c);
    l = put(l, m.b, ta, c);
    l = { ...l, hold: l.hold.filter((h): h is HoldEntry => h !== null) };
  }
  if (holdUsed(l.hold, c) > c.rules.start.hold) throw new RuleError('HOLD_FULL', 'The hold is full.');
  l.installed.sort((x, y) => SYSTEM_IDS.indexOf(x.system) - SYSTEM_IDS.indexOf(y.system) || x.slot - y.slot);
  return l;
}
