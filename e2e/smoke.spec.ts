import { expect, test } from '@playwright/test';

test('title page loads, reports mock translator, switches themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const health = await page.request.get('/healthz');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true, llm: 'mock', version: 'e2e' });
  expect((await page.request.get('/readyz')).ok()).toBe(true);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Starwake' })).toBeVisible();
  await expect(page.locator('#sw-llm')).toHaveText(/mock/i);

  for (const theme of ['light', 'dark', 'vga']) {
    await page.locator(`[data-theme-id="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
  expect(errors).toEqual([]);
});
