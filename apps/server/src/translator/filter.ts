import { createHash } from 'node:crypto';
import type { Filters } from '@starwake/shared';
import type { Config } from '../config.js';

/**
 * Output post-filter (PLAN §6.5): the alien's line is checked word by word (and two-word phrases)
 * against hashed lists: clean-room terms and AI talk always, then by CONTENT_RATING. A hit means
 * one repair retry, then a fallback line. Hashing keeps the lists out of shipped content.
 */
const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 24);

export type FilterHit = 'cleanroom' | 'never' | 'strong' | 'crude';

export function createFilter(f: Filters, rating: Config['CONTENT_RATING']) {
  const sets: [FilterHit, Set<string>][] = [
    ['cleanroom', new Set(f.cleanroom)],
    ['never', new Set(f.never)],
  ];
  if (rating === 'everyone' || rating === 'teen') sets.push(['strong', new Set(f.strong)]);
  if (rating !== 'adult') sets.push(['crude', new Set(f.crude)]);
  return {
    /** The first list a text hits, or null when it's clean. */
    check(text: string): FilterHit | null {
      const words = text
        .toLowerCase()
        .replace(/[’']/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const grams = [...words];
      for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
      for (let i = 0; i + 2 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      const hs = grams.map(hash);
      for (const [name, set] of sets) if (hs.some((h) => set.has(h))) return name;
      return null;
    },
  };
}
export type OutputFilter = ReturnType<typeof createFilter>;
