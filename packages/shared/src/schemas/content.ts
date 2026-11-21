import { z } from 'zod';

/**
 * Content schemas (PLAN §3). Every file in content/ validates against these (a unit test loads them
 * all); game code reads balance numbers only from validated content.
 */
const pos = z.number().positive();

export const FlightStatsSchema = z.object({
  maxSpeed: pos,
  accel: pos,
  pitchRate: pos,
  yawRate: pos,
  rollRate: pos,
  angAccel: pos,
  driftDamping: z.number().min(0).max(5),
});

export const PlayerShipSchema = z.object({
  name: z.string().min(1),
  /** Flight stats with Thrusters at 100% output (M4 scales them by output). */
  flight: FlightStatsSchema,
  /** Fraction of flight stats kept at 0% Thruster output, so a stripped ship can still crawl. */
  flightFloor: z.number().min(0).max(1),
});
export type PlayerShip = z.infer<typeof PlayerShipSchema>;

export const ContentBundleSchema = z.object({
  player: PlayerShipSchema,
});
export type ContentBundle = z.infer<typeof ContentBundleSchema>;

/** Which content file feeds which bundle key. */
export const CONTENT_FILES = {
  player: 'player.json',
} as const satisfies Record<keyof ContentBundle, string>;

/** Validate raw parsed JSON per file into a bundle. Throws with every issue, naming the file. */
export function parseContent(raw: Record<keyof ContentBundle, unknown>): ContentBundle {
  const errors: string[] = [];
  const out: Partial<ContentBundle> = {};
  for (const [key, file] of Object.entries(CONTENT_FILES) as [keyof ContentBundle, string][]) {
    const schema = ContentBundleSchema.shape[key];
    const r = schema.safeParse(raw[key]);
    if (r.success) (out as Record<string, unknown>)[key] = r.data;
    else
      for (const i of r.error.issues) errors.push(`${file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  if (errors.length) throw new Error(`Invalid content:\n  ${errors.join('\n  ')}`);
  return ContentBundleSchema.parse(out);
}
