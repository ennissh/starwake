# Fakes used in tests

Fake the edges, not our code. Every fake is listed here.

| Fake | Replaces | Where | Notes |
|---|---|---|---|
| `fakeFetch` | Ollama `/api/tags` over HTTP | `apps/server/test/health.test.ts` | Scripted responses: model present / missing / HTTP 500 / connection refused |
| `LLM_MODE=mock` | Ollama | Playwright smoke (`playwright.config.ts`) | `/healthz` reports `mock`; canned alien replies arrive in M5 |
| `sensiblePilot`, `passivePilot` | A human at the controls | `packages/shared/test/bots.ts` | Scripted pilots for the combat balance check and replay tests; they aim perfectly |
| Forged `EncounterResult` | A cheating or buggy client | `apps/server/test/campaign.test.ts` | Proves the server rejects results the replay and the bounds check can't support |
