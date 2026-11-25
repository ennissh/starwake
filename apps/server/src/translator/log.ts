import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Translator call log (CLAUDE.md §7): one JSONL file per day in /data/logs, rotated after 14 days.
 * Holds prompt hash, model, latency, raw response and validation result. Never goes to stdout.
 */
export interface TranslatorLogEntry {
  kind: 'turn' | 'greeting' | 'summary' | 'advisor';
  raceId?: string;
  advisorId?: string;
  model: string;
  promptHash: string;
  latencyMs: number;
  raw: string | null;
  valid: boolean;
  repaired: boolean;
  error?: string;
  filtered?: string | null;
  applied?: string;
}

export function createTranslatorLog(dataDir: string, now: () => Date = () => new Date(), keepDays = 14) {
  const dir = join(dataDir, 'logs');
  let lastSweep = '';
  const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  async function sweep(today: string): Promise<void> {
    if (lastSweep === today) return;
    lastSweep = today;
    const cutoff = day(new Date(now().getTime() - keepDays * 86_400_000));
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      const m = /^translator-(\d{8})\.jsonl$/.exec(f);
      if (m && m[1]! < cutoff) await unlink(join(dir, f)).catch(() => undefined);
    }
  }

  return {
    dir,
    async write(e: TranslatorLogEntry): Promise<void> {
      const d = now();
      const today = day(d);
      try {
        await mkdir(dir, { recursive: true });
        await appendFile(
          join(dir, `translator-${today}.jsonl`),
          JSON.stringify({ ts: d.toISOString(), ...e }) + '\n',
        );
        await sweep(today);
      } catch {
        /* logging must never break a conversation */
      }
    },
  };
}
export type TranslatorLog = ReturnType<typeof createTranslatorLog>;
