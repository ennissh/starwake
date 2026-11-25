import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import type { CampaignState, ContentBundle, Readiness } from '@starwake/shared';

/**
 * Automated playthroughs in a headless browser (the M6 "both endings are reachable" check, early).
 *
 * Everything goes through the real UI and the real server: title, pilot, Continue, probe, claim
 * beacons, star map and fold jumps, the Waystation, Colony Readiness and signalling the Caravan. The
 * only fake is the pilot's hands in a fight: the `autopilot` test hook flies the same scripted
 * "sensible" pilot the balance tests use, and `timeScale` runs the sim faster. Its commands still go
 * through the sim, the recorder and the server's replay check, which must say "verified".
 *
 * The run writes a timeline to test-results/playthrough/ (clock, fuel, hull, claims per step): the
 * numbers for tuning the Caravan Clock.
 *
 *   npm run build && npx playwright test e2e/playthrough.spec.ts --trace off
 *   PLAYTHROUGH_SEED=my-seed npx playwright test e2e/playthrough.spec.ts   # another campaign
 */
const SEED = process.env.PLAYTHROUGH_SEED ?? 'playthrough-1';
const TIME_SCALE = Number(process.env.PLAYTHROUGH_TIME_SCALE ?? 6);
const OUT = 'test-results/playthrough';

/** expect.poll that checks often: the UI answers in tens of milliseconds. */
const ep = <T>(fn: () => Promise<T>, o: { timeout?: number } = {}) =>
  expect.poll(fn, { intervals: [50, 100, 200], timeout: 10_000, ...o });

type Snap = {
  systemId: string;
  panel: string | null;
  fighting: boolean;
  folding: boolean;
  tutorial?: string | null;
  verification: string | null;
  state: CampaignState;
  ship: { range: number; fuelPerParsec: number };
  readiness: Readiness;
};

interface Step {
  step: string;
  wallS: number;
  clock: number;
  fuel: number;
  hull: number;
  system: string;
  beacons: number;
  claims: number;
}

interface FightRecord {
  where: string;
  reason: string;
  outcome: string;
  verification: string | null;
  wallS: number;
}

class Run {
  readonly steps: Step[] = [];
  readonly fights: FightRecord[] = [];
  readonly errors: string[] = [];
  private t0 = Date.now();
  private shots = 0;

