import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/migrations/index.js';
import { newGame } from '../src/rules/campaign.js';
import { CAMPAIGN_VERSION } from '../src/schemas/campaign.js';
import { loadTestContent } from './helpers.js';

const c = loadTestContent();
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('save migrations', () => {
  it('the current version loads unchanged', () => {
    const s = newGame(c, 'm');
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual({ state: s, migratedFrom: null });
  });
  it('every fixture save from an earlier release still loads (CLAUDE.md rule 8)', () => {
    mkdirSync(fixtures, { recursive: true });
    const current = join(fixtures, `save-v${CAMPAIGN_VERSION}.json`);
    if (!existsSync(current)) writeFileSync(current, JSON.stringify(newGame(c, 'fixture'), null, 2) + '\n');
    for (let v = 1; v <= CAMPAIGN_VERSION; v++) {
      const raw = JSON.parse(readFileSync(join(fixtures, `save-v${v}.json`), 'utf8'));
      expect(migrate(raw).state.version).toBe(CAMPAIGN_VERSION);
    }
  });
  it('refuses saves from the future and saves without a version', () => {
    expect(() => migrate({ version: CAMPAIGN_VERSION + 1 })).toThrow(/Upgrade Starwake/);
    expect(() => migrate({})).toThrow(/no valid version/);
    expect(() => migrate(null)).toThrow();
  });
});
