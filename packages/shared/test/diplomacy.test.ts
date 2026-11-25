import { describe, expect, it } from 'vitest';
import { applyAction, applyEncounterResult, newGame } from '../src/rules/campaign.js';
import {
  canSign,
  closeConversation,
  conversationRelation,
  openConversation,
  payTribute,
  signTreaty,
} from '../src/rules/diplomacy.js';
import { readiness } from '../src/rules/readiness.js';
import { attacksYou, isActiveThreat } from '../src/rules/relations.js';
import { scriptedTurn } from '../src/rules/scripted.js';
import { addItem, itemQty } from '../src/rules/ship.js';
import { evaluateTrade, executeTrade, raceStock, tributeDemand } from '../src/rules/trade.js';
import type { CampaignState } from '../src/schemas/campaign.js';
import type { EncounterResult } from '../src/sim/combat/types.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const race = (id: string) => c.races.find((r) => r.id === id)!;
const withItems = (s: CampaignState, id: string, qty: number) => ({
  ...s,
  hold: addItem(s.hold, id, qty, c).hold,
});

describe('evaluateTrade (PLAN §4)', () => {
  const s = withItems(newGame(c, 'tr'), 'isotope-crate', 5);
  it('values the player side by what the race wants', () => {
    const ev = evaluateTrade(
      s,
      'quillari',
      { playerGives: [{ itemId: 'isotope-crate', qty: 1 }], raceGives: [] },
      c,
    );
    expect(ev.give).toBe(12 * race('quillari').economy.wants['isotope-crate']!);
  });
  it('fair is acceptable, lopsided is not, tolerance grows with relation', () => {
    const t = {
      playerGives: [{ itemId: 'isotope-crate', qty: 1 }],
      raceGives: [{ itemId: 'coil-2', qty: 1 }],
    };
    expect(evaluateTrade(s, 'quillari', t, c).acceptable).toBe(false);
    const t2 = {
      playerGives: [{ itemId: 'isotope-crate', qty: 2 }],
      raceGives: [{ itemId: 'coil-2', qty: 1 }],
    };
    expect(evaluateTrade(s, 'quillari', t2, c).acceptable).toBe(true);
    const near = {
      playerGives: [
        { itemId: 'isotope-crate', qty: 1 },
        { itemId: 'data-core', qty: 0 + 0 },
      ].filter((g) => g.qty),
      raceGives: [{ itemId: 'fold-mass', qty: 15 }],
    };
    const cold = evaluateTrade({ ...s, relations: { ...s.relations, quillari: -30 } }, 'quillari', near, c);
    const warm = evaluateTrade({ ...s, relations: { ...s.relations, quillari: 40 } }, 'quillari', near, c);
    expect(warm.tolerance).toBeGreaterThan(cold.tolerance);
  });
  it('refuses goods the player lacks, the race lacks, unknown goods and services owned', () => {
    expect(
      evaluateTrade(s, 'quillari', { playerGives: [{ itemId: 'isotope-crate', qty: 9 }], raceGives: [] }, c)
        .reason,
    ).toBe('player_lacks');
    expect(
      evaluateTrade(s, 'quillari', { playerGives: [], raceGives: [{ itemId: 'lens-3', qty: 1 }] }, c).reason,
    ).toBe('race_lacks');
    expect(
      evaluateTrade(s, 'quillari', { playerGives: [{ itemId: 'warp-gem', qty: 1 }], raceGives: [] }, c)
        .reason,
    ).toBe('unknown_good');
    const owned = { ...s, flags: ['permit:quillari'] };
    expect(
      evaluateTrade(
        owned,
        'quillari',
        { playerGives: [{ itemId: 'isotope-crate', qty: 5 }], raceGives: [{ itemId: 'permit', qty: 1 }] },
        c,
      ).reason,
    ).toBe('already_have');
  });
  it('executeTrade moves goods both ways, depletes stock, grants service flags, nudges relation', () => {
    const t = {
      playerGives: [{ itemId: 'isotope-crate', qty: 4 }],
      raceGives: [
        { itemId: 'permit', qty: 1 },
        { itemId: 'fold-mass', qty: 10 },
      ],
    };
    const r = executeTrade({ ...s, fuel: 50 }, 'quillari', t, c);
    expect(itemQty(r.state, 'isotope-crate')).toBe(1);
    expect(r.state.fuel).toBe(60);
    expect(r.state.flags).toContain('permit:quillari');
    expect(raceStock(r.state, race('quillari'), 'permit')).toBe(0);
    expect(raceStock(r.state, race('quillari'), 'isotope-crate')).toBe(4);
    expect(r.state.relations.quillari).toBe(race('quillari').economy.tradeRelation);
  });
});

