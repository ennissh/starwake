import { type ContentBundle, type Race, SERVICE_GOODS, byId } from '../schemas/content.js';
import type { CampaignState, GoodQty, HoldEntry, Trade } from '../schemas/campaign.js';
import { RuleError } from './errors.js';
import { applyRelationDelta } from './relations.js';
import { addItem, holdUsed, removeItem } from './ship.js';

/**
 * Trade (M5, PLAN §4 evaluateTrade). Goods are items, components, `fold-mass` and the services
 * `permit` and `passage`. Values are in the race's own terms; the player's side is multiplied by
 * how much the race wants it. A trade is acceptable when what the player gives covers what the race
 * gives, less a tolerance that grows with relation.
 */
export type GoodKind = 'item' | 'component' | 'fuel' | 'service';

export function goodKind(c: ContentBundle, id: string): GoodKind | null {
  if (id === 'fold-mass') return 'fuel';
  if ((SERVICE_GOODS as readonly string[]).includes(id)) return 'service';
  if (c.items.some((i) => i.id === id)) return 'item';
  if (c.components.some((x) => x.id === id)) return 'component';
  return null;
}

export function goodName(c: ContentBundle, id: string, race?: Race): string {
  if (id === 'fold-mass') return 'Fold mass';
  if (id === 'permit') return race ? `${race.name} claim permit` : 'Claim permit';
  if (id === 'passage') return race ? `${race.name} safe passage` : 'Safe passage';
  return c.items.find((i) => i.id === id)?.name ?? c.components.find((x) => x.id === id)?.name ?? id;
}

/** What one unit is worth to this race (before wants). */
export function goodValue(race: Race, id: string, c: ContentBundle): number {
  const v = race.economy.values[id];
  if (v !== undefined) return v;
  const k = goodKind(c, id);
  if (k === 'fuel') return c.rules.diplomacy.foldMassValue;
  if (k === 'item') return byId(c.items, id).baseValue;
  if (k === 'component') return byId(c.components, id).baseValue;
  return 0;
}

export function wantOf(race: Race, id: string, c: ContentBundle): number {
  return (
    race.economy.wants[id] ??
    (goodKind(c, id) === 'component' ? race.economy.wants.component : undefined) ??
    1
  );
}

export function raceStock(s: CampaignState, race: Race, id: string): number {
  return s.raceStock[race.id]?.[id] ?? race.economy.stock[id] ?? 0;
}

/** How many of a good the player can give. Services can't be given by the player. */
export function playerHas(s: CampaignState, id: string, c: ContentBundle): number {
  switch (goodKind(c, id)) {
    case 'fuel':
      return Math.floor(s.fuel);
    case 'item':
      return s.hold.reduce((n, h) => n + (h.type === 'item' && h.itemId === id ? h.qty : 0), 0);
    case 'component':
      return s.hold.filter((h) => h.type === 'component' && h.componentId === id).length;
    default:
      return 0;
  }
}

export type TradeReason =
  'ok' | 'empty' | 'unknown_good' | 'player_lacks' | 'race_lacks' | 'already_have' | 'unbalanced' | 'broken';

export interface TradeEval {
  /** Value of what the player gives, to the race (× wants). */
  give: number;
  /** Value of what the race gives. */
  get: number;
  /** give − get (positive favours the race). */
  balance: number;
  tolerance: number;
  acceptable: boolean;
  reason: TradeReason;
  /** The goods that failed a check. */
  problems: string[];
}

export function tolerance(s: CampaignState, race: Race): number {
  const rel = s.relations[race.id] ?? 0;
  return Math.max(0, Math.min(0.5, race.economy.baseTolerance + rel * race.economy.tolerancePerRelation));
}

const merge = (xs: readonly GoodQty[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x.itemId, (m.get(x.itemId) ?? 0) + x.qty);
  return m;
};

