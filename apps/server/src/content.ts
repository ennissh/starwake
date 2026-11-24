import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_FILES, parseContent, type ContentBundle } from '@starwake/shared';

export function defaultContentDir(): string {
  // apps/server/{src,dist} → repo root /content (the image copies it to /app/content).
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../content');
}

/** Read and validate every content file. Throws (naming file and path) on any problem. */
export async function loadContent(dir: string): Promise<ContentBundle> {
  const raw: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(CONTENT_FILES)) {
    const path = join(dir, file);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      throw new Error(`content file missing: ${path} (${(err as Error).message})`, { cause: err });
    }
    try {
      raw[key] = JSON.parse(text);
    } catch (err) {
      throw new Error(`content file is not valid JSON: ${path} (${(err as Error).message})`, { cause: err });
    }
  }
  return parseContent(raw as Record<keyof ContentBundle, unknown>);
}
