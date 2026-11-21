import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const app = await buildApp(cfg);

app.log.info(
  {
    version: cfg.STARWAKE_VERSION,
    gitSha: cfg.STARWAKE_GIT_SHA,
    llmMode: cfg.LLM_MODE,
    model: cfg.OLLAMA_MODEL ?? null,
    ollama: cfg.OLLAMA_URL ? 'configured' : 'not set',
    dataDir: cfg.DATA_DIR,
    rating: cfg.CONTENT_RATING,
  },
  'starwake starting',
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.log.info({ sig }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: cfg.HOST, port: cfg.LISTEN_PORT });
