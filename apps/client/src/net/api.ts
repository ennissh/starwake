import { ContentBundleSchema, Health, type ContentBundle } from '@starwake/shared';

/** Typed calls to the Starwake server. Every response is validated with the shared schemas. */
export async function getHealth(): Promise<Health> {
  const r = await fetch('/healthz');
  return Health.parse(await r.json());
}

export async function getContent(): Promise<ContentBundle> {
  const r = await fetch('/api/content');
  if (!r.ok) throw new Error(`content: HTTP ${r.status}`);
  return ContentBundleSchema.parse(await r.json());
}
