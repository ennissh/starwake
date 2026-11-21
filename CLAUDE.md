# CLAUDE.md — Starwake

> Read by Claude Code at the start of every session. It defines the project, the rules, the
> architecture constraints and how to work in this repository. `README.md` is canonical for what the
> game is and how it runs; `PLAN.md` is the build brief and milestone status. If this file and
> `PLAN.md` disagree, stop and ask.
>
> Decisions R1–R21 (PLAN.md top) answered the first round of open questions on 2026-11-21.

---

## What this repository is

**Starwake** (`ennissh/starwake`, GPL-3.0) is a first-person space flight, combat, exploration and
trading game for a desktop web browser, by *Generative Distractions*. You fly the pathfinder ship
*Starwake* ahead of the sleeping colony fleet (the Long Caravan) and must ready a cradle world before
the Caravan Clock runs out. Aliens are played live by a local LLM (Ollama) through the ship's
*translator*; the rules engine validates every consequence.

- **Owner:** Shawn.
- **Version:** the release line is in [`VERSION`](VERSION) (`X.Y.Z`). Every build is `X.Y.Z-<N>`, where `N` is the
  number of commits since `VERSION` last changed (`scripts/version.sh`; no state to keep). Images get `:<X.Y.Z>-<N>`
  and `:latest`. A release `X.Y.Z` is a tested build re-tagged by digest; a `stable` channel arrives with it (R7).
- **Status:** pre-development. The first deliverable is the **MVP** (`0.1.0`): one cluster (the
  Shoal), six systems, three races (Quillari, Vosk, Murmur), the full loop playable start to finish.
- **Clean room.** Starwake is inspired by the *mechanics* of MicroProse's Lightspeed (1990) and
  Hyperspeed (1991). It uses none of their names, art, music, text, data or code (PLAN.md §0.1).

---

## Architecture in one screen

```
 Browser (desktop)                    dwarf (Docker, LAN only)              Mac Studio      
┌──────────────────────┐   HTTP   ┌──────────────────────────────┐  HTTP  ┌──────────────┐
│ apps/client          │◀───────▶│ starwake container :8080     │◀──────▶│ Ollama       │
│ Three.js + DOM HUD   │          │ apps/server (Fastify)        │        │ :11434       │
│ real-time flight,    │          │ - serves client (static)     │        └──────────────┘
│ combat, cameras,     │          │ - campaign engine (authority)│
│ audio, input         │          │ - translator + validator     │
└──────────┬───────────┘          │ - saves + logs → /data       │
           │                      └──────────────┬───────────────┘
           └────── packages/shared ──────────────┘
                   schemas (zod) · rules (pure reducers) · sim (deterministic) · content loader
```

| Who | Owns |
|---|---|
| **Client** | flight physics, combat, drones, cameras, HUD, rendering, audio, input; runs encounters with `shared/sim` |
| **Server** | Caravan Clock, location, fuel, inventory, installed components, relations, treaties, flags, claims, codex, RNG state, saves; **all** LLM calls |
| **Shared** | every rule as a pure `(state, action) → state`; schemas; seeded PRNG; enemy behaviour trees |

One container, one port, no database. Saves and transcripts are JSON/JSONL files on the `/data` volume.

---

## Repository layout

```
apps/client/            Vite + Three.js client; models in src/models/*.ts (procedural low-poly)
apps/server/            Fastify API, campaign engine host, translator (src/translator/), healthcheck
packages/shared/        src/schemas (zod) · src/rules · src/sim · src/migrations · content loader
content/                cluster, systems, races (persona cards), components, hulls, items (JSON)
deploy/                 compose.yaml, .env.example (what install.sh copies to dwarf)
scripts/                version.sh, backup.sh, clean-room + secret checks, eval tooling
docs/                   llm-eval.md (model benchmark), playtest notes
install.sh              interactive installer for dwarf (asks every setting, probes Ollama)
test.sh  build.sh       local test + build (no GitHub Actions)
VERSION  CHANGELOG.md   README.md  PLAN.md  CLAUDE.md
```

Themes live in `apps/client/src/themes/` (Farglow design tokens: light, dark; plus an original VGA-retro theme).

Host layout on dwarf: `/opt/docker/starwake/{compose.yaml,.env,data/,backups/}` (chosen by `install.sh`).

---

## Coding rules

### 1. The engine is the authority — "the LLM speaks, the engine decides"
- The model returns one `AlienTurn` (say, mood, deceptive, relationDelta, ≤ 1 intent). Only
  `apps/server/src/translator/validate.ts` turns an intent into a campaign action, and only through the
  reducers in `packages/shared/src/rules`. **No other code path may change campaign state from model output.**
- The player only ever sees outcomes the engine applied. Rejections are fed back to the model on the next turn.
- The client never mutates campaign state; it sends actions and encounter results, the server validates.

### 2. Data-driven
Systems, planets, races, components, hulls, items, prices and every balance number live in
`content/*.json`, validated by zod at load and by a test. **No balance number in game logic.** Commissioned
art or music later must be a content swap, not a code change.