describe('claims ship crates; probes write survey logs (trade goods, R: claims yield cargo)', () => {
  it('claiming ships the first crates; arriving again ships more', () => {
    let s = applyAction(newGame(c, 'cr'), { type: 'probe' }, c).state;
    expect(itemQty(s, 'survey-log')).toBe(1);
    s = applyAction(s, { type: 'claim', planetId: 'anvil' }, c).state;
    expect(itemQty(s, 'ore-crate')).toBe(2 * c.rules.diplomacy.cratesPerYield);
    s = applyAction(s, { type: 'jump', to: 'glass-reach' }, c).state;
    if (!s.pendingEncounter) {
      s = applyAction(s, { type: 'jump', to: 'harbor' }, c).state;
      expect(itemQty(s, 'ore-crate')).toBe(4 * c.rules.diplomacy.cratesPerYield);
    }
  });
  it('a second probe of a known system gives no extra log', () => {
    let s = applyAction(newGame(c, 'cr2'), { type: 'probe' }, c).state;
    s = { ...s, visits: { ...s.visits, harbor: { ...s.visits.harbor!, count: 2 } } };
    s = applyAction(s, { type: 'probe' }, c).state;
    expect(itemQty(s, 'survey-log')).toBe(1);
  });
});

describe('conversation rules', () => {
  const atGlass = () => ({ ...newGame(c, 'cv'), systemId: 'glass-reach' });
  it('only the occupant (or an ambusher) can be hailed; one channel at a time', () => {
    expect(() => openConversation(newGame(c, 'h'), 'quillari', c)).toThrow(/no one/);
    const o = openConversation(atGlass(), 'quillari', c).state;
    expect(o.conversation!.patience).toBe(race('quillari').diplomacy.patienceTurns);
    expect(() => applyAction(o, { type: 'jump', to: 'harbor' }, c)).toThrow(/channel/);
  });
  it('relation per conversation is capped at ±20', () => {
    let s = openConversation(atGlass(), 'quillari', c).state;
    for (let i = 0; i < 10; i++) s = conversationRelation(s, 8, 'x', c).state;
    expect(s.relations.quillari).toBe(c.rules.diplomacy.relationPerConversationMax);
  });
  it('closing stores memory; leaving a parley means the fight goes ahead', () => {
    let s = { ...newGame(c, 'pa'), systemId: 'cinder-gate' };
    s = {
      ...s,
      pendingEncounter: {
        id: 'e',
        defId: 'vosk-patrol',
        seed: 'x',
        systemId: 'cinder-gate',
        fromSystemId: 'harbor',
        reason: 'patrol',
        raceId: 'vosk',
        parley: true,
      },
    };
    s = openConversation(s, 'vosk', c).state;
    s = closeConversation(s, 'They were rude.', c).state;
    expect(s.conversationMemory.vosk!.summary).toBe('They were rude.');
    expect(s.pendingEncounter!.parley).toBe(false);
    expect(() => openConversation(s, 'vosk', c)).toThrow();
  });
  it('scripted responder: deterministic, insults lower, courtesy raises', () => {
    const s = openConversation(atGlass(), 'quillari', c).state;
    const a = scriptedTurn(s, 'quillari', { type: 'say', text: 'You are pathetic fools.' }, c);
    expect(a.relationDelta).toBeLessThan(0);
    expect(
      scriptedTurn(s, 'quillari', { type: 'say', text: 'Thank you, friend.' }, c).relationDelta,
    ).toBeGreaterThan(0);
    expect(scriptedTurn(s, 'quillari', { type: 'say', text: 'hi' }, c)).toEqual(
      scriptedTurn(s, 'quillari', { type: 'say', text: 'hi' }, c),
    );
  });
  it('a treaty ends the threat and the patrols; passage only ends the patrols', () => {
    const s = newGame(c, 'th');
    expect(isActiveThreat(s, 'vosk', c)).toBe(true);
    const passage = { ...s, flags: ['passage:vosk'] };
    expect(isActiveThreat(passage, 'vosk', c)).toBe(true);
    expect(attacksYou(passage, 'vosk', c)).toBe(false);
    const treaty = signTreaty(
      { ...s, relations: { ...s.relations, vosk: -10 }, flags: ['respect:vosk'] },
      'vosk',
      c,
    ).state;
    expect(isActiveThreat(treaty, 'vosk', c)).toBe(false);
  });
});

