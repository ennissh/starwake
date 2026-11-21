# Changelog

## 0.1.0 (in progress)

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
