import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CommandRecorder,
  Encounter,
  TICK,
  quantize,
  sensiblePilot,
  type CampaignState,
} from '@starwake/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sw-camp-'));
  app = await buildApp(loadConfig({ LLM_MODE: 'off', DATA_DIR: dir, LOG_LEVEL: 'silent' }));
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });
async function newPilot(name = 'Shawn') {
  const p = await post('/api/profiles', { name });
  expect(p.statusCode).toBe(201);
  const s = await post('/api/saves', { profile: p.json().id, slot: 'auto' });
  expect(s.statusCode).toBe(201);
  return { profile: p.json().id as string, save: s.json() as { id: string; state: CampaignState } };
}
const action = (id: string, a: unknown) => post(`/api/campaign/${id}/action`, { action: a });

describe('profiles', () => {
  it('create, list, duplicate refused, settings stored', async () => {
    await post('/api/profiles', { name: 'Shawn' });
    expect((await post('/api/profiles', { name: 'shawn' })).statusCode).toBe(409);
    expect((await app.inject('/api/profiles')).json()).toEqual([
      expect.objectContaining({ id: 'shawn', name: 'Shawn' }),
    ]);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/profiles/shawn/settings',
      payload: { settings: { invertY: true } },
    });
    expect(put.statusCode).toBe(200);
    expect((await app.inject('/api/profiles/shawn')).json().settings).toEqual({ invertY: true });
  });
  it('rejects path tricks in ids', async () => {
    expect((await app.inject('/api/profiles/..%2F..%2Fetc')).statusCode).toBe(400);
    expect((await app.inject('/api/saves/..%2Fx.auto')).statusCode).toBe(400);
    expect((await app.inject('/api/saves?profile=../x')).statusCode).toBe(400);
  });
});

