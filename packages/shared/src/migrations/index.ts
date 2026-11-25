import { CAMPAIGN_VERSION, type CampaignState, CampaignStateSchema } from '../schemas/campaign.js';

/**
 * Save migrations (PLAN §7.5, CLAUDE.md rule 8): each step upgrades a save from one version to the
 * next. A new release that changes CampaignState bumps CAMPAIGN_VERSION and adds a step here, with
 * a test that starts from the previous version's fixture save (test/fixtures/save-v<N>.json).
 */
type Raw = Record<string, unknown>;
const STEPS: Record<number, (s: Raw) => Raw> = {
  // 1 → 2 (M5): race stock, open conversation, ambush parley.
  1: (s) => ({
    ...s,
    version: 2,
    raceStock: {},
    conversation: null,
    pendingEncounter: s.pendingEncounter ? { ...(s.pendingEncounter as Raw), parley: false } : null,
  }),
};

export class SaveVersionError extends Error {}

export function migrate(raw: unknown): { state: CampaignState; migratedFrom: number | null } {
  if (!raw || typeof raw !== 'object') throw new SaveVersionError('save is not an object');
  let s = raw as Raw;
  const from = s.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1)
    throw new SaveVersionError('save has no valid version');
  if (from > CAMPAIGN_VERSION)
    throw new SaveVersionError(
      `save is version ${from}; this build reads up to ${CAMPAIGN_VERSION}. Upgrade Starwake.`,
    );
  let v = from;
  while (v < CAMPAIGN_VERSION) {
    const step = STEPS[v];
    if (!step) throw new SaveVersionError(`no migration from version ${v}`);
    s = step(s);
    v++;
  }
  return { state: CampaignStateSchema.parse(s), migratedFrom: from === CAMPAIGN_VERSION ? null : from };
}
