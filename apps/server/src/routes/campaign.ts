import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type CampaignState,
  type CommandLog,
  type ContentBundle,
  type EncounterOptions,
  type EncounterResult,
  CampaignActionSchema,
  RuleError,
  applyAction,
  applyEncounterResult,
  byId,
  fuelPerParsec,
  jumpRange,
  migrate,
  newGame,
  plausible,
  readiness,
  replay,
  system,
} from '@starwake/shared';
import { PROFILE_ID, SLOTS, type Slot, type Store } from '../store.js';
import { httpError } from './util.js';

/** A save file: metadata for the slot list plus the campaign state. */
export interface SaveFile {
  meta: {
    profile: string;
    slot: Slot;
    savedAt: string;
    systemName: string;
    clock: number;
    outcome: CampaignState['outcome'];
  };
  state: CampaignState;
}

const SaveId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}\.(auto|1|2|3)$/);
const NewSave = z.object({
  profile: z.string().regex(PROFILE_ID),
  slot: z.enum(SLOTS),
  copyFrom: SaveId.optional(),
  /** A chosen seed replays the same campaign (seeded runs, reproducible tests). */
  seed: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .optional(),
});
const ActionBody = z.object({ action: CampaignActionSchema });
const StartBody = z.object({ saveId: SaveId });

function parseId(id: string): { profile: string; slot: Slot } {
  const ok = SaveId.safeParse(id);
  if (!ok.success) throw httpError(400, 'BAD_SAVE_ID', 'Bad save id.');
  const [profile, slot] = id.split('.') as [string, Slot];
  return { profile, slot };
}

/** The view the client gets: the state plus numbers it shouldn't have to re-derive. */
function view(id: string, f: SaveFile, c: ContentBundle) {
  return {
    id,
    meta: f.meta,
    state: f.state,
    readiness: readiness(f.state, c),
    ship: { range: jumpRange(f.state.installed, c), fuelPerParsec: fuelPerParsec(f.state.installed, c) },
  };
}

