import { type ContentBundle, type Race, byId } from '../schemas/content.js';
import type { CampaignState, GoodQty, Trade } from '../schemas/campaign.js';
import type { AlienTurn, Mood, PlayerMove } from '../schemas/translator.js';
import { allowedKnowledge, canGrantPassage, canSign } from './diplomacy.js';
import { isBroken } from './relations.js';
import { evaluateTrade, goodName, goodValue } from './trade.js';

/**
 * The scripted responder (M5): a deterministic AlienTurn for a player move, from the race's stock
 * lines and the rules. It is the fallback when Ollama is off or down, and the mock "model" in
 * tests (LLM_MODE=mock). Its turns go through the same validator as a real model's.
 */
type LineKey = keyof Race['persona']['lines'];

const INSULTS =
  /\b(stupid|idiot|idiots|ugly|fool|fools|hate|worthless|pathetic|disgusting|vermin|coward|cowards|liar|liars)\b/i;
const KIND = /\b(thank|thanks|please|friend|friends|beautiful|honou?r|respect|admire|wonderful|kind)\b/i;

/** Pick a line deterministically: same state and move, same line. */
export function stockLine(race: Race, key: LineKey, salt: number): string {
  const xs = race.persona.lines[key];
  return xs[Math.abs(salt) % xs.length]!;
}

function turn(
  say: string,
  mood: Mood,
  intent: AlienTurn['intent'] = { type: 'none' },
  relationDelta = 0,
  reason = '',
): AlienTurn {
  return {
    say,
    mood,
    deceptive: false,
    relationDelta,
    relationReason: reason,
    playerDeceptionSuspected: false,
    intent,
  };
}

/** Shrink what the race gives until the trade is acceptable (or nothing is left). */
export function counterFor(s: CampaignState, race: Race, t: Trade, c: ContentBundle): Trade | null {
  const raceGives: GoodQty[] = t.raceGives.map((g) => ({ ...g }));
  for (let guard = 0; guard < 200; guard++) {
    const ev = evaluateTrade(s, race.id, { playerGives: t.playerGives, raceGives }, c);
    if (ev.acceptable) return raceGives.length ? { playerGives: t.playerGives, raceGives } : null;
    if (ev.reason !== 'unbalanced') return null;
    // Drop one unit of the most valuable thing they'd give.
    let best = -1;
    raceGives.forEach((g, i) => {
      if (best < 0 || goodValue(race, g.itemId, c) > goodValue(race, raceGives[best]!.itemId, c)) best = i;
    });
    if (best < 0) return null;
    raceGives[best]!.qty--;
    if (raceGives[best]!.qty <= 0) raceGives.splice(best, 1);
    if (!raceGives.length) return null;
  }
  return null;
}

/** Map free speech to the move it most likely means (fallback only; the model reads it itself). */
export function readSpeech(text: string): PlayerMove['type'] | 'insult' | 'kind' | 'smallTalk' {
  const t = text.toLowerCase();
  if (INSULTS.test(t)) return 'insult';
  if (/\b(treaty|pact|alliance|peace|ally)\b/.test(t)) return 'askTreaty';
  if (/\b(passage|pass through|let (me|us) (pass|through)|safe conduct)\b/.test(t)) return 'askPassage';
  if (/\b(tribute|pay you|what do you want)\b/.test(t)) return 'payTribute';
  if (/\b(tell me|know|knowledge|secret|secrets|rumou?r|news|cradle|where|learn)\b/.test(t))
    return 'askKnowledge';
  if (/\b(who are you|yourselves|about you|your (people|kind|race))\b/.test(t)) return 'about';
  if (/\b(bye|goodbye|farewell|leave|later)\b/.test(t)) return 'leave';
  if (KIND.test(t)) return 'kind';
  return 'smallTalk';
}

