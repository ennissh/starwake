import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/**
 * UI/UX validation helpers for the headless suite (e2e/ux.spec.ts): accessibility (axe-core, WCAG 2
 * A/AA), layout (panels inside the viewport and not overlapping), overflow, target size, keyboard
 * focus visibility and console errors. Every finding is written to test-results/ux-findings.jsonl;
 * screenshots go to UX_SHOTS (default test-results/ux-shots) for the review page.
 */
export const SHOTS = process.env.UX_SHOTS ?? 'test-results/ux-shots';
const FINDINGS = 'test-results/ux-findings.jsonl';
mkdirSync(SHOTS, { recursive: true });

export interface Finding {
  view: string;
  viewport: string;
  theme: string;
  check: string;
  severity: 'serious' | 'minor';
  detail: string;
}

/** Panels that must stay on screen and must not overlap each other when visible. */
const PANELS = [
  '.hud__systems',
  '.hud__radar',
  '.chud__status',
  '.chud__target',
  '.chbar',
  '.hud__bottom',
  '.sw-dialog',
  '.sw-title-screen',
];

/** Losing pointer lock pauses the game by design (alt-tab, Esc); in headless runs that can
 * happen during an audit, so flows resume explicitly before sending game keys. */
export async function flying(page: Page): Promise<void> {
  const resume = page.getByRole('dialog', { name: 'Paused' });
  if (await resume.isVisible().catch(() => false))
    await page.getByRole('button', { name: 'Resume' }).first().click();
}

export async function setTheme(page: Page, theme: string): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event('resize'));
  }, theme);
  await page.waitForTimeout(250);
}

export async function audit(
  page: Page,
  view: string,
  opts: { shot?: boolean; overlapIgnore?: string[][]; hud?: boolean } = {},
): Promise<Finding[]> {
  if (opts.hud) await flying(page);
  const vp = page.viewportSize()!;
  const viewport = `${vp.width}x${vp.height}`;
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
  const f: Finding[] = [];
  const add = (check: string, severity: Finding['severity'], detail: string) =>
    f.push({ view, viewport, theme, check, severity, detail });

  // 1. Accessibility (the canvas is the 3D view and is excluded).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('#scene')
    .analyze();
  for (const v of axe.violations) {
    const sev = v.impact === 'serious' || v.impact === 'critical' ? 'serious' : 'minor';
    const targets = v.nodes
      .slice(0, 4)
      .map((n) => n.target.join(' '))
      .join(' | ');
    add(`a11y:${v.id}`, sev, `${v.help} (${v.nodes.length}×) ${targets}`);
  }

  // A HUD view must be measured as the player sees it, not under the pause menu.
  if (opts.hud) {
    await flying(page);
    await page.waitForTimeout(150);
  }
  // 2. Layout: visible panels inside the viewport and not overlapping one another.
  const boxes = await page.evaluate((sels) => {
    const out: { sel: string; x: number; y: number; w: number; h: number }[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
        out.push({ sel, x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return out;
  }, PANELS);
  for (const b of boxes) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > vp.width + 1 || b.y + b.h > vp.height + 1)
      add(
        'layout:offscreen',
        'serious',
        `${b.sel} extends past the viewport (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`,
      );
  }
  const modal = boxes.some((b) => b.sel === '.sw-dialog');
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (modal) continue; // a modal deliberately covers the HUD
      if (
        (opts.overlapIgnore ?? []).some(
          ([p, q]) => (p === a.sel && q === b.sel) || (p === b.sel && q === a.sel),
        )
      )
        continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2)
        add(
          'layout:overlap',
          'serious',
          `${a.sel} overlaps ${b.sel} by ${Math.round(ox)}×${Math.round(oy)} px`,
        );
    }
  }

  // 3. Overflow: no horizontal page scroll; no clipped text inside dialogs.
  const overflow = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px)`);
    for (const el of document.querySelectorAll<HTMLElement>(
      '.sw-dialog *, .sw-title-screen *, .hud *, .chbar',
    )) {
      const cs = getComputedStyle(el);
      if (el.closest('[hidden]') || cs.display === 'none') continue;
      if (
        el.scrollWidth > el.clientWidth + 2 &&
        (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis')
      )
        out.push(
          `clipped: <${el.tagName.toLowerCase()} class="${el.className}"> ${el.textContent?.trim().slice(0, 40)}`,
        );
    }
    return out;
  });
  for (const o of overflow) add('layout:overflow', 'serious', o);

  // 4. Target size (WCAG 2.5.8): visible buttons at least 24×24 CSS px.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, [role="button"], select, input')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          !el.closest('[hidden]') &&
          !el.classList.contains('sw-link') &&
          (r.width < 24 || r.height < 24)
        );
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`,
      ),
  );
  for (const s of small.slice(0, 6)) add('a11y:target-size', 'minor', s);

  if (opts.shot !== false)
    await page.screenshot({
      path: join(
        SHOTS,
        `${view}${theme && theme !== 'dark' ? `--${theme}` : ''}${vp.width === 1280 ? '' : `--${viewport}`}.png`,
      ),
    });
  for (const x of f) appendFileSync(FINDINGS, JSON.stringify(x) + '\n');
  return f;
}

/** Keyboard: Tab moves focus to a visible control with a visible focus indicator. */
export async function auditFocus(page: Page, view: string, presses = 4): Promise<Finding[]> {
  const out: Finding[] = [];
  const vp = page.viewportSize()!;
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { ok: false, why: 'focus went nowhere' };
      const cs = getComputedStyle(el);
      const visible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== 'none';
      return {
        ok: visible || shadow,
        why: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" has no visible focus style`,
      };
    });
    if (!r.ok)
      out.push({
        view,
        viewport: `${vp.width}x${vp.height}`,
        theme: '',
        check: 'a11y:focus-visible',
        severity: 'serious',
        detail: r.why,
      });
  }
  for (const x of out) appendFileSync(FINDINGS, JSON.stringify(x) + '\n');
  return out;
}

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export const serious = (fs: Finding[]) => fs.filter((x) => x.severity === 'serious');

/** Fail the test listing every serious finding (minor ones are reported only). */
export function expectClean(fs: Finding[]): void {
  expect(serious(fs).map((x) => `[${x.view} ${x.viewport} ${x.theme}] ${x.check}: ${x.detail}`)).toEqual([]);
}
