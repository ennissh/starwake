import { z } from 'zod';
import { SystemId } from './content.js';

/**
 * The campaign state: one JSON document per save slot (PLAN §3). Only the server changes it, and
 * only through the pure reducers in rules/campaign.ts. Every save carries `version`; migrations in
 * migrations/ upgrade older saves on load.
 */
export const CAMPAIGN_VERSION = 2;

const u32 = z.number().int().min(0).max(0xffffffff);
const id = z.string().min(1);

export const InstalledSchema = z.object({
  system: SystemId,
  slot: z.number().int().min(0),
  componentId: id,
  condition: z.number().min(0).max(100),
});

export const HoldEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('component'), componentId: id, condition: z.number().min(0).max(100) }),
  z.object({ type: z.literal('item'), itemId: id, qty: z.number().int().min(1) }),
]);
export type HoldEntry = z.infer<typeof HoldEntrySchema>;

export const PendingEncounterSchema = z.object({
  id: id,
  defId: id,
  seed: z.string(),
  systemId: id,
  /** Where an emergency fold returns to. */
  fromSystemId: id,
  reason: z.enum(['ambush', 'patrol', 'attack']),
  raceId: id,
  /** They hailed first (ambush/patrol): the player may talk or pay before fighting (M5). */
  parley: z.boolean(),
});
export type PendingEncounter = z.infer<typeof PendingEncounterSchema>;

/** A trade: good ids (items, components, `fold-mass`, `permit`, `passage`) and quantities. */
export const GoodQtySchema = z.object({ itemId: id, qty: z.number().int().min(1).max(999) });
export type GoodQty = z.infer<typeof GoodQtySchema>;
export const TradeSchema = z.object({
  playerGives: z.array(GoodQtySchema).max(12),
  raceGives: z.array(GoodQtySchema).max(12),
});
export type Trade = z.infer<typeof TradeSchema>;

/** An open channel with a race (M5). The engine keeps it; the model only sees what it's told. */
export const ConversationSchema = z.object({
  raceId: id,
  context: z.enum(['hail', 'ambush']),
  patience: z.number().int().min(0),
  turns: z.number().int().min(0),
  /** Relation change so far this conversation (capped per PLAN §6.4). */
  delta: z.number(),
  /** The player's offer on the table, and the race's counter. */
  offer: TradeSchema.nullable(),
  counter: TradeSchema.nullable(),
  /** Tribute they demand (goods the player holds). */
  demand: z.array(GoodQtySchema).nullable(),
  /** What the engine refused last turn, told to the model next turn. */
  notes: z.array(z.string()),
  transcript: z.array(
    z.object({
      who: z.enum(['player', 'alien', 'system']),
      text: z.string(),
      mood: z.string().optional(),
      tell: z.boolean().optional(),
      unverified: z.boolean().optional(),
    }),
  ),
  /** The translator fell back to scripted lines (Ollama off or down) during this conversation. */
  degraded: z.boolean(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const LogEntrySchema = z.object({ clock: z.number(), text: z.string() });

export const CampaignStateSchema = z.object({
  version: z.literal(CAMPAIGN_VERSION),
  seed: z.string(),
  rng: z.tuple([u32, u32, u32, u32]),
  /** Caravan Clock, years left. */
  clock: z.number(),
  systemId: id,
  lastSystemId: id,
  fuel: z.number().min(0),
  /** Hull fraction 0..1. */
  hull: z.number().min(0).max(1),
  installed: z.array(InstalledSchema),
  hold: z.array(HoldEntrySchema),
  droneFrames: z.number().int().min(0),
  beacons: z.number().int().min(0),
  claims: z.array(z.object({ systemId: id, planetId: id })),
  relations: z.record(z.string(), z.number()),
  treaties: z.array(z.string()),
  flags: z.array(z.string()),
  codex: z.array(z.string()),
  visits: z.record(
    z.string(),
    z.object({
      count: z.number().int().min(0),
      probedOn: z.number().int().nullable(),
      fights: z.number().int().min(0),
    }),
  ),
  /** Systems the player has probed. */
  known: z.array(id),
  conversationMemory: z.record(z.string(), z.object({ summary: z.string(), lastTurns: z.array(z.string()) })),
  /** Races' tradeable stock once it has changed (absent: the content's starting stock). */
  raceStock: z.record(z.string(), z.record(z.string(), z.number().int().min(0))),
  conversation: ConversationSchema.nullable(),
  pendingEncounter: PendingEncounterSchema.nullable(),
  /** Components recovered from the last fight, waiting for the player to take or leave them. */
  salvageOffer: z.array(id),
  outcome: z.enum(['ongoing', 'won', 'lost']),
  stats: z.object({
    jumps: z.number().int(),
    parsecs: z.number(),
    fights: z.number().int(),
    destroyed: z.record(z.string(), z.number().int()),
    claimsLost: z.number().int(),
    lifeboats: z.number().int(),
    emergencyFolds: z.number().int(),
  }),
  log: z.array(LogEntrySchema),
});
export type CampaignState = z.infer<typeof CampaignStateSchema>;

export const CampaignActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('jump'), to: id }),
  z.object({ type: z.literal('probe') }),
  z.object({ type: z.literal('claim'), planetId: id }),
  z.object({ type: z.literal('dock') }),
  z.object({ type: z.literal('repair') }),
  z.object({ type: z.literal('buy'), componentId: id }),
  z.object({ type: z.literal('takeSalvage'), componentIds: z.array(id) }),
  z.object({ type: z.literal('dropHold'), index: z.number().int().min(0) }),
  z.object({ type: z.literal('attackBase') }),
  z.object({ type: z.literal('signalCaravan') }),
  /** Refuse to talk when they hail you before a fight (M5 parley): the fight starts. */
  z.object({ type: z.literal('fight') }),
  z.object({
    type: z.literal('refit'),
    moves: z
      .array(
        z.object({
          a: z.union([
            z.object({ system: SystemId, slot: z.number().int().min(0) }),
            z.object({ hold: z.number().int().min(0) }),
          ]),
          b: z.union([
            z.object({ system: SystemId, slot: z.number().int().min(0) }),
            z.object({ hold: z.number().int().min(0) }),
          ]),
        }),
      )
      .min(1)
      .max(40),
  }),
]);
export type CampaignAction = z.infer<typeof CampaignActionSchema>;

export type CampaignEvent =
  | { t: 'jumped'; from: string; to: string; parsecs: number; fuel: number; years: number }
  | { t: 'encounter'; reason: PendingEncounter['reason']; defId: string; raceId: string }
  | { t: 'probed'; systemId: string }
  | { t: 'claimed'; planetId: string }
  | { t: 'claimLost'; planetId: string; raceId: string }
  | { t: 'docked' }
  | { t: 'repaired' }
  | { t: 'bought'; componentId: string }
  | { t: 'refitted'; swaps: number; years: number }
  | { t: 'treaty'; raceId: string }
  | { t: 'passage'; raceId: string }
  | { t: 'knowledge'; raceId: string; knowledgeId: string }
  | { t: 'tribute'; raceId: string }
  | { t: 'fightAvoided'; raceId: string }
  | { t: 'traded'; raceId: string }
  | { t: 'channelOpened'; raceId: string }
  | { t: 'channelClosed'; raceId: string }
  | { t: 'crates'; items: { itemId: string; qty: number }[] }
  | { t: 'surveyLog' }
  | { t: 'relation'; raceId: string; delta: number; reason: string }
  | { t: 'salvageTaken'; count: number }
  | { t: 'won' }
  | { t: 'lost' }
  | { t: 'notice'; text: string };