export function scriptedTurn(
  s: CampaignState,
  raceId: string,
  move: PlayerMove,
  c: ContentBundle,
): AlienTurn {
  const race = byId(c.races, raceId);
  const conv = s.conversation;
  const salt = (conv?.turns ?? 0) + (conv?.transcript.length ?? 0);
  const L = (k: LineKey) => stockLine(race, k, salt);
  const rel = s.relations[raceId] ?? 0;
  const hostile = rel <= c.rules.relations.hostile || isBroken(s, raceId);

  if (isBroken(s, raceId) && move.type !== 'leave')
    return turn(L('hostileGreet'), 'angry', { type: 'none' }, 0, 'they remember their broken base');

  const kind = move.type === 'say' ? readSpeech(move.text) : move.type;
  switch (kind) {
    case 'insult':
      return turn(L('insulted'), 'angry', { type: 'none' }, -3, 'you insulted them');
    case 'kind':
      return turn(L('smallTalk'), 'pleased', { type: 'none' }, 2, 'you were courteous');
    case 'smallTalk':
      if (conv?.demand)
        return turn(L('tributeDemand'), 'scheming', { type: 'demand_tribute', tribute: conv.demand });
      return turn(L('smallTalk'), hostile ? 'annoyed' : 'neutral');
    case 'about':
      return turn(`${L('about')}`, 'neutral');
    case 'leave':
      return turn(L('farewell'), 'neutral', { type: 'end_conversation' });
    case 'askTreaty': {
      const ok = canSign(s, raceId, c);
      return ok.ok
        ? turn(L('treatyAccept'), 'pleased', { type: 'accept_treaty' }, 0, 'a treaty')
        : turn(L('treatyReject'), 'neutral', { type: 'reject_treaty' });
    }
    case 'askPassage':
      return canGrantPassage(s, raceId, c)
        ? turn(L('passage'), 'neutral', { type: 'grant_passage' })
        : turn(L('nothingToShare'), 'annoyed', { type: 'none' });
    case 'askKnowledge': {
      const k = allowedKnowledge(s, raceId, c)[0];
      return k
        ? turn(`${L('knowledge')} ${k.text}`, 'neutral', { type: 'share_knowledge', knowledgeId: k.id })
        : turn(L('nothingToShare'), 'neutral');
    }
    case 'payTribute':
      // The engine executes the payment itself; this is their reaction.
      return conv?.demand
        ? turn(L('tributePaid'), 'pleased')
        : turn(L('tributeDemand'), 'scheming', { type: race.diplomacy.tribute ? 'demand_tribute' : 'none' });
    case 'acceptCounter':
      return turn(L('tradeAccept'), 'pleased');
    case 'offer': {
      if (move.type !== 'offer') return turn(L('smallTalk'), 'neutral');
      const ev = evaluateTrade(s, raceId, move.trade, c);
      if (ev.acceptable) return turn(L('tradeAccept'), 'pleased', { type: 'accept_trade' });
      if (ev.reason === 'unbalanced') {
        const counter = counterFor(s, race, move.trade, c);
        if (counter)
          return turn(
            `${L('tradeCounter')} (${counter.raceGives.map((g) => `${g.qty} ${goodName(c, g.itemId, race)}`).join(', ')})`,
            'scheming',
            { type: 'counter_trade', trade: counter },
          );
      }
      return turn(L('tradeReject'), 'annoyed', { type: 'reject_trade' });
    }
    default:
      return turn(L('smallTalk'), 'neutral');
  }
}

/** The opening line when a channel opens. */
export function scriptedGreeting(s: CampaignState, raceId: string, c: ContentBundle): AlienTurn {
  const race = byId(c.races, raceId);
  const rel = s.relations[raceId] ?? 0;
  const hostile =
    rel <= c.rules.relations.hostile || isBroken(s, raceId) || s.flags.includes(`liedTo:${raceId}`);
  const demand = s.conversation?.demand;
  if (demand)
    return turn(`${stockLine(race, 'hostileGreet', 0)} ${stockLine(race, 'tributeDemand', 0)}`, 'scheming', {
      type: 'demand_tribute',
      tribute: demand,
    });
  return turn(stockLine(race, hostile ? 'hostileGreet' : 'greet', 0), hostile ? 'annoyed' : 'neutral');
}

/** A short memory summary without the model (PLAN §6.4 memory, fallback path). */
export function scriptedSummary(s: CampaignState, raceId: string, c: ContentBundle): string {
  const race = byId(c.races, raceId);
  const conv = s.conversation;
  const prev = s.conversationMemory[raceId]?.summary;
  const bits: string[] = [];
  if (conv) {
    bits.push(
      `The ${race.name} spoke with the pathfinder for ${conv.turns} turn${conv.turns === 1 ? '' : 's'}.`,
    );
    if (conv.delta)
      bits.push(`Their opinion ${conv.delta > 0 ? 'rose' : 'fell'} by ${Math.abs(conv.delta)}.`);
    const sys = conv.transcript.filter((t) => t.who === 'system').map((t) => t.text);
    if (sys.length) bits.push(sys.slice(-3).join(' '));
  }
  const text = [prev, ...bits].filter(Boolean).join(' ');
  return text.length > 600 ? text.slice(text.length - 600) : text;
}
