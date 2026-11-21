# M2 combat: playtest notes

PLAN M2 acceptance: "A fight against 1 frigate + 4 fighters is winnable with sensible tactics and
losable without them." Checked two ways:

## 1. Simulated (automated, every `./test.sh`)

`packages/shared/test/encounter.test.ts` flies the real encounter sim with two scripted pilots
(`packages/shared/test/bots.ts`) on three seeds each:

| Pilot | What it does | Patrol (1 frigate + 4 fighters) | Raider base |
|---|---|---|---|
| Sensible | Lance on the big ship when aligned, WAKE turret on fighters, Lance drones at the frigate / emitters, Rams at the base, holds range outside the base cannons | **Wins** (about 20–30 s, hull 100%) | **Wins** (about 100–130 s) |
| Passive | Does nothing (WAKE still crews the turret) | **Crippled** at about 80–95 s | Stalemate: it never closes to cannon range |

Last run (frigate hull 320, before the bump to 520): sensible won in 18–21 s; passive was crippled at 80, 82 and 94 s.

The bot aims perfectly, so these times flatter a human. They prove the rules allow both outcomes;
how *hard* it feels is for a human playtest.

## 2. Human playtest (Shawn, to do)

Title → Practice arena → *Vosk patrol*, then *Vosk raider base*. Things to try:

- T to target, Y to pick a subsystem, Left mouse / Space to fire the Lance (bridge or chase view).
- C to the turret view: aim with the mouse, fire; the target's lead diamond shows where to shoot.
- 1 / 2 / 3 launch Hornet / Lance / Ram; C again to ride the newest drone (fly it like the ship).
- R recalls Hornets (they dock and give the frame back).
- Against the base: the Lance is blocked (blue beam, "EMITTERS UP") until all three emitters die.
- Let the Vosk win once: the crippled choice (emergency fold vs lifeboat).
- Hold Shift+J for 1 s to fold out of a fight.

Questions for the playtest:

1. Is the patrol too easy or too hard by hand? Knobs: frigate `hp` (now 520) in `content/hulls.json`,
   `vosk-bolt` / `vosk-cannon` in `content/weapons.json`, Lance `cooldown` (5 s).
2. Base fight length (target 2–4 min)? Knobs: base `hp` 2600, emitter `hp` 60, reserve size and
   `launchInterval` 25 s.
3. Do the cameras make the drone cockpit useful, or just pretty?
4. WAKE's turret only shoots fighters (point defence). Should it also shoot frigates?
