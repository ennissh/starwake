import { describe, expect, it } from 'vitest';
import { systemOutputs } from '../src/rules/systems.js';
import { defaultInstalled } from '../src/sim/combat/encounter.js';
import { SYSTEM_IDS } from '../src/schemas/content.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();

describe('system output', () => {
  it('starting systems sit at about 40–60% (PLAN §1.6)', () => {
    const o = systemOutputs(defaultInstalled(c), c);
    for (const s of SYSTEM_IDS) {
      expect(o[s], s).toBeGreaterThanOrEqual(0.4);
      expect(o[s], s).toBeLessThanOrEqual(0.6);
    }
  });

  it('scales with condition and treats empty slots as 0', () => {
    const inst = defaultInstalled(c).filter((i) => i.system === 'foreShield');
    const full = systemOutputs(inst, c).foreShield;
    const half = systemOutputs(
      inst.map((i) => ({ ...i, condition: 50 })),
      c,
    ).foreShield;
    expect(half).toBeCloseTo(full / 2, 9);
    expect(systemOutputs([], c).foreShield).toBe(0);
  });
});
