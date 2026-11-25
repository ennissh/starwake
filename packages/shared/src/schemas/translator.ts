import { z } from 'zod';
import { GoodQtySchema, TradeSchema } from './campaign.js';

/**
 * The translator contract (PLAN §6.3). The model returns exactly one AlienTurn per player turn;
 * the engine validates its intent (apps/server/src/translator/validate.ts) and applies only what
 * the rules allow. The JSON schema handed to Ollama is generated from this zod schema.
 */
export const MOODS = ['neutral', 'pleased', 'amused', 'annoyed', 'angry', 'afraid', 'scheming'] as const;
export type Mood = (typeof MOODS)[number];

export const INTENTS = [
  'none',
  'offer_trade',
  'counter_trade',
  'accept_trade',
  'reject_trade',
  'propose_treaty',
  'accept_treaty',
  'reject_treaty',
  'demand_tribute',
  'threaten',
  'declare_hostility',
  'share_knowledge',
  'grant_passage',
  'end_conversation',
] as const;
export type IntentType = (typeof INTENTS)[number];

export const AlienTurnSchema = z.object({
  say: z.string().min(1).max(600),
  mood: z.enum(MOODS),
  deceptive: z.boolean(),
  relationDelta: z.number().int().min(-8).max(8),
  relationReason: z.string().max(160),
  /** R11: the model thinks the player is lying to them. */
  playerDeceptionSuspected: z.boolean(),
  intent: z.object({
    type: z.enum(INTENTS),
    trade: TradeSchema.optional(),
    tribute: z.array(GoodQtySchema).max(8).optional(),
    knowledgeId: z.string().max(64).optional(),
  }),
});
export type AlienTurn = z.infer<typeof AlienTurnSchema>;

/** What the player does on a turn: free speech, or a structured move from the chips and panels. */
export const PlayerMoveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal('offer'), trade: TradeSchema }),
  /** Accept the race's counter-offer as it stands. */
  z.object({ type: z.literal('acceptCounter') }),
  z.object({ type: z.literal('askTreaty') }),
  z.object({ type: z.literal('askPassage') }),
  z.object({ type: z.literal('askKnowledge') }),
  z.object({ type: z.literal('about') }),
  z.object({ type: z.literal('payTribute') }),
  z.object({ type: z.literal('leave') }),
]);
export type PlayerMove = z.infer<typeof PlayerMoveSchema>;

/** One advisor reply from the model (advisors' misses only; read-only). */
export const AdvisorTurnSchema = z.object({ say: z.string().min(1).max(700) });
