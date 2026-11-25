# Starwake

*A Generative Distractions game.*

Starwake is a first-person space flight and trading game that runs in a web browser. You fly a lone pathfinder ship, the *Starwake*, ahead of a sleeping colony fleet called the Long Caravan. Your job is to find the Caravan a home before its clock runs out. You do that by:

- **Flying:** bridge, chase, orbit, turret and drone-cockpit cameras.
- **Fighting:** spinal lance, a 360° turret, and drones you launch and fly yourself. Precise targeting lets you knock out shield emitters, turrets and engines one at a time.
- **Exploring:** fold-jump between star systems, send surveyor probes, and stake claim beacons on resource worlds.
- **Trading and talking:** aliens are played live by a local LLM through your ship's *translator*. They bargain, bluff, hold grudges and remember you.
- **Upgrading:** salvage and trade for components, then rebuild the ship's systems slot by slot in the engine room.

Starwake is an **original work inspired by the design of MicroProse's Lightspeed (1990) and Hyperspeed (1991)**. It uses no names, art, music, text, data or code from those games or any other MicroProse/Atari property. See the "Clean-room rules" section in PLAN.md.

---

## Status

In development: **M0–M3 are built**: the installer and image, flight and cameras, combat and the practice arena, and the campaign (the Shoal, jumps, probes, claims, the Waystation, Colony Readiness, saves). Next: M4 engine room, M5 translator, M6 onboarding and audio (PLAN.md §8). PLAN.md is the build plan for Claude Code. The first deliverable is an **MVP**: one star cluster (the Shoal), six systems, three alien races, and the full loop playable from start to finish.

## How it runs

```
 Browser (desktop)                     dwarf (Docker)                       Mac Studio
┌──────────────────────┐   HTTP    ┌──────────────────────────────┐  HTTP  ┌──────────────┐
│ Three.js client      │◀────────▶│ starwake container           │◀──────▶│ Ollama       │
│ - flight & combat    │           │ - serves client (static)     │        │ :11434       │
│ - HUD, menus         │           │ - campaign engine (authority)│        └──────────────┘
│ - real-time sim      │           │ - LLM translator + validator │
└──────────────────────┘           │ - saves → /data volume       │
                                   └──────────────────────────────┘
```

- **Client:** TypeScript, Vite and Three.js. Real-time flight and combat run in the browser.
- **Server:** Node.js LTS, Fastify and TypeScript. It owns the campaign state (time, inventory, relations, trades, treaties) and is the only thing that talks to Ollama.
- **Shared package:** game rules, data schemas (zod) and the deterministic simulation. Client and server both use it.
- **Storage:** JSON save files and an LLM transcript log, kept in a mounted volume. No database.
- **One container, one port.** It is LAN-only, protected by dwarf's existing `DOCKER-LAN-ONLY` iptables chain.

## Requirements

| Where | What |
|---|---|
| dwarf | Docker Engine with Compose v2; stacks under `/opt/docker` |
| Ollama host | Ollama on the **Mac Studio**, reachable from dwarf on port 11434 (`launchctl setenv OLLAMA_HOST 0.0.0.0`, then restart Ollama), with an instruct model that handles JSON-schema output (default `gemma4:12b`) |
| Player | Desktop Chrome, Edge or Firefox; keyboard and mouse (gamepad is a later feature; Firefox only allows it over HTTPS) |
| Dev machine | Node.js 22.12+ (the image runs Node 26 LTS), npm, Docker with buildx; optional `shellcheck`, `gitleaks` |

## Quick start (development)

```bash
npm ci
cp .env.example .env            # set OLLAMA_URL and OLLAMA_MODEL
npm run dev                     # client on :5173, server on :8787 (Vite proxies /api)
npm test                        # unit tests (shared rules, validator, trade math)
npm run eval:llm                # LLM diplomacy eval against your real Ollama
LLM_MODE=mock npm run dev       # play without Ollama (canned alien replies)
```

## Deploy to dwarf

**1. Publish an image.** On GitHub: **Actions → Publish images → Run workflow** (branch `main`). It runs
`./test.sh`, then pushes `ghcr.io/ennissh/starwake:<X.Y.Z-N>` and `:latest` for amd64 and arm64. Tick
*release* to also promote that build to `X.Y.Z` and `:stable`. It never runs on its own.

The first time, make the package pullable without a login: GitHub → your profile → **Packages →
starwake → Package settings → Change visibility → Public** (or run `docker login ghcr.io` on dwarf with
a token that has `read:packages`).

Without Actions, the same thing from any machine with Docker: `docker login ghcr.io`, then
`./build.sh --push`.