export function evaluateTrade(s: CampaignState, raceId: string, t: Trade, c: ContentBundle): TradeEval {
  const race = byId(c.races, raceId);
  const out = (reason: TradeReason, problems: string[] = [], give = 0, get = 0): TradeEval => ({
    give,
    get,
    balance: give - get,
    tolerance: tolerance(s, race),
    acceptable: false,
    reason,
    problems,
  });
  if (s.flags.includes(`${raceId}_broken`)) return out('broken');
  if (!t.playerGives.length && !t.raceGives.length) return out('empty');
  const pg = merge(t.playerGives);
  const rg = merge(t.raceGives);
  const unknown = [...pg.keys(), ...rg.keys()].filter((id) => !goodKind(c, id));
  if (unknown.length) return out('unknown_good', unknown);
  let give = 0;
  let get = 0;
  for (const [id, q] of pg) give += goodValue(race, id, c) * wantOf(race, id, c) * q;
  for (const [id, q] of rg) get += goodValue(race, id, c) * q;
  const lacks = [...pg].filter(([id, q]) => playerHas(s, id, c) < q).map(([id]) => id);
  if (lacks.length) return out('player_lacks', lacks, give, get);
  const raceLacks = [...rg]
    .filter(([id, q]) => raceStock(s, race, id) < q || (goodKind(c, id) === 'service' && q > 1))
    .map(([id]) => id);
  if (raceLacks.length) return out('race_lacks', raceLacks, give, get);
  const owned = [...rg.keys()].filter(
    (id) => goodKind(c, id) === 'service' && s.flags.includes(`${id}:${raceId}`),
  );
  if (owned.length) return out('already_have', owned, give, get);
  const tol = tolerance(s, race);
  const acceptable = give >= get * (1 - tol) - 1e-9;
  return {
    give,
    get,
    balance: give - get,
    tolerance: tol,
    acceptable,
    reason: acceptable ? 'ok' : 'unbalanced',
    problems: [],
  };
}

/** Move goods from the player (the hold, fuel) into the race's stock. */
function takeFromPlayer(
  s: CampaignState,
  race: Race,
  goods: readonly GoodQty[],
  c: ContentBundle,
): CampaignState {
  let hold: HoldEntry[] = s.hold.map((h) => ({ ...h }));
  let fuel = s.fuel;
  const stock = { ...race.economy.stock, ...(s.raceStock[race.id] ?? {}) };
  for (const { itemId, qty } of goods) {
    const k = goodKind(c, itemId);
    if (k === 'fuel') fuel -= qty;
    else if (k === 'item') {
      const next = removeItem(hold, itemId, qty);
      if (!next) throw new RuleError('PLAYER_LACKS', `You don't have ${qty} ${goodName(c, itemId)}.`);
      hold = next;
    } else if (k === 'component') {
      for (let i = 0; i < qty; i++) {
        // Give away the most worn copy first.
        let worst = -1;
        hold.forEach((h, j) => {
          if (h.type === 'component' && h.componentId === itemId) {
            const w = hold[worst];
            if (worst < 0 || (w?.type === 'component' && h.condition < w.condition)) worst = j;
          }
        });
        if (worst < 0) throw new RuleError('PLAYER_LACKS', `You don't have ${goodName(c, itemId)}.`);
        hold.splice(worst, 1);
      }
    } else throw new RuleError('BAD_GOOD', `You can't give ${itemId}.`);
    stock[itemId] = (stock[itemId] ?? 0) + qty;
  }
  if (fuel < 0) throw new RuleError('PLAYER_LACKS', 'Not enough fold mass.');
  return { ...s, hold, fuel, raceStock: { ...s.raceStock, [race.id]: stock } };
}

