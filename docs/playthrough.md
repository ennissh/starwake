# Headless playthrough

`e2e/playthrough.spec.ts` plays a whole campaign in headless Chromium through the real UI: the title
screen, Continue, probes, claim beacons, the star map, fold jumps, the Waystation, Colony Readiness and
signalling the Caravan. A second run burns the clock to the losing ending. Each run also reloads
mid-game and checks that Continue restores the exact state.

The only fake is the pilot's hands in fights. The `autopilot` test hook flies the scripted "sensible"
pilot from `packages/shared/src/sim/combat/pilots.ts`, and `timeScale` runs the sim 6× faster. The
pilot's commands still go through the real sim, recorder and server replay; every fight's server check
must come back `verified`.

```bash
npm run build
npm run e2e:playthrough                       # win and lose, about 6 minutes
PLAYTHROUGH_SEED=my-seed npm run e2e:playthrough
./test.sh --full                              # everything, including this
```

Each run writes `test-results/playthrough/<run>.md` and `.json` (a timeline of clock, fold mass,
hull and claims per step) and screenshots.

## Route (win)

Harbor: Anvil → Saltmarrow: Brinehold, Marrow → reload and Continue → dock at the Waystation →
Glass Reach: Frostglass (angers the Quillari; not war) → Cinder Gate: probe, attack Cinder Hold, break
the Vosk → Slag → Verdance: Verdance Prime → Colony Readiness → signal the Caravan.

## Results (2026-11-22, build 0.1.0-N)

| Seed | Outcome | Years used | Fights | Server checks | Wall time |
|---|---|---|---|---|---|
| playthrough-1 | won | 1.06 of 10 | ambush + Cinder Hold | verified, verified | 1.8 min |
| playthrough-2 | won | 1.06 of 10 | ambush + Cinder Hold | verified, verified | 1.9 min |
| playthrough-3 | won | 1.06 of 10 | Cinder Hold | verified | 1.9 min |
| lose run | lost (clock 0) | 10 of 10 | none | — | 4.2 min |

## What it found

1. **Bug, fixed:** after a won fight with salvage the mouse was locked under the salvage panel
   (pointer lock was granted after the panel had already released it), so "Take selected" couldn't
   be clicked.
2. **Bug, fixed:** running out of clock from a Waystation action didn't show the losing ending.
3. **Balance:** a perfect route needs only about **1.1 years of the 10-year clock**, and the scripted
   pilot finished every fight at 100% hull. A human will wander, refit and lose fights, but the clock
   currently puts no pressure on the run. See the proposal below.

## Clock proposal (for Shawn to decide)

The perfect route spends 0.86 years on jumps (17.2 pc × 0.05) and 0.1 on one refit. Options:

| Option | Change in `content/rules.json` | Perfect run | Feel |
|---|---|---|---|
| A | `startYears` 10 → 4 | 1.1 of 4 | Same costs, about 3.6× slack |
| B | `jumpYearsPerParsec` 0.05 → 0.15, `refitYears` 0.1 → 0.25 | about 2.9 of 10 | Every jump matters; the clock reads as years |
| C | B, plus `startYears` 10 → 8 | about 2.9 of 8 | Tightest; one lifeboat (1.5 yr) hurts |

The recommendation is **B**: it keeps the 10-year story, makes each fold visibly expensive and leaves
room for exploring, mistakes and a lifeboat. Combat difficulty is a separate tuning pass (see
`docs/playtest-m2.md`).