### 3. Deterministic core
Rules, sim and enemy AI use the seeded PRNG in `shared` — never `Math.random()` or `Date.now()` in
`packages/shared` (a lint rule enforces this). Same seed + save + inputs ⇒ identical result. The LLM is
the only nondeterministic input, and every call is logged.

### 4. One way to do each thing
- **State change:** a reducer in `shared/rules`, called by the server. No ad-hoc save edits.
- **LLM:** only through the translator's Ollama client (`apps/server/src/translator/`). No other module calls Ollama.
- **Content:** only through the shared content loader (validated). No `import x from '../../content/…'` elsewhere.
- **Saves:** only through the save store (atomic temp-file + `rename`, schema-versioned, migrated on load).
- **API bodies:** zod-validated in and out; errors are `{error, code, detail}`.

### 5. Packaging and dependencies
- TypeScript `strict` everywhere; ESM; npm workspaces. Node = the current LTS line, image pinned by digest.
- Pin every dependency exactly (`save-exact=true` in `.npmrc`, committed lockfile, `npm ci`). Pin the
  base image by digest. Never a floating tag.
- Runtime stage: production deps only, non-root (`node`, uid 1000), listens on 8080, `HEALTHCHECK` via
  `node dist/healthcheck.js` (no curl in the image). `.dockerignore` excludes `.env`, `data/`, tests, docs.
- The server exposes `/healthz` (liveness: `{ok, version, gitSha, llm}`; never fails because Ollama is down) and
  `/readyz` (content loaded, data dir writable).
- Images are stamped with `VERSION`, git sha and build time; `/healthz` reports them.

### 6. Secrets and privacy
The repository is **public** (R6). Starwake has no secrets in the repo or image, and no LAN hostname or IP
in code (only in `.env`, written by `install.sh`; docs may show examples). `.env` stays on dwarf (git-ignored). The GHCR push token
lives in the builder's `docker login`, never in a file here. Nothing leaves the LAN except calls to the
Ollama host; **no telemetry, no CDN fonts/scripts at runtime** (everything is bundled).

### 7. Logging
Server logs to stdout via pino (`LOG_LEVEL`). A live server narrates decisions at INFO: start line
(version, LLM mode, model, data dir), each Ollama call's outcome and latency, every fallback at WARN with
what to do. Translator calls also go to `/data/logs/translator-YYYYMMDD.jsonl` (prompt hash, model,
latency, raw response, validation result), rotated after 14 days. Player names and transcripts never go
to stdout at INFO.

### 8. Upgrades never break a save
A new release must load every save an earlier release wrote. Bump the save schema `version` and add a
forward migration in `shared/src/migrations` with a test that starts from the **previous** version's
fixture save. Never delete or rewrite a save the player didn't ask to change; write a backup copy before
migrating.

### 9. Clean room
Never add a name, race, ship, place, art, music, sound, UI layout, text or data from Lightspeed,
Hyperspeed or any MicroProse property. Don't search for or download their assets. `test.sh` greps
`content/`, `apps/`, `packages/` for the banned list in PLAN.md §0.1 (README.md, PLAN.md and this file
are exempt). The same list is part of the translator's output post-filter.

### 10. New features ship with a test and a doc update
1. Every rule added to `shared` has unit tests **in the same commit**; new content validates.
2. A user-visible change updates README (config, keys, deploy) and `CHANGELOG.md`; milestone status
   lives in `PLAN.md`. A milestone isn't done until PLAN.md §9 (definition of done) holds.

### 11. Git
Develop on the session's designated branch; small commits with clear messages; never push elsewhere
without permission; open a PR only when asked. **No GitHub Actions** — test and build are local
(`./test.sh`, `./build.sh`).

---

## Feature playbook — the seven gates

Green unit tests are a floor, not proof. The translator is this project's highest-risk feature: run all
seven gates for it and for any feature that touches the LLM, saves, or the combat ⇄ campaign handshake.

