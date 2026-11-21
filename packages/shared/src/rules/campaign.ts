import { Rng, type RngState, seedRng } from '../rng.js';
import { type ContentBundle, SYSTEM_IDS, byId } from '../schemas/content.js';
import {
  CAMPAIGN_VERSION,
  type CampaignAction,
  type CampaignEvent,
  type CampaignState,
  type PendingEncounter,
} from '../schemas/campaign.js';
import type { EncounterResult, InstalledComponent } from '../sim/combat/types.js';
import { RuleError } from './errors.js';
import { laneBetween, parsecsBetween, system } from './graph.js';
import { readiness } from './readiness.js';
import { applyRelationDelta, brokenFlag, hostileActDelta, isActiveThreat } from './relations.js';
import { addItem, holdFree, itemQty, jumpCost, removeItem } from './ship.js';

/**
 * Campaign rules (PLAN §4): pure functions (state, action) → { state, events }. The server is the
 * only caller; it saves the returned state. Randomness comes from the state's own seeded RNG, so a
 * save replays identically.
 */
export interface Step {
  state: CampaignState;
  events: CampaignEvent[];
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function defaultLoadout(c: ContentBundle): InstalledComponent[] {
  const out: InstalledComponent[] = [];
  for (const system of SYSTEM_IDS) {
    (c.player.loadout[system] ?? []).forEach((componentId, slot) => {
      if (componentId) out.push({ system, slot, componentId, condition: 100 });
    });
  }
  return out;
}

export function newGame(c: ContentBundle, seed: string): CampaignState {
  const r = c.rules;
  const relations: Record<string, number> = {};
  for (const race of c.races) relations[race.id] = race.diplomacy.startRelation;
  const start = r.start.systemId;
  let s: CampaignState = {
    version: CAMPAIGN_VERSION,
    seed,
    rng: [...seedRng(`campaign:${seed}`)] as CampaignState['rng'],
    clock: r.clock.startYears,
    systemId: start,
    lastSystemId: start,
    fuel: r.fuel.start,
    hull: 1,
    installed: defaultLoadout(c),
    hold: [],
    droneFrames: c.player.droneBay.frames,
    beacons: r.start.beacons,
    claims: [],
    relations,
    treaties: [],
    flags: [],
    codex: [],
    visits: { [start]: { count: 1, probedOn: null, fights: 0 } },
    known: [],
    conversationMemory: {},
    pendingEncounter: null,
    salvageOffer: [],
    outcome: 'ongoing',
    stats: { jumps: 0, parsecs: 0, fights: 0, destroyed: {}, claimsLost: 0, lifeboats: 0, emergencyFolds: 0 },
    log: [],
  };
  s = { ...s, hold: addItem([], 'data-core', r.start.dataCores, c).hold };
  return log(
    s,
    `The Starwake wakes in ${system(c, start).name}. ${r.clock.startYears} years until the Caravan's life support fails.`,
  );
}

function log(s: CampaignState, text: string): CampaignState {
  return { ...s, log: [...s.log, { clock: round(s.clock), text }].slice(-50) };
}

function useRng<T>(s: CampaignState, f: (rng: Rng) => T): { state: CampaignState; value: T } {
  const rng = new Rng(s.rng as unknown as RngState);
  const value = f(rng);
  return { state: { ...s, rng: [...rng.state] as CampaignState['rng'] }, value };
}

function spendTime(s: CampaignState, years: number, events: CampaignEvent[]): CampaignState {
  const clock = round(s.clock - years);
  let next = { ...s, clock };
  if (clock <= 0 && s.outcome === 'ongoing') {
    next = log(
      { ...next, clock: 0, outcome: 'lost' },
      'The Caravan Clock has run out. The Long Caravan sleeps on, forever.',
    );
    events.push({ t: 'lost' });
  }
  return next;
}

function guard(s: CampaignState, allowPending = false): void {
  if (s.outcome !== 'ongoing') throw new RuleError('GAME_OVER', 'This campaign is over.');
  if (!allowPending && s.pendingEncounter) throw new RuleError('IN_ENCOUNTER', 'Finish the fight first.');
}

function encounterFor(
  s: CampaignState,
  c: ContentBundle,
  defId: string,
  reason: PendingEncounter['reason'],
  raceId: string,
  from: string,
): CampaignState {
  const { state, value } = useRng(s, (rng) => Math.floor(rng.next() * 0xffffffff).toString(36));
  const visits = state.visits[state.systemId] ?? { count: 1, probedOn: null, fights: 0 };
  return {
    ...state,
    pendingEncounter: {
      id: `e${state.stats.fights + 1}-${value}`,
      defId,
      seed: `${state.seed}:${value}`,
      systemId: state.systemId,
      fromSystemId: from,
      reason,
      raceId,
    },
    stats: { ...state.stats, fights: state.stats.fights + 1 },
    visits: { ...state.visits, [state.systemId]: { ...visits, fights: visits.fights + 1 } },
  };
}

// ---- actions --------------------------------------------------------------------------------------
export function applyAction(s: CampaignState, a: CampaignAction, c: ContentBundle): Step {
  switch (a.type) {
    case 'jump':
      return jump(s, a.to, c);
    case 'probe':
      return probe(s, c);
    case 'claim':
      return claim(s, a.planetId, c);
    case 'dock':
      return dock(s, c);
    case 'repair':
      return repair(s, c);
    case 'buy':
      return buy(s, a.componentId, c);
    case 'takeSalvage':
      return takeSalvage(s, a.componentIds, c);
    case 'dropHold':
      return dropHold(s, a.index);
    case 'attackBase':
      return attackBase(s, c);
    case 'signalCaravan':
      return signalCaravan(s, c);
  }
}

export function jump(s0: CampaignState, to: string, c: ContentBundle): Step {
  guard(s0);
  const from = s0.systemId;
  if (to === from) throw new RuleError('SAME_SYSTEM', 'You are already there.');
  const lane = laneBetween(c, from, to);
  if (!lane)
    throw new RuleError('NO_LANE', `No fold lane from ${system(c, from).name} to ${system(c, to).name}.`);
  const cost = jumpCost(parsecsBetween(c, from, to), s0.installed, c);
  if (!cost.inRange)
    throw new RuleError('OUT_OF_RANGE', `${cost.parsecs.toFixed(2)} pc is beyond the Fold Drive's range.`);
  if (cost.fuel > s0.fuel + 1e-9)
    throw new RuleError(
      'NO_FUEL',
      `Needs ${cost.fuel.toFixed(1)} fold mass; you have ${s0.fuel.toFixed(1)}.`,
    );
  const events: CampaignEvent[] = [
    { t: 'jumped', from, to, parsecs: round(cost.parsecs), fuel: round(cost.fuel), years: round(cost.years) },
  ];
  const v = s0.visits[to];
  let s: CampaignState = {
    ...s0,
    systemId: to,
    lastSystemId: from,
    fuel: round(s0.fuel - cost.fuel),
    salvageOffer: [],
    visits: { ...s0.visits, [to]: { count: (v?.count ?? 0) + 1, probedOn: v?.probedOn ?? null, fights: 0 } },
    stats: { ...s0.stats, jumps: s0.stats.jumps + 1, parsecs: round(s0.stats.parsecs + cost.parsecs) },
  };
  s = log(s, `Folded to ${system(c, to).name} (${cost.parsecs.toFixed(2)} pc).`);
  s = spendTime(s, cost.years, events);
  if (s.outcome !== 'ongoing') return { state: s, events };

  // Hostile patrols raid beacons while you're away (R13).
  for (const cl of [...s.claims]) {
    const sys = system(c, cl.systemId);
    const raider = sys.patrols.find((p) => isActiveThreat(s, p.raceId, c));
    if (!raider) continue;
    const r = useRng(s, (rng) => rng.chance(c.rules.beaconRaidChance));
    s = r.state;
    if (r.value) {
      s = {
        ...s,
        claims: s.claims.filter((x) => x !== cl),
        stats: { ...s.stats, claimsLost: s.stats.claimsLost + 1 },
      };
      const planet = sys.planets.find((p) => p.id === cl.planetId)!;
      s = log(s, `${byId(c.races, raider.raceId).name} raiders destroyed your beacon on ${planet.name}.`);
      events.push({ t: 'claimLost', planetId: cl.planetId, raceId: raider.raceId });
    }
  }

  // Ambush on the lane, else a patrol on arrival.
  if (lane.ambush && isActiveThreat(s, lane.ambush.raceId, c)) {
    const r = useRng(s, (rng) => rng.chance(lane.ambush!.chance));
    s = r.state;
    if (r.value) {
      s = encounterFor(s, c, lane.ambush.encounterId, 'ambush', lane.ambush.raceId, from);
      s = log(s, `${byId(c.races, lane.ambush.raceId).name} pulled you out of the fold!`);
      events.push({
        t: 'encounter',
        reason: 'ambush',
        defId: lane.ambush.encounterId,
        raceId: lane.ambush.raceId,
      });
      return { state: s, events };
    }
  }
  for (const p of system(c, to).patrols) {
    if (!isActiveThreat(s, p.raceId, c)) continue;
    const r = useRng(s, (rng) => rng.chance(p.chance));
    s = r.state;
    if (r.value) {
      s = encounterFor(s, c, p.encounterId, 'patrol', p.raceId, from);
      s = log(s, `A ${byId(c.races, p.raceId).name} patrol moves to intercept.`);
      events.push({ t: 'encounter', reason: 'patrol', defId: p.encounterId, raceId: p.raceId });
      break;
    }
  }
  return { state: s, events };
}

export function probe(s0: CampaignState, c: ContentBundle): Step {
  guard(s0);
  const v = s0.visits[s0.systemId] ?? { count: 1, probedOn: null, fights: 0 };
  if (v.probedOn === v.count)
    throw new RuleError('PROBE_USED', 'One surveyor probe per visit: it has already reported.');
  const sys = system(c, s0.systemId);
  let s: CampaignState = {
    ...s0,
    visits: { ...s0.visits, [s0.systemId]: { ...v, probedOn: v.count } },
    known: s0.known.includes(sys.id) ? s0.known : [...s0.known, sys.id],
    codex: [
      ...new Set([
        ...s0.codex,
        `system:${sys.id}`,
        ...sys.planets.map((p) => `planet:${p.id}`),
        ...(sys.occupant ? [`race:${sys.occupant}`] : []),
      ]),
    ],
  };
  s = log(
    s,
    `Probe report from ${sys.name}: ${sys.planets.length} planet${sys.planets.length === 1 ? '' : 's'}${sys.occupant ? `, ${byId(c.races, sys.occupant).name} present` : ''}.`,
  );
  return { state: s, events: [{ t: 'probed', systemId: sys.id }] };
}

export function claim(s0: CampaignState, planetId: string, c: ContentBundle): Step {
  guard(s0);
  const sys = system(c, s0.systemId);
  const planet = sys.planets.find((p) => p.id === planetId);
  if (!planet) throw new RuleError('NOT_HERE', 'That planet is not in this system.');
  if (!s0.known.includes(sys.id)) throw new RuleError('NOT_PROBED', 'Probe the system first (P).');
  if (s0.claims.some((x) => x.planetId === planetId))
    throw new RuleError('ALREADY_CLAIMED', `${planet.name} already carries your beacon.`);
  if (!planet.habitable && planet.resources.length === 0)
    throw new RuleError('NOTHING_TO_CLAIM', `${planet.name} has nothing worth claiming.`);
  if (s0.beacons <= 0) throw new RuleError('NO_BEACONS', 'No claim beacons left. Restock at the Waystation.');
  const events: CampaignEvent[] = [{ t: 'claimed', planetId }];
  let s: CampaignState = {
    ...s0,
    beacons: s0.beacons - 1,
    claims: [...s0.claims, { systemId: sys.id, planetId }],
  };
  s = log(s, `Claim beacon placed on ${planet.name}.`);
  // Claiming in someone else's system without permission is a hostile act (PLAN §1.7).
  if (sys.occupant && !s.flags.includes(`permit:${sys.occupant}`) && !s.treaties.includes(sys.occupant)) {
    const r = applyRelationDelta(
      s,
      sys.occupant,
      hostileActDelta(c, sys.occupant, 'claimWithoutPermission'),
      `claimed ${planet.name} without permission`,
    );
    s = log(r.state, `The ${byId(c.races, sys.occupant).name} saw that. They did not give you permission.`);
    events.push(r.event);
  }
  return { state: s, events };
}

export function dock(s0: CampaignState, c: ContentBundle): Step {
  guard(s0);
  const sys = system(c, s0.systemId);
  if (sys.station !== 'waystation') throw new RuleError('NO_STATION', 'There is no Waystation here.');
  let s: CampaignState = {
    ...s0,
    fuel: c.rules.fuel.capacity,
    hull: 1,
    installed: s0.installed.map((i) => ({ ...i, condition: 100 })),
    hold: s0.hold.map((h) => (h.type === 'component' ? { ...h, condition: 100 } : h)),
    beacons: Math.max(s0.beacons, c.rules.start.beacons),
    droneFrames: Math.max(s0.droneFrames, c.player.droneBay.frames),
  };
  const fab = addItem(s.hold, 'provender', c.rules.waystation.provenderPerDock, c);
  s = { ...s, hold: fab.hold };
  const events: CampaignEvent[] = [{ t: 'docked' }];
  s = log(
    s,
    `Docked at the Waystation: refuelled, repaired, restocked${fab.added ? `; ${fab.added} Provender fabricated` : ''}.`,
  );
  s = spendTime(s, c.rules.clock.refitYears, events);
  return { state: s, events };
}

export function repair(s0: CampaignState, c: ContentBundle): Step {
  guard(s0);
  if (s0.hull >= 1) throw new RuleError('NOTHING_TO_REPAIR', 'The hull is sound.');
  const events: CampaignEvent[] = [{ t: 'repaired' }];
  let s = { ...s0, hull: round(Math.min(1, s0.hull + c.rules.repairInPlaceHull)) };
  s = log(s, `Repair drones patched the hull to ${Math.round(s.hull * 100)}%.`);
  s = spendTime(s, c.rules.clock.repairYears, events);
  return { state: s, events };
}

export function buy(s0: CampaignState, componentId: string, c: ContentBundle): Step {
  guard(s0);
  if (system(c, s0.systemId).station !== 'waystation')
    throw new RuleError('NO_STATION', 'There is no Waystation here.');
  const offer = c.rules.waystation.sells.find((x) => x.componentId === componentId);
  if (!offer) throw new RuleError('NOT_SOLD', 'The Waystation does not make that.');
  if (holdFree(s0, c) < 1) throw new RuleError('HOLD_FULL', 'The hold is full.');
  const hold = removeItem(s0.hold, 'data-core', offer.price);
  if (!hold)
    throw new RuleError(
      'CANT_AFFORD',
      `Needs ${offer.price} Data Core${offer.price === 1 ? '' : 's'}; you have ${itemQty(s0, 'data-core')}.`,
    );
  const comp = byId(c.components, componentId);
  const s = log(
    { ...s0, hold: [...hold, { type: 'component', componentId, condition: 100 }] },
    `Bought ${comp.name} for ${offer.price} Data Core${offer.price === 1 ? '' : 's'}.`,
  );
  return { state: s, events: [{ t: 'bought', componentId }] };
}

export function takeSalvage(s0: CampaignState, ids: string[], c: ContentBundle): Step {
  guard(s0);
  const offer = [...s0.salvageOffer];
  const taken: string[] = [];
  for (const id of ids) {
    const i = offer.indexOf(id);
    if (i < 0) throw new RuleError('NOT_OFFERED', `${id} is not in the salvage.`);
    offer.splice(i, 1);
    taken.push(id);
  }
  if (taken.length > holdFree(s0, c))
    throw new RuleError('HOLD_FULL', `Only ${holdFree(s0, c)} free hold slots.`);
  let s: CampaignState = {
    ...s0,
    salvageOffer: [],
    hold: [
      ...s0.hold,
      ...taken.map((componentId) => ({ type: 'component' as const, componentId, condition: 100 })),
    ],
  };
  if (taken.length) s = log(s, `Salvaged ${taken.map((t) => byId(c.components, t).name).join(', ')}.`);
  return { state: s, events: [{ t: 'salvageTaken', count: taken.length }] };
}

export function dropHold(s0: CampaignState, index: number): Step {
  guard(s0);
  if (index >= s0.hold.length) throw new RuleError('NO_SUCH_SLOT', 'Nothing in that hold slot.');
  return { state: { ...s0, hold: s0.hold.filter((_, i) => i !== index) }, events: [] };
}

export function attackBase(s0: CampaignState, c: ContentBundle): Step {
  guard(s0);
  const sys = system(c, s0.systemId);
  if (!sys.baseEncounter || !sys.occupant) throw new RuleError('NO_BASE', 'There is no base to attack here.');
  if (s0.flags.includes(brokenFlag(sys.occupant)))
    throw new RuleError('ALREADY_BROKEN', 'The base is already a wreck.');
  const events: CampaignEvent[] = [];
  let s = s0;
  // Firing first is a hostile act, recorded by the engine, not the translator (PLAN §1.5).
  const r = applyRelationDelta(
    s,
    sys.occupant,
    hostileActDelta(c, sys.occupant, 'firstStrike'),
    `attacked their base`,
  );
  s = r.state;
  events.push(r.event);
  s = encounterFor(s, c, sys.baseEncounter, 'attack', sys.occupant, s.lastSystemId);
  s = log(
    s,
    `You opened fire on ${byId(c.hulls, byId(c.encounters, sys.baseEncounter).roster.hulls[0]!).name}.`,
  );
  events.push({ t: 'encounter', reason: 'attack', defId: sys.baseEncounter, raceId: sys.occupant });
  return { state: s, events };
}

export function signalCaravan(s0: CampaignState, c: ContentBundle): Step {
  guard(s0);
  const r = readiness(s0, c);
  if (!r.canSignal)
    throw new RuleError('NOT_READY', 'The colony is not ready, or you are not at the Cradle.');
  const s = log(
    { ...s0, outcome: 'won' },
    'You signal the Long Caravan. Far off, thousands of sleepers begin to wake.',
  );
  return { state: s, events: [{ t: 'won' }] };
}

// ---- fights -----------------------------------------------------------------------------------------
/** Apply a verified encounter result to the campaign (PLAN §2.2 step 5). */
export function applyEncounterResult(s0: CampaignState, result: EncounterResult, c: ContentBundle): Step {
  guard(s0, true);
  const pe = s0.pendingEncounter;
  if (!pe) throw new RuleError('NO_ENCOUNTER', 'There is no fight to resolve.');
  if (result.outcome === 'ongoing') throw new RuleError('NOT_OVER', 'The fight is not over.');
  const events: CampaignEvent[] = [];
  let s: CampaignState = { ...s0, pendingEncounter: null };

  // What was destroyed changes relations deterministically (not the LLM).
  const destroyed = { ...s.stats.destroyed };
  for (const d of result.destroyed) {
    const hull = byId(c.hulls, d.hullId);
    destroyed[hull.raceId] = (destroyed[hull.raceId] ?? 0) + 1;
    const r = applyRelationDelta(
      s,
      hull.raceId,
      hostileActDelta(c, hull.raceId, 'destroyShip'),
      `destroyed a ${hull.name}`,
    );
    s = r.state;
    if (r.event.t === 'relation' && r.event.delta !== 0) events.push(r.event);
    if (hull.class === 'base') {
      // R12: broken by force. Patrols stop, the Cradle is safe from them, they stay hostile forever.
      s = { ...s, flags: [...new Set([...s.flags, brokenFlag(hull.raceId)])], fuel: c.rules.fuel.capacity };
      s = log(
        s,
        `${hull.name} is destroyed. The ${byId(c.races, hull.raceId).name} are broken in this cluster. Its fuel stores refill your tanks.`,
      );
    }
  }
  s = { ...s, stats: { ...s.stats, destroyed } };

  if (result.outcome === 'victory') {
    const fights = s.visits[pe.systemId]?.fights ?? 1;
    const keep = Math.ceil(
      result.salvage.length * Math.pow(c.rules.salvage.diminishPerFight, Math.max(0, fights - 1)),
    );
    s = {
      ...s,
      installed: result.installed,
      hull: round(result.hullFraction),
      droneFrames: result.framesLeft,
      salvageOffer: result.salvage.slice(0, keep),
    };
    s = log(s, `The fight is won. Hull at ${Math.round(result.hullFraction * 100)}%.`);
  } else if (result.outcome === 'emergencyFold') {
    s = {
      ...s,
      installed: result.installed,
      hull: Math.max(c.rules.emergencyFoldHull, round(result.hullFraction)),
      droneFrames: result.framesLeft,
      systemId: pe.fromSystemId,
      salvageOffer: [],
      stats: { ...s.stats, emergencyFolds: s.stats.emergencyFolds + 1 },
    };
    s = log(
      s,
      `Emergency fold back to ${system(c, pe.fromSystemId).name}. Lost: ${result.lost.map((l) => byId(c.components, l.componentId).name).join(', ') || 'nothing'}.`,
    );
  } else {
    // Lifeboat: wake at the Waystation with a basic refit; cargo and spare parts are gone.
    const home = c.systems.find((x) => x.station === 'waystation')?.id ?? c.rules.start.systemId;
    s = {
      ...s,
      systemId: home,
      installed: defaultLoadout(c),
      hold: [],
      hull: 1,
      fuel: c.rules.fuel.capacity,
      droneFrames: c.player.droneBay.frames,
      salvageOffer: [],
      stats: { ...s.stats, lifeboats: s.stats.lifeboats + 1 },
    };
    s = log(s, 'The lifeboat brings you home. A basic refit, an empty hold, and a year and a half gone.');
    s = spendTime(s, c.rules.clock.lifeboatYears, events);
  }
  return { state: s, events };
}
