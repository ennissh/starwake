import { z } from 'zod';

/**
 * Content schemas (PLAN §3). Every file in content/ validates against these (a unit test loads them
 * all, and cross-checks ids); game code reads balance numbers only from validated content.
 */
const pos = z.number().positive();
const nonneg = z.number().min(0);
const id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'ids are lowercase-kebab');
const vec = z.object({ x: z.number(), y: z.number(), z: z.number() });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const FlightStatsSchema = z.object({
  maxSpeed: pos,
  accel: pos,
  pitchRate: pos,
  yawRate: pos,
  rollRate: pos,
  angAccel: pos,
  driftDamping: z.number().min(0).max(5),
});

// ---------------------------------------------------------------------------------- components
export const COMPONENT_FAMILIES = ['coil', 'capacitor', 'manifold', 'navcore', 'gyro', 'lens', 'emitter'] as const;
export const ComponentFamily = z.enum(COMPONENT_FAMILIES);
export type ComponentFamily = z.infer<typeof ComponentFamily>;

export const ComponentSchema = z.object({
  id,
  name: z.string().min(1),
  family: ComponentFamily,
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Output contributed to a system at 100% condition. */
  output: pos,
  baseValue: pos,
});
export type Component = z.infer<typeof ComponentSchema>;

export const SYSTEM_IDS = ['fold', 'thrusters', 'lance', 'turret', 'foreShield', 'aftShield'] as const;
export const SystemId = z.enum(SYSTEM_IDS);
export type SystemId = z.infer<typeof SystemId>;

export const ShipSystemSchema = z.object({
  name: z.string(),
  slots: z.number().int().min(1).max(6),
  accepts: z.array(ComponentFamily).min(1),
  /** Sum of slot outputs that counts as 100%. */
  maxOutput: pos,
});

// ---------------------------------------------------------------------------------- weapons
export const WeaponSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['bolt', 'beam']),
  damage: pos,
  penetration: z.number().int().min(0).max(3),
  /** Units (bolt range or beam length). */
  range: pos,
  /** Seconds between shots (beam: recharge time). */
  cooldown: pos,
  /** Bolt speed, units/s (ignored for beams). */
  speed: pos,
  /** Firing arc half-angle in degrees from the mount's forward; 180 = any direction. */
  arc: z.number().min(1).max(180),
  /** Aim error in degrees (enemies only). */
  spread: nonneg.default(0),
});
export type Weapon = z.infer<typeof WeaponSchema>;

// ---------------------------------------------------------------------------------- hulls
export const HULL_CLASSES = ['fighter', 'frigate', 'capital', 'base'] as const;
export const HullClass = z.enum(HULL_CLASSES);
export type HullClass = z.infer<typeof HullClass>;

export const SubsystemSchema = z.object({
  id,
  kind: z.enum(['emitter', 'turret', 'engine']),
  offset: vec,
  radius: pos,
  hp: pos,
  armor: z.number().int().min(0).max(2),
  /** A turret subsystem's weapon. */
  weapon: id.optional(),
});
export type Subsystem = z.infer<typeof SubsystemSchema>;

export const HullSchema = z.object({
  id,
  name: z.string(),
  raceId: id,
  class: HullClass,
  /** Damage applies only if a weapon's penetration >= armor (PLAN §1.5). */
  armor: z.number().int().min(0).max(2),
  hp: pos,
  /** Collision/hit radius, units. */
  radius: pos,
  flight: FlightStatsSchema.nullable(),
  /** Hull-mounted weapons (fighters, frigates); turret subsystems carry their own. */
  weapons: z.array(z.object({ weapon: id, offset: vec })),
  subsystems: z.array(SubsystemSchema),
  salvage: z.object({
    /** Number of rolls on the table when destroyed. */
    rolls: z.number().int().min(0).max(5),
    chance: z.number().min(0).max(1),
    table: z.array(z.object({ componentId: id, weight: pos })),
  }),
  /** Base hulls launch reserve fighters this often (seconds); finite reserves, no infinite respawn. */
  launchInterval: pos.optional(),
  meshId: id,
});
export type Hull = z.infer<typeof HullSchema>;