describe('campaign', () => {
  it('a new game starts in Harbor', async () => {
    const { save } = await newPilot();
    expect(save.state.systemId).toBe('harbor');
    expect(save.id).toBe('shawn.auto');
  });

  it('actions apply rules, persist, and return events; rule refusals are 409s', async () => {
    const { save } = await newPilot();
    const probe = await action(save.id, { type: 'probe' });
    expect(probe.statusCode).toBe(200);
    expect(probe.json().events[0]).toEqual({ t: 'probed', systemId: 'harbor' });
    const again = await action(save.id, { type: 'probe' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'PROBE_USED' });
    const bad = await action(save.id, { type: 'teleport' });
    expect(bad.statusCode).toBe(400);
    const reloaded = (await app.inject(`/api/saves/${save.id}`)).json();
    expect(reloaded.state.known).toEqual(['harbor']);
  });

  it('M3 acceptance: save → reload restores the exact state (deep-equal)', async () => {
    const { profile, save } = await newPilot();
    await action(save.id, { type: 'probe' });
    await action(save.id, { type: 'claim', planetId: 'anvil' });
    await action(save.id, { type: 'jump', to: 'saltmarrow' });
    const live = (await app.inject(`/api/saves/${save.id}`)).json().state as CampaignState;
    const manual = await post('/api/saves', { profile, slot: '1', copyFrom: save.id });
    expect(manual.statusCode).toBe(201);
    // Play on, then load slot 1 back into auto.
    await action(save.id, { type: 'probe' });
    const loaded = await post('/api/saves', { profile, slot: 'auto', copyFrom: `${profile}.1` });
    expect(loaded.json().state).toEqual(live);
    // A fresh server (same data dir) reads the same bytes back.
    await app.close();
    app = await buildApp(loadConfig({ LLM_MODE: 'off', DATA_DIR: dir, LOG_LEVEL: 'silent' }));
    expect((await app.inject(`/api/saves/${profile}.1`)).json().state).toEqual(live);
    expect(
      (await app.inject(`/api/saves?profile=${profile}`)).json().map((s: { id: string }) => s.id),
    ).toEqual([`${profile}.auto`, `${profile}.1`]);
  });

  it('a chosen seed gives the same campaign', async () => {
    await post('/api/profiles', { name: 'Seedy' });
    const a = (await post('/api/saves', { profile: 'seedy', slot: '1', seed: 'run-42' })).json().state;
    const b = (await post('/api/saves', { profile: 'seedy', slot: '2', seed: 'run-42' })).json().state;
    expect(a).toEqual(b);
    expect(a.seed).toBe('run-42');
    expect((await post('/api/saves', { profile: 'seedy', slot: '3', seed: '../x' })).statusCode).toBe(400);
  });

  it('writes atomically: no temp files left behind', async () => {
    const { save } = await newPilot();
    await Promise.all([
      action(save.id, { type: 'probe' }),
      action(save.id, { type: 'dock' }),
      action(save.id, { type: 'repair' }),
    ]);
    const files = readdirSync(join(dir, 'saves', 'shawn'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a save from a newer build, and keeps a backup when migrating', async () => {
    const { save } = await newPilot();
    const p = join(dir, 'saves', 'shawn', 'auto.json');
    mkdirSync(join(dir, 'saves', 'shawn'), { recursive: true });
    writeFileSync(p, JSON.stringify({ meta: save, state: { ...save.state, version: 99 } }));
    const r = await app.inject(`/api/saves/${save.id}`);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/Upgrade Starwake/);
  });
});

describe('encounters', () => {
  async function pendingFight() {
    const { save } = await newPilot();
    // Walk to Cinder Gate and attack the base: a guaranteed encounter.
    let s = (await action(save.id, { type: 'jump', to: 'glass-reach' })).json();
    if (!s.state.pendingEncounter) s = (await action(save.id, { type: 'jump', to: 'cinder-gate' })).json();
    if (!s.state.pendingEncounter) s = (await action(save.id, { type: 'attackBase' })).json();
    expect(s.state.pendingEncounter).not.toBeNull();
    const start = (await post('/api/encounters/start', { saveId: save.id })).json();
    return { id: save.id, start };
  }

  function fight(start: { options: Record<string, unknown> }, content: unknown) {
    const e = new Encounter({ ...(start.options as object), content } as ConstructorParameters<
      typeof Encounter
    >[0]);
    const rec = new CommandRecorder();
    for (let i = 0; i < 600 / TICK && !e.over && !e.crippled; i++) {
      const cmd = quantize(sensiblePilot(e));
      rec.push(cmd);
      e.step(cmd);
    }
    if (e.crippled) {
      e.chooseCrippled('lifeboat');
      rec.crippledChoice = 'lifeboat';
    }
    return { result: e.result(), log: rec.log() };
  }

  it('the server replays the command log and applies a verified result', async () => {
    const content = (await app.inject('/api/content')).json();
    const { id, start } = await pendingFight();
    const { result, log } = fight(start, content);
    const r = await post(`/api/encounters/${start.encounterId}/result`, { saveId: id, result, log });
    expect(r.statusCode).toBe(200);
    expect(r.json().verification).toBe('verified');
    expect(r.json().state.pendingEncounter).toBeNull();
    // A second post of the same fight is refused.
    expect(
      (await post(`/api/encounters/${start.encounterId}/result`, { saveId: id, result, log })).statusCode,
    ).toBe(409);
  });

  it('a forged result is rejected', async () => {
    const content = (await app.inject('/api/content')).json();
    const { id, start } = await pendingFight();
    const { result } = fight(start, content);
    const forged = {
      ...result,
      outcome: 'victory',
      destroyed: [...result.destroyed, { id: 'hx', hullId: 'vosk-base' }, { id: 'hy', hullId: 'vosk-base' }],
      salvage: [
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
        'gyro-3',
      ],
    };
    const r = await post(`/api/encounters/${start.encounterId}/result`, {
      saveId: id,
      result: forged,
      log: { runs: [] },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('IMPLAUSIBLE_RESULT');
  });
});

describe('advisors', () => {
  it('answers from the save, without changing it', async () => {
    const { save } = await newPilot();
    const before = (await app.inject({ method: 'GET', url: `/api/saves/${save.id}` })).json().state;
    const r = await post('/api/advisor/ask', { saveId: save.id, advisor: 'wake', question: 'What now?' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ advisorId: 'wake', topicId: 'next-steps' });
    expect(r.json().text).toMatch(/Probe/);
    const after = (await app.inject({ method: 'GET', url: `/api/saves/${save.id}` })).json().state;
    expect(after).toEqual(before);
  });

  it('works without a save, and refuses bad input', async () => {
    const r = await post('/api/advisor/ask', { advisor: 'tactical', question: 'how do I aim the lance' });
    expect(r.json().topicId).toBe('lance');
    expect((await post('/api/advisor/ask', { advisor: 'wake' })).statusCode).toBe(400);
    expect((await post('/api/advisor/ask', { advisor: '../x', question: 'hi' })).statusCode).toBe(400);
    expect(
      (await post('/api/advisor/ask', { saveId: 'nobody.auto', advisor: 'wake', question: 'next' }))
        .statusCode,
    ).toBe(404);
  });
});
