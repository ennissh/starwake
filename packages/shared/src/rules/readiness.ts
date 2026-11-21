import { type ContentBundle, RESOURCE_KINDS, type ResourceKind } from '../schemas/content.js';
import type { CampaignState } from '../schemas/campaign.js';
import { hopsFrom, system } from './graph.js';
import { isActiveThreat } from './relations.js';

/** Colony Readiness (PLAN §1.2): cradle, quotas, safety, clock. */
export interface Readiness {
  cradle: { ok: boolean; systemId: string | null; planetId: string | null };
  quotas: Record<ResourceKind, { have: number; need: number; ok: boolean }>;
  safety: { ok: boolean; threats: string[] };
  clock: { ok: boolean; years: number };
  /** All four met and the Starwake is in the Cradle system: the Caravan can be signalled. */
  canSignal: boolean;
  status: 'won' | 'lost' | 'ongoing';
}

export function readiness(s: CampaignState, c: ContentBundle): Readiness {
  const planets = new Map(c.systems.flatMap((sys) => sys.planets.map((p) => [p.id, { p, sys }] as const)));
  const claimed = s.claims.map((cl) => planets.get(cl.planetId)).filter((x) => x !== undefined);
  const cradle = claimed.find((x) => x.p.habitable);
  const quotas = {} as Readiness['quotas'];
  for (const k of RESOURCE_KINDS) {
    const have = claimed.reduce(
      (n, x) => n + x.p.resources.filter((r) => r.kind === k).reduce((m, r) => m + r.yield, 0),
      0,
    );
    const need = c.rules.readiness.quotas[k] ?? 0;
    quotas[k] = { have, need, ok: have >= need };
  }
  // Safety: every race present (home or patrol) within N lane hops of the Cradle is no threat.
  let threats: string[] = [];
  if (cradle) {
    const hops = hopsFrom(c, cradle.sys.id);
    const present = new Set<string>();
    for (const [sid, h] of hops) {
      if (h > c.rules.readiness.safetyHops) continue;
      const sys = system(c, sid);
      if (sys.occupant) present.add(sys.occupant);
      for (const p of sys.patrols) present.add(p.raceId);
    }
    threats = [...present].filter((r) => isActiveThreat(s, r, c)).sort();
  }
  const r: Readiness = {
    cradle: { ok: !!cradle, systemId: cradle?.sys.id ?? null, planetId: cradle?.p.id ?? null },
    quotas,
    safety: { ok: !!cradle && threats.length === 0, threats },
    clock: { ok: s.clock > 0, years: s.clock },
    canSignal: false,
    status: s.outcome,
  };
  r.canSignal =
    s.outcome === 'ongoing' &&
    r.cradle.ok &&
    Object.values(quotas).every((q) => q.ok) &&
    r.safety.ok &&
    r.clock.ok &&
    s.systemId === r.cradle.systemId;
  return r;
}