Install or reconfigure (on dwarf). `install.sh` asks every setting, checks the port, probes Ollama
**from inside a container** (the real path through `DOCKER-USER`), lists the models on the Ollama host,
writes `/opt/docker/starwake/{compose.yaml,.env}`, chowns the data directory to uid 1000, optionally
installs a daily backup, starts the container and waits for `/healthz`.

**2. Install on dwarf.** `install.sh` is one self-contained file (it carries the compose file and the
backup script), so dwarf needs nothing else from the repository:

```bash
curl -fsSLO https://raw.githubusercontent.com/ennissh/starwake/main/install.sh
sudo bash install.sh
```

- Re-run it any time: it offers your saved answers (`--settings saved|review|fresh`).
- Upgrade to the newest build: fetch `install.sh` again, then `sudo bash install.sh --settings saved`.
- A specific build: `sudo bash install.sh --tag 0.1.0-17`.
- Scripted: `sudo OLLAMA_URL=http://mac-studio.lan:11434 bash install.sh --non-interactive`.
- It never edits the firewall, Pi-hole or other stacks; it prints what to change. Then by hand:
  1. Pi-hole local DNS: `starwake.citus.cloud → <dwarf's LAN IP>` (your `local-dns.txt`).
  2. Check that the LAN subnets you play from are allowed for the port in `DOCKER-LAN-ONLY`.
  3. Uptime Kuma: HTTP keyword monitor on `http://starwake.citus.cloud:8090/healthz`, keyword `"ok":true`.
  4. Open `http://starwake.citus.cloud:8090` in a desktop browser.

### Is it working? (cheapest check first)

1. `curl -fsS http://localhost:8090/healthz` on dwarf → `{"ok":true,"version":"0.1.0-N",…}`
2. `curl -fsS http://localhost:8090/readyz` → `{"ready":true,…}` (data directory writable)
3. `/healthz` shows `"llm":"up"`: the container reaches Ollama and the model is installed
4. The page loads at `http://starwake.citus.cloud:8090` from another LAN machine and shows *Translator: online*
5. **Mock hail** (no Ollama needed): run a copy with `LLM_MODE=mock`, fly to Glass Reach and press **V**.
   The Quillari answer from their phrasebook; the status line says *Translator (mock)*
6. **Real hail**: with `LLM_MODE=ollama`, hail the Quillari. Replies should take a few seconds
   (*decoding…*); *Signal degraded* means Ollama failed and the scripted fallback answered. Each call is
   in `/opt/docker/starwake/data/logs/translator-YYYYMMDD.jsonl` (latency, raw reply, validation)
7. **Benchmark the model** from a checkout on any LAN machine (see *Translator* below):
   `OLLAMA_URL=http://<mac-studio>:11434 npm run eval:llm -- --models gemma4:12b`

### Versions

`VERSION` holds the release line (`X.Y.Z`). Every build is `X.Y.Z-N`, where `N` counts commits since
`VERSION` last changed (`scripts/version.sh`). `:latest` follows every build. `./build.sh --release`
re-tags a tested build as `X.Y.Z` and `:stable` by digest; then bump `VERSION`.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8090` | Host port published by compose (the container listens on 8080) |
| `STARWAKE_HOSTNAME` | `starwake.citus.cloud` | Name players use (DNS and messages only) |
| `STARWAKE_IMAGE` · `STARWAKE_TAG` | `ghcr.io/ennissh/starwake` · `latest` | Image to run (`latest` or an exact `X.Y.Z-N`) |
| `STARWAKE_DATA` | `/opt/docker/starwake/data` | Host directory mounted at `/data` (saves, profiles, transcripts), uid 1000 |
| `OLLAMA_URL` | *(asked; no default)* | Ollama base URL on the Mac Studio, e.g. `http://mac-studio.lan:11434` |
| `OLLAMA_MODEL` | `gemma4:12b` | Model tag used by the translator; confirmed with `npm run eval:llm` |
| `OLLAMA_TIMEOUT_MS` | `20000` | Per-request timeout; on timeout the translator degrades gracefully |
| `LLM_MODE` | `ollama` | `ollama` · `mock` (canned replies, used in tests) · `off` (scripted fallback only) |
| `LLM_TEMPERATURE` | `0.7` | Alien creativity |
| `CONTENT_RATING` | `mature` | Tone guard for alien dialogue: `everyone` · `teen` · `mature` · `adult` (no level allows explicit sexual content) |
| `LOG_LEVEL` | `info` | Server log level |

