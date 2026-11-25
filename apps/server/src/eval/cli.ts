import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { defaultContentDir, loadContent } from '../content.js';
import { createChatClient } from '../translator/ollama.js';
import { reportMarkdown, runEval } from './llmEval.js';

/**
 * npm run eval:llm -- [--models a,b,c] [--runs 3] [--race vosk] [--out docs/llm-eval.md]
 * Needs OLLAMA_URL (from .env or the environment). Exits 1 when any model misses a bar.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const cfg = loadConfig(process.env);
if (!cfg.OLLAMA_URL) {
  console.error(
    'eval:llm needs OLLAMA_URL (put it in .env or export it). Example: OLLAMA_URL=http://mac-studio.lan:11434',
  );
  process.exit(2);
}
const models = (arg('models') ?? cfg.OLLAMA_MODEL ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
if (!models.length) {
  console.error('eval:llm needs a model: --models gemma4:12b,another:tag (or OLLAMA_MODEL)');
  process.exit(2);
}
const runs = Number(arg('runs') ?? 3);
const race = arg('race');
const out = resolve(arg('out') ?? 'docs/llm-eval.md');
const content = await loadContent(cfg.CONTENT_DIR ?? defaultContentDir());
const chat = createChatClient(cfg);
const dataDir = mkdtempSync(join(tmpdir(), 'starwake-eval-'));

const reports = [];
for (const model of models) {
  console.log(`\n== ${model}`);
  const r = await runEval({
    cfg,
    content,
    chat,
    model,
    runs,
    dataDir,
    ...(race ? { only: (s) => s.raceId === race } : {}),
    onProgress: (m) => process.stdout.write(`\r${m.padEnd(70).slice(0, 70)}`),
  });
  console.log(
    `\n${model}: schema ${(r.schemaValid * 100).toFixed(1)}% · injection state ${(r.injectionState * 100).toFixed(0)}% · in character ${(r.injectionInCharacter * 100).toFixed(0)}% · p50 ${r.latency.p50} ms → ${r.ok ? 'PASS' : 'FAIL'}`,
  );
  reports.push(r);
}
writeFileSync(out, reportMarkdown(reports, new Date().toISOString()));
console.log(`\nReport: ${out}\nRaw calls: ${dataDir}/logs`);
process.exit(reports.some((r) => r.ok) ? 0 : 1);
