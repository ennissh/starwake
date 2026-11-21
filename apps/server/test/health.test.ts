import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Health } from '@starwake/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLlmProbe } from '../src/llm/ollama.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sw-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const silent = { info() {}, warn() {} };

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request) => handler(String(input))) as typeof fetch;
}

describe('/healthz', () => {
  it('reports mock mode without calling Ollama', async () => {
    const cfg = loadConfig({
      LLM_MODE: 'mock',
      DATA_DIR: tmp(),
      LOG_LEVEL: 'silent',
      STARWAKE_VERSION: '0.1.0-7',
    });
    const app = await buildApp(cfg);
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    const body = Health.parse(res.json());
    expect(body).toMatchObject({ ok: true, llm: 'mock', version: '0.1.0-7' });
    await app.close();
  });

  it('stays 200 with llm "down" when Ollama is unreachable', async () => {
    const cfg = loadConfig({
      OLLAMA_URL: 'http://ollama.invalid:11434',
      DATA_DIR: tmp(),
      LOG_LEVEL: 'silent',
    });
    const llm = createLlmProbe(
      cfg,
      silent,
      fakeFetch(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const app = await buildApp(cfg, { llm });
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json().llm).toBe('down');
    await app.close();
  });
});

describe('LLM probe', () => {
  const base = { OLLAMA_URL: 'http://ollama.test:11434', OLLAMA_MODEL: 'gemma4:12b' };
  const tags = (names: string[]) => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }));

  it('is up when the model is installed', async () => {
    const p = createLlmProbe(
      loadConfig(base),
      silent,
      fakeFetch(() => tags(['gemma4:12b', 'other:1b'])),
    );
    expect(await p.status()).toBe('up');
  });

  it('is down when the model is missing', async () => {
    const p = createLlmProbe(
      loadConfig(base),
      silent,
      fakeFetch(() => tags(['other:1b'])),
    );
    expect(await p.status()).toBe('down');
  });

  it('is down on HTTP error', async () => {
    const p = createLlmProbe(
      loadConfig(base),
      silent,
      fakeFetch(() => new Response('no', { status: 500 })),
    );
    expect(await p.status()).toBe('down');
  });

  it('is down without a URL', async () => {
    const p = createLlmProbe(
      loadConfig({}),
      silent,
      fakeFetch(() => tags([])),
    );
    expect(await p.status()).toBe('down');
  });

  it('caches for the TTL and re-probes after it', async () => {
    let calls = 0;
    let t = 0;
    const p = createLlmProbe(
      loadConfig(base),
      silent,
      fakeFetch(() => {
        calls++;
        return tags(['gemma4:12b']);
      }),
      () => t,
      1000,
    );
    await p.status();
    await p.status();
    expect(calls).toBe(1);
    t = 1500;
    await p.status();
    expect(calls).toBe(2);
  });

  it('reports off and mock without fetching', async () => {
    const boom = fakeFetch(() => {
      throw new Error('should not fetch');
    });
    expect(await createLlmProbe(loadConfig({ LLM_MODE: 'off' }), silent, boom).status()).toBe('off');
    expect(await createLlmProbe(loadConfig({ LLM_MODE: 'mock' }), silent, boom).status()).toBe('mock');
  });
});

describe('/readyz', () => {
  it('is ready when the data dir is writable', async () => {
    const app = await buildApp(loadConfig({ LLM_MODE: 'off', DATA_DIR: tmp(), LOG_LEVEL: 'silent' }));
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
    await app.close();
  });

  it('is 503 when the data dir cannot be created', async () => {
    const file = join(tmp(), 'a-file');
    writeFileSync(file, 'x');
    const app = await buildApp(
      loadConfig({ LLM_MODE: 'off', DATA_DIR: join(file, 'data'), LOG_LEVEL: 'silent' }),
    );
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.dataDir.ok).toBe(false);
    await app.close();
  });
});

describe('errors', () => {
  it('404s use the uniform error shape', async () => {
    const app = await buildApp(
      loadConfig({ LLM_MODE: 'off', DATA_DIR: tmp(), LOG_LEVEL: 'silent', CLIENT_DIR: tmp() }),
    );
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Not found', code: 'NOT_FOUND' });
    await app.close();
  });
});

describe('config', () => {
  it('rejects a bad rating', () => {
    expect(() => loadConfig({ CONTENT_RATING: 'nc17' })).toThrow(/CONTENT_RATING/);
  });
  it('defaults to mature', () => {
    expect(loadConfig({}).CONTENT_RATING).toBe('mature');
  });
});

describe('/api/content', () => {
  it('serves the validated content bundle', async () => {
    const app = await buildApp(loadConfig({ LLM_MODE: 'off', DATA_DIR: tmp(), LOG_LEVEL: 'silent' }));
    const res = await app.inject('/api/content');
    expect(res.statusCode).toBe(200);
    expect(res.json().player.name).toBe('Starwake');
    await app.close();
  });

  it('refuses to start on broken content, naming the file', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'player.json'), '{"name": ""}');
    await expect(
      buildApp(loadConfig({ LLM_MODE: 'off', DATA_DIR: tmp(), LOG_LEVEL: 'silent', CONTENT_DIR: dir })),
    ).rejects.toThrow(/player\.json/);
  });
});
