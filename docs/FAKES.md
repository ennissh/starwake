# Fakes used in tests

Fake the edges, not our code. Every fake is listed here.

| Fake | Replaces | Where | Notes |
|---|---|---|---|
| `fakeFetch` | Ollama `/api/tags` over HTTP | `apps/server/test/health.test.ts` | Scripted responses: model present / missing / HTTP 500 / connection refused |
| `LLM_MODE=mock` | Ollama | Playwright smoke (`playwright.config.ts`) | `/healthz` reports `mock`; canned alien replies arrive in M5 |
| `sensiblePilot`, `passivePilot` | A human at the controls in a fight | `packages/shared/src/sim/combat/pilots.ts` | Scripted pilots for the combat balance check, replay tests and (via the client's `autopilot` test hook) the headless playthrough; they aim perfectly. Their commands go through the real sim, recorder and server replay |
| `timeScale` test hook | Real time | client `window.__starwake.timeScale(n)` | Runs the sim up to 8× faster in the playthrough; commands per tick are unchanged, so replay still matches |
| Forged `EncounterResult` | A cheating or buggy client | `apps/server/test/campaign.test.ts` | Proves the server rejects results the replay and the bounds check can't support |
