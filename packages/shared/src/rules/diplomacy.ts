import { type ContentBundle, type Knowledge, byId } from '../schemas/content.js';
import type { CampaignEvent, CampaignState, Conversation, GoodQty } from '../schemas/campaign.js';
import { RuleError } from './errors.js';
import { system } from './graph.js';
import { applyRelationDelta, isBroken, relationLabel } from './relations.js';
import { _takeFromPlayer, playerHas, tributeDemand, tributeValue } from './trade.js';

/**
 * Diplomacy rules (M5, PLAN §4, §6.4): treaties, passage, knowledge, tribute, conversations.
 * Pure functions; the translator's validator (server) and the scripted responder both call them,
 * so the model can never do more than these allow.
 */
export interface DStep {
  state: CampaignState;
  events: CampaignEvent[];
}

export function canSign(s: CampaignState, raceId: string, c: ContentBundle): { ok: boolean; reason: string } {
  const race = byId(c.races, raceId);
  const d = race.diplomacy;
  const rel = s.relations[raceId] ?? 0;
  if (s.treaties.includes(raceId)) return { ok: false, reason: 'a treaty is already signed' };
  if (isBroken(s, raceId)) return { ok: false, reason: 'you broke them by force; they will never sign' };
  if (rel < d.treatyThreshold)
    return { ok: false, reason: `relation ${rel} is below their threshold ${d.treatyThreshold}` };
  if (d.treatyRequiresAny.length && !d.treatyRequiresAny.some((f) => s.flags.includes(f)))
    return { ok: false, reason: `they need one of: ${d.treatyRequiresAny.join(', ')}` };
  return { ok: true, reason: 'ok' };
}

export function signTreaty(s0: CampaignState, raceId: string, c: ContentBundle): DStep {
  const ok = canSign(s0, raceId, c);
  if (!ok.ok) throw new RuleError('CANT_SIGN', ok.reason);
  const race = byId(c.races, raceId);
  const flags = [...new Set([...s0.flags, `permit:${raceId}`, `passage:${raceId}`])];
  const rel = Math.max(s0.relations[raceId] ?? 0, race.diplomacy.treatyRelationFloor);
  const s: CampaignState = {
    ...s0,
    treaties: [...s0.treaties, raceId],
    flags,
    relations: { ...s0.relations, [raceId]: rel },
    codex: [...new Set([...s0.codex, `treaty:${raceId}`])],
  };
  return { state: s, events: [{ t: 'treaty', raceId }] };
}

export function canGrantPassage(s: CampaignState, raceId: string, c: ContentBundle): boolean {
  const race = byId(c.races, raceId);
  return !isBroken(s, raceId) && (s.relations[raceId] ?? 0) >= race.diplomacy.passageMinRelation;
}

export function grantPassage(s: CampaignState, raceId: string, c: ContentBundle): DStep {
  if (!canGrantPassage(s, raceId, c)) throw new RuleError('NO_PASSAGE', 'They will not let you pass freely.');
  const f = `passage:${raceId}`;
  return {
    state: { ...s, flags: s.flags.includes(f) ? s.flags : [...s.flags, f] },
    events: [{ t: 'passage', raceId }],
  };
}

/** Knowledge this race may share now (relation and flags), not yet shared. */
export function allowedKnowledge(s: CampaignState, raceId: string, c: ContentBundle): Knowledge[] {
  const race = byId(c.races, raceId);
  const rel = s.relations[raceId] ?? 0;
  return race.knowledge.filter(
    (k) =>
      rel >= k.minRelation &&
      k.requiresFlags.every((f) => s.flags.includes(f)) &&
      !s.codex.includes(`knowledge:${k.id}`),
  );
}

export function shareKnowledge(
  s: CampaignState,
  raceId: string,
  knowledgeId: string,
  c: ContentBundle,
): DStep {
  const k = allowedKnowledge(s, raceId, c).find((x) => x.id === knowledgeId);
  if (!k) throw new RuleError('NOT_ALLOWED', 'They may not share that now.');
  const flags = k.grantsFlag && !s.flags.includes(k.grantsFlag) ? [...s.flags, k.grantsFlag] : s.flags;
  return {
    state: { ...s, flags, codex: [...s.codex, `knowledge:${k.id}`] },
    events: [{ t: 'knowledge', raceId, knowledgeId: k.id }],
  };
}