  constructor(
    readonly page: Page,
    readonly c: ContentBundle,
    readonly name: string,
  ) {
    page.on('pageerror', (e) => this.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push(m.text());
    });
    mkdirSync(OUT, { recursive: true });
  }

  async snap(): Promise<Snap> {
    const s = await this.page.evaluate(() =>
      (window as unknown as { __starwake: { campaign(): unknown } }).__starwake.campaign(),
    );
    if (!s) throw new Error('no campaign running');
    return s as Snap;
  }

  async hook(name: string, arg?: unknown): Promise<unknown> {
    return this.page.evaluate(
      ([n, a]) =>
        (window as unknown as { __starwake: Record<string, (x?: unknown) => unknown> }).__starwake[
          n as string
        ]!(a),
      [name, arg] as const,
    );
  }

  async record(step: string): Promise<void> {
    const s = await this.snap();
    this.steps.push({
      step,
      wallS: Math.round((Date.now() - this.t0) / 100) / 10,
      clock: s.state.clock,
      fuel: Math.round(s.state.fuel * 10) / 10,
      hull: s.state.hull,
      system: s.state.systemId,
      beacons: s.state.beacons,
      claims: s.state.claims.length,
    });
  }

  async shot(label: string): Promise<void> {
    await this.page.screenshot({
      path: join(OUT, `${this.name}-${String(++this.shots).padStart(2, '0')}-${label}.png`),
    });
  }

  /** Losing the mouse pauses the game by design; a headless browser loses it now and then. */
  async resume(): Promise<void> {
    const paused = this.page.getByRole('dialog', { name: 'Paused' });
    if (await paused.isVisible().catch(() => false))
      await this.page.getByRole('button', { name: 'Resume' }).first().click();
  }

  async key(code: string): Promise<void> {
    await this.resume();
    await this.page.keyboard.press(code);
  }

  async closePanel(): Promise<void> {
    await this.resume();
    await this.takeSalvage(); // the one panel Esc can't close: it needs a choice
    if ((await this.snap()).panel) {
      await this.page.keyboard.press('Escape');
      await ep(async () => (await this.snap()).panel).toBeNull();
    }
  }

  async openReport(): Promise<void> {
    if ((await this.snap()).panel === 'system') return;
    await this.closePanel();
    await this.key('KeyI');
    await ep(async () => (await this.snap()).panel).toBe('system');
  }

  async probe(): Promise<void> {
    await this.closePanel();
    await this.key('KeyP');
    await ep(async () => (await this.snap()).panel).toBe('system');
    await ep(async () => (await this.snap()).state.known).toContain((await this.snap()).systemId);
    await this.record(`probe ${(await this.snap()).systemId}`);
  }

  async claim(planetId: string): Promise<void> {
    await this.openReport();
    await this.page.locator(`[data-act="claim"][data-id="${planetId}"]`).click();
    await expect
      .poll(async () => (await this.snap()).state.claims.map((x) => x.planetId))
      .toContain(planetId);
    await this.record(`claim ${planetId}`);
  }

  async dock(): Promise<void> {
    const before = (await this.snap()).state.clock;
    await this.openReport();
    await this.page.locator('[data-act="dock"]').click();
    await ep(async () => (await this.snap()).state.clock).toBeLessThan(before);
    await this.record('dock');
  }

  /** Shortest lane route from here, using only lanes the Fold Drive can reach. */
  route(from: string, to: string, range: number): string[] | null {
    const pc = (a: string, b: string) => {
      const p = this.c.systems.find((s) => s.id === a)!.position;
      const q = this.c.systems.find((s) => s.id === b)!.position;
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    const prev = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === to) break;
      for (const l of this.c.lanes) {
        const next = l.a === cur ? l.b : l.b === cur ? l.a : null;
        if (next && !prev.has(next) && pc(cur, next) <= range + 1e-9) {
          prev.set(next, cur);
          queue.push(next);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path = [to];
    while (prev.get(path[0]!)) path.unshift(prev.get(path[0]!)!);
    return path;
  }

  async jump(to: string): Promise<void> {
    await this.closePanel();
    const from = (await this.snap()).systemId;
    await this.key('Tab');
    await ep(async () => (await this.snap()).panel).toBe('map');
    await this.page.locator(`[data-act="select"][data-id="${to}"]`).dispatchEvent('click');
    await expect(this.page.locator('.cmap__side h3')).toHaveText(
      this.c.systems.find((s) => s.id === to)!.name,
    );
    await this.page.keyboard.press('KeyJ');
    await expect
      .poll(async () => {
        const s = await this.snap();
        return (s.systemId !== from || s.fighting || s.state.outcome !== 'ongoing') && !s.folding;
      })
      .toBe(true);
    await this.record(`jump ${from} → ${to}`);
    // They hail first (M5 parley): this run answers by fighting.
    if ((await this.snap()).panel === 'parley') {
      await this.page.getByRole('button', { name: 'Fight', exact: true }).click();
      await ep(async () => (await this.snap()).fighting).toBe(true);
    }
    if ((await this.snap()).fighting) await this.fight();
  }

  /** Let the autopilot fight; take the crippled choice if needed; accept the result and salvage. */
  async fight(): Promise<void> {
    const start = Date.now();
    const s0 = await this.snap();
    const reason = s0.state.pendingEncounter?.reason ?? 'unknown';
    const where = s0.systemId;
    let shot = false;
    for (;;) {
      if (Date.now() - start > 6 * 60_000) throw new Error(`fight at ${where} did not finish in 6 minutes`);
      await this.resume();
      if (!shot && Date.now() - start > 4000) {
        await this.shot(`fight-${where}`);
        shot = true;
      }
      if (
        await this.page
          .getByRole('dialog', { name: 'The Starwake is crippled' })
          .isVisible()
          .catch(() => false)
      ) {
        await this.page.getByRole('button', { name: /Emergency fold/ }).click();
      }
      if (
        await this.page
          .getByRole('dialog', { name: 'The fight could not be recorded' })
          .isVisible()
          .catch(() => false)
      ) {
        throw new Error('the server refused the fight result');
      }
      const cont = this.page.getByRole('button', { name: 'Continue', exact: true });
      if (await cont.isVisible().catch(() => false)) {
        const outcome = (await this.page.locator('#sw-modal-title').textContent()) ?? '?';
        const snap = await this.snap();
        this.fights.push({
          where,
          reason,
          outcome,
          verification: snap.verification,
          wallS: Math.round((Date.now() - start) / 1000),
        });
        await cont.click();
        break;
      }
      await this.page.waitForTimeout(400);
    }
    await ep(async () => (await this.snap()).fighting).toBe(false);
    await this.record(`fight (${reason}) at ${where}: ${this.fights[this.fights.length - 1]!.outcome}`);
    await this.takeSalvage();
  }

  /** The salvage panel opens just after the result screen, whenever the server offered salvage. */
  async takeSalvage(): Promise<void> {
    if (!(await this.snap()).state.salvageOffer.length) return;
    await ep(async () => (await this.snap()).panel).toBe('salvage');
    await this.page.getByRole('button', { name: 'Take selected' }).click();
    await ep(async () => (await this.snap()).state.salvageOffer.length).toBe(0);
    await ep(async () => (await this.snap()).panel).not.toBe('salvage');
    await this.record('salvage');
  }

  async goTo(to: string): Promise<void> {
    for (let hops = 0; hops < 16; hops++) {
      const s = await this.snap();
      if (s.systemId === to) return;
      const path = this.route(s.systemId, to, s.ship.range);
      if (!path || path.length < 2)
        throw new Error(`no route from ${s.systemId} to ${to} within ${s.ship.range} pc`);
      await this.jump(path[1]!);
    }
    throw new Error(`could not reach ${to}`);
  }

  /** Top up beacons and hull at the Waystation when short. */
  async ensure(beacons: number, hull: number): Promise<void> {
    const s = await this.snap();
    if (s.state.beacons >= beacons && s.state.hull >= hull) return;
    await this.goTo(this.c.systems.find((x) => x.station === 'waystation')!.id);
    await this.dock();
  }

  async claimAt(systemId: string, planets: string[]): Promise<void> {
    const todo = () =>
      this.snap().then((s) => planets.filter((p) => !s.state.claims.some((c) => c.planetId === p)));
    if (!(await todo()).length) return;
    await this.ensure((await todo()).length, 0.35);
    await this.goTo(systemId);
    if (!(await this.snap()).state.known.includes(systemId)) await this.probe();
    for (const p of await todo()) await this.claim(p);
    await this.closePanel();
  }

  report(): {
    seed: string;
    run: string;
    yearsUsed: number | null;
    yearsLeft: number | null;
    wallSeconds: number;
    fights: FightRecord[];
    steps: Step[];
  } {
    const last = this.steps[this.steps.length - 1];
    const startClock = this.c.rules.clock.startYears;
    return {
      seed: SEED,
      run: this.name,
      yearsUsed: last ? Math.round((startClock - last.clock) * 100) / 100 : null,
      yearsLeft: last?.clock ?? null,
      wallSeconds: Math.round((Date.now() - this.t0) / 1000),
      fights: this.fights,
      steps: this.steps,
    };
  }
}

async function startSeeded(page: Page, pilot: string): Promise<{ run: Run; content: ContentBundle }> {
  const content = (await (await page.request.get('/api/content')).json()) as ContentBundle;
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByLabel('New pilot name').fill(pilot);
  await page.getByRole('button', { name: 'Add pilot' }).click();
  await expect(page.locator('#sw-pilot')).toBeVisible();
  const profile = (await page.evaluate(() =>
    (window as unknown as { __starwake: { profile(): string } }).__starwake.profile(),
  )) as string;
  // A seeded new game (the API the title's New game uses, plus a seed), then the real Continue path.
  const r = await page.request.post('/api/saves', { data: { profile, slot: 'auto', seed: SEED } });
  expect(r.status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  const run = new Run(page, content, pilot.toLowerCase().replace(/\W+/g, '-'));
  const loaded = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __starwake: { campaign(): { systemId: string } | null } }
        ).__starwake.campaign()?.systemId ?? null,
    );
  await expect.poll(loaded, { timeout: 15_000 }).toBe(content.rules.start.systemId);
  await run.hook('autopilot', true);
  await run.hook('timeScale', TIME_SCALE);
  await run.record('start');
  return { run, content };
}

