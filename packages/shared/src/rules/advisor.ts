import type { AdvisorDynamic, AdvisorTopic, ContentBundle } from '../schemas/content.js';
import { RESOURCE_KINDS } from '../schemas/content.js';
import type { CampaignState } from '../schemas/campaign.js';
import { hopsFrom, neighbours, parsecsBetween, system } from './graph.js';
import { readiness } from './readiness.js';
import { isActiveThreat, isBroken, relationLabel } from './relations.js';
import { holdFree, itemQty, jumpCost, jumpRange } from './ship.js';

/**
 * Advisors (playtest batch 1, #3): WAKE and the bridge council answer the player's questions.
 *
 * Scripted and deterministic: a question is matched against the topics in content/advisors.json and
 * answered either with fixed text or with facts read from the campaign state. Only what the player
 * has learned is used (unprobed systems stay "unsurveyed"). When nothing matches well enough the
 * advisor says so and offers questions it can answer: a miss beats a wrong answer.
 *
 * Answers may hold `{key:<action>}` placeholders; the client swaps in the player's own bindings.
 * This is read-only: asking never changes the campaign.
 */
export interface AdvisorAnswer {
  /** The advisor who answers (another council member when the question is theirs). */
  advisorId: string;
  topicId: string | null;
  text: string;
  /** True when the question was handed to another advisor. */
  handoff: boolean;
  suggestions: string[];
}

export const MAX_QUESTION_LENGTH = 300;

