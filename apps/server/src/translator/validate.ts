import {
  type AlienTurn,
  type CampaignEvent,
  type CampaignState,
  type ContentBundle,
  type GoodQty,
  type PlayerMove,
  type Trade,
  Rng,
  RuleError,
  allowedKnowledge,
  byId,
  canGrantPassage,
  canSign,
  canThreaten,
  conversationRelation,
  declareHostility,
  deceptionSuspected,
  evaluateTrade,
  executeTrade,
  goodKind,
  grantPassage,
  payTribute,
  playerHas,
  raceStock,
  resolveParley,
  shareKnowledge,
  signTreaty,
  tributeDemand,
  tributeValue,
} from '@starwake/shared';

/**
 * The translator's gate (PLAN §6.4, CLAUDE.md rule 1). The ONLY place where a model's AlienTurn
 * becomes a campaign change, and only through the shared rule reducers. Whatever the model says,
 * the engine checks the intent and applies, alters or rejects it; rejections are noted for the
 * model's next turn. The player only ever sees what was applied.
 */
export interface Shown {
  say: string;
  mood: AlienTurn['mood'];
  /** The race's tell shows (they lied, and the translator caught it). */
  tell: boolean;
  /** share_knowledge that the engine refused: the words stand, unverified, no codex entry. */
  unverified: boolean;
}

export interface Applied {
  state: CampaignState;
  events: CampaignEvent[];
  shown: Shown;
  /** The intent as applied ("accept_trade", or "accept_trade→reject_trade (imbalance 12)"). */
  applied: string;
  /** Told to the model next turn. */
  notes: string[];
  /** The conversation should end after this turn. */
  end: boolean;
}

const sysLine = (s: CampaignState, text: string): CampaignState =>
  s.conversation
    ? {
        ...s,
        conversation: {
          ...s.conversation,
          transcript: [...s.conversation.transcript, { who: 'system' as const, text }].slice(-40),
        },
      }
    : s;

/** Engine effects of the player's own move, before the model speaks. */
export function applyPlayerMove(
  s0: CampaignState,
  move: PlayerMove,
  c: ContentBundle,
): { state: CampaignState; events: CampaignEvent[]; notes: string[] } {
  const conv = s0.conversation;
  if (!conv) throw new RuleError('NO_CONVERSATION', 'No channel is open.');
  const raceId = conv.raceId;
  let s = s0;
  const events: CampaignEvent[] = [];
  const notes: string[] = [];
  const said: Record<Exclude<PlayerMove['type'], 'say'>, string> = {
    offer: '(puts an offer on the table)',
    acceptCounter: '(accepts your counter-offer)',
    askTreaty: 'I propose a treaty between our peoples.',
    askPassage: 'Will you grant us safe passage through your space?',
    askKnowledge: 'What do you know about this cluster?',
    about: 'Tell me about yourselves.',
    payTribute: '(pays the tribute)',
    leave: '(leaves)',
  };
  const text = move.type === 'say' ? move.text : said[move.type];
  s = {
    ...s,
    conversation: { ...conv, transcript: [...conv.transcript, { who: 'player' as const, text }].slice(-40) },
  };

  switch (move.type) {
    case 'offer': {
      const ev = evaluateTrade(s, raceId, move.trade, c);
      if (ev.reason !== 'ok' && ev.reason !== 'unbalanced')
        throw new RuleError(
          'BAD_OFFER',
          `That offer can't stand: ${ev.reason.replace('_', ' ')} (${ev.problems.join(', ')}).`,
        );
      s = { ...s, conversation: { ...s.conversation!, offer: move.trade, counter: null } };
      break;
    }
    case 'acceptCounter': {
      const counter = s.conversation!.counter;
      if (!counter) throw new RuleError('NO_COUNTER', 'There is no counter-offer to accept.');
      const r = executeTrade(s, raceId, counter, c);
      s = { ...r.state, conversation: { ...r.state.conversation!, offer: null, counter: null } };
      s = sysLine(s, 'Trade complete.');
      events.push({ t: 'traded', raceId });
      notes.push('The player accepted your counter-offer and the trade went through.');
      break;
    }
    case 'payTribute': {
      const demand = s.conversation!.demand;
      if (!demand) throw new RuleError('NO_DEMAND', 'They have not demanded tribute.');
      const r = payTribute(s, raceId, demand, c);
      s = { ...r.state, conversation: { ...r.state.conversation!, demand: null } };
      s = sysLine(s, 'Tribute paid.');
      events.push(...r.events);
      notes.push('The player paid your tribute in full.');
      break;
    }
    default:
      break;
  }
  return { state: s, events, notes };
}

/** Keep only trade lines that exist, that the player has and that the race stocks. */
function cleanTrade(s: CampaignState, raceId: string, t: Trade | undefined, c: ContentBundle): Trade | null {
  if (!t) return null;
  const race = byId(c.races, raceId);
  const ok = (g: GoodQty, side: 'p' | 'r') =>
    Number.isInteger(g.qty) &&
    g.qty > 0 &&
    goodKind(c, g.itemId) !== null &&
    (side === 'p' ? playerHas(s, g.itemId, c) >= g.qty : raceStock(s, race, g.itemId) >= g.qty);
  const out = {
    playerGives: t.playerGives.filter((g) => ok(g, 'p')),
    raceGives: t.raceGives.filter((g) => ok(g, 'r')),
  };
  return out.playerGives.length || out.raceGives.length ? out : null;
}