// ---- M5 acceptance: a full Vosk arc completable three ways ------------------------------------------
/** A campaign that has the Cradle and its quotas claimed, so only safety (the Vosk) is left. */
function readyButVosk(seed: string): CampaignState {
  const s = newGame(c, seed);
  const claims = [
    { systemId: 'verdance', planetId: 'verdance-prime' },
    { systemId: 'verdance', planetId: 'thorn' },
    { systemId: 'harbor', planetId: 'anvil' },
    { systemId: 'saltmarrow', planetId: 'brinehold' },
    { systemId: 'saltmarrow', planetId: 'marrow' },
    { systemId: 'glass-reach', planetId: 'frostglass' },
    { systemId: 'cinder-gate', planetId: 'ember' },
  ];
  return { ...s, claims, systemId: 'verdance', flags: ['permit:quillari'] };
}
const voskOnlyThreat = (s: CampaignState) => readiness(s, c).safety.threats;

describe('M5 ACCEPT: the Vosk arc three ways (treaty, tribute, force)', () => {
  it('starting point: everything but safety is met, and the Vosk are the threat', () => {
    const r = readiness(readyButVosk('a0'), c);
    expect(r.cradle.ok).toBe(true);
    expect(Object.values(r.quotas).every((q) => q.ok)).toBe(true);
    expect(r.safety.threats).toEqual(['vosk']);
  });

  it('FORCE: break Cinder Hold → safe (and hostile forever)', () => {
    let s = readyButVosk('a1');
    s = { ...s, systemId: 'cinder-gate' };
    s = applyAction(s, { type: 'attackBase' }, c).state;
    const result: EncounterResult = {
      outcome: 'victory',
      destroyed: [{ id: 'b', hullId: 'vosk-base' }],
      fled: [],
      salvage: [],
      installed: s.installed,
      lost: [],
      hullFraction: 0.6,
      framesLeft: 6,
      dronesLost: { hornet: 0, lance: 0, ram: 0 },
      seconds: 200,
    } as unknown as EncounterResult;
    s = applyEncounterResult(s, result, c).state;
    expect(voskOnlyThreat(s)).toEqual([]);
    expect(canSign({ ...s, relations: { ...s.relations, vosk: 50 } }, 'vosk', c).ok).toBe(false);
  });

  it('TRIBUTE: pay the hive twice → no longer hostile → safe', () => {
    let s = withItems(readyButVosk('a2'), 'ore-crate', 20);
    for (let i = 0; i < 2; i++) {
      const demand = tributeDemand(s, 'vosk', c)!;
      expect(demand).not.toBeNull();
      s = payTribute(s, 'vosk', demand, c).state;
    }
    expect(s.flags).toContain('tribute:vosk');
    expect(voskOnlyThreat(s)).toEqual([]);
  });

  it('TREATY: win a fight (respect) and talk them up to the threshold → treaty → safe', () => {
    let s = readyButVosk('a3');
    s = { ...s, flags: [...s.flags, 'respect:vosk'], systemId: 'cinder-gate' };
    for (let conv = 0; conv < 20 && !s.treaties.includes('vosk'); conv++) {
      s = openConversation(s, 'vosk', c).state;
      // Courteous talk raises them a little each turn (scripted responder = the mock model).
      const t = scriptedTurn(s, 'vosk', { type: 'say', text: 'We respect the hive, friend.' }, c);
      s = conversationRelation(s, t.relationDelta * 4, 'respect', c).state;
      if (canSign(s, 'vosk', c).ok) s = signTreaty(s, 'vosk', c).state;
      s = closeConversation(s, '', c).state;
    }
    expect(s.treaties).toContain('vosk');
    expect(voskOnlyThreat({ ...s, systemId: 'verdance' })).toEqual([]);
  });
});

describe('tribute the pilot cannot cover', () => {
  it('opens without a demand and says why', () => {
    let s = { ...newGame(c, 'poor'), systemId: 'cinder-gate', hold: [], fuel: 10 };
    s = openConversation(s, 'vosk', c).state;
    expect(s.conversation!.demand).toBeNull();
    expect(s.conversation!.transcript[0]!.text).toMatch(/too little/);
  });
});
