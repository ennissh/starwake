import { z } from 'zod';

export const LlmStatus = z.enum(['up', 'down', 'mock', 'off']);
export type LlmStatus = z.infer<typeof LlmStatus>;

export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  gitSha: z.string(),
  builtAt: z.string(),
  llm: LlmStatus,
  model: z.string().nullable(),
});
export type Health = z.infer<typeof Health>;

export const Ready = z.object({
  ready: z.boolean(),
  checks: z.record(z.string(), z.object({ ok: z.boolean(), detail: z.string().optional() })),
});
export type Ready = z.infer<typeof Ready>;

/** Uniform error body for every API error. */
export const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  detail: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
