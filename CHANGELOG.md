# Changelog

## 0.1.0 (in progress)

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
