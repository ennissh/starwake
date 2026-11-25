import { describe, expect, it } from 'vitest';
import { newGame } from '../src/rules/campaign.js';
import { endingSummary } from '../src/rules/ending.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();

describe('ending summary (M6)', () => {
  it('a loss is The Long Sleep, no stars', () => {
    const e = endingSummary({ ...newGame(c, 'l'), outcome: 'lost', clock: 0 }, c);
    expect(e.won).toBe(false);
    expect(e.title).toBe('The Long Sleep');
    expect(e.stars).toBe(0);
    expect(e.epilogue[0]).toMatch(/ran out/);
  });
  it('a fast, clean, two-treaty win is a five-star Peacemaker', () => {
    const s = { ...newGame(c, 'w'), outcome: 'won' as const, clock: 7, treaties: ['quillari', 'vosk'] };
    const e = endingSummary(s, c);
    expect(e.title).toBe('Peacemaker');
    expect(e.stars).toBe(5);
    expect(e.races.find((r) => r.raceId === 'vosk')!.outcome).toBe('treaty');
    expect(e.epilogue.join(' ')).toMatch(/Vosk stand with the colony/);
  });
  it('breaking the Vosk without treaties is a Conqueror; tribute is remembered', () => {
    const conq = endingSummary({ ...newGame(c, 'c'), outcome: 'won', clock: 3, flags: ['vosk_broken'] }, c);
    expect(conq.title).toBe('Conqueror');
    expect(conq.races.find((r) => r.raceId === 'vosk')!.outcome).toBe('broken');
    const trib = endingSummary({ ...newGame(c, 't'), outcome: 'won', clock: 3, flags: ['tribute:vosk'] }, c);
    expect(trib.title).toBe('Tributary');
  });
  it('races never met are "unmet"; the same save always gets the same ending', () => {
    const s = { ...newGame(c, 'u'), outcome: 'won' as const, clock: 4 };
    expect(endingSummary(s, c).races.every((r) => r.outcome === 'unmet')).toBe(true);
    expect(endingSummary(s, c)).toEqual(endingSummary(s, c));
  });
});
