# Demo notes: M0–M3 (first playable build)

Build `0.1.0-N` on branch `claude/focused-darwin-fyxcok`. `./test.sh` is green: 177 unit tests and
5 Playwright smoke runs (mock translator).

## 1. Install on dwarf (you run these)

```bash
git clone -b claude/focused-darwin-fyxcok https://github.com/ennissh/starwake.git && cd starwake
./build.sh --local                       # no GHCR image yet: build here (needs Node 22+ for tests)
sudo ./install.sh --no-pull --tag local  # asks every setting, probes Ollama from a container
```

Or, after `./build.sh --push` from your build machine: `sudo ./install.sh`.

Check, cheapest first:

```bash
curl -fsS http://localhost:8090/healthz   # {"ok":true,...,"llm":"up"} proves the DOCKER-USER path to the Mac Studio
curl -fsS http://localhost:8090/readyz
sudo docker logs starwake | tail
```

If the installer reports Ollama unreachable *from a container* but reachable from the host, the
`DOCKER-LAN-ONLY` chain is dropping container-originated traffic: it prints the chain (read-only) and
what to allow. It never edits it. Then add the Pi-hole record and the Uptime Kuma monitor it prints.

## 2. What to try

| Area | Try |
|---|---|
| Title | Click to begin; add a pilot; switch Light / Dark / VGA 1990 |
| Flight test (M1) | Mouse as a virtual joystick (pointer lock), arrows, Q/E roll, W/S, Shift+W, X, Z drift; C cycles bridge → chase → orbit → turret; \` perf overlay (check 60 fps on your laptop); F1 help; Esc → Controls, rebind a key (mouse buttons work too), reload: it persists |
| Practice arena (M2) | *Vosk patrol*, then *Vosk raider base*: see `docs/playtest-m2.md` for the checklist and questions |
| Campaign (M3) | New game → P probe Harbor → claim Anvil → Tab map → Glass Reach → Cinder Gate (expect ambushes) → attack Cinder Hold or fold out → H readiness → I system report / Waystation dock, buy a Nav Core → save to a slot (Esc → Save / load) → reload the page → Continue |

## 3. Decisions to confirm or change

1. **Clock length**: 10 years. A careful run uses about 4–6; should it be tighter?
2. **Base difficulty**: Cinder Hold takes about 2 minutes with good tactics, and is safe to besiege from
   2,150 units. Too easy?
3. **WAKE's turret** shoots fighters only (point defence). Should it also shoot frigates?
4. **Jump lanes**: jumps only follow lanes; the Glass Reach–Saltmarrow shortcut needs a Nav Core Mk II.
5. **Data Cores**: you start with 2; they buy Mk I parts at the Waystation. Docking fabricates 5
   Provender (sold to the aliens from M5).
6. **Firefox**: fights there are accepted on a plausibility check if its maths differs from Node's.
   Chromium is verified exactly.

## 4. Known gaps (by design until later milestones)

- The engine room UI (F) is M4. Component effects on range and fuel already work; flight and weapons
  don't yet scale with output.
- Hail (V), trade, treaties and permits are M5. Until then, claiming in Quillari or Vosk space can only
  be done as a hostile act.
- Audio, the intro and tutorial, the Codex (K) and the full ending summary are M6.
