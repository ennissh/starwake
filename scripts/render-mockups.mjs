// Render docs/mockups/*.html to PNG (dark, light and VGA) for the review page.
// Usage: node scripts/render-mockups.mjs [outDir]
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] ?? 'test-results/mockups');
mkdirSync(out, { recursive: true });
const dir = resolve('docs/mockups');
const exe = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  for (const theme of ['dark', 'light', 'vga']) {
    await page.goto(`file://${join(dir, f)}`);
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(out, `${f.replace('.html', '')}${theme === 'dark' ? '' : `--${theme}`}.png`),
    });
  }
}
await browser.close();
console.log(`rendered to ${out}`);
