# Changelog

## 0.1.0 (in progress)

### Review fixes (M3 stop)
- Closing a campaign panel with its own key (Tab/I/H) no longer reopens it.
- Esc while rebinding cancels only the capture; mouse buttons can be bound from the Controls screen.
- Failed fight starts show "Signal lost" with Retry instead of a blank screen.
- Detonated drones count as spent; VGA radar/hologram placement fixed on any window shape;
  `/readyz` reports content; save loads that migrate run under the save's lock.

### M3 · Campaign layer
- The Shoal: six systems with planets (resources, temperatures, the habitable Cradle), fold lanes
  with Vosk ambushes, patrols, the Waystation; races' diplomacy defaults; campaign rules in
  `content/rules.json` (clock, fuel, range, quotas, relations, salvage, raids).
- Pure campaign reducers in `packages/shared`: jump (lanes, range from Nav Cores, fuel from Fold Drive
  output, time, ambush and patrol rolls, beacon raids), probe (one per visit), claim (with the
  hostile-act penalty), dock (refuel, repair, restock, Provender), repair, buy, salvage (diminishing),
  attack a base, signal the Caravan; encounter results (victory, emergency fold, lifeboat; breaking
  the Vosk by force); Colony Readiness; save schema with migrations and a v1 fixture.
- Server: profiles (name only, settings stored per profile), atomic save slots (auto + 3), campaign
  actions, encounter start/result. Fight results are verified by **replaying the browser's command
  log** through the same sim, with a plausibility fallback.
- Client: pilot picker, New game / Continue / Load, system scenes (Waystation, Quillari spire, Murmur
  cloud, Cinder Hold), campaign status bar, star map, system report, readiness, salvage, endings,
  save/load in the pause menu.

### M2 · Combat
- Deterministic encounter sim in `packages/shared` (60 Hz, seeded): Spinal Lance beam, turret (WAKE
  point defence or manual aim with assist), Hornet/Lance/Ram drones (8 frames, 3 out, recall/dock),
  fore/aft shields, hull damage wearing random installed components, crippled choice (emergency fold
  loses 2–3 components, or lifeboat), salvage tables, finite reserves.
- Armour rule (penetration ≥ armour) and shield emitters blocking the Lance; tested for every pairing.
- Behaviour trees per hull class: fighters attack-run, break off, evade and flee; frigates hold
  standoff and call for help; the base launches its finite reserve.
- Content: components (7 families × 3 tiers), weapons, Vosk fighter/frigate/base, drones, races,
  arena encounters, starting loadout (systems at 40–55%).
- Client: Vosk and drone models, bolts/beams/explosions, target brackets and lead marker, target
  hologram, combat status panel, drone cockpit camera, practice arena (title menu), crippled and
  result/salvage screens. System status icons now show real outputs.
- Holistic balance test: a sensible scripted pilot beats 1 frigate + 4 fighters; a passive one is
  crippled (3 seeds). Notes in `docs/playtest-m2.md`.

### M1 · Flight and cameras
- Shared deterministic flight model (assisted and drift), tested; flight stats in `content/player.json`.
- Flight test scene: three-layer starfield, tinted skybox, speed dust, bloomed star, low-poly planet, nav buoys.
- Cameras: bridge, chase (spring follow), orbit (drag/wheel), turret (360° aim); smooth blends. Drone cockpit
  joins the cycle in M2.
- HUD: speed and throttle, flight mode, virtual-joystick marker, system status icons, 3D radar globe.
- Input: virtual joystick (pointer lock, or cursor offset without it) plus arrow keys; rebindable keys with
  conflict handling, stored per profile; pause menu (controls, settings, key help); F1/? help; ` perf overlay.
- Title screen with click-to-begin gate. VGA theme renders the 3D view at 320×200.

### M0 · Skeleton and deploy pipeline
- npm-workspaces monorepo (`packages/shared`, `apps/server`, `apps/client`), TypeScript strict, ESLint
  (bans `Math.random`/`Date.now` in shared), Prettier, Vitest, Playwright.
- Server: Fastify with `/healthz` (version, git sha, cached Ollama probe: `up · down · mock · off`),
  `/readyz` (data dir writable), uniform `{error, code, detail}` errors, static client with cache headers.
- Client: rotating procedural low-poly *Starwake*, theme switcher (Light, Dark, original VGA 1990).
- Seeded PRNG (sfc32) with serialisable state, tested.
- Docker image (Node 26 LTS pinned by digest, non-root uid 1000, read-only root fs, HEALTHCHECK).
- `install.sh`: interactive installer for dwarf (port check, in-container Ollama probe with firewall
  diagnosis, model list, rating, daily backup), `build.sh` (`X.Y.Z-N` builds, `:latest`, `--release`),
  `test.sh`, clean-room and secret checks, `backup.sh`.
