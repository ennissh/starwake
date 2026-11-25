import { type ContentBundle, RESOURCE_KINDS } from '../schemas/content.js';
import type { CampaignState } from '../schemas/campaign.js';
import { readiness } from './readiness.js';
import { isBroken } from './relations.js';

/**
 * The ending summary (M6, PLAN §1.2): a rating, time left, and the choices that shaped the run.
 * Pure and deterministic, so the same save always gets the same ending.
 */
export type RaceOutcome = 'treaty' | 'tribute' | 'broken' | 'hostile' | 'wary' | 'friendly' | 'unmet';

export interface EndingSummary {
  won: boolean;
  /** Short title, e.g. "Peacemaker". */
  title: string;
  /** 1–5 stars. */
  stars: number;
  /** One-paragraph epilogue built from what happened. */
  epilogue: string[];
  yearsLeft: number;
  races: { raceId: string; name: string; outcome: RaceOutcome; relation: number }[];
  facts: { label: string; value: string }[];
}

function raceOutcome(s: CampaignState, raceId: string, c: ContentBundle): RaceOutcome {
  if (isBroken(s, raceId)) return 'broken';
  if (s.treaties.includes(raceId)) return 'treaty';
  if (s.flags.includes(`tribute:${raceId}`)) return 'tribute';
  const met = s.codex.includes(`race:${raceId}`) || (s.stats.destroyed[raceId] ?? 0) > 0;
  if (!met) return 'unmet';
  const rel = s.relations[raceId] ?? 0;
  if (rel <= c.rules.relations.hostile) return 'hostile';
  if (rel >= c.rules.relations.friendly) return 'friendly';
  return 'wary';
}

export function endingSummary(s: CampaignState, c: ContentBundle): EndingSummary {
  const won = s.outcome === 'won';
  const races = c.races.map((r) => ({
    raceId: r.id,
    name: r.name,
    outcome: raceOutcome(s, r.id, c),
    relation: s.relations[r.id] ?? 0,
  }));
  const killed = Object.values(s.stats.destroyed).reduce((a, b) => a + b, 0);
  const treaties = races.filter((r) => r.outcome === 'treaty').length;
  const broken = races.filter((r) => r.outcome === 'broken').length;
  const start = c.rules.clock.startYears;
  const left = Math.max(0, s.clock);

  let title: string;
  let stars: number;
  if (!won) {
    title = 'The Long Sleep';
    stars = 0;
  } else {
    stars = 2;
    if (left >= start * 0.5) stars++;
    if (s.stats.claimsLost === 0 && s.stats.lifeboats === 0) stars++;
    if (treaties >= 2) stars++;
    stars = Math.min(5, stars);
    title =
      treaties >= 2 && broken === 0
        ? 'Peacemaker'
        : broken > 0 && treaties === 0
          ? 'Conqueror'
          : races.some((r) => r.outcome === 'tribute')
            ? 'Tributary'
            : left >= start * 0.6
              ? 'Swift Pathfinder'
              : 'Pathfinder';
  }

  const r = readiness(s, c);
  const name = (id: string) => c.races.find((x) => x.id === id)?.name ?? id;
  const cradle = r.cradle.planetId
    ? c.systems.flatMap((x) => x.planets).find((p) => p.id === r.cradle.planetId)?.name
    : null;
  const epilogue: string[] = [];
  if (won) {
    epilogue.push(
      `The Long Caravan wakes above ${cradle ?? 'its new world'} with ${left.toFixed(1)} years to spare.`,
    );
  } else {
    epilogue.push(
      'The Caravan Clock ran out. The sleepers dream on, and the Starwake keeps watch over a cluster that never became home.',
    );
  }
  for (const x of races) {
    const n = name(x.raceId);
    const line: Partial<Record<RaceOutcome, string>> = {
      treaty: `The ${n} stand with the colony under a treaty.`,
      tribute: `The ${n} were bought off with tribute; their memory of it is long.`,
      broken: `The ${n} were broken by force, and will hate the colony for generations.`,
      hostile: `The ${n} remain hostile.`,
      friendly: `The ${n} think well of the newcomers.`,
    };
    if (line[x.outcome]) epilogue.push(line[x.outcome]!);
  }
  if (s.flags.some((f) => f.startsWith('liedTo:')))
    epilogue.push('Some still tell stories of the pathfinder who lied.');

  const quotas = RESOURCE_KINDS.map((k) => `${k} ${r.quotas[k].have}/${r.quotas[k].need}`).join(', ');
  const facts = [
    { label: 'Time left', value: `${left.toFixed(2)} of ${start} years` },
    { label: 'Cradle', value: cradle ?? 'none' },
    { label: 'Quotas', value: quotas },
    { label: 'Jumps', value: `${s.stats.jumps} (${s.stats.parsecs.toFixed(1)} pc)` },
    { label: 'Claims', value: `${s.claims.length} held, ${s.stats.claimsLost} lost` },
    { label: 'Fights', value: `${s.stats.fights} (${killed} ships destroyed)` },
    { label: 'Treaties', value: s.treaties.map(name).join(', ') || 'none' },
    { label: 'Emergency folds · lifeboats', value: `${s.stats.emergencyFolds} · ${s.stats.lifeboats}` },
    { label: 'Codex entries', value: String(s.codex.length) },
  ];
  return { won, title, stars, epilogue, yearsLeft: left, races, facts };
}
