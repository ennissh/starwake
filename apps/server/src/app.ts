import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ApiError } from '@starwake/shared';
import type { Config } from './config.js';
import { createLlmProbe, type LlmProbe } from './translator/probe.js';
import { healthRoutes } from './routes/health.js';
import { type ChatClient, createChatClient } from './translator/ollama.js';
import { createFilter } from './translator/filter.js';
import { createTranslatorLog } from './translator/log.js';
import { createTranslator } from './translator/translator.js';
import { defaultContentDir, loadContent } from './content.js';
import { Store } from './store.js';
import { profileRoutes } from './routes/profiles.js';
import { campaignRoutes } from './routes/campaign.js';
import { HttpError } from './routes/util.js';
import { ZodError } from 'zod';
import type { ContentBundle } from '@starwake/shared';

export interface AppDeps {
  llm?: LlmProbe;
  /** The Ollama chat client (tests pass a fake edge). */
  chat?: ChatClient;
  content?: ContentBundle;
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
      if (err instanceof HttpError) {
        const body: ApiError = {
          error: err.message,
          code: err.code,
          ...(err.detail !== undefined ? { detail: err.detail } : {}),
        };
        return reply.code(err.statusCode).send(body);
      }
      // Duck-typed too: zod errors thrown in the shared package may come from another module instance.
      if (err instanceof ZodError || Array.isArray((err as { issues?: unknown }).issues)) {
        const body: ApiError = {
          error: 'Invalid request',
          code: 'BAD_REQUEST',
          detail: (err as ZodError).issues,
        };
        return reply.code(400).send(body);
      }
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

  // Content is validated at start: a broken content file stops the server with a clear message
  // rather than serving a half-working game.
  const content = deps.content ?? (await loadContent(cfg.CONTENT_DIR ?? defaultContentDir()));
  app.log.info({ dir: cfg.CONTENT_DIR ?? defaultContentDir() }, 'content loaded and validated');

  healthRoutes(app, cfg, llm, content);

  const store = new Store(cfg.DATA_DIR);
  profileRoutes(app, store);
  const translator = createTranslator({
    cfg,
    content,
    chat: deps.chat ?? createChatClient(cfg),
    filter: createFilter(content.filters, cfg.CONTENT_RATING),
    log: createTranslatorLog(cfg.DATA_DIR),
    logger: app.log,
  });
  campaignRoutes(app, store, content, translator);

  app.get('/api/content', async (_req, reply) => {
    reply.header('cache-control', 'no-cache');
    return content;
  });

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
