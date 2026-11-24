# Headless UI/UX validation

`e2e/ux.spec.ts` (helpers in `e2e/ux-lib.ts`) drives every built view in headless Chromium at
1280×720, 1920×1080 and 1024×768, and in the Light and VGA themes, and checks each one for:

| Check | How |
|---|---|
| Accessibility | axe-core, WCAG 2.0/2.1/2.2 A and AA (the 3D canvas is excluded); serious and critical violations fail the run |
| Layout | HUD panels, dialogs and the title stay inside the viewport and don't overlap each other |
| Overflow | no sideways page scroll; no clipped text in dialogs, the title or the HUD |
| Target size | buttons and inputs at least 24×24 px (reported as minor) |
| Keyboard | Tab reaches a control with a visible focus style |
| Console | no page errors or console errors |

Findings go to `test-results/ux-findings.jsonl`; screenshots to `test-results/ux-shots/`.

```bash
npm run build
npx playwright test e2e/ux.spec.ts --trace off   # about 8 minutes headless
node scripts/render-mockups.mjs                  # docs/mockups/*.html → test-results/mockups/
```

It isn't part of `./test.sh` (it takes about 8 minutes); run it before a milestone stop.

## First run (2026-11-21): found and fixed

| Finding | Fix |
|---|---|
| Ship-systems panel overlapped the target panel (combat HUD, ≤1280 px wide) | systems panel moves top-right in combat; target panel and hologram fit the height left |
| Tab closed the system report instead of moving focus | Tab toggles only the star map; in other panels it moves focus |
| Low-contrast secondary text in primary buttons | inherits the button's text colour |
| VGA title panel taller than 720 px | scrolls inside its frame |
| Nested interactive roles in the star map | the map SVG is a group, not an image |
| Slider/checkbox targets under 24 px | enlarged |

Open (minor): the Settings checkbox is 20×20 px; its label makes the click area larger.

## Mockups

`docs/mockups/` holds HTML mockups of the views M4–M6 will add (engine room, translator, ambush
demand, codex, intro, tutorial, ending). They use the game's own theme CSS, so they render in Dark,
Light and VGA.
