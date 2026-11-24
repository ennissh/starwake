import type { LlmStatus } from '@starwake/shared';
import type { Config } from '../config.js';

export interface LlmProbe {
  status(): Promise<LlmStatus>;
}

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Cached Ollama reachability check for /healthz. Never throws: a down LLM is a reported state,
 * not a server failure (the game falls back to scripted dialogue).
 */
export function createLlmProbe(
  cfg: Config,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  ttlMs = 30_000,
): LlmProbe {
  let cached: { at: number; value: LlmStatus } | undefined;
  let inflight: Promise<LlmStatus> | undefined;

  async function ping(): Promise<LlmStatus> {
    if (!cfg.OLLAMA_URL) {
      log.warn({}, 'LLM_MODE=ollama but OLLAMA_URL is empty: run install.sh or set it in .env');
      return 'down';
    }
    const url = new URL('/api/tags', cfg.OLLAMA_URL).toString();
    const started = now();
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(Math.min(cfg.OLLAMA_TIMEOUT_MS, 5000)),
      });
      if (!res.ok) {
        log.warn({ status: res.status, url }, 'Ollama ping failed: check OLLAMA_URL');
        return 'down';
      }
      const body = (await res.json()) as { models?: { name?: string }[] };
      const names = (body.models ?? []).map((m) => m.name ?? '');
      if (cfg.OLLAMA_MODEL && !names.includes(cfg.OLLAMA_MODEL)) {
        log.warn(
          { model: cfg.OLLAMA_MODEL, available: names },
          'Ollama is up but OLLAMA_MODEL is not installed there: run `ollama pull <model>` on the Ollama host',
        );
        return 'down';
      }
      log.info({ ms: now() - started, models: names.length }, 'Ollama ping ok');
      return 'up';
    } catch (err) {
      log.warn(
        { err: (err as Error).message, url },
        'Ollama unreachable: the translator will use the scripted fallback. Check the Ollama host and the DOCKER-LAN-ONLY chain',
      );
      return 'down';
    }
  }

  return {
    async status() {
      if (cfg.LLM_MODE === 'mock') return 'mock';
      if (cfg.LLM_MODE === 'off') return 'off';
      if (cached && now() - cached.at < ttlMs) return cached.value;
      inflight ??= ping().then((value) => {
        cached = { at: now(), value };
        inflight = undefined;
        return value;
      });
      return inflight;
    },
  };
}