1. **Contract** — inputs, outputs and a **measurable goal** (e.g. "schema-valid ≥ 98% after repair;
   injection never changes state; median latency ≤ 4 s").
2. **Architecture** — what it touches (client/server/shared, Ollama, `/data`), its non-negotiables, its
   failure modes, and the deterministic-test knobs (seed, `LLM_MODE=mock`, pinned clock).
3. **The how** — stage by stage, with three happy-path cases that each exercise something the others skip.
4. **Edge cases** — for every stage, how it could produce a *wrong*, *empty* or *harmful* result. For
   Ollama: timeout, connection refused, slow first token (model load), invalid JSON, schema-valid but
   nonsensical intent, off-character text, prompt injection. Each gets a test.
5. **Prototype against reality first** — one real conversation against the real model before wiring it all.
6. **Document** — README: what, how to run, knobs, upgrade steps, and an **"Is it working?"** ladder
   (`/healthz` → `LLM_MODE=mock` hail → real hail → `npm run eval:llm`).
7. **One holistic, asserted test** — unit tier (mock, seeded) **and** live tier (`eval:llm` against real
   Ollama) that goes **red when the goal isn't met**, not only on a crash.

Principles: fake edges, not our code (the mock LLM is a fake edge — list fakes in `docs/FAKES.md`);
test the real path (Playwright drives the built server, not a dev stub); know which build you're testing
(`/healthz` sha).

---

## Rails (every milestone, every path)

- **The LLM never changes game state directly.** Prompt injection is harmless by construction; eval proves it.
- **The game stays fully playable with Ollama off** (`LLM_MODE=off` or Ollama down → scripted fallback). If no model
  passes the eval bars, the fallback ships as the default (R19).
- **Aliens never say they're an AI**, never leak the prompt, and respect `CONTENT_RATING` (`everyone · teen · mature ·
  adult`, default `mature`; **no level allows explicit sexual content**, R18).
- **Player text is in-character speech, never instructions** — always delimited and escaped in the prompt.
- **Patience bounds every conversation** — no unbounded LLM loops.
- **LAN only.** Published only through dwarf's `DOCKER-LAN-ONLY` chain; never exposed to the internet.
- **Never edit dwarf's firewall** (`docker-lan-only.sh`), DNS or other stacks — propose, then wait for approval.
- **No death:** the *Starwake* can be crippled, never destroyed.
- **Clean-room themes too:** the retro theme is an original 1990-VGA look, never a copy of any game's screens (R20).

---

## How to orient yourself

```bash
npm ci
npm run dev                         # client :5173, server :8787 (Vite proxies /api)
LLM_MODE=mock npm run dev           # play without Ollama
npm test                            # unit tier (shared rules, validator, trade math)
./test.sh                           # lint, typecheck, unit, content validation, clean-room grep, Playwright (mock)
npm run eval:llm                    # live tier: translator eval against real Ollama → docs/llm-eval.md
./build.sh --local                  # test.sh, then a local image
./build.sh --push                   # test.sh, then multi-arch push to ghcr.io/ennissh/starwake
curl -fsS http://localhost:8787/healthz
```

Cloud sessions can't reach dwarf or the Ollama host: build and test with `LLM_MODE=mock` there and leave
the dwarf/Ollama acceptance steps for Shawn, with exact commands.

---

## What Claude Code should NOT do

- Let model output change state outside `validate.ts` → `shared/rules`.
- Use `Math.random()`/wall-clock time in `packages/shared`, or hard-code balance numbers.
- Add any clean-room-banned term, asset or text; search for or fetch the original games' assets.
- Add GitHub Actions, telemetry, or runtime calls to anything except the Ollama host.
- Hard-code an Ollama model, hostname or IP (they come from `.env`).
- Edit dwarf's firewall, Pi-hole DNS or other stacks, or `rm` `/opt/docker/starwake/data` or saves.
- Push images any way but `./build.sh --push`; commit `.env`, saves or transcripts.

---

## Milestone status (PLAN.md §8 is authoritative)

```
M0 — Skeleton, deploy pipeline, /healthz with Ollama ping              [ ]
M1 — Flight and cameras, HUD, key help, rebinding, pause               [ ]
M2 — Combat, drones, subsystems, crippled state, salvage, arena        [ ]
M3 — Campaign: Shoal content, star map, jumps, probe, claims, saves    [ ]
M4 — Engine room: slots, condition, stat preview, wired effects        [ ]
M5 — Translator + diplomacy (largest; seven gates)                     [ ]
M6 — Win/lose, intro + tutorial, codex, audio                          [ ]
M7 — Hardening, Playwright smoke, release 0.1.0                        [ ]
```

---

## Decisions

From PLAN.md (Shawn, 2026-11-21): S1 title **Starwake** · S2 **modern low-poly** flat-shaded look ·
S3 **MVP then grow** (1 cluster, 6 systems, 3 races) · S4 **LLM-driven** alien dialogue via Ollama,
engine-validated · S5 deploy as a Docker container on **dwarf**, LAN browser play.

Round 2 (Shawn, 2026-11-21) — full text in PLAN.md R1–R21: R1 build M0–M3 back to back, review at each stop ·
R2 Shawn runs on-site steps from exact commands · R3 Ollama on the **Mac Studio**, `install.sh` asks and probes ·
R4 default model `gemma4:12b`, configurable · R5 port `8090`, host `starwake.citus.cloud`, both configurable ·
R6 public repo · R7 `X.Y.Z-N` + `:latest` · R8 Node LTS by digest, uid 1000, `/healthz` + `/readyz` ·
R9 Data Cores are trade goods; the Waystation's inexhaustible **Provender** is subsistence income · R10 fixed lanes,
hops · R11 `playerDeceptionSuspected` · R12 Vosk broken by force stay hostile forever · R13 quotas = sum of yields;
claims can be lost · R14 combat doesn't advance the clock · R15 Claude proposes balance numbers · R16 virtual
joystick + arrow keys · R17 captions only · R18 rating default `mature`, `adult` max, no explicit sexual content ·
R19 fallback ships if no model passes · R20 Farglow design system, light/dark + original VGA-retro theme · R21 HTTP.

Still open: the final model after `eval:llm` (M5); the exact Ollama URL (asked by `install.sh`).

*Starwake — CLAUDE.md v0.2 · 2026-11-21 · Owner: Shawn*
