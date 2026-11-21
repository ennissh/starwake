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
  await page.getByRole('tab', { name: 'Key help' }).click();
  await expect(page.getByRole('dialog')).toContainText('Cycle camera');

  await page.reload();
  expect(await hook(page, (h) => h.bindings().cycleCamera)).toEqual(['KeyG']);
  expect(errors).toEqual([]);
});
