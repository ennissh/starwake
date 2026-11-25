import type { Config } from '../config.js';

/**
 * The only Ollama chat client in Starwake (CLAUDE.md rule 4). Native `POST /api/chat`, no
 * streaming, structured output via `format` (a JSON schema), bounded by OLLAMA_TIMEOUT_MS.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatErrorKind = 'not_configured' | 'timeout' | 'unreachable' | 'http' | 'bad_body';

export class ChatError extends Error {
  constructor(
    readonly kind: ChatErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatResult {
  content: string;
  latencyMs: number;
  model: string;
}

export interface ChatClient {
  chat(
    messages: ChatMessage[],
    format: object,
    opts?: { temperature?: number; model?: string },
  ): Promise<ChatResult>;
}

export function createChatClient(
  cfg: Config,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): ChatClient {
  return {
    async chat(messages, format, opts = {}) {
      const model = opts.model ?? cfg.OLLAMA_MODEL;
      if (!cfg.OLLAMA_URL || !model)
        throw new ChatError(
          'not_configured',
          'OLLAMA_URL or OLLAMA_MODEL is not set (run install.sh or edit .env)',
        );
      const url = new URL('/api/chat', cfg.OLLAMA_URL).toString();
      const started = now();
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            format,
            options: { temperature: opts.temperature ?? cfg.LLM_TEMPERATURE, num_ctx: 8192 },
          }),
          signal: AbortSignal.timeout(cfg.OLLAMA_TIMEOUT_MS),
        });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError')
          throw new ChatError('timeout', `Ollama did not answer within ${cfg.OLLAMA_TIMEOUT_MS} ms`);
        throw new ChatError('unreachable', `Ollama unreachable: ${e.message}`);
      }
      if (!res.ok) throw new ChatError('http', `Ollama answered HTTP ${res.status}`);
      let body: { message?: { content?: unknown } };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new ChatError('bad_body', 'Ollama sent a body that is not JSON');
      }
      const content = body.message?.content;
      if (typeof content !== 'string') throw new ChatError('bad_body', 'Ollama reply has no message.content');
      return { content, latencyMs: now() - started, model };
    },
  };
}
