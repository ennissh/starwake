import type { ContentBundle, HostileAct } from '../schemas/content.js';
import type { CampaignEvent, CampaignState } from '../schemas/campaign.js';

export type RelationLabel = 'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied';

export function relationLabel(v: number, c: ContentBundle): RelationLabel {
  const t = c.rules.relations;
  if (v <= t.hostile) return 'hostile';
  if (v <= t.wary) return 'wary';
  if (v < t.friendly) return 'neutral';
  if (v < t.allied) return 'friendly';
  return 'allied';
}

/** Broken by force (R12): no more patrols or ambushes, no threat to the Cradle, hostile forever. */
export const brokenFlag = (raceId: string) => `${raceId}_broken`;

export function isBroken(s: CampaignState, raceId: string): boolean {
  return s.flags.includes(brokenFlag(raceId));
}

/** A race that will still attack and threaten the colony. */
export function isActiveThreat(s: CampaignState, raceId: string, c: ContentBundle): boolean {
  return !isBroken(s, raceId) && relationLabel(s.relations[raceId] ?? 0, c) === 'hostile';
}

/** Apply a relation change, clamped to -100..100. Returns the new state and an event. */
export function applyRelationDelta(
  s: CampaignState,
  raceId: string,
  delta: number,
  reason: string,
): { state: CampaignState; event: CampaignEvent } {
  const cur = s.relations[raceId] ?? 0;
  const next = Math.max(-100, Math.min(100, cur + delta));
  return {
    state: { ...s, relations: { ...s.relations, [raceId]: next } },
    event: { t: 'relation', raceId, delta: next - cur, reason },
  };
}

export function hostileActDelta(c: ContentBundle, raceId: string, act: HostileAct): number {
  const r = c.races.find((x) => x.id === raceId);
  return r?.diplomacy.hostileActs.find((a) => a.act === act)?.delta ?? 0;
}