/** Move goods from the race's stock to the player. */
function giveToPlayer(
  s: CampaignState,
  race: Race,
  goods: readonly GoodQty[],
  c: ContentBundle,
): CampaignState {
  let hold = s.hold;
  let fuel = s.fuel;
  let flags = s.flags;
  const stock = { ...race.economy.stock, ...(s.raceStock[race.id] ?? {}) };
  for (const { itemId, qty } of goods) {
    if ((stock[itemId] ?? 0) < qty)
      throw new RuleError('RACE_LACKS', `They have no ${goodName(c, itemId, race)} to give.`);
    stock[itemId] = (stock[itemId] ?? 0) - qty;
    const k = goodKind(c, itemId);
    if (k === 'fuel') fuel = Math.min(c.rules.fuel.capacity, fuel + qty);
    else if (k === 'service')
      flags = flags.includes(`${itemId}:${race.id}`) ? flags : [...flags, `${itemId}:${race.id}`];
    else if (k === 'item') {
      const r = addItem(hold, itemId, qty, c);
      if (r.added < qty) throw new RuleError('HOLD_FULL', 'The hold is full.');
      hold = r.hold;
    } else {
      for (let i = 0; i < qty; i++)
        hold = [...hold, { type: 'component', componentId: itemId, condition: 100 }];
      if (holdUsed(hold, c) > c.rules.start.hold) throw new RuleError('HOLD_FULL', 'The hold is full.');
    }
  }
  return { ...s, hold, fuel, flags, raceStock: { ...s.raceStock, [race.id]: stock } };
}

/** Execute a trade the race has agreed to. Throws RuleError if it can't happen. */
export function executeTrade(
  s0: CampaignState,
  raceId: string,
  t: Trade,
  c: ContentBundle,
): { state: CampaignState; relation: number } {
  const race = byId(c.races, raceId);
  const ev = evaluateTrade(s0, raceId, t, c);
  if (ev.reason !== 'ok' && ev.reason !== 'unbalanced')
    throw new RuleError(
      ev.reason.toUpperCase(),
      `The trade can't happen: ${ev.reason.replace('_', ' ')} (${ev.problems.join(', ')}).`,
    );
  let s = takeFromPlayer(s0, race, t.playerGives, c);
  s = giveToPlayer(s, race, t.raceGives, c);
  const r = applyRelationDelta(s, raceId, race.economy.tradeRelation, 'a fair trade');
  return { state: r.state, relation: race.economy.tradeRelation };
}

/**
 * What tribute they'd demand from what the player carries: their most-valued goods first, until
 * the demand reaches the race's tribute value. Null when they don't take tribute or the player
 * can't cover it.
 */
export function tributeDemand(s: CampaignState, raceId: string, c: ContentBundle): GoodQty[] | null {
  const race = byId(c.races, raceId);
  const rule = race.diplomacy.tribute;
  if (!rule) return null;
  const ids = new Set<string>();
  for (const h of s.hold) ids.add(h.type === 'item' ? h.itemId : h.componentId);
  ids.add('fold-mass');
  const unit = (id: string) => goodValue(race, id, c) * wantOf(race, id, c);
  const ranked = [...ids]
    .filter((id) => unit(id) > 0)
    .sort((a, b) => unit(b) - unit(a) || a.localeCompare(b));
  const out: GoodQty[] = [];
  let total = 0;
  for (const id of ranked) {
    // Keep fold mass to get home on: never demand more than half the tank.
    const have = id === 'fold-mass' ? Math.floor(s.fuel / 2) : playerHas(s, id, c);
    let q = 0;
    while (q < have && total < rule.value) {
      q++;
      total += unit(id);
    }
    if (q) out.push({ itemId: id, qty: q });
    if (total >= rule.value) return out;
  }
  return null;
}

/** Value of goods to the race (× wants), e.g. to check a tribute. */
export function tributeValue(raceId: string, goods: readonly GoodQty[], c: ContentBundle): number {
  const race = byId(c.races, raceId);
  return goods.reduce((n, g) => n + goodValue(race, g.itemId, c) * wantOf(race, g.itemId, c) * g.qty, 0);
}

/** For tribute (diplomacy.ts): move goods from the player to the race. */
export { takeFromPlayer as _takeFromPlayer };