export function applyAlienTurn(
  s0: CampaignState,
  turn: AlienTurn,
  c: ContentBundle,
  opts: { playerSpoke: boolean },
): Applied {
  const conv = s0.conversation;
  if (!conv) throw new RuleError('NO_CONVERSATION', 'No channel is open.');
  const raceId = conv.raceId;
  const race = byId(c.races, raceId);
  let s = s0;
  const events: CampaignEvent[] = [];
  const notes: string[] = [];
  let unverified = false;
  let end = false;
  const intent = turn.intent;
  let applied: string = intent.type;
  const downgrade = (to: string, why: string) => {
    applied = `${intent.type}→${to} (${why})`;
    notes.push(`Your ${intent.type} did not happen: ${why}.`);
  };
  const run = (f: () => { state: CampaignState; events: CampaignEvent[] }) => {
    const r = f();
    s = r.state;
    events.push(...r.events);
  };

  switch (intent.type) {
    case 'none':
    case 'propose_treaty':
    case 'reject_treaty':
      break;
    case 'offer_trade':
    case 'counter_trade': {
      const t = cleanTrade(s, raceId, intent.trade, c);
      if (!t) {
        downgrade('none', 'no valid goods in it (use exact ids, only what you stock and the player holds)');
        break;
      }
      s = { ...s, conversation: { ...s.conversation!, counter: t } };
      const ev = evaluateTrade(s, raceId, t, c);
      s = sysLine(s, `Counter-offer: balance ${ev.balance >= 0 ? '+' : ''}${ev.balance.toFixed(0)}.`);
      break;
    }
    case 'accept_trade': {
      const offer = s.conversation!.offer;
      if (!offer) {
        downgrade('none', 'there is no offer from the player to accept');
        break;
      }
      const ev = evaluateTrade(s, raceId, offer, c);
      if (!ev.acceptable) {
        downgrade('reject_trade', `imbalance ${(ev.get - ev.give).toFixed(0)} against you (${ev.reason})`);
        s = { ...s, conversation: { ...s.conversation!, offer: null } };
        s = sysLine(s, 'They meant to accept, but the scales say no: the trade did not happen.');
        break;
      }
      try {
        run(() => {
          const r = executeTrade(s, raceId, offer, c);
          return { state: r.state, events: [{ t: 'traded', raceId }] };
        });
        s = { ...s, conversation: { ...s.conversation!, offer: null, counter: null } };
        s = sysLine(s, 'Trade complete.');
      } catch (err) {
        downgrade('reject_trade', (err as Error).message);
      }
      break;
    }
    case 'reject_trade':
      s = { ...s, conversation: { ...s.conversation!, offer: null } };
      break;
    case 'accept_treaty': {
      const ok = canSign(s, raceId, c);
      if (!ok.ok) {
        downgrade('reject_treaty', ok.reason);
        break;
      }
      run(() => signTreaty(s, raceId, c));
      run(() => resolveParley(s, raceId));
      s = sysLine(s, `Treaty signed with the ${race.name}.`);
      break;
    }
    case 'demand_tribute': {
      const rule = race.diplomacy.tribute;
      const rel = s.relations[raceId] ?? 0;
      if (!rule || rel >= rule.belowRelation) {
        downgrade('none', 'you do not demand tribute at this relation');
        break;
      }
      const asked = (intent.tribute ?? []).filter((g) => playerHas(s, g.itemId, c) >= g.qty && g.qty > 0);
      const demand =
        asked.length && tributeValue(raceId, asked, c) >= rule.value ? asked : tributeDemand(s, raceId, c);
      if (!demand) {
        downgrade('none', 'the player cannot cover a tribute');
        break;
      }
      s = { ...s, conversation: { ...s.conversation!, demand } };
      break;
    }
    case 'threaten':
      if (!canThreaten(s, raceId, c)) downgrade('none', 'you are not that angry with them');
      break;
    case 'declare_hostility':
      if (!canThreaten(s, raceId, c)) {
        downgrade('none', 'you are not that angry with them');
        break;
      }
      run(() => declareHostility(s, raceId, c));
      if (s.conversation!.context === 'ambush') end = true;
      break;
    case 'share_knowledge': {
      const id = intent.knowledgeId ?? '';
      if (!allowedKnowledge(s, raceId, c).some((k) => k.id === id)) {
        unverified = true;
        downgrade('none', `knowledge "${id}" is not yours to share now`);
        break;
      }
      run(() => shareKnowledge(s, raceId, id, c));
      s = sysLine(s, 'Recorded in the codex.');
      break;
    }
    case 'grant_passage':
      if (!canGrantPassage(s, raceId, c)) {
        downgrade('none', 'you will not grant passage at this relation');
        break;
      }
      run(() => grantPassage(s, raceId, c));
      run(() => resolveParley(s, raceId));
      s = sysLine(s, `Safe passage through ${race.name} space.`);
      break;
    case 'end_conversation':
      end = true;
      break;
  }

  // Relation: clamped per turn and per conversation, whatever the model asked for.
  run(() => conversationRelation(s, turn.relationDelta, turn.relationReason || 'the conversation', c));
  // R11: they suspect a lie (only counts when the player actually said something).
  if (turn.playerDeceptionSuspected && opts.playerSpoke && !s.flags.includes(`liedTo:${raceId}`))
    run(() => deceptionSuspected(s, raceId, c));

  // The tell shows when they lie, if the translator catches it (seeded, so it replays).
  const tell =
    turn.deceptive &&
    new Rng(`tell:${s.seed}:${raceId}:${s.conversation!.turns}:${s.conversation!.transcript.length}`).chance(
      c.rules.diplomacy.tellChance,
    );
  const shown: Shown = { say: turn.say, mood: turn.mood, tell, unverified };
  s = {
    ...s,
    conversation: {
      ...s.conversation!,
      notes,
      transcript: [
        ...s.conversation!.transcript,
        { who: 'alien' as const, text: turn.say, mood: turn.mood, tell, unverified },
      ].slice(-40),
    },
  };
  return { state: s, events, shown, applied, notes, end };
}