export function canThreaten(s: CampaignState, raceId: string, c: ContentBundle): boolean {
  return (s.relations[raceId] ?? 0) <= byId(c.races, raceId).diplomacy.threatenAtOrBelow;
}

/** They declare hostility: relation drops to hostile (if allowed at the current relation). */
export function declareHostility(s: CampaignState, raceId: string, c: ContentBundle): DStep {
  if (!canThreaten(s, raceId, c)) throw new RuleError('NOT_ALLOWED', 'They are not that angry.');
  const target = c.rules.relations.hostile - 5;
  const rel = s.relations[raceId] ?? 0;
  if (rel <= target) return { state: s, events: [] };
  const r = applyRelationDelta(s, raceId, target - rel, 'declared hostility');
  return { state: r.state, events: [r.event] };
}

/** Pay tribute: the goods must reach their tribute value. Clears a parley fight with them. */
export function payTribute(
  s0: CampaignState,
  raceId: string,
  goods: readonly GoodQty[],
  c: ContentBundle,
): DStep {
  const race = byId(c.races, raceId);
  const rule = race.diplomacy.tribute;
  if (!rule) throw new RuleError('NO_TRIBUTE', `The ${race.name} don't take tribute.`);
  if (isBroken(s0, raceId)) throw new RuleError('NO_TRIBUTE', 'There is no one left to pay.');
  for (const g of goods)
    if (playerHas(s0, g.itemId, c) < g.qty)
      throw new RuleError('PLAYER_LACKS', `You don't have ${g.qty} ${g.itemId}.`);
  if (tributeValue(raceId, goods, c) < rule.value - 1e-9)
    throw new RuleError('TOO_LITTLE', 'That is not enough tribute.');
  let s = _takeFromPlayer(s0, race, goods, c);
  const r = applyRelationDelta(s, raceId, rule.relationGain, 'paid tribute');
  s = {
    ...r.state,
    flags: s.flags.includes(rule.grantsFlag) ? r.state.flags : [...r.state.flags, rule.grantsFlag],
  };
  const events: CampaignEvent[] = [r.event, { t: 'tribute', raceId }];
  const pe = s.pendingEncounter;
  if (pe && pe.raceId === raceId && pe.reason !== 'attack') {
    s = { ...s, pendingEncounter: null };
    events.push({ t: 'fightAvoided', raceId });
  }
  return { state: s, events };
}

/** A treaty or passage with the race that hailed you before a fight: there is no fight. */
export function resolveParley(s: CampaignState, raceId: string): DStep {
  const pe = s.pendingEncounter;
  if (!pe || pe.raceId !== raceId || pe.reason === 'attack') return { state: s, events: [] };
  if (!s.treaties.includes(raceId) && !s.flags.includes(`passage:${raceId}`)) return { state: s, events: [] };
  return { state: { ...s, pendingEncounter: null }, events: [{ t: 'fightAvoided', raceId }] };
}

// ---- conversations ------------------------------------------------------------------------------------
/** Races the player can hail here: the system's occupant, or whoever is pulling them out of a fold. */
export function hailable(s: CampaignState, c: ContentBundle): string[] {
  const out = new Set<string>();
  const pe = s.pendingEncounter;
  if (pe?.parley) out.add(pe.raceId);
  const occ = system(c, s.systemId).occupant;
  if (occ && !pe) out.add(occ);
  return [...out];
}

export function openConversation(s0: CampaignState, raceId: string, c: ContentBundle): DStep {
  if (s0.outcome !== 'ongoing') throw new RuleError('GAME_OVER', 'This campaign is over.');
  if (s0.conversation) {
    if (s0.conversation.raceId === raceId) return { state: s0, events: [] };
    throw new RuleError('IN_CONVERSATION', 'You are already talking to someone.');
  }
  if (!hailable(s0, c).includes(raceId))
    throw new RuleError('NOT_HERE', 'There is no one by that name to hail here.');
  const race = byId(c.races, raceId);
  const context: Conversation['context'] = s0.pendingEncounter?.raceId === raceId ? 'ambush' : 'hail';
  const rel = s0.relations[raceId] ?? 0;
  const demand =
    race.diplomacy.tribute && rel < race.diplomacy.tribute.belowRelation && !isBroken(s0, raceId)
      ? tributeDemand(s0, raceId, c)
      : null;
  const conv: Conversation = {
    raceId,
    context,
    patience: race.diplomacy.patienceTurns,
    turns: 0,
    delta: 0,
    offer: null,
    counter: null,
    demand,
    notes: [],
    transcript: [],
    degraded: false,
  };
  return {
    state: { ...s0, conversation: conv, codex: [...new Set([...s0.codex, `race:${raceId}`])] },
    events: [{ t: 'channelOpened', raceId }],
  };
}

