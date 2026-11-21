import { describe, expect, it } from 'vitest';
import { Encounter, TICK } from '../src/sim/combat/encounter.js';
import { CommandRecorder, plausible, quantize, replay } from '../src/sim/combat/replay.js';
import { sensiblePilot } from './bots.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const def = c.encounters.find((e) => e.id === 'arena-patrol')!;
const opts = { seed: 'rp', content: c, roster: def.roster, distance: def.distance };

function play() {
  const e = new Encounter(opts);
  const rec = new CommandRecorder();
  for (let i = 0; i < 120 / TICK && !e.over && !e.crippled; i++) {
    const cmd = quantize(sensiblePilot(e));
    rec.push(cmd);
    e.step(cmd);
  }
  return { result: e.result(), log: rec.log() };
}

describe('encounter replay verification', () => {
  it('replaying the recorded commands reproduces the result exactly', () => {
    const { result, log } = play();
    expect(result.outcome).toBe('victory');
    expect(replay(opts, log)).toEqual(result);
  });
  it('run-length encoding keeps the log small', () => {
    const { log, result } = play();
    expect(log.runs.length).toBeLessThan(result.ticks);
  });
  it('a tampered result fails the replay and the plausibility check', () => {
    const { result, log } = play();
    const forged = {
      ...result,
      salvage: [
        ...result.salvage,
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
      ],
    };
    expect(replay(opts, log)).not.toEqual(forged);
    expect(plausible(forged, opts, c).length).toBeGreaterThan(0);
    expect(plausible(result, opts, c)).toEqual([]);
  });
  it('plausibility rejects impossible kills and repairs', () => {
    const { result } = play();
    expect(
      plausible(
        { ...result, destroyed: [...result.destroyed, { id: 'hx', hullId: 'vosk-base' }] },
        opts,
        c,
      ).join(),
    ).toMatch(/not in this encounter/);
    expect(plausible({ ...result, hullFraction: 2 }, opts, c).join()).toMatch(/hull went up/);
  });
});