export const DroneSchema = z.object({
  id: z.enum(['hornet', 'lance', 'ram']),
  name: z.string(),
  hp: pos,
  armor: z.number().int().min(0).max(2),
  radius: pos,
  flight: FlightStatsSchema,
  /** Hornet gun, or the warhead of a one-use drone. */
  weapon: id,
  oneUse: z.boolean(),
  /** One-use drones detonate within this distance of their target. */
  proximity: nonneg,
  /** Seconds a one-use drone flies before it self-destructs. */
  life: pos,
});
export type Drone = z.infer<typeof DroneSchema>;

// ---------------------------------------------------------------------------------- races
export const RaceSchema = z.object({
  id,
  name: z.string(),
  palette: z.object({ hull: color, trim: color, glow: color, accent: color }),
  summary: z.string(),
});
export type Race = z.infer<typeof RaceSchema>;

// ---------------------------------------------------------------------------------- encounters
export const RosterSchema = z.object({
  /** Hostiles present at the start, by hull id. */
  hulls: z.array(id).min(1),
  /** Held back: released by "call for help" or a base's launch bay. */
  reserve: z.array(id),
});
export type Roster = z.infer<typeof RosterSchema>;

export const EncounterDefSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  roster: RosterSchema,
  /** Where the hostiles start relative to the player, units. */
  distance: pos,
});
export type EncounterDef = z.infer<typeof EncounterDefSchema>;

// ---------------------------------------------------------------------------------- player ship
export const PlayerShipSchema = z.object({
  name: z.string().min(1),
  /** Flight stats with Thrusters at 100% output (M4 scales them by output). */
  flight: FlightStatsSchema,
  /** Fraction of flight stats kept at 0% Thruster output, so a stripped ship can still crawl. */
  flightFloor: z.number().min(0).max(1),
  hp: pos,
  /** WAKE's aim error (degrees) when it crews the turret; manual aim has none. */
  wakeTurretSpread: nonneg,
  /** Hit spheres along the spine, ship-local units (forward is -z). */
  hitSpheres: z.array(z.object({ offset: vec, radius: pos })).min(1),
  shields: z.object({ fore: nonneg, aft: nonneg, rechargePerS: nonneg, rechargeDelayS: nonneg }),
  lance: z.object({ weapon: id, muzzle: vec }),
  turret: z.object({ weapon: id, mount: vec }),
  droneBay: z.object({ frames: z.number().int().min(0), maxActive: z.number().int().min(1), mount: vec }),
  /** Condition points (0–100) lost by a random installed component per point of hull damage. */
  wearPerHullHp: nonneg,
  /** Emergency fold loses this many random installed components. */
  emergencyFoldLoses: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  systems: z.record(SystemId, ShipSystemSchema),
  /** Starting loadout: component id or null per slot. */
  loadout: z.record(SystemId, z.array(id.nullable())),
});
export type PlayerShip = z.infer<typeof PlayerShipSchema>;

// ---------------------------------------------------------------------------------- bundle
export const ContentBundleSchema = z.object({
  player: PlayerShipSchema,
  components: z.array(ComponentSchema),
  weapons: z.array(WeaponSchema),
  hulls: z.array(HullSchema),
  drones: z.array(DroneSchema),
  races: z.array(RaceSchema),
  encounters: z.array(EncounterDefSchema),
});
export type ContentBundle = z.infer<typeof ContentBundleSchema>;

/** Which content file feeds which bundle key. */
export const CONTENT_FILES = {
  player: 'player.json',
  components: 'components.json',
  weapons: 'weapons.json',
  hulls: 'hulls.json',
  drones: 'drones.json',
  races: 'races.json',
  encounters: 'encounters.json',
} as const satisfies Record<keyof ContentBundle, string>;

