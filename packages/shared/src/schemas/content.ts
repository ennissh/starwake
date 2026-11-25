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
export const COMPONENT_FAMILIES = [
  'coil',
  'capacitor',
  'manifold',
  'navcore',
  'gyro',
  'lens',
  'emitter',
] as const;
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
export const HOSTILE_ACTS = ['claimWithoutPermission', 'destroyShip', 'firstStrike'] as const;
export const HostileAct = z.enum(HOSTILE_ACTS);
export type HostileAct = z.infer<typeof HostileAct>;

/**
 * A tradeable good (M5): an item id, a component id, `fold-mass` (fuel units) or a service:
 * `permit` (claim in their system without offence) and `passage` (their patrols and ambushes let
 * you by). Services grant flags `permit:<race>` / `passage:<race>`.
 */
export const SERVICE_GOODS = ['fold-mass', 'permit', 'passage'] as const;

/** The persona card: everything the LLM is told about how this race speaks and thinks (PLAN §3). */
export const PersonaSchema = z.object({
  voice: z.string().min(1),
  appearance: z.string().min(1),
  values: z.array(z.string()).min(1),
  dislikes: z.array(z.string()),
  taboos: z.array(z.string()),
  speechStyle: z.string().min(1),
  /** What the portrait does when they lie (shown when `deceptive`). */
  tell: z.string().min(1),
  secrets: z.array(z.string()),
  relationsToOthers: z.array(z.object({ raceId: id, stance: z.string(), note: z.string() })),
  /** Stock lines: few-shot examples for the model, and the scripted fallback's whole vocabulary. */
  lines: z.object({
    greet: z.array(z.string()).min(1),
    hostileGreet: z.array(z.string()).min(1),
    farewell: z.array(z.string()).min(1),
    tradeAccept: z.array(z.string()).min(1),
    tradeReject: z.array(z.string()).min(1),
    tradeCounter: z.array(z.string()).min(1),
    treatyAccept: z.array(z.string()).min(1),
    treatyReject: z.array(z.string()).min(1),
    tributeDemand: z.array(z.string()).min(1),
    tributePaid: z.array(z.string()).min(1),
    passage: z.array(z.string()).min(1),
    knowledge: z.array(z.string()).min(1),
    nothingToShare: z.array(z.string()).min(1),
    impatient: z.array(z.string()).min(1),
    insulted: z.array(z.string()).min(1),
    smallTalk: z.array(z.string()).min(1),
    about: z.array(z.string()).min(1),
  }),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const EconomySchema = z.object({
  /** What a good is worth to them, overriding its base value (and the only value of services). */
  values: z.record(z.string(), nonneg),
  /** How much they want it: multiplies what the player gives. Keys: a good id, or `component`. */
  wants: z.record(z.string(), pos),
  /** What they can give, and how much (depletes; kept in the save). */
  stock: z.record(z.string(), z.number().int().min(0)),
  /** Fraction of imbalance (in their favour's absence) they accept at relation 0. */
  baseTolerance: z.number().min(0).max(1),
  /** Extra tolerance per relation point (negative relation shrinks it). */
  tolerancePerRelation: z.number().min(0).max(0.02),
  /** A fair trade nudges relation by this much. */
  tradeRelation: z.number().int().min(0).max(8),
});
export type Economy = z.infer<typeof EconomySchema>;

export const KnowledgeSchema = z.object({
  id,
  /** What they tell you (the model paraphrases; the codex stores this). */
  text: z.string().min(1),
  codexTitle: z.string().min(1),
  minRelation: z.number().min(-100).max(100),
  requiresFlags: z.array(z.string()).default([]),
  grantsFlag: z.string().optional(),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const RaceSchema = z.object({
  id,
  name: z.string(),
  palette: z.object({ hull: color, trim: color, glow: color, accent: color }),
  summary: z.string(),
  /** Seeds the race's procedural leitmotif (M6). */
  leitmotifSeed: z.number().int().min(0),
  persona: PersonaSchema,
  economy: EconomySchema,
  knowledge: z.array(KnowledgeSchema),
  /** Deterministic relation and diplomacy rules (PLAN §3, §6.4). */
  diplomacy: z.object({
    startRelation: z.number().min(-100).max(100),
    hostileActs: z.array(z.object({ act: HostileAct, delta: z.number().int().min(-50).max(0) })),
    /** Turns per conversation before they end it. */
    patienceTurns: z.number().int().min(1).max(30),
    /** Relation change when patience runs out. */
    impatienceDelta: z.number().int().min(-20).max(0),
    treatyThreshold: z.number().min(-100).max(100),
    /** Any one of these flags is required for a treaty (empty: none needed). */
    treatyRequiresAny: z.array(z.string()),
    /** Relation set to at least this when a treaty is signed. */
    treatyRelationFloor: z.number().min(-100).max(100),
    /** Lowest relation at which they grant passage. */
    passageMinRelation: z.number().min(-100).max(100),
    /** They demand tribute (on ambush, or when hailed) while relation is below this. Null: never. */
    tribute: z
      .object({
        belowRelation: z.number().min(-100).max(100),
        /** Value (in their terms) a tribute must reach. */
        value: pos,
        relationGain: z.number().int().min(0).max(30),
        grantsFlag: z.string(),
      })
      .nullable(),
    /** May threaten or declare hostility while relation is at or below this. */
    threatenAtOrBelow: z.number().min(-100).max(100),
    /** When they suspect the player lied: relation changes for them and for those they tell. */
    onDeception: z.array(z.object({ raceId: id, delta: z.number().int().min(-20).max(0) })),
    /** Winning a fight against them sets this flag (e.g. respect for strength). */
    victoryFlag: z.string().optional(),
  }),
});
export type Race = z.infer<typeof RaceSchema>;

// ---------------------------------------------------------------------------------- cluster
export const RESOURCE_KINDS = ['ice', 'biomass', 'ore', 'isotopes'] as const;
export const ResourceKind = z.enum(RESOURCE_KINDS);
export type ResourceKind = z.infer<typeof ResourceKind>;

export const PlanetSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['rock', 'ice', 'gas', 'ocean', 'jungle', 'desert']),
  tempK: pos,
  atmosphere: z.string(),
  resources: z.array(
    z.object({ kind: ResourceKind, yield: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  ),
  habitable: z.boolean(),
});
export type Planet = z.infer<typeof PlanetSchema>;

export const SystemSchema = z.object({
  id,
  name: z.string(),
  /** Parsecs. */
  position: vec,
  starType: z.string(),
  starColor: color,
  tint: color,
  description: z.string(),
  occupant: id.optional(),
  station: z.literal('waystation').optional(),
  /** The occupant's base, attackable as this encounter. */
  baseEncounter: id.optional(),
  planets: z.array(PlanetSchema),
  /** Hostile patrols that may jump you on arrival, and raid beacons here. */
  patrols: z.array(z.object({ raceId: id, encounterId: id, chance: z.number().min(0).max(1) })),
});
export type StarSystem = z.infer<typeof SystemSchema>;

export const LaneSchema = z.object({
  a: id,
  b: id,
  ambush: z.object({ raceId: id, encounterId: id, chance: z.number().min(0).max(1) }).optional(),
});
export type Lane = z.infer<typeof LaneSchema>;

export const ItemSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  /** Units per hold slot. */
  stack: z.number().int().min(1),
  /** Raw-material crates: the resource a claimed world of this kind ships as cargo (M5). */
  resource: ResourceKind.optional(),
  baseValue: pos,
});
export type Item = z.infer<typeof ItemSchema>;

/** Campaign balance (PLAN §1.2, §1.7). Every number the campaign rules use lives here. */
export const RulesSchema = z.object({
  clock: z.object({
    startYears: pos,
    jumpYearsPerParsec: nonneg,
    refitYears: nonneg,
    lifeboatYears: nonneg,
    repairYears: nonneg,
    swapYears: nonneg,
  }),
  fuel: z.object({
    capacity: pos,
    start: nonneg,
    perParsec: pos,
    minFoldOutput: z.number().min(0.01).max(1),
  }),
  range: z.object({ baseParsecs: nonneg, parsecsPerNavOutput: nonneg }),
  start: z.object({
    systemId: id,
    beacons: z.number().int().min(0),
    dataCores: z.number().int().min(0),
    hold: z.number().int().min(1),
  }),
  waystation: z.object({
    provenderPerDock: z.number().int().min(0),
    sells: z.array(z.object({ componentId: id, price: z.number().int().min(0) })),
  }),
  repairInPlaceHull: z.number().min(0).max(1),
  emergencyFoldHull: z.number().min(0).max(1),
  salvage: z.object({ diminishPerFight: z.number().min(0).max(1) }),
  beaconRaidChance: z.number().min(0).max(1),
  relations: z.object({ hostile: z.number(), wary: z.number(), friendly: z.number(), allied: z.number() }),
  readiness: z.object({
    quotas: z.record(ResourceKind, z.number().int().min(0)),
    safetyHops: z.number().int().min(0),
  }),
  /** Trade and conversation (M5, PLAN §6.4). */
  diplomacy: z.object({
    /** What one unit of fold mass is worth when a race doesn't say. */
    foldMassValue: pos,
    /** Crates a claimed world ships per point of yield, each time you arrive in its system. */
    cratesPerYield: z.number().int().min(0),
    relationPerTurnMax: z.number().int().min(1).max(20),
    relationPerConversationMax: z.number().int().min(1).max(50),
    /** Chance the player sees a race's tell when it lies (translator quality; fixed in the MVP). */
    tellChance: z.number().min(0).max(1),
    /** Turns of conversation memory kept per race. */
    memoryTurns: z.number().int().min(0).max(40),
  }),
});
export type Rules = z.infer<typeof RulesSchema>;

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
const EffectSchema = z.object({ at0: z.number().positive(), at1: z.number().positive() });
export type Effect = z.infer<typeof EffectSchema>;

export const PlayerShipSchema = z.object({
  name: z.string().min(1),
  /** Flight stats with Thrusters at 100% output (M4 scales them by output). */
  flight: FlightStatsSchema,
  /**
   * Component effects (M4): each multiplier is at0 + (at1 − at0) × system output, where output is
   * 0 (empty) to 1 (a full Mk III set). Tuned so the starting loadout lands near 1.0.
   */
  effects: z.object({
    thrusters: EffectSchema,
    lanceDamage: EffectSchema,
    lanceRecharge: EffectSchema,
    turretRate: EffectSchema,
    turretTracking: EffectSchema,
    shieldCapacity: EffectSchema,
    shieldRecharge: EffectSchema,
  }),
  hp: pos,
  /** WAKE's aim error (degrees) when it crews the turret; manual aim has none. */
  wakeTurretSpread: nonneg,
  /** Hit spheres along the spine, ship-local units (forward is -z). */
  hitSpheres: z.array(z.object({ offset: vec, radius: pos })).min(1),
  shields: z.object({ fore: nonneg, aft: nonneg, rechargePerS: nonneg, rechargeDelayS: nonneg }),
  lance: z.object({
    weapon: id,
    muzzle: vec,
    /** The beam bends onto the target when the nose is within this many degrees of it. */
    assistConeDeg: z.number().min(0).max(30),
  }),
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
/** Advisors (playtest batch 1, #3): WAKE and the bridge council answer the player's questions. */
export const ADVISOR_DYNAMICS = [
  'nextSteps',
  'readiness',
  'clock',
  'route',
  'claims',
  'fuel',
  'repair',
  'trade',
  'beacons',
  'threats',
] as const;
export type AdvisorDynamic = (typeof ADVISOR_DYNAMICS)[number];
const AdvisorSchema = z.object({
  id,
  name: z.string().min(1),
  role: z.string().min(1),
  greeting: z.string().min(1),
  /** Said when no topic matches: a miss beats a wrong answer. */
  miss: z.string().min(1),
  suggestions: z.array(z.string().min(1)).min(1).max(6),
});
const AdvisorTopicSchema = z
  .object({
    id,
    advisor: id,
    /** Lower-case words or phrases; a match scores its word count. */
    keywords: z.array(z.string().min(1)).min(1),
    /** Generic words that only tip a tie (half weight). */
    weak: z.array(z.string().min(1)).optional(),
    /** Fixed answer; `{key:<action>}` is replaced by the player's binding on the client. */
    answer: z.string().min(1).optional(),
    /** Or an answer built from the campaign state. */
    dynamic: z.enum(ADVISOR_DYNAMICS).optional(),
  })
  .refine((t) => !!t.answer !== !!t.dynamic, 'a topic has exactly one of answer or dynamic');
export const AdvisorsSchema = z.object({
  advisors: z.array(AdvisorSchema).min(1),
  topics: z.array(AdvisorTopicSchema).min(1),
});
export type Advisors = z.infer<typeof AdvisorsSchema>;
export type AdvisorTopic = z.infer<typeof AdvisorTopicSchema>;

/** Hashed word lists for the translator's output post-filter (scripts/gen-filters.mjs). */
export const FiltersSchema = z.object({
  note: z.string(),
  cleanroom: z.array(z.string()),
  never: z.array(z.string()),
  strong: z.array(z.string()),
  crude: z.array(z.string()),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const ContentBundleSchema = z.object({
  player: PlayerShipSchema,
  components: z.array(ComponentSchema),
  weapons: z.array(WeaponSchema),
  hulls: z.array(HullSchema),
  drones: z.array(DroneSchema),
  races: z.array(RaceSchema),
  encounters: z.array(EncounterDefSchema),
  systems: z.array(SystemSchema),
  lanes: z.array(LaneSchema),
  items: z.array(ItemSchema),
  rules: RulesSchema,
  advisors: AdvisorsSchema,
  filters: FiltersSchema,
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
  systems: 'systems.json',
  lanes: 'lanes.json',
  items: 'items.json',
  rules: 'rules.json',
  advisors: 'advisors.json',
  filters: 'filters.json',
} as const satisfies Record<keyof ContentBundle, string>;

/** Validate raw parsed JSON per file into a bundle, then cross-check ids. Throws listing every issue. */
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
  const need = (set: Set<string>, v: string | undefined, where: string) => {
    if (v !== undefined && !set.has(v)) errs.push(`${where}: unknown id ${v}`);
  };
  const comps = ids(c.components, 'components.json');
  const weapons = ids(c.weapons, 'weapons.json');
  const hulls = ids(c.hulls, 'hulls.json');
  const races = ids(c.races, 'races.json');
  ids(c.drones, 'drones.json');
  const encs = ids(c.encounters, 'encounters.json');
  const systems = ids(c.systems, 'systems.json');
  ids(c.items, 'items.json');
  for (const it of c.items)
    if (comps.has(it.id)) errs.push(`items.json: ${it.id} clashes with a component id`);
  const planetIds = new Set<string>();
  for (const s of c.systems) {
    need(races, s.occupant, `systems.json ${s.id}.occupant`);
    need(encs, s.baseEncounter, `systems.json ${s.id}.baseEncounter`);
    for (const p of s.patrols) {
      need(races, p.raceId, `systems.json ${s.id}.patrols`);
      need(encs, p.encounterId, `systems.json ${s.id}.patrols`);
    }
    for (const p of s.planets) {
      if (planetIds.has(p.id)) errs.push(`systems.json: duplicate planet id ${p.id}`);
      planetIds.add(p.id);
    }
  }
  for (const l of c.lanes) {
    need(systems, l.a, 'lanes.json a');
    need(systems, l.b, 'lanes.json b');
    if (l.a === l.b) errs.push(`lanes.json: ${l.a} lanes to itself`);
    if (l.ambush) {
      need(races, l.ambush.raceId, `lanes.json ${l.a}-${l.b}.ambush`);
      need(encs, l.ambush.encounterId, `lanes.json ${l.a}-${l.b}.ambush`);
    }
  }
  need(systems, c.rules.start.systemId, 'rules.json start.systemId');
  for (const s of c.rules.waystation.sells) need(comps, s.componentId, 'rules.json waystation.sells');
  // M5: race economies name real goods; services have a value; knowledge ids are unique.
  const itemIds = new Set(c.items.map((i) => i.id));
  const isGood = (g: string) =>
    itemIds.has(g) || comps.has(g) || (SERVICE_GOODS as readonly string[]).includes(g);
  const knowledgeIds = new Set<string>();
  for (const r of c.races) {
    const e = r.economy;
    for (const g of [...Object.keys(e.values), ...Object.keys(e.stock)])
      if (!isGood(g)) errs.push(`races.json ${r.id}: unknown good ${g}`);
    for (const g of Object.keys(e.wants))
      if (g !== 'component' && !isGood(g)) errs.push(`races.json ${r.id} wants: unknown good ${g}`);
    for (const g of ['permit', 'passage'])
      if (e.values[g] === undefined) errs.push(`races.json ${r.id}: economy.values.${g} is required`);
    for (const k of r.knowledge) {
      if (knowledgeIds.has(k.id)) errs.push(`races.json: duplicate knowledge id ${k.id}`);
      knowledgeIds.add(k.id);
    }
    for (const o of r.diplomacy.onDeception) need(races, o.raceId, `races.json ${r.id} onDeception`);
  }
  for (const k of ['ice', 'biomass', 'ore', 'isotopes'] as const)
    if (!c.items.some((i) => i.resource === k)) errs.push(`items.json: no crate item for resource ${k}`);
  const advisors = ids(c.advisors.advisors, 'advisors.json advisors');
  ids(c.advisors.topics, 'advisors.json topics');
  for (const t of c.advisors.topics) need(advisors, t.advisor, `advisors.json topic ${t.id}`);
  for (const a of c.advisors.advisors)
    if (!c.advisors.topics.some((t) => t.advisor === a.id)) errs.push(`advisors.json: ${a.id} has no topics`);
  if (!advisors.has('wake')) errs.push('advisors.json: WAKE (id "wake") is required');
  if (!c.systems.some((s) => s.planets.some((p) => p.habitable)))
    errs.push('systems.json: no habitable planet (no Cradle possible)');
  for (const h of c.hulls) {
    need(races, h.raceId, `hulls.json ${h.id}.raceId`);
    for (const w of h.weapons) need(weapons, w.weapon, `hulls.json ${h.id}.weapons`);
    for (const s of h.subsystems) need(weapons, s.weapon, `hulls.json ${h.id}.subsystems.${s.id}`);
    for (const t of h.salvage.table) need(comps, t.componentId, `hulls.json ${h.id}.salvage`);
    if (h.class !== 'base' && !h.flight) errs.push(`hulls.json ${h.id}: only bases may have no flight stats`);
  }
  for (const d of c.drones) need(weapons, d.weapon, `drones.json ${d.id}.weapon`);
  for (const e of c.encounters)
    for (const h of [...e.roster.hulls, ...e.roster.reserve]) need(hulls, h, `encounters.json ${e.id}`);
  need(weapons, c.player.lance.weapon, 'player.json lance.weapon');
  need(weapons, c.player.turret.weapon, 'player.json turret.weapon');
  const byId = new Map(c.components.map((x) => [x.id, x]));
  for (const sys of Object.keys(c.player.systems) as SystemId[]) {
    const def = c.player.systems[sys];
    const slots = c.player.loadout[sys] ?? [];
    if (slots.length !== def.slots)
      errs.push(`player.json loadout.${sys}: needs ${def.slots} slots, has ${slots.length}`);
    for (const cid of slots) {
      if (cid === null) continue;
      const comp = byId.get(cid);
      if (!comp) errs.push(`player.json loadout.${sys}: unknown component ${cid}`);
      else if (!def.accepts.includes(comp.family))
        errs.push(`player.json loadout.${sys}: ${cid} (${comp.family}) not accepted`);
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