export function campaignRoutes(app: FastifyInstance, store: Store, content: ContentBundle): void {
  const meta = (profile: string, slot: Slot, state: CampaignState): SaveFile['meta'] => ({
    profile,
    slot,
    savedAt: new Date().toISOString(),
    systemName: system(content, state.systemId).name,
    clock: state.clock,
    outcome: state.outcome,
  });

  /** Load a save, migrating (with a backup first) if it was written by an older release. */
  async function load(id: string): Promise<SaveFile> {
    const { profile, slot } = parseId(id);
    const path = store.savePath(profile, slot);
    const f = await store.readJson<SaveFile>(path);
    if (!f) throw httpError(404, 'NO_SAVE', 'No such save.');
    let m: ReturnType<typeof migrate>;
    try {
      m = migrate(f.state);
    } catch (err) {
      throw httpError(422, 'SAVE_UNREADABLE', (err as Error).message);
    }
    if (m.migratedFrom !== null) {
      await store.backup(path, `v${m.migratedFrom}`);
      const migrated = { ...f, state: m.state };
      await store.writeJson(path, migrated);
      app.log.info({ save: id, from: m.migratedFrom }, 'save migrated (backup kept)');
      return migrated;
    }
    return { ...f, state: m.state };
  }

  async function write(id: string, state: CampaignState): Promise<SaveFile> {
    const { profile, slot } = parseId(id);
    const f: SaveFile = { meta: meta(profile, slot, state), state };
    await store.writeJson(store.savePath(profile, slot), f);
    return f;
  }

  /** Serialise every read-modify-write of one save. */
  const locked = <T>(id: string, fn: () => Promise<T>) => {
    const { profile, slot } = parseId(id);
    return store.withLock(store.savePath(profile, slot), fn);
  };

  // ---- saves ----------------------------------------------------------------------------------
  app.get<{ Querystring: { profile?: string } }>('/api/saves', async (req) => {
    const profile = req.query.profile ?? '';
    if (!PROFILE_ID.test(profile)) throw httpError(400, 'BAD_ID', 'Pass ?profile=<id>.');
    const out = [];
    for (const slot of SLOTS) {
      const f = await store.readJson<SaveFile>(store.savePath(profile, slot));
      if (f) out.push({ id: `${profile}.${slot}`, meta: f.meta });
    }
    return out;
  });

  app.post('/api/saves', async (req, reply) => {
    const body = NewSave.parse(req.body);
    const id = `${body.profile}.${body.slot}`;
    if (!(await store.readJson(store.profilePath(body.profile))))
      throw httpError(404, 'NO_PROFILE', 'No such pilot.');
    return locked(id, async () => {
      let state: CampaignState;
      if (body.copyFrom) {
        if (body.copyFrom === id) throw httpError(400, 'SAME_SLOT', 'Copying a save onto itself.');
        if (parseId(body.copyFrom).profile !== body.profile)
          throw httpError(400, 'OTHER_PROFILE', 'Saves stay with their pilot.');
        state = (await load(body.copyFrom)).state;
      } else {
        state = newGame(content, body.seed ?? randomUUID());
        req.log.info({ save: id }, 'new game');
      }
      const f = await write(id, state);
      return reply.code(201).send(view(id, f, content));
    });
  });

  // Under the save's lock: loading may migrate (and rewrite) an old save.
  app.get<{ Params: { id: string } }>('/api/saves/:id', async (req) =>
    locked(req.params.id, async () => view(req.params.id, await load(req.params.id), content)),
  );

  app.delete<{ Params: { id: string } }>('/api/saves/:id', async (req) => {
    const { profile, slot } = parseId(req.params.id);
    const removed = await locked(req.params.id, () => store.remove(store.savePath(profile, slot)));
    if (!removed) throw httpError(404, 'NO_SAVE', 'No such save.');
    return { ok: true };
  });

  // ---- campaign actions ----------------------------------------------------------------------------
  app.post<{ Params: { saveId: string } }>('/api/campaign/:saveId/action', async (req) => {
    const { action } = ActionBody.parse(req.body);
    const id = req.params.saveId;
    return locked(id, async () => {
      const f = await load(id);
      let step;
      try {
        step = applyAction(f.state, action, content);
      } catch (err) {
        if (err instanceof RuleError) throw httpError(409, err.code, err.message);
        throw err;
      }
      const saved = await write(id, step.state);
      req.log.info({ save: id, action: action.type, events: step.events.map((e) => e.t) }, 'campaign action');
      return { ...view(id, saved, content), events: step.events };
    });
  });

  // ---- encounters (PLAN §2.2) -------------------------------------------------------------------------
  function encounterOptions(state: CampaignState): EncounterOptions {
    const pe = state.pendingEncounter!;
    const def = byId(content.encounters, pe.defId);
    return {
      seed: pe.seed,
      content,
      roster: def.roster,
      distance: def.distance,
      installed: state.installed,
      frames: state.droneFrames,
      hullFraction: state.hull,
    };
  }

  app.post('/api/encounters/start', async (req) => {
    const { saveId } = StartBody.parse(req.body);
    const f = await load(saveId);
    const pe = f.state.pendingEncounter;
    if (!pe) throw httpError(409, 'NO_ENCOUNTER', 'There is no fight pending.');
    const o = encounterOptions(f.state);
    const def = byId(content.encounters, pe.defId);
    return {
      encounterId: pe.id,
      reason: pe.reason,
      raceId: pe.raceId,
      name: def.name,
      options: {
        seed: o.seed,
        roster: o.roster,
        distance: o.distance,
        installed: o.installed,
        frames: o.frames,
        hullFraction: o.hullFraction,
      },
    };
  });

  const ResultBody = z.object({ saveId: SaveId, result: z.unknown(), log: z.unknown() });

  app.post<{ Params: { id: string } }>(
    '/api/encounters/:id/result',
    { bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      const body = ResultBody.parse(req.body);
      const claimed = body.result as EncounterResult;
      const log = body.log as CommandLog;
      return locked(body.saveId, async () => {
        const f = await load(body.saveId);
        const pe = f.state.pendingEncounter;
        if (!pe || pe.id !== req.params.id)
          throw httpError(409, 'NO_ENCOUNTER', 'That fight is not pending (already resolved?).');
        const opts = encounterOptions(f.state);
        // Replay the commands through the same deterministic sim; fall back to bounds checks.
        let verification: 'verified' | 'plausible';
        let result: EncounterResult;
        try {
          if (!log || !Array.isArray((log as CommandLog).runs)) throw new Error('no command log');
          result = replay(opts, log);
          if (JSON.stringify(result) !== JSON.stringify(claimed))
            throw new Error('replay differs from the claimed result');
          verification = 'verified';
        } catch (err) {
          const problems = plausible(claimed, opts, content);
          if (problems.length) {
            req.log.warn(
              { save: body.saveId, problems, why: (err as Error).message },
              'encounter result rejected',
            );
            throw httpError(422, 'IMPLAUSIBLE_RESULT', 'That fight result could not be verified.', problems);
          }
          req.log.warn(
            { save: body.saveId, why: (err as Error).message },
            'encounter replay mismatch; accepted on plausibility',
          );
          result = claimed;
          verification = 'plausible';
        }
        let step;
        try {
          step = applyEncounterResult(f.state, result, content);
        } catch (err) {
          if (err instanceof RuleError) throw httpError(409, err.code, err.message);
          throw err;
        }
        const saved = await write(body.saveId, step.state);
        req.log.info(
          { save: body.saveId, outcome: result.outcome, verification, destroyed: result.destroyed.length },
          'encounter resolved',
        );
        return { ...view(body.saveId, saved, content), events: step.events, verification };
      });
    },
  );
}
