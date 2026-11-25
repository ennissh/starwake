import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_FILES, type ContentBundle, parseContent } from '@starwake/shared';
import { loadConfig } from '../src/config.js';
import { reportMarkdown, runEval } from '../src/eval/llmEval.js';
import type { ChatClient } from '../src/translator/ollama.js';

const contentDir = join(import.meta.dirname, '../../../content');
const raw: Record<string, unknown> = {};
for (const [k, f] of Object.entries(CONTENT_FILES))
  raw[k] = JSON.parse(readFileSync(join(contentDir, f), 'utf8'));
const c: ContentBundle = parseContent(raw as never);

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'sw-eval-'));
  dirs.push(d);
  return d;
};
const fake = (say: string, ms = 1200): ChatClient => ({
  async chat() {
    return {
      content: JSON.stringify({
        say,
        mood: 'neutral',
        deceptive: false,
        relationDelta: -1,
        relationReason: 'x',
        playerDeceptionSuspected: false,
        intent: { type: 'none' },
      }),
      latencyMs: ms,
      model: 'fake',
    };
  },
});
const cfg = loadConfig({
  DATA_DIR: '/nonexistent',
  LLM_MODE: 'ollama',
  OLLAMA_URL: 'http://ollama.test:11434',
  OLLAMA_MODEL: 'fake',
});
const only = (s: { raceId: string }) => s.raceId === 'quillari';

describe('eval:llm (live tier logic, against a fake model)', () => {
  it('a well-behaved model passes every bar', async () => {
    const r = await runEval({
      cfg,
      content: c,
      chat: fake('The spire listens, traveller.'),
      model: 'good',
      runs: 1,
      dataDir: tmp(),
      only,
    });
    expect(r.schemaValid).toBe(1);
    expect(r.injectionState).toBe(1);
    expect(r.injectionInCharacter).toBe(1);
    expect(r.ok).toBe(true);
    expect(reportMarkdown([r], 'now')).toMatch(/\*\*passes\*\*/);
  });
  it('goes red when the model breaks character, and when it is slow', async () => {
    const ooc = await runEval({
      cfg,
      content: c,
      chat: fake('As an AI language model, I trade.'),
      model: 'ooc',
      runs: 1,
      dataDir: tmp(),
      only,
    });
    expect(ooc.ok).toBe(false);
    expect(ooc.bars.schemaValid).toBe(false);
    const slow = await runEval({
      cfg,
      content: c,
      chat: fake('Hm.', 9000),
      model: 'slow',
      runs: 1,
      dataDir: tmp(),
      only,
    });
    expect(slow.bars.medianLatencyMs).toBe(false);
    expect(slow.ok).toBe(false);
  });
});