/** Lower-case words, apostrophes dropped, everything else a space. */
export function normalizeQuestion(q: string): string {
  return ` ${q
    .slice(0, MAX_QUESTION_LENGTH)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function score(t: AdvisorTopic, norm: string): number {
  const has = (k: string) => norm.includes(` ${normalizeQuestion(k).trim()} `);
  let n = 0;
  for (const k of t.keywords) if (has(k)) n += k.trim().split(/\s+/).length;
  for (const k of t.weak ?? []) if (has(k)) n += 0.5;
  return n;
}

/** Pick the topic for a question; the asked advisor wins ties. Null when nothing scores ≥ 1. */
export function matchTopic(c: ContentBundle, advisorId: string, question: string): AdvisorTopic | null {
  const norm = normalizeQuestion(question);
  let best: AdvisorTopic | null = null;
  let bestScore = 0;
  for (const t of c.advisors.topics) {
    const s = score(t, norm);
    if (s === 0) continue;
    const ranked = s + (t.advisor === advisorId ? 0.25 : 0);
    if (ranked > bestScore) {
      best = t;
      bestScore = ranked;
    }
  }
  return best && score(best, norm) >= 1 ? best : null;
}

export function ask(
  c: ContentBundle,
  state: CampaignState | null,
  advisorId: string,
  question: string,
): AdvisorAnswer {
  const asked = c.advisors.advisors.find((a) => a.id === advisorId) ?? c.advisors.advisors[0]!;
  const topic = matchTopic(c, asked.id, question);
  if (!topic) {
    return {
      advisorId: asked.id,
      topicId: null,
      text: asked.miss,
      handoff: false,
      suggestions: asked.suggestions,
    };
  }
  const who = c.advisors.advisors.find((a) => a.id === topic.advisor)!;
  const text = topic.answer ?? dynamicAnswer(topic.dynamic!, c, state);
  return {
    advisorId: who.id,
    topicId: topic.id,
    text,
    handoff: who.id !== asked.id,
    suggestions: who.suggestions,
  };
}

// ---- answers built from the campaign ------------------------------------------------------------
const NO_CAMPAIGN =
  'That depends on a campaign, and we are not on one. Start or continue a game from the title screen and ask me again.';

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const yrs = (y: number) => `${y.toFixed(2)} years`;

function dynamicAnswer(d: AdvisorDynamic, c: ContentBundle, s: CampaignState | null): string {
  if (!s) return NO_CAMPAIGN;
  if (s.outcome === 'won') return 'The Caravan is on its way. The colony is safe: well flown.';
  if (s.outcome === 'lost') return 'The Caravan Clock ran out. Start a new campaign and we will try again.';
  switch (d) {
    case 'nextSteps':
      return nextSteps(c, s);
    case 'readiness':
      return readinessAnswer(c, s);
    case 'clock':
      return clockAnswer(c, s);
    case 'route':
      return routeAnswer(c, s);
    case 'claims':
      return claimsAnswer(c, s);
    case 'fuel':
      return fuelAnswer(c, s);
    case 'repair':
      return repairAnswer(c, s);
    case 'trade':
      return tradeAnswer(c, s);
    case 'beacons':
      return beaconsAnswer(c, s);
    case 'threats':
      return threatsAnswer(c, s);
  }
}

const waystation = (c: ContentBundle) => c.systems.find((x) => x.station === 'waystation');
const probedHere = (s: CampaignState) => {
  const v = s.visits[s.systemId];
  return !!v && v.probedOn === v.count;
};
const planetsById = (c: ContentBundle) =>
  new Map(c.systems.flatMap((sys) => sys.planets.map((p) => [p.id, { p, sys }] as const)));

/** Known, unclaimed planets that would help: the Cradle if still needed, then short resources. */
function usefulPlanets(c: ContentBundle, s: CampaignState) {
  const r = readiness(s, c);
  const short = RESOURCE_KINDS.filter((k) => !r.quotas[k].ok);
  const claimed = new Set(s.claims.map((x) => x.planetId));
  const out: { name: string; sysName: string; sysId: string; why: string }[] = [];
  for (const sys of c.systems) {
    if (!s.known.includes(sys.id)) continue;
    for (const p of sys.planets) {
      if (claimed.has(p.id)) continue;
      const gives = p.resources.filter((x) => short.includes(x.kind)).map((x) => `${x.kind} ${x.yield}`);
      if (p.habitable && !r.cradle.ok)
        out.push({ name: p.name, sysName: sys.name, sysId: sys.id, why: 'habitable: a Cradle' });
      else if (gives.length)
        out.push({ name: p.name, sysName: sys.name, sysId: sys.id, why: gives.join(', ') });
    }
  }
  return { r, short, out };
}

function nextSteps(c: ContentBundle, s: CampaignState): string {
  const here = system(c, s.systemId);
  const ws = waystation(c);
  if (s.pendingEncounter)
    return 'Deal with the fight first: win it, or hold {key:emergencyFold} to fold out.';
  if (s.salvageOffer.length) return 'There is salvage waiting: take what you want aboard, then carry on.';
  const { r, short, out } = usefulPlanets(c, s);
  if (r.canSignal)
    return 'Everything is ready and we are at the Cradle. Open the system report ({key:systemReport}) and signal the Caravan.';
  if (s.hull < 0.5 && ws)
    return `Hull is at ${Math.round(s.hull * 100)}%. Fold back to ${ws.name} and dock at the Waystation to repair before the next fight.`;
  if (!probedHere(s) && here.planets.length)
    return `Probe ${here.name} first ({key:probe}): the report shows what its planets yield, and you can only claim in a probed system.`;
  const hereUseful = out.filter((x) => x.sysId === here.id);
  if (hereUseful.length && s.beacons > 0)
    return `Claim ${list(hereUseful.map((x) => `${x.name} (${x.why})`))} here: open the system report ({key:systemReport}) and place a beacon.`;
  if (s.beacons === 0 && ws)
    return `We are out of claim beacons. Dock at ${ws.name}'s Waystation to restock.`;
  if (r.cradle.ok && !short.length && !r.safety.ok)
    return `The Cradle and the quotas are done. What's left is safety: ${list(r.safety.threats.map((t) => c.races.find((x) => x.id === t)?.name ?? t))} still threaten the Cradle. Ask Tactical about threats.`;
  if (r.cradle.ok && !short.length && r.safety.ok) {
    const cradleSys = system(c, r.cradle.systemId!);
    return `The colony is ready. Fold to ${cradleSys.name} and signal the Caravan from the system report.`;
  }
  if (out.length) {
    const best = out[0]!;
    return `Fold to ${best.sysName} and claim ${best.name} (${best.why}). Still needed: ${needsText(r, short)}.`;
  }
  const unknown = c.systems.filter((x) => !s.known.includes(x.id)).map((x) => x.name);
  if (unknown.length)
    return `Explore: ${list(unknown)} ${unknown.length === 1 ? 'is' : 'are'} not surveyed yet. Open the star map ({key:starMap}), fold there and probe. Still needed: ${needsText(r, short)}.`;
  return `Still needed: ${needsText(r, short)}. Check the colony panel ({key:colony}).`;
}

