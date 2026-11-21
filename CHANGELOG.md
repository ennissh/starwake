# Changelog

## 0.1.0 (in progress)

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
