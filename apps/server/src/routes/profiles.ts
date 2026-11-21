import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROFILE_ID, type Store } from '../store.js';
import { httpError } from './util.js';

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  /** Client settings (key bindings, mouse, theme), opaque to the server. */
  settings: unknown;
}

const NewProfile = z.object({ name: z.string().trim().min(1).max(24) });
const Settings = z.object({ settings: z.unknown() });

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'pilot'
  );
}

/** Player profiles: a name only (LAN game, no passwords). */
export function profileRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/profiles', async () => {
    const files = await store.list('profiles');
    const out: Omit<Profile, 'settings'>[] = [];
    for (const f of files) {
      const p = await store.readJson<Profile>(store.profilePath(f.replace(/\.json$/, '')));
      if (p) out.push({ id: p.id, name: p.name, createdAt: p.createdAt });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post('/api/profiles', async (req, reply) => {
    const { name } = NewProfile.parse(req.body);
    const id = slug(name);
    const path = store.profilePath(id);
    return store.withLock(path, async () => {
      if (await store.readJson(path))
        throw httpError(409, 'PROFILE_EXISTS', `A pilot called "${name}" already exists.`);
      const p: Profile = { id, name, createdAt: new Date().toISOString(), settings: null };
      await store.writeJson(path, p);
      req.log.info({ profile: id }, 'profile created');
      return reply.code(201).send(p);
    });
  });

  app.get<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    if (!PROFILE_ID.test(req.params.id)) throw httpError(400, 'BAD_ID', 'Bad profile id.');
    const p = await store.readJson<Profile>(store.profilePath(req.params.id));
    if (!p) throw httpError(404, 'NO_PROFILE', 'No such pilot.');
    return p;
  });

  app.put<{ Params: { id: string } }>('/api/profiles/:id/settings', { bodyLimit: 64 * 1024 }, async (req) => {
    if (!PROFILE_ID.test(req.params.id)) throw httpError(400, 'BAD_ID', 'Bad profile id.');
    const { settings } = Settings.parse(req.body);
    const path = store.profilePath(req.params.id);
    return store.withLock(path, async () => {
      const p = await store.readJson<Profile>(path);
      if (!p) throw httpError(404, 'NO_PROFILE', 'No such pilot.');
      await store.writeJson(path, { ...p, settings });
      return { ok: true };
    });
  });
}