function needsText(r: ReturnType<typeof readiness>, short: string[]): string {
  const parts: string[] = [];
  if (!r.cradle.ok) parts.push('a habitable Cradle world');
  for (const k of short)
    parts.push(
      `${k} ${r.quotas[k as keyof typeof r.quotas].have}/${r.quotas[k as keyof typeof r.quotas].need}`,
    );
  return parts.length ? list(parts) : 'nothing but safety around the Cradle';
}

function readinessAnswer(c: ContentBundle, s: CampaignState): string {
  const r = readiness(s, c);
  const q = RESOURCE_KINDS.map(
    (k) => `${k} ${r.quotas[k].have}/${r.quotas[k].need}${r.quotas[k].ok ? ' ✓' : ''}`,
  );
  const cradle = r.cradle.ok
    ? `Cradle: ${planetsById(c).get(r.cradle.planetId!)?.p.name} ✓`
    : 'Cradle: not yet (claim one habitable world)';
  const safety = !r.cradle.ok
    ? 'Safety: judged once there is a Cradle'
    : r.safety.ok
      ? 'Safety ✓'
      : `Safety: threatened by ${list(r.safety.threats.map((t) => c.races.find((x) => x.id === t)?.name ?? t))}`;
  return `To win, four things, then signal the Caravan from the Cradle system. ${cradle}. Quotas: ${q.join(', ')}. ${safety}. Clock: ${yrs(s.clock)} left. The colony panel ({key:colony}) shows the same.`;
}

function clockAnswer(c: ContentBundle, s: CampaignState): string {
  return `${yrs(s.clock)} left on the Caravan Clock. Each parsec folded costs ${c.rules.clock.jumpYearsPerParsec} years and a Waystation refit ${c.rules.clock.refitYears}. Fights cost no time.`;
}

function routeAnswer(c: ContentBundle, s: CampaignState): string {
  const range = jumpRange(s.installed, c);
  const lines = neighbours(c, s.systemId).map((id) => {
    const sys = system(c, id);
    const cost = jumpCost(parsecsBetween(c, s.systemId, id), s.installed, c);
    const status = !cost.inRange ? 'out of range' : cost.fuel > s.fuel ? 'not enough fold mass' : 'reachable';
    return `${sys.name} ${cost.parsecs.toFixed(1)} pc (${status}, ${cost.fuel.toFixed(0)} mass, ${yrs(cost.years)}${s.known.includes(id) ? '' : ', unsurveyed'})`;
  });
  const { out } = usefulPlanets(c, s);
  const hops = hopsFrom(c, s.systemId);
  const target = [...out].sort((a, b) => (hops.get(a.sysId) ?? 99) - (hops.get(b.sysId) ?? 99))[0];
  const tip = target ? ` Worth going: ${target.sysName}, for ${target.name} (${target.why}).` : '';
  return `From ${system(c, s.systemId).name} (range ${range.toFixed(1)} pc, ${s.fuel.toFixed(0)} fold mass): ${list(lines)}.${tip} Open the star map with {key:starMap}, pick a system and fold with {key:jump}.`;
}