/** Validate raw parsed JSON per file into a bundle, then cross-check ids. Throws listing every issue. */
export function parseContent(raw: Record<keyof ContentBundle, unknown>): ContentBundle {
  const errors: string[] = [];
  const out: Partial<ContentBundle> = {};
  for (const [key, file] of Object.entries(CONTENT_FILES) as [keyof ContentBundle, string][]) {
    const schema = ContentBundleSchema.shape[key];
    const r = schema.safeParse(raw[key]);
    if (r.success) (out as Record<string, unknown>)[key] = r.data;
    else for (const i of r.error.issues) errors.push(`${file}: ${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  if (errors.length) throw new Error(`Invalid content:\n  ${errors.join('\n  ')}`);
  const bundle = ContentBundleSchema.parse(out);
  const refErrors = crossCheck(bundle);
  if (refErrors.length) throw new Error(`Invalid content references:\n  ${refErrors.join('\n  ')}`);
  return bundle;
}

function crossCheck(c: ContentBundle): string[] {
  const errs: string[] = [];
  const ids = <T extends { id: string }>(xs: T[], file: string): Set<string> => {
    const s = new Set<string>();
    for (const x of xs) {
      if (s.has(x.id)) errs.push(`${file}: duplicate id ${x.id}`);
      s.add(x.id);
    }
    return s;
  };
  const comps = ids(c.components, 'components.json');
  const weapons = ids(c.weapons, 'weapons.json');
  const hulls = ids(c.hulls, 'hulls.json');
  const races = ids(c.races, 'races.json');
  ids(c.drones, 'drones.json');
  ids(c.encounters, 'encounters.json');
  const need = (set: Set<string>, v: string | undefined, where: string) => {
    if (v !== undefined && !set.has(v)) errs.push(`${where}: unknown id ${v}`);
  };
  for (const h of c.hulls) {
    need(races, h.raceId, `hulls.json ${h.id}.raceId`);
    for (const w of h.weapons) need(weapons, w.weapon, `hulls.json ${h.id}.weapons`);
    for (const s of h.subsystems) need(weapons, s.weapon, `hulls.json ${h.id}.subsystems.${s.id}`);
    for (const t of h.salvage.table) need(comps, t.componentId, `hulls.json ${h.id}.salvage`);
    if (h.class !== 'base' && !h.flight) errs.push(`hulls.json ${h.id}: only bases may have no flight stats`);
  }
  for (const d of c.drones) need(weapons, d.weapon, `drones.json ${d.id}.weapon`);
  for (const e of c.encounters) for (const h of [...e.roster.hulls, ...e.roster.reserve]) need(hulls, h, `encounters.json ${e.id}`);
  need(weapons, c.player.lance.weapon, 'player.json lance.weapon');
  need(weapons, c.player.turret.weapon, 'player.json turret.weapon');
  const byId = new Map(c.components.map((x) => [x.id, x]));
  for (const sys of Object.keys(c.player.systems) as SystemId[]) {
    const def = c.player.systems[sys];
    const slots = c.player.loadout[sys] ?? [];
    if (slots.length !== def.slots) errs.push(`player.json loadout.${sys}: needs ${def.slots} slots, has ${slots.length}`);
    for (const cid of slots) {
      if (cid === null) continue;
      const comp = byId.get(cid);
      if (!comp) errs.push(`player.json loadout.${sys}: unknown component ${cid}`);
      else if (!def.accepts.includes(comp.family)) errs.push(`player.json loadout.${sys}: ${cid} (${comp.family}) not accepted`);
    }
  }
  for (const s of SYSTEM_IDS) if (!c.player.systems[s]) errs.push(`player.json systems: missing ${s}`);
  const fl = c.player.emergencyFoldLoses;
  if (fl.min > fl.max) errs.push('player.json emergencyFoldLoses: min > max');
  return errs;
}

/** Lookup helpers. */
export function byId<T extends { id: string }>(xs: readonly T[], idv: string): T {
  const x = xs.find((i) => i.id === idv);
  if (!x) throw new Error(`unknown id ${idv}`);
  return x;
}
