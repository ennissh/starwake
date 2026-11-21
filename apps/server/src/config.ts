import { z } from 'zod';

/**
 * Server configuration, from the environment (.env written by install.sh on dwarf).
 * No hostnames or IPs are baked in: OLLAMA_URL has no default on purpose (public repo, R6).
 */
const Env = z.object({
  HOST: z.string().default('0.0.0.0'),
  LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().default('/data'),
  CLIENT_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LLM_MODE: z.enum(['ollama', 'mock', 'off']).default('ollama'),
  OLLAMA_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  OLLAMA_MODEL: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  CONTENT_RATING: z.enum(['everyone', 'teen', 'mature', 'adult']).default('mature'),
  STARWAKE_VERSION: z.string().default('dev'),
  STARWAKE_GIT_SHA: z.string().default('unknown'),
  STARWAKE_BUILT_AT: z.string().default('unknown'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
