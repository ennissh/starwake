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

Pre-development. PLAN.md is the build plan for Claude Code. The first deliverable is an **MVP**: one star cluster (the Shoal), six systems, three alien races, and the full loop playable from start to finish.

## How it runs

```
 Browser (desktop)                     dwarf (Docker)                       mindseye
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
| Ollama host | Ollama reachable from dwarf (default: mindseye on port 11434, listening on 0.0.0.0), with an instruct model that handles JSON-schema output |
| Player | Desktop Chrome, Edge or Firefox; keyboard and mouse (gamepad is a later feature; Firefox only allows it over HTTPS) |
| Dev machine | Node.js LTS, npm, Docker with buildx |

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

```bash
# on the build machine
./test.sh && ./build.sh --push          # → ghcr.io/ennissh/starwake:<VERSION>-<gitsha>

# on dwarf
sudo mkdir -p /opt/docker/starwake/data
sudo cp deploy/compose.yaml deploy/.env.example /opt/docker/starwake/
cd /opt/docker/starwake && sudo cp .env.example .env && sudo nano .env
sudo docker compose pull && sudo docker compose up -d
curl -fsS http://localhost:8090/healthz   # → {"ok":true,...}
```

Then:

1. Add `starwake.citus.cloud → 192.168.1.2` to Pi-hole's local DNS (your `local-dns.txt`).
2. Add an Uptime Kuma HTTP monitor on `http://starwake.citus.cloud:8090/healthz`.
3. Open `http://starwake.citus.cloud:8090` in a desktop browser.

> Port 8090 is a proposal. Check that it's free on dwarf first (`sudo ss -ltnp`); Pi-hole uses 8001, Uptime Kuma 3001, and Mealie has its own port.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8090` | Host port published by compose (the container listens on 8080) |
| `OLLAMA_URL` | `http://mindseye.citus.cloud:11434` | Ollama base URL (confirm the hostname) |
| `OLLAMA_MODEL` | *(required)* | Model tag used by the translator, chosen with `npm run eval:llm` |
| `OLLAMA_TIMEOUT_MS` | `20000` | Per-request timeout; on timeout the translator degrades gracefully |
| `LLM_MODE` | `ollama` | `ollama` · `mock` (canned replies, used in tests) · `off` (scripted fallback only) |
| `LLM_TEMPERATURE` | `0.7` | Alien creativity |
| `CONTENT_RATING` | `teen` | Tone guard for alien dialogue: `everyone` · `teen` · `mature` |
| `DATA_DIR` | `/data` | Saves, profiles, transcripts |
| `LOG_LEVEL` | `info` | Fastify/pino log level |

## Controls (default, rebindable)

| Action | Key |
|---|---|
| Pitch / yaw | Mouse (pointer lock) or arrow keys |
| Roll | Q / E |
| Throttle up / down · full · stop | W / S · Shift+W · X |
| Fire selected weapon | Left mouse / Space |
| Cycle camera (bridge → chase → orbit → turret → drones) | C |
| Next / previous target · target subsystem | T / Shift+T · Y |
| Match target speed | M |
| Launch Hornet / Lance / Ram drone · recall drones | 1 / 2 / 3 · R |
| Star map · Engine room · Colony status · Codex | Tab · F · H · K |
| Probe system · Hail ship or base | P · V |
| Fold jump (from star map) · Emergency fold | J · Shift+J (hold 1 s) |
| Key help overlay | F1 or ? |
| Pause / release mouse | Esc |

Browser-reserved keys (Ctrl+W, Alt combinations, F11) are never bound.

## Repository layout

```
starwake/
├── apps/client/        Three.js game client (Vite)
├── apps/server/        Fastify API, campaign engine host, LLM translator
├── packages/shared/    rules, schemas (zod), deterministic sim, content loader
├── content/            data-driven game content (JSON): cluster, races, components, items
├── deploy/             compose.yaml, .env.example
├── scripts/            build.sh, test.sh, backup.sh, eval tooling
├── Dockerfile
├── README.md
└── PLAN.md
```

## Backups

Everything that matters is in `/opt/docker/starwake/data`. `scripts/backup.sh` writes a dated tarball of it. Restore by stopping the container, extracting the tarball and starting the container again.

## Legal

Starwake is original. Lightspeed, Hyperspeed and MicroProse are trademarks of their respective owners, are mentioned here only to credit the inspiration, and are not affiliated with this project. Never add assets, text, music or data extracted from those games to this repository or its images.
