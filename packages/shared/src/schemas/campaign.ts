import { z } from 'zod';
import { SystemId } from './content.js';

/**
 * The campaign state: one JSON document per save slot (PLAN §3). Only the server changes it, and
 * only through the pure reducers in rules/campaign.ts. Every save carries `version`; migrations in
 * migrations/ upgrade older saves on load.
 */
export const CAMPAIGN_VERSION = 1;

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
});
export type PendingEncounter = z.infer<typeof PendingEncounterSchema>;

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
  | { t: 'relation'; raceId: string; delta: number; reason: string }
  | { t: 'salvageTaken'; count: number }
  | { t: 'won' }
  | { t: 'lost' }
  | { t: 'notice'; text: string };
