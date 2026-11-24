import { expect, test, type Page } from '@playwright/test';
import { type Finding, audit, auditFocus, expectClean, flying, setTheme, watchErrors } from './ux-lib.js';

/**
 * UI/UX validation in a headless browser: every major view, three viewports, three themes.
 * Run alone with `npx playwright test e2e/ux.spec.ts`; screenshots land in test-results/ux-shots.
 */
type Hook = Record<string, () => unknown>;
const hook = (page: Page, name: string) =>
  page.evaluate((n) => (window as unknown as { __starwake: Hook }).__starwake[n]!(), name);

async function begin(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Click to begin' }).click();
  await expect(page.getByRole('heading', { name: 'Starwake' })).toBeVisible();
}

async function pilot(page: Page, name: string): Promise<void> {
  await page.getByLabel('New pilot name').fill(name);
  await page.getByRole('button', { name: 'Add pilot' }).click();
  await expect(page.locator('#sw-pilot')).toBeVisible();
}

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, colorScheme: 'dark' });

    test('title, flight HUD, cameras, pause menus', async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      const f: Finding[] = [];
      await page.goto('/');
      f.push(...(await audit(page, '01-title-gate')));
      await page.getByRole('button', { name: 'Click to begin' }).click();
      await pilot(page, `UX ${vp.width}`);
      f.push(...(await audit(page, '02-title')));
      f.push(...(await auditFocus(page, '02-title')));
      await page.getByRole('button', { name: 'Flight test' }).click();
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1500);
      await page.keyboard.up('KeyW');
      f.push(...(await audit(page, '03-flight-chase', { hud: true })));
      await flying(page);
      for (const [i, cam] of ['orbit', 'turret', 'bridge'].entries()) {
        await flying(page);
        await page.keyboard.press('KeyC');
        await page.waitForTimeout(900);
        if (vp.width === 1280) f.push(...(await audit(page, `0${4 + i}-flight-${cam}`, { hud: true })));
      }
      await flying(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
      f.push(...(await audit(page, '07-pause')));
      for (const [tab, name] of [
        ['Controls', '08-pause-controls'],
        ['Settings', '09-pause-settings'],
        ['Key help', '10-pause-help'],
      ] as const) {
        await page.getByRole('tab', { name: tab }).click();
        f.push(...(await audit(page, name)));
      }
      expectClean(f);
      expect(errors).toEqual([]);
    });

    test('practice arena: picker, combat HUD with target, crippled, result', async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      const f: Finding[] = [];
      await begin(page);
      await page.getByRole('button', { name: 'Practice arena' }).click();
      f.push(...(await audit(page, '11-arena-picker')));
      await page.locator('[data-id="arena-base"]').click();
      await page.waitForTimeout(800);
      await flying(page);
      await page.keyboard.press('KeyT');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('KeyY');
        const sub = await page.evaluate(
          () =>
            (window as unknown as { __starwake: { flight(): { subId: string | null } } }).__starwake.flight()
              .subId,
        );
        if (sub) break;
        await page.keyboard.press('KeyT');
      }
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(1500);
      f.push(...(await audit(page, '12-combat-chase', { hud: true })));
      await flying(page);
      await page.keyboard.press('KeyC');
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(900);
      f.push(...(await audit(page, '13-combat-turret', { hud: true })));
      await flying(page);
      expect(await hook(page, 'debugCripple')).toBe(true);
      await expect(page.getByRole('dialog', { name: 'The Starwake is crippled' })).toBeVisible();
      f.push(...(await audit(page, '14-crippled')));
      await page.getByRole('button', { name: /Emergency fold/ }).click();
      await expect(page.getByRole('dialog')).toContainText('Fight again');
      f.push(...(await audit(page, '15-result')));
      expectClean(f);
      expect(errors).toEqual([]);
    });

    test('campaign: system HUD, report, star map, readiness, save/load', async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      const f: Finding[] = [];
      await begin(page);
      await pilot(page, `Camp ${vp.width}`);
      await page.getByRole('button', { name: 'New game' }).click();
      await page.waitForTimeout(1500);
      f.push(...(await audit(page, '16-campaign-harbor', { hud: true })));
      await flying(page);
      await page.keyboard.press('KeyP');
      await expect(page.getByRole('dialog')).toContainText('Anvil');
      f.push(...(await audit(page, '17-system-report')));
      f.push(...(await auditFocus(page, '17-system-report')));
      await page.keyboard.press('Escape');
      await flying(page);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('dialog')).toContainText('Star map');
      f.push(...(await audit(page, '18-star-map')));
      await page.keyboard.press('Escape');
      await flying(page);
      await page.keyboard.press('KeyH');
      await expect(page.getByRole('dialog')).toContainText('Colony Readiness');
      f.push(...(await audit(page, '19-readiness')));
      await page.keyboard.press('Escape');
      await flying(page);
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Save / load' }).click();
      await expect(page.getByRole('dialog')).toContainText('Autosave');
      f.push(...(await audit(page, '20-save-load')));
      expectClean(f);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('themes at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark' });
  for (const theme of ['light', 'vga']) {
    test(`${theme}: title, HUD, combat, report, map`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      const f: Finding[] = [];
      await begin(page);
      await setTheme(page, theme);
      await pilot(page, `Theme ${theme}`);
      f.push(...(await audit(page, '02-title')));
      await page.getByRole('button', { name: 'Practice arena' }).click();
      await page.locator('[data-id="arena-patrol"]').click();
      await page.waitForTimeout(800);
      await flying(page);
      await page.keyboard.press('KeyT');
      await page.waitForTimeout(1200);
      f.push(...(await audit(page, '12-combat-chase', { hud: true })));
      await flying(page);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Quit to title' }).click();
      await page.getByRole('button', { name: 'New game' }).click();
      await page.waitForTimeout(1200);
      await flying(page);
      await page.keyboard.press('KeyP');
      await expect(page.getByRole('dialog')).toContainText('Anvil');
      f.push(...(await audit(page, '17-system-report')));
      await page.keyboard.press('Escape');
      await flying(page);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('dialog')).toContainText('Star map');
      f.push(...(await audit(page, '18-star-map')));
      expectClean(f);
      expect(errors).toEqual([]);
    });
  }
});
