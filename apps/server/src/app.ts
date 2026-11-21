import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ApiError } from '@starwake/shared';
import type { Config } from './config.js';
import { createLlmProbe, type LlmProbe } from './llm/ollama.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  llm?: LlmProbe;
}

function defaultClientDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../client/dist');
}

export async function buildApp(cfg: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: cfg.LOG_LEVEL },
    // Per-request lines are noise for a one-player LAN game; decisions are logged explicitly.
    logController: new LogController({ disableRequestLogging: true }),
  });
  const llm = deps.llm ?? createLlmProbe(cfg, app.log);

  app.setErrorHandler(
    (err: Error & { statusCode?: number; code?: string; validation?: unknown }, _req, reply) => {
      const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
      if (status >= 500) app.log.error({ err }, 'request failed');
      const body: ApiError = {
        error: status >= 500 ? 'Internal error' : err.message,
        code: err.code ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        ...(err.validation ? { detail: err.validation } : {}),
      };
      return reply.code(status).send(body);
    },
  );

  healthRoutes(app, cfg, llm);

  app.get('/api/version', async () => ({
    version: cfg.STARWAKE_VERSION,
    gitSha: cfg.STARWAKE_GIT_SHA,
    builtAt: cfg.STARWAKE_BUILT_AT,
  }));

  const clientDir = cfg.CLIENT_DIR ?? defaultClientDir();
  if (existsSync(join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: clientDir,
      index: ['index.html'],
      setHeaders(res, path) {
        // Hashed assets are immutable; index.html must always revalidate.
        if (path.includes(`${'/'}assets${'/'}`))
          res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
  } else {
    app.log.warn({ clientDir }, 'client build not found: serving the API only (run `npm run build`)');
  }

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { error: 'Not found', code: 'NOT_FOUND', detail: { path: req.url } };
    return reply.code(404).send(body);
  });

  return app;
}