function save(run: Run, outcome: string): void {
  const rep = { ...run.report(), outcome };
  writeFileSync(join(OUT, `${run.name}.json`), JSON.stringify(rep, null, 2));
  const lines = [
    `# Playthrough: ${run.name} (seed ${SEED})`,
    '',
    `Outcome **${outcome}** · ${rep.yearsUsed} years used, ${rep.yearsLeft} left · ${rep.wallSeconds} s wall time · ${run.fights.length} fights`,
    '',
    '| Step | Clock (yr) | Fold mass | Hull | System | Beacons | Claims |',
    '|---|---|---|---|---|---|---|',
    ...run.steps.map(
      (s) =>
        `| ${s.step} | ${s.clock.toFixed(2)} | ${s.fuel} | ${Math.round(s.hull * 100)}% | ${s.system} | ${s.beacons} | ${s.claims} |`,
    ),
    '',
    '| Fight | Reason | Outcome | Server check | Wall s |',
    '|---|---|---|---|---|',
    ...run.fights.map((f) => `| ${f.where} | ${f.reason} | ${f.outcome} | ${f.verification} | ${f.wallS} |`),
  ];
  writeFileSync(join(OUT, `${run.name}.md`), lines.join('\n') + '\n');
}

test.describe('headless playthrough', () => {
  // No silent hangs: every click or key gives up after 15 s.
  test.use({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark', actionTimeout: 15_000 });

  test('win: claim the quotas, break the Vosk, signal the Caravan from Verdance', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const { run } = await startSeeded(page, 'Winner');
    try {
      // 1. Harbor's ore, then Saltmarrow's ice and isotopes.
      await run.claimAt('harbor', ['anvil']);
      await run.shot('harbor-report');
      await run.claimAt('saltmarrow', ['brinehold', 'marrow']);

      // Mid-run persistence: reload and Continue gives back exactly the same campaign.
      const before = (await run.snap()).state;
      await page.reload();
      await page.getByRole('button', { name: 'Click to begin' }).click();
      await page.getByRole('button', { name: /^Continue/ }).click();
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as unknown as { __starwake: { campaign(): { state: unknown } | null } }
                ).__starwake.campaign()?.state ?? null,
            ),
          { timeout: 15_000 },
        )
        .toEqual(before);
      await run.hook('autopilot', true);
      await run.hook('timeScale', TIME_SCALE);
      await run.record('reload and continue');

      // 2. Quillari ice (a hostile act without a permit: it costs relation, not war).
      await run.claimAt('glass-reach', ['frostglass']);

      // 3. Break the Vosk at Cinder Hold (treaty and tribute arrive with the translator in M5).
      for (
        let attempt = 0;
        attempt < 5 && !(await run.snap()).state.flags.includes('vosk_broken');
        attempt++
      ) {
        await run.ensure(2, 0.85);
        await run.goTo('cinder-gate');
        if (
          (await run.snap()).state.flags.includes('vosk_broken') ||
          (await run.snap()).systemId !== 'cinder-gate'
        )
          continue;
        // Occupants (and their base) show only once the system is surveyed.
        if (!(await run.snap()).state.known.includes('cinder-gate')) await run.probe();
        await run.openReport();
        await run.page.locator('[data-act="attack"]').click();
        await ep(async () => (await run.snap()).fighting).toBe(true);
        await run.fight();
      }
      expect((await run.snap()).state.flags).toContain('vosk_broken');

      // 4. Cinder Gate's ore and isotopes, then the Cradle.
      await run.claimAt('cinder-gate', ['slag']);
      await run.claimAt('verdance', ['verdance-prime']);

      // 5. Colony Readiness: all four met at the Cradle → signal.
      await run.closePanel();
      await run.key('Tab');
      await ep(async () => (await run.snap()).panel).toBe('map');
      await run.shot('star-map');
      await run.closePanel();
      await run.key('KeyH');
      await ep(async () => (await run.snap()).panel).toBe('readiness');
      const r = (await run.snap()).readiness;
      expect(r.cradle.ok && r.safety.ok && r.clock.ok, JSON.stringify(r)).toBe(true);
      expect(r.canSignal).toBe(true);
      await run.shot('readiness');
      await page.locator('[data-act="signal"]').click();
      await ep(async () => (await run.snap()).state.outcome).toBe('won');
      await expect(page.getByRole('dialog', { name: 'The Caravan is coming' })).toBeVisible();
      await run.record('signal the Caravan');
      await run.shot('ending');

      // The win survives a reload.
      await page.reload();
      await page.getByRole('button', { name: 'Click to begin' }).click();
      await page.getByRole('button', { name: /^Continue/ }).click();
      await expect(page.getByRole('dialog', { name: 'The Caravan is coming' })).toBeVisible();

      // Every fight was checked by the server's replay and matched exactly.
      expect(run.fights.length).toBeGreaterThan(0);
      for (const f of run.fights) expect(f.verification, JSON.stringify(f)).toBe('verified');
      expect(run.errors).toEqual([]);
      save(run, 'won');
    } catch (err) {
      await run.shot('failure').catch(() => undefined);
      save(run, `failed: ${(err as Error).message.split('\n')[0]}`);
      throw err;
    }
  });

  test('lose: the Caravan Clock runs out', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const { run, content } = await startSeeded(page, 'Loser');
    try {
      // Burn the clock at the Waystation: every refit costs time.
      await run.openReport();
      const docks = Math.ceil(content.rules.clock.startYears / content.rules.clock.refitYears) + 2;
      for (let i = 0; i < docks && (await run.snap()).state.outcome === 'ongoing'; i++) {
        const before = (await run.snap()).state.clock;
        await page.locator('[data-act="dock"]').click();
        await expect
          .poll(async () => {
            const s = (await run.snap()).state;
            return s.clock < before || s.outcome !== 'ongoing';
          })
          .toBe(true);
      }
      await run.record('clock ran out');
      expect((await run.snap()).state.outcome).toBe('lost');
      expect((await run.snap()).state.clock).toBe(0);
      await expect(page.getByRole('dialog', { name: 'The Caravan Clock ran out' })).toBeVisible();
      await run.shot('ending');
      // A lost game refuses further actions and stays lost after a reload.
      await page.reload();
      await page.getByRole('button', { name: 'Click to begin' }).click();
      await page.getByRole('button', { name: /^Continue/ }).click();
      await expect(page.getByRole('dialog', { name: 'The Caravan Clock ran out' })).toBeVisible();
      expect(run.errors).toEqual([]);
      save(run, 'lost');
    } catch (err) {
      await run.shot('failure').catch(() => undefined);
      save(run, `failed: ${(err as Error).message.split('\n')[0]}`);
      throw err;
    }
  });
});
