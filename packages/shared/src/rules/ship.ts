import type { ContentBundle } from '../schemas/content.js';
import type { CampaignState, HoldEntry } from '../schemas/campaign.js';
import type { InstalledComponent } from '../sim/combat/types.js';
import { systemOutputs } from './systems.js';

/** Jump range in parsecs: a base plus the Nav Cores' output, scaled by condition (PLAN §1.6). */
export function jumpRange(installed: readonly InstalledComponent[], c: ContentBundle): number {
  const comps = new Map(c.components.map((x) => [x.id, x]));
  let nav = 0;
  for (const i of installed) {
    const comp = comps.get(i.componentId);
    if (i.system === 'fold' && comp?.family === 'navcore') nav += comp.output * (i.condition / 100);
  }
  return c.rules.range.baseParsecs + nav * c.rules.range.parsecsPerNavOutput;
}

/** Fuel per parsec: base cost divided by Fold Drive output (an empty slot makes jumps dearer). */
export function fuelPerParsec(installed: readonly InstalledComponent[], c: ContentBundle): number {
  const fold = systemOutputs(installed, c).fold;
  return c.rules.fuel.perParsec / Math.max(c.rules.fuel.minFoldOutput, fold);
}

export function jumpCost(parsecs: number, installed: readonly InstalledComponent[], c: ContentBundle) {
  return {
    parsecs,
    fuel: parsecs * fuelPerParsec(installed, c),
    years: parsecs * c.rules.clock.jumpYearsPerParsec,
    inRange: parsecs <= jumpRange(installed, c) + 1e-9,
  };
}

/** Hold slots used: one per component, ceil(qty / stack) per item stack. */
export function holdUsed(hold: readonly HoldEntry[], c: ContentBundle): number {
  let n = 0;
  for (const h of hold) {
    if (h.type === 'component') n++;
    else n += Math.ceil(h.qty / (c.items.find((i) => i.id === h.itemId)?.stack ?? 1));
  }
  return n;
}

export function holdFree(s: CampaignState, c: ContentBundle): number {
  return c.rules.start.hold - holdUsed(s.hold, c);
}

export function itemQty(s: CampaignState, itemId: string): number {
  return s.hold.reduce((n, h) => n + (h.type === 'item' && h.itemId === itemId ? h.qty : 0), 0);
}

/** Add units of an item, merging into one entry; capped by free hold space. Returns units added. */
export function addItem(
  hold: HoldEntry[],
  itemId: string,
  qty: number,
  c: ContentBundle,
): { hold: HoldEntry[]; added: number } {
  const next = hold.map((h) => ({ ...h }));
  let entry = next.find(
    (h): h is Extract<HoldEntry, { type: 'item' }> => h.type === 'item' && h.itemId === itemId,
  );
  let added = 0;
  for (let i = 0; i < qty; i++) {
    const trial = entry
      ? next.map((h) => (h === entry ? { ...entry, qty: entry.qty + 1 } : h))
      : [...next, { type: 'item' as const, itemId, qty: 1 }];
    if (holdUsed(trial, c) > c.rules.start.hold) break;
    if (entry) entry.qty++;
    else {
      entry = { type: 'item', itemId, qty: 1 };
      next.push(entry);
    }
    added++;
  }
  return { hold: next, added };
}

/** Remove units of an item (all-or-nothing). */
export function removeItem(hold: HoldEntry[], itemId: string, qty: number): HoldEntry[] | null {
  const have = hold.reduce((n, h) => n + (h.type === 'item' && h.itemId === itemId ? h.qty : 0), 0);
  if (have < qty) return null;
  return hold
    .map((h) => (h.type === 'item' && h.itemId === itemId ? { ...h, qty: h.qty - qty } : h))
    .filter((h) => h.type !== 'item' || h.qty > 0);
}