/** Relation change from one exchange, clamped per turn and per conversation (PLAN §6.4). */
export function conversationRelation(
  s: CampaignState,
  wanted: number,
  reason: string,
  c: ContentBundle,
): DStep {
  const conv = s.conversation;
  if (!conv) return { state: s, events: [] };
  const d = c.rules.diplomacy;
  let delta = Math.max(-d.relationPerTurnMax, Math.min(d.relationPerTurnMax, Math.round(wanted)));
  const max = d.relationPerConversationMax;
  delta = Math.max(-max - conv.delta, Math.min(max - conv.delta, delta));
  if (!delta) return { state: s, events: [] };
  const r = applyRelationDelta(s, conv.raceId, delta, reason);
  return {
    state: { ...r.state, conversation: { ...conv, delta: conv.delta + delta } },
    events: [r.event],
  };
}

/** One turn used: patience drops. Returns whether patience ran out. */
export function spendPatience(s: CampaignState): { state: CampaignState; exhausted: boolean } {
  const conv = s.conversation;
  if (!conv) return { state: s, exhausted: false };
  const patience = Math.max(0, conv.patience - 1);
  return {
    state: { ...s, conversation: { ...conv, patience, turns: conv.turns + 1 } },
    exhausted: patience === 0,
  };
}

/** Close the channel; impatience costs relation; the summary goes to memory (PLAN §6.4). */
export function closeConversation(s0: CampaignState, summary: string, c: ContentBundle): DStep {
  const conv = s0.conversation;
  if (!conv) return { state: s0, events: [] };
  const race = byId(c.races, conv.raceId);
  let s = s0;
  const events: CampaignEvent[] = [];
  if (conv.patience === 0) {
    const r = applyRelationDelta(s, conv.raceId, race.diplomacy.impatienceDelta, 'ran out of patience');
    s = r.state;
    events.push(r.event);
  }
  const keep = c.rules.diplomacy.memoryTurns;
  const lines = conv.transcript
    .filter((t) => t.who !== 'system')
    .map((t) => `${t.who === 'player' ? 'Pilot' : race.name}: ${t.text}`);
  const prev = s.conversationMemory[conv.raceId]?.lastTurns ?? [];
  // Leaving a parley without a deal: the fight goes ahead (no second hail).
  const pe = s.pendingEncounter;
  if (pe && pe.raceId === conv.raceId && pe.parley) s = { ...s, pendingEncounter: { ...pe, parley: false } };
  s = {
    ...s,
    conversation: null,
    conversationMemory: {
      ...s.conversationMemory,
      [conv.raceId]: { summary: summary.slice(0, 600), lastTurns: [...prev, ...lines].slice(-keep) },
    },
  };
  events.push({ t: 'channelClosed', raceId: conv.raceId });
  return { state: s, events };
}

/** When a race suspects the player lied: they and those they tell think less of the player. */
export function deceptionSuspected(s0: CampaignState, raceId: string, c: ContentBundle): DStep {
  const race = byId(c.races, raceId);
  let s = s0;
  const events: CampaignEvent[] = [];
  const flag = `liedTo:${raceId}`;
  if (!s.flags.includes(flag)) s = { ...s, flags: [...s.flags, flag] };
  for (const o of race.diplomacy.onDeception) {
    const r = applyRelationDelta(s, o.raceId, o.delta, `heard you lied to the ${race.name}`);
    s = r.state;
    events.push(r.event);
  }
  return { state: s, events };
}

/** Facts for the prompt and the UI: relation label and what is possible right now. */
export function diplomacyFacts(s: CampaignState, raceId: string, c: ContentBundle) {
  const rel = s.relations[raceId] ?? 0;
  return {
    relation: rel,
    label: relationLabel(rel, c),
    treaty: s.treaties.includes(raceId),
    canSign: canSign(s, raceId, c),
    passage: s.flags.includes(`passage:${raceId}`),
    canGrantPassage: canGrantPassage(s, raceId, c),
    canThreaten: canThreaten(s, raceId, c),
    broken: isBroken(s, raceId),
    knowledge: allowedKnowledge(s, raceId, c).map((k) => k.id),
  };
}
