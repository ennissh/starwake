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

In development: **M0 (skeleton, Docker image, installer) and M1 (flight, cameras, HUD) are built**; M2–M3 are next (PLAN.md §8). PLAN.md is the build plan for Claude Code. The first deliverable is an **MVP**: one star cluster (the Shoal), six systems, three alien races, and the full loop playable from start to finish.

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

Build and publish (on the build machine):

```bash
./build.sh --push          # runs ./test.sh, then pushes ghcr.io/ennissh/starwake:<X.Y.Z-N> and :latest
```

Install or reconfigure (on dwarf). `install.sh` asks every setting, checks the port, probes Ollama
**from inside a container** (the real path through `DOCKER-USER`), lists the models on the Ollama host,
writes `/opt/docker/starwake/{compose.yaml,.env}`, chowns the data directory to uid 1000, optionally
installs a daily backup, starts the container and waits for `/healthz`:

```bash
git clone https://github.com/ennissh/starwake.git && cd starwake
sudo ./install.sh
```

- Re-run it any time: it offers your saved answers (`--settings saved|review|fresh`).
- Upgrade to the newest build: `git pull && sudo ./install.sh --settings saved`.
- Scripted: `sudo OLLAMA_URL=http://mac-studio.lan:11434 ./install.sh --non-interactive`.
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
is an original retro look (pixel font, 16-colour-style palette, 320×200 upscaled 3D). Themes switch from the
title screen; the choice is remembered per browser (per profile from M3).

## Controls (default, rebindable)

| Action | Key |
|---|---|
| Pitch / yaw | Mouse as a virtual joystick (pointer lock; offset from centre = turn rate) or arrow keys |
| Roll | Q / E |
| Throttle up / down · full · stop | W / S · Shift+W · X |
| Flight assist on/off (drift mode) | Z |
| Fire selected weapon | Left mouse / Space |
| Cycle camera (bridge → chase → orbit → turret → drones) | C |
| Next / previous target · target subsystem | T / Shift+T · Y |
| Match target speed | M |
| Launch Hornet / Lance / Ram drone · recall drones | 1 / 2 / 3 · R |
| Star map · Engine room · Colony status · Codex | Tab · F · H · K |
| Probe system · Hail ship or base | P · V |
| Fold jump (from star map) · Emergency fold | J · Shift+J (hold 1 s) |
| Key help overlay | F1 or ? |
| Performance overlay (fps, draw calls) | ` |
| Pause / release mouse | Esc |

Browser-reserved keys (Ctrl/Alt/Meta combinations, F5, F11, F12) can never be bound; Esc always pauses. Rebind keys in the pause menu (Esc → Controls). In bridge and chase views the mouse is a virtual joystick; in orbit and turret views it moves the camera and you fly with the arrow keys.

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
├── test.sh · build.sh  local test cycle and image build (no GitHub Actions)
├── Dockerfile
├── README.md
└── PLAN.md
```

## Backups

Everything that matters is in `/opt/docker/starwake/data`. `install.sh` can install a daily cron job (`/etc/cron.d/starwake-backup`, 03:17) that runs `backup.sh` and keeps the last 14 tarballs in `/opt/docker/starwake/backups`. Run one by hand with `sudo /opt/docker/starwake/backup.sh`. Restore steps are at the top of `scripts/backup.sh`.

## Legal

Starwake is original and licensed GPL-3.0. Bundled fonts (Inter Tight, IBM Plex Mono, VT323) are under the SIL Open Font License 1.1. Lightspeed, Hyperspeed and MicroProse are trademarks of their respective owners, are mentioned here only to credit the inspiration, and are not affiliated with this project. Never add assets, text, music or data extracted from those games to this repository or its images.