`install.sh` writes these to `/opt/docker/starwake/.env`. For development, copy `.env.example` to `.env`.

## Themes

Light and dark follow the Farglow design system's colours and fonts (Inter Tight, IBM Plex Mono). **VGA 1990**
is an original retro look: pixel font, 16-colour palette, and the 3D view rendered at full resolution and then mapped onto the
16-colour VGA palette with an ordered dither (retro colours, modern sharpness). Themes switch from the
title screen; the choice is remembered per browser (per profile from M3).

## Controls (default, rebindable)

| Action | Key |
|---|---|
| Pitch / yaw | Arrow keys (↑ dives, ↓ climbs); or the mouse as a virtual joystick when mouse steering is on |
| Mouse steering on/off (off by default) | L (also Esc → Settings) |
| Roll | Q / E |
| Throttle up / down · full · stop | W / S · Shift+W · X |
| Flight assist on/off (drift mode) | Z |
| Fire selected weapon | Left mouse / Space |
| Cycle camera (bridge → chase → orbit → turret → drones) | C |
| Next / previous target · target subsystem | T / Shift+T · Y |
| Face target (hold: the helm turns the nose onto it) | G |
| Match target speed | M |
| Launch Hornet (fighter) / Lance (homing) / Ram (kamikaze torpedo) drone · recall | 1 / 2 / 3 · R |
| Star map · System report and services · Colony Readiness | Tab · I · H |
| Engine room · Codex | F · K (M6) |
| Probe system · Hail ship or base | P · V (the translator arrives in M5) |
| Ask the advisors (WAKE and the council) | Enter or N |
| Fold jump (from star map) · Emergency fold | J · Shift+J (hold 1 s) |
| Key help overlay | F1 or ? |
| Performance overlay (fps, draw calls) | ` |
| Pause / release mouse | Esc |

Browser-reserved keys (Ctrl/Alt/Meta combinations, F5, F11, F12) can never be bound; Esc always pauses. Rebind keys in the pause menu (Esc → Controls).

**Mouse.** Mouse steering is off by default: the arrow keys steer and the cursor stays free (click to fire).
Press **L** (or Esc → Settings → "Mouse steers the ship") to make the mouse a virtual joystick in the
bridge and chase views (pointer lock; offset from centre = turn rate). Orbit and turret views always use
the mouse to look.

**Aiming the Lance.** The Spinal Lance fires along the keel. Target a ship (**T**, a subsystem with **Y**),
then hold **G**: the helm turns the nose onto it. The target panel shows how many degrees off you are;
within the assist cone (`player.json` → `lance.assistConeDeg`, 4°) the beam bends onto the target and
the bracket turns green ("LANCE ON TARGET").

**Advisors.** Press **Enter** to ask WAKE, the Navigator, the Quartermaster or Tactical anything: click a
suggested question or type your own. Answers come from what you know of the campaign (what to do next,
routes, readiness, fuel, threats, combat) and use your own key bindings. They are scripted and
deterministic for now (`content/advisors.json`, `packages/shared/src/rules/advisor.ts`); when a question
doesn't match, the advisor says so rather than guess. M5 may route them through the translator.

**Tutorial.** A new game starts WAKE's first-flight checklist (throttle, steer, camera, advisors, probe,
claim, readiness, star map, fold). Each step completes when you do it; skip it from the card, replay it
from Esc → Replay tutorial.

## Translator (M5): talking to aliens

Hail the system's occupant with **V** (or *Hail* in the system report). When a Vosk ambush or patrol
pulls you out of a fold they hail first: answer, or fight. The translator screen shows the alien's
portrait (mood, and its **tell** when the translator catches a lie), the transcript, relation and
patience meters, quick chips (*about yourselves · the cluster · treaty · passage · trade · leave*),
free text, and a trade panel with a balance bar.

**The LLM speaks; the engine decides.** Each turn the model (Ollama, `OLLAMA_MODEL`) returns one JSON
`AlienTurn`; `apps/server/src/translator/validate.ts` applies, alters or refuses its intent through the
shared rules, so prompt injection can't change the game. Relation moves at most ±8 per turn and ±20 per
conversation; patience bounds every conversation. If Ollama is off, down or slow the conversation drops
to a scripted phrasebook (*Signal degraded*) and the game stays fully playable (`LLM_MODE=off` makes
that the default, R19).

- **Trade goods:** Data Cores, Provender, **crates** (each claimed world ships its resource as crates
  every time you arrive in its system), **Survey Logs** (the first probe of each system writes one; the
  Murmur love them), components and fold mass. Races also sell *claim permits* and *safe passage*.
- **The Vosk** can be dealt with three ways: **treaty** (beat them in a fight or pay tribute, then talk
  them up to the threshold), **tribute** (pay twice and they stop counting you as prey), or **force**
  (break Cinder Hold; hostile forever).
- **Memory:** closing a channel writes a short summary from the alien's point of view; it and the last
  12 turns go into the next conversation.
- **Advisors** answer scripted questions themselves; a question they can't match goes to the model with
  the engine's facts (read-only), and to the scripted "I don't know" if Ollama is unavailable.

**Benchmark (`npm run eval:llm`).** Runs ~30 golden scenarios (10 per race: greeting, fair and lopsided
trades, treaty below threshold, three injection attempts, secrets, insults, 10 turns in character)
through the real translator and validator against a real model, three times each by default, and
writes `docs/llm-eval.md`. Bars: schema-valid ≥ 98% after repair, injection never changes state, in
character under injection ≥ 90%, median latency ≤ 4 s. It exits non-zero if no model passes.

```bash
OLLAMA_URL=http://mac-studio.lan:11434 npm run eval:llm -- --models gemma4:12b,qwen3:14b --runs 3
```

Pick the passing model for `OLLAMA_MODEL` in `.env`; if none passes, set `LLM_MODE=off`.

## Playing the campaign (M3)

1. Title → add a pilot (name only) → **New game**. You start in Harbor beside the Waystation.
2. **P** launches the surveyor probe (one per visit) and opens the **system report** (**I** reopens it):
   planets, resources, the habitable tag, occupants, and the Waystation's services (dock and refit,
   Mk I parts for Data Cores).
3. Place **claim beacons** on resource worlds (3 carried; restock by docking). Claiming in someone's
   system without permission angers them; hostile patrols can destroy beacons while you're away.
4. **Tab** opens the star map: drag to rotate, click a system, **J** to fold along a lane. Jumps cost
   fold mass and Caravan Clock time; range comes from the Nav Cores. The fold plays a short
   transition and an "Arrived: <system>" card (a plain fade with reduced motion).
5. Vosk ambush the lanes past Glass Reach and patrol Cinder Gate and Verdance. Fights use the M2
   combat; the server checks every result by replaying your fight.
6. **H** shows Colony Readiness: a Cradle world, the four resource quotas, safety (no hostile race
   within 2 jumps of the Cradle) and the clock. Meet all four, go to the Cradle and signal the Caravan.

**Engine room (F).** Six systems with slots, and the hold. Click a part (or drag it), then click where it
goes: a slot that takes its family, or "To the hold". The table previews jump range, fold mass per
parsec, speed, turn rate, Lance and turret damage per second and shields before you confirm. Refits are
free at the Waystation and cost 0.01 years per swap anywhere else. Each system's output (the sum of its
parts' output × condition, over its maximum) drives the stats through multipliers in
`content/player.json` → `effects`; the starting loadout is tuned to about ×1.0.

The game autosaves after every action; the pause menu (Esc → Save / load) keeps three manual slots.

## Repository layout

```
starwake/
├── apps/client/        Three.js game client (Vite)
├── apps/server/        Fastify API, campaign engine host, LLM translator
├── packages/shared/    rules, schemas (zod), deterministic sim, content loader
├── content/            data-driven game content (JSON): cluster, races, components, items
├── deploy/             compose.yaml, .env.example (installed by install.sh)
├── scripts/            version.sh, backup.sh, clean-room + secret checks, eval tooling
├── e2e/                Playwright smoke tests (against the built server, mock LLM)
├── install.sh          interactive installer for dwarf
├── test.sh · build.sh  local test cycle and image build
├── .github/workflows/  images.yml: the manual-only "Publish images" workflow
├── Dockerfile
├── README.md
└── PLAN.md
```

## Backups

Everything that matters is in `/opt/docker/starwake/data`. `install.sh` can install a daily cron job (`/etc/cron.d/starwake-backup`, 03:17) that runs `backup.sh` and keeps the last 14 tarballs in `/opt/docker/starwake/backups`. Run one by hand with `sudo /opt/docker/starwake/backup.sh`. Restore steps are at the top of `scripts/backup.sh`.

## Legal

Starwake is original and licensed GPL-3.0. Bundled fonts (Inter Tight, IBM Plex Mono, VT323) are under the SIL Open Font License 1.1. Lightspeed, Hyperspeed and MicroProse are trademarks of their respective owners, are mentioned here only to credit the inspiration, and are not affiliated with this project. Never add assets, text, music or data extracted from those games to this repository or its images.