function claimsAnswer(c: ContentBundle, s: CampaignState): string {
  const { short, out } = usefulPlanets(c, s);
  const mine = s.claims.map((x) => planetsById(c).get(x.planetId)?.p.name ?? x.planetId);
  const have = mine.length ? `Our beacons stand on ${list(mine)}. ` : '';
  const beacons = `${s.beacons} beacon${s.beacons === 1 ? '' : 's'} aboard. `;
  if (!out.length) {
    const unknown = c.systems.filter((x) => !s.known.includes(x.id)).length;
    return `${have}${beacons}No surveyed world we still need${unknown ? `; ${unknown} system${unknown === 1 ? ' is' : 's are'} unsurveyed, so probe ({key:probe}) as you go` : ''}.${short.length ? ` Short on ${list(short)}.` : ''}`;
  }
  return `${have}${beacons}Worth claiming: ${list(out.map((x) => `${x.name} in ${x.sysName} (${x.why})`))}. Claim from the system report ({key:systemReport}) once the system is probed. Claiming in an occupied system without permission angers its owners, and hostile patrols can destroy beacons.`;
}

function fuelAnswer(c: ContentBundle, s: CampaignState): string {
  const ws = waystation(c);
  const per = jumpCost(1, s.installed, c).fuel;
  return `Fold mass ${s.fuel.toFixed(0)}/${c.rules.fuel.capacity}; this drive burns about ${per.toFixed(1)} per parsec. ${ws ? `Docking at ${ws.name}'s Waystation refills it (and costs ${c.rules.clock.refitYears} years).` : ''} Never fold somewhere you can't fold back from.`;
}

function repairAnswer(c: ContentBundle, s: CampaignState): string {
  const ws = waystation(c);
  const worn = s.installed.filter((i) => i.condition < 60).length;
  return `Hull ${Math.round(s.hull * 100)}%${worn ? `, ${worn} component${worn === 1 ? '' : 's'} badly worn` : ''}. ${ws ? `A Waystation refit at ${ws.name} restores hull and components, refuels and restocks beacons and drone frames for ${c.rules.clock.refitYears} years.` : ''} Repair drones patch ${Math.round(c.rules.repairInPlaceHull * 100)}% of hull anywhere for ${c.rules.clock.repairYears} years (system report).`;
}

function tradeAnswer(c: ContentBundle, s: CampaignState): string {
  const ws = waystation(c);
  const cores = itemQty(s, 'data-core');
  const prov = itemQty(s, 'provender');
  const sells = c.rules.waystation.sells
    .map((x) => `${c.components.find((k) => k.id === x.componentId)?.name ?? x.componentId} (${x.price})`)
    .slice(0, 4);
  return `Data Cores are our currency: we hold ${cores}. ${ws ? `The Waystation at ${ws.name} sells components for cores, e.g. ${list(sells)}, and fabricates ${c.rules.waystation.provenderPerDock} Provender each time we dock (we hold ${prov}): cheap, but everyone eats.` : ''} Salvage from fights is free cargo. Hold space free: ${holdFree(s, c)}.`;
}

function beaconsAnswer(c: ContentBundle, s: CampaignState): string {
  const ws = waystation(c);
  return `${s.beacons} claim beacon${s.beacons === 1 ? '' : 's'} aboard. ${ws ? `Docking at ${ws.name}'s Waystation restocks to ${c.rules.start.beacons}.` : ''} A beacon destroyed by raiders is gone, and so is the claim.`;
}

function threatsAnswer(c: ContentBundle, s: CampaignState): string {
  const lines = c.races.map((race) => {
    const v = s.relations[race.id] ?? 0;
    const broken = isBroken(s, race.id) ? ', base broken: hostile for good, but no longer a threat' : '';
    const threat = isActiveThreat(s, race.id, c) ? ' (a threat)' : '';
    return `${race.name}: ${relationLabel(v, c)} (${v})${threat}${broken}`;
  });
  const here = system(c, s.systemId);
  const patrol = here.patrols.filter((p) => isActiveThreat(s, p.raceId, c));
  const warn = patrol.length
    ? ` ${list(patrol.map((p) => c.races.find((r) => r.id === p.raceId)?.name ?? p.raceId))} patrol ${here.name}: expect company.`
    : '';
  return `${lines.join('. ')}.${warn} Threats near the Cradle block the win: make peace when the translator comes online, or break their base.`;
}
