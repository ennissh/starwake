import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_FILES, type ContentBundle, parseContent } from '../src/schemas/content.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../content');

/** The real content/ files, validated: tests run against the shipped balance numbers. */
export function loadTestContent(): ContentBundle {
  const raw: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(CONTENT_FILES)) raw[key] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  return parseContent(raw as never);
}
