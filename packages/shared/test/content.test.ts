import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_FILES, parseContent } from '../src/schemas/content.js';

const contentDir = join(dirname(fileURLToPath(import.meta.url)), '../../../content');

function loadAll(): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(CONTENT_FILES)) {
    raw[key] = JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
  }
  return raw;
}

describe('content/', () => {
  it('every content file validates', () => {
    expect(() => parseContent(loadAll() as never)).not.toThrow();
  });

  it('every JSON file in content/ is known to the loader', () => {
    const known = new Set<string>(Object.values(CONTENT_FILES));
    const files = readdirSync(contentDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.json'));
    for (const f of files) expect(known, `content/${f} is not loaded by anything`).toContain(f);
  });

  it('reports the file and path of a bad value', () => {
    const raw = loadAll();
    (raw.player as { flight: { maxSpeed: number } }).flight.maxSpeed = -1;
    expect(() => parseContent(raw as never)).toThrow(/player\.json: flight\.maxSpeed/);
  });
});
