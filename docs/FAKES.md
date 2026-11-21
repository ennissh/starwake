# Fakes used in tests

Fake the edges, not our code. Every fake is listed here.

| Fake | Replaces | Where | Notes |
|---|---|---|---|
| `fakeFetch` | Ollama `/api/tags` over HTTP | `apps/server/test/health.test.ts` | Scripted responses: model present / missing / HTTP 500 / connection refused |
| `LLM_MODE=mock` | Ollama | Playwright smoke (`playwright.config.ts`) | `/healthz` reports `mock`; canned alien replies arrive in M5 |
