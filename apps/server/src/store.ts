import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * File storage under DATA_DIR (PLAN §7.5): JSON documents written atomically (temp file in the
 * same directory, fsync, rename), with a per-file lock so concurrent requests can't interleave.
 * No database. Paths are built only from validated ids, never from raw input.
 */
export const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const SLOTS = ['auto', '1', '2', '3'] as const;
export type Slot = (typeof SLOTS)[number];

export class Store {
  private locks = new Map<string, Promise<unknown>>();

  constructor(readonly dataDir: string) {}

  profilePath(id: string): string {
    if (!PROFILE_ID.test(id)) throw new Error('bad profile id');
    return join(this.dataDir, 'profiles', `${id}.json`);
  }

  savePath(profile: string, slot: Slot): string {
    if (!PROFILE_ID.test(profile) || !SLOTS.includes(slot)) throw new Error('bad save id');
    return join(this.dataDir, 'saves', profile, `${slot}.json`);
  }

  /** Run `fn` with exclusive access to `path`. */
  async withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(path) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(path, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(path) === tail) this.locks.delete(path);
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(value, null, 1));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  }

  async remove(path: string): Promise<boolean> {
    try {
      await rm(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      return (await readdir(join(this.dataDir, dir))).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Copy a save file before a migration rewrites it (never lose a player's save). */
  async backup(path: string, suffix: string): Promise<void> {
    const raw = await readFile(path, 'utf8');
    await writeFile(`${path}.${suffix}.bak`, raw);
  }
}
