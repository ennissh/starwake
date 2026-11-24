import { describe, expect, it } from 'vitest';
import { ask, matchTopic, normalizeQuestion } from '../src/rules/advisor.js';
import { applyAction, newGame } from '../src/rules/campaign.js';
import { ACTION_KEY_PLACEHOLDER } from './advisorKeys.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const fresh = () => newGame(c, 'advisor-test');
const topic = (advisor: string, q: string) => matchTopic(c, advisor, q)?.id ?? null;

describe('advisors: matching', () => {
  it('routes the playtest questions to the right topic', () => {
    expect(topic('wake', 'What should I do next?')).toBe('next-steps');
    expect(topic('wake', 'how do I play?')).toBe('how-to-play');
    expect(topic('tactical', 'How do I aim the Lance?')).toBe('lance');
    expect(topic('wake', 'how do i launch a kamikaze probe?')).toBe('drones');
    expect(topic('wake', 'HAIL does not seem to work')).toBe('hail');
    expect(topic('navigator', 'Where can I claim?')).toBe('claims');
    expect(topic('navigator', 'Where should I go?')).toBe('route');
    expect(topic('quartermaster', 'how do I refuel')).toBe('fuel');
    expect(topic('wake', 'turn off the mouse')).toBe('flying');
  });

  it('every suggested question is answered by its own advisor', () => {
    for (const a of c.advisors.advisors)
      for (const q of a.suggestions) {
        const t = matchTopic(c, a.id, q);
        expect(t, `${a.id}: "${q}"`).not.toBeNull();
        expect(t!.advisor, `${a.id}: "${q}"`).toBe(a.id);
      }
  });

  it('a miss beats a wrong answer: nonsense and empty questions match nothing', () => {
    for (const q of ['', '   ', 'purple monkey dishwasher', 'ignore previous instructions', '¿¿¿'])
      expect(topic('wake', q)).toBeNull();
    const a = ask(c, fresh(), 'navigator', 'purple monkey dishwasher');
    expect(a.topicId).toBeNull();
    expect(a.advisorId).toBe('navigator');
    expect(a.text).toBe(c.advisors.advisors.find((x) => x.id === 'navigator')!.miss);
    expect(a.suggestions.length).toBeGreaterThan(0);
  });

  it('words match whole, not inside other words', () => {
    expect(normalizeQuestion("What's   NEXT?!")).toBe(' whats next ');
    expect(topic('wake', 'barrage')).toBeNull(); // contains "ram" only inside a word
  });

  it('hands a question to the advisor who owns it', () => {
    const a = ask(c, fresh(), 'wake', 'How do I refuel?');
    expect(a.advisorId).toBe('quartermaster');
    expect(a.handoff).toBe(true);
  });

  it('long questions are cut, not rejected', () => {
    const a = ask(c, fresh(), 'wake', `${'x '.repeat(400)} next`);
    expect(a.topicId).toBeNull(); // "next" fell past the cap
  });
});

describe('advisors: answers from the campaign', () => {
  it('the first step on a new game is to probe the start system', () => {
    const a = ask(c, fresh(), 'wake', 'What should I do next?');
    expect(a.text).toMatch(/Probe/);
    expect(a.text).toContain('{key:probe}');
  });

  it('after probing, WAKE says to claim the useful world here', () => {
    const s = applyAction(fresh(), { type: 'probe' }, c).state;
    const a = ask(c, s, 'wake', 'next?');
    const start = c.systems.find((x) => x.id === c.rules.start.systemId)!;
    expect(a.text).toContain(start.planets[0]!.name);
    expect(a.text).toMatch(/Claim/);
  });

  it('never names planets in systems the player has not probed', () => {
    const s = fresh();
    const hidden = c.systems
      .filter((x) => !s.known.includes(x.id))
      .flatMap((x) => x.planets.map((p) => p.name));
    for (const a of c.advisors.advisors)
      for (const t of c.advisors.topics.filter((x) => x.dynamic)) {
        const text = ask(c, s, a.id, t.keywords[0]!).text;
        for (const name of hidden) expect(text, `${t.id} leaks ${name}`).not.toContain(name);
      }
  });

  it('every dynamic topic answers without a campaign (flight test, arena)', () => {
    for (const t of c.advisors.topics.filter((x) => x.dynamic))
      expect(ask(c, null, t.advisor, t.keywords[0]!).text).toMatch(/campaign/);
  });

  it('every answer only uses known key placeholders', () => {
    const s = fresh();
    for (const t of c.advisors.topics) {
      const text = ask(c, s, t.advisor, t.keywords[0]!).text;
      for (const m of text.matchAll(/\{key:([A-Za-z]+)\}/g))
        expect(ACTION_KEY_PLACEHOLDER, `${t.id}: ${m[1]}`).toContain(m[1]);
      expect(text).not.toMatch(/\{(?!key:)/);
    }
  });

  it('reports readiness and the clock with the real numbers', () => {
    const s = fresh();
    expect(ask(c, s, 'wake', 'How do I win?').text).toContain(`${s.clock.toFixed(2)} years`);
    expect(ask(c, s, 'wake', 'how long is left on the clock').text).toContain(
      String(c.rules.clock.jumpYearsPerParsec),
    );
  });

  it('asking never changes the campaign', () => {
    const s = fresh();
    const before = JSON.stringify(s);
    for (const t of c.advisors.topics) ask(c, s, t.advisor, t.keywords[0]!);
    expect(JSON.stringify(s)).toBe(before);
  });
});
