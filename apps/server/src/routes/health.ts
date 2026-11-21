import { access, constants, mkdir } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Health, Ready } from '@starwake/shared';
import type { Config } from '../config.js';
import type { LlmProbe } from '../llm/ollama.js';

export function healthRoutes(
  app: FastifyInstance,
  cfg: Config,
  llm: LlmProbe,
  content: { systems: unknown[] },
): void {
  // Liveness: no dependencies may fail it (Ollama down is reported, not fatal).
  app.get('/healthz', async (): Promise<Health> => {
    return {
      ok: true,
      version: cfg.STARWAKE_VERSION,
      gitSha: cfg.STARWAKE_GIT_SHA,
      builtAt: cfg.STARWAKE_BUILT_AT,
      llm: await llm.status(),
      model: cfg.LLM_MODE === 'ollama' ? (cfg.OLLAMA_MODEL ?? null) : null,
    };
  });

  // Readiness: the things the game needs to serve a player.
  app.get('/readyz', async (_req, reply) => {
    // Content was validated at start (the server refuses to start without it); report it here too.
    const checks: Ready['checks'] = { content: { ok: content.systems.length > 0 } };
    try {
      await mkdir(cfg.DATA_DIR, { recursive: true });
      await access(cfg.DATA_DIR, constants.W_OK);
      checks.dataDir = { ok: true };
    } catch (err) {
      checks.dataDir = {
        ok: false,
        detail: `${cfg.DATA_DIR} not writable by uid ${process.getuid?.()}: ${(err as Error).message}`,
      };
    }
    const ready = Object.values(checks).every((c) => c.ok);
    const body: Ready = { ready, checks };
    return reply.code(ready ? 200 : 503).send(body);
  });
}
