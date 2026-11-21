import { expect, test, type Page } from '@playwright/test';

type Hook = {
  screen(): string;
  paused(): boolean;
  flight(): { camera: string; assist: boolean; throttle: number; speed: number; pos: { z: number } } | null;
  bindings(): Record<string, string[]>;
};
const hook = <T>(page: Page, fn: (h: Hook) => T) =>
  page.evaluate(
    (src) => new Function('h', `return (${src})(h)`)((window as unknown as { __starwake: Hook }).__starwake),
    fn.toString(),
  ) as Promise<T>;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('server health and readiness (mock translator)', async ({ request }) => {
  const health = await request.get('/healthz');
  expect(await health.json()).toMatchObject({ ok: true, llm: 'mock', version: 'e2e' });
  expect((await request.get('/readyz')).ok()).toBe(true);
  expect((await (await request.get('/api/content')).json()).player.name).toBe('Starwake');
});

test('title → flight: throttle, cameras, assist, pause, help, rebinding persists', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await expect(page.getByRole('heading', { name: 'Starwake' })).toBeVisible();
  await expect(page.locator('#sw-llm')).toHaveText(/mock/i);

  for (const theme of ['light', 'vga', 'dark']) {
    await page.locator(`[data-theme-id="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }

  await page.getByRole('button', { name: 'Flight test' }).click();
  await expect.poll(() => hook(page, (h) => h.screen())).toBe('flight');

  // Hold W: throttle rises and the ship moves forward (-Z).
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await expect.poll(() => hook(page, (h) => h.flight()!.throttle)).toBeGreaterThan(0.2);
  await expect.poll(() => hook(page, (h) => h.flight()!.pos.z)).toBeLessThan(-1);

  // Full throttle, then stop.
  await page.keyboard.press('Shift+KeyW');
  await expect.poll(() => hook(page, (h) => h.flight()!.throttle)).toBe(1);
  await page.keyboard.press('KeyX');
  await expect.poll(() => hook(page, (h) => h.flight()!.throttle)).toBe(0);

  // Cameras cycle bridge → orbit → turret → back to chase (no drone without drones).
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('KeyC');
    seen.push(await hook(page, (h) => h.flight()!.camera));
  }
  expect(seen).toEqual(['orbit', 'turret', 'bridge', 'chase']);

  await page.keyboard.press('KeyZ');
  await expect.poll(() => hook(page, (h) => h.flight()!.assist)).toBe(false);

  // Esc pauses; the controls tab rebinds Cycle camera to G; it persists after a reload.
  await page.keyboard.press('Escape');
  await expect.poll(() => hook(page, (h) => h.paused())).toBe(true);
  await page.getByRole('tab', { name: 'Controls' }).click();
  await page.getByRole('button', { name: 'Cycle camera key 1' }).click();
  await page.keyboard.press('KeyG');
  await expect(page.getByRole('button', { name: 'Cycle camera key 1' })).toHaveText('G');
  // Esc cancels a capture without closing the menu; a mouse button can be bound.
  await page.getByRole('button', { name: 'Cycle camera key 2' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => hook(page, (h) => h.paused())).toBe(true);
  await expect(page.getByRole('button', { name: 'Cycle camera key 2' })).toHaveText('—');
  await page.getByRole('button', { name: 'Cycle camera key 2' }).click();
  await page.mouse.click(10, 10, { button: 'middle' });
  await expect(page.getByRole('button', { name: 'Cycle camera key 2' })).toHaveText('Middle mouse');
  await page.getByRole('tab', { name: 'Key help' }).click();
  await expect(page.getByRole('dialog')).toContainText('Cycle camera');

  await page.reload();
  expect(await hook(page, (h) => h.bindings().cycleCamera)).toEqual(['KeyG', 'Mouse1']);
  expect(errors).toEqual([]);
});

test('practice arena: target, subsystem, drone, ride it, emergency fold → result', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByRole('button', { name: 'Practice arena' }).click();
  await page.locator('[data-id="arena-base"]').click();
  await expect.poll(() => hook(page, (h) => h.screen())).toBe('flight');
  type Snap = {
    targetId: string | null;
    subId: string | null;
    drones: number;
    frames: number;
    camera: string;
    outcome: string;
  };
  const snap = () => hook(page, (h) => h.flight() as unknown as Snap);

  await page.keyboard.press('KeyT');
  await expect.poll(async () => (await snap()).targetId).not.toBeNull();
  // Cycle T until the base (the one with subsystems) is targeted, then Y picks a subsystem.
  for (let i = 0; i < 6 && !(await snap()).subId; i++) {
    await page.keyboard.press('KeyY');
    if (!(await snap()).subId) await page.keyboard.press('KeyT');
  }
  expect((await snap()).subId).not.toBeNull();

  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await snap()).drones).toBe(1);
  expect((await snap()).frames).toBe(7);

  // C cycles chase → orbit → turret → drone cockpit.
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyC');
  await expect.poll(async () => (await snap()).camera).toBe('drone');

  // Hold Shift+J for a second: emergency fold ends the fight.
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyJ');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyJ');
  await page.keyboard.up('Shift');
  await expect(page.getByRole('dialog')).toContainText('Emergency fold');
  await expect(page.getByRole('dialog')).toContainText('Components lost');
  await page.getByRole('button', { name: 'Back to title' }).click();
  await expect.poll(() => hook(page, (h) => h.screen())).toBe('title');
  expect(errors).toEqual([]);
});

type CampSnap = {
  systemId: string;
  clock: number;
  fuel: number;
  panel: string | null;
  pending: boolean;
  fighting: boolean;
  verification: string | null;
  state: unknown;
};
const camp = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __starwake: { campaign(): unknown } }).__starwake.campaign(),
  ) as Promise<CampSnap | null>;

test('campaign: pilot → new game → probe → claim → map → jump → save → reload → load', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByLabel('New pilot name').fill(`Pilot ${Date.now() % 100000}`);
  await page.getByRole('button', { name: 'Add pilot' }).click();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect.poll(async () => (await camp(page))?.systemId).toBe('harbor');

  await page.keyboard.press('KeyP');
  await expect(page.getByRole('dialog')).toContainText('Anvil');
  await page.getByRole('button', { name: 'Place claim beacon' }).click();
  await expect(page.getByRole('dialog')).toContainText('Beacon placed');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await camp(page))?.panel).toBeNull();

  // Tab toggles the map shut again (and stays shut); then reopen it to jump.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog')).toContainText('Star map');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  expect((await camp(page))!.panel).toBeNull();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog')).toContainText('Star map');
  await page.locator('[data-act="select"][data-id="saltmarrow"]').dispatchEvent('click');
  await page.keyboard.press('KeyJ');
  await expect.poll(async () => (await camp(page))?.systemId).toBe('saltmarrow');
  const after = (await camp(page))!;
  expect(after.fuel).toBeLessThan(100);
  expect(after.clock).toBeLessThan(10);

  // Save to slot 1 from the pause menu.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Save / load' }).click();
  await page.locator('[data-save="1"]').click();
  await expect(page.getByRole('dialog')).toContainText('Saved to slot 1');

  // Reload the page: Continue restores the exact state; Load slot 1 matches too.
  await page.reload();
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect.poll(async () => (await camp(page))?.systemId).toBe('saltmarrow');
  expect((await camp(page))!.state).toEqual(after.state);
  expect(errors).toEqual([]);
});

test('campaign fight: attack Cinder Hold, fold out; the server verifies the browser fight by replay', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await page.getByLabel('New pilot name').fill(`Raider ${Date.now() % 100000}`);
  await page.getByRole('button', { name: 'Add pilot' }).click();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect.poll(async () => (await camp(page))?.systemId).toBe('harbor');

  const byName: Record<string, string> = { 'glass-reach': 'Glass Reach', 'cinder-gate': 'Cinder Gate' };
  const jump = async (to: string) => {
    await page.keyboard.press('Tab');
    // Dispatched, not a pixel click: stars can overlap at some rotations.
    await page.locator(`[data-act="select"][data-id="${to}"]`).dispatchEvent('click');
    await expect(page.locator('.cmap__side h3')).toHaveText(byName[to]!);
    await page.keyboard.press('KeyJ');
    await expect.poll(async () => (await camp(page))?.systemId).toBe(to);
  };
  await jump('glass-reach');
  await jump('cinder-gate');
  // An ambush or patrol may already have started a fight; otherwise attack the base.
  if (!(await camp(page))!.fighting) {
    await page.keyboard.press('KeyP');
    await page.getByRole('button', { name: 'Attack their base' }).click();
  }
  await expect.poll(async () => (await camp(page))?.fighting).toBe(true);
  await page.waitForTimeout(1500);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyJ');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyJ');
  await page.keyboard.up('Shift');
  await expect(page.getByRole('dialog')).toContainText('Emergency fold');
  expect((await camp(page))!.verification).toBe('verified');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(async () => (await camp(page))?.fighting).toBe(false);
  expect(['glass-reach', 'cinder-gate']).toContain((await camp(page))!.systemId);
  expect(errors).toEqual([]);
});
