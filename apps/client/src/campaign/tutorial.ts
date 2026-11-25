import type { CampaignState } from '@starwake/shared';
import type { Action, KeyMap } from '../input/keymap.js';
import { renderAnswer } from '../ui/advisors.js';

/**
 * First-flight tutorial (playtest batch 1, #1): WAKE walks a new pilot through the loop, one step
 * at a time, in a small card that never blocks the game. A step completes when the player does
 * the thing (or the campaign shows it done), so it can't get stuck. Skippable; once finished or
 * skipped it stays off for the profile until "Replay tutorial" in the pause menu.
 */
export interface TutorialView {
  state: () => CampaignState;
  speed: () => number;
  /** Seconds the player has spent steering (arrows or mouse), from the input. */
  steering: () => boolean;
  keyMap: () => KeyMap;
  panel: () => string | null;
}

interface Step {
  id: string;
  text: string;
  done: (t: Tutorial) => boolean;
}

const STEPS: Step[] = [
  {
    id: 'throttle',
    text: 'Welcome aboard, pilot. I am WAKE. Hold {key:throttleUp} to open the throttle ({key:throttleDown} closes it, {key:throttleStop} stops).',
    done: (t) => t.v.speed() > 5,
  },
  {
    id: 'steer',
    text: 'Steer with the arrow keys: ↑ dives, ↓ climbs, ← → turn. {key:rollLeft}/{key:rollRight} roll. Want the mouse to steer? Press {key:mouseSteer}.',
    done: (t) => t.steerTime >= 1.2,
  },
  {
    id: 'camera',
    text: 'Press {key:cycleCamera} to change the view: bridge, chase, orbit and turret.',
    done: (t) => t.seen.has('cycleCamera'),
  },
  {
    id: 'advisors',
    text: 'Stuck at any point? Press {key:advisors} to ask me, the Navigator, the Quartermaster or Tactical. Try it now.',
    done: (t) => t.seen.has('advisors'),
  },
  {
    id: 'probe',
    text: 'Our job: ready a world for the Long Caravan before the clock runs out. First, probe this system with {key:probe}.',
    done: (t) => {
      const s = t.v.state();
      const v = s.visits[s.systemId];
      return s.known.includes(s.systemId) || (!!v && v.probedOn === v.count);
    },
  },
  {
    id: 'claim',
    text: 'Open the system report with {key:systemReport} and place a claim beacon on a planet that yields something the colony needs.',
    done: (t) => t.v.state().claims.length > 0,
  },
  {
    id: 'colony',
    text: 'Press {key:colony} for Colony Readiness: a habitable Cradle, resource quotas, safety, and time left.',
    done: (t) => t.seen.has('colony') || t.v.panel() === 'readiness',
  },
  {
    id: 'engine',
    text: 'Press {key:engineRoom} for the engine room: six systems, each with slots for parts. Better parts mean more range, speed and firepower. Refits are free here at the Waystation.',
    done: (t) => t.seen.has('engineRoom') || t.v.panel() === 'engine',
  },
  {
    id: 'map',
    text: 'Now open the star map with {key:starMap}. Fold lanes link the systems; each parsec costs time and fold mass.',
    done: (t) => t.seen.has('starMap') || t.v.panel() === 'map',
  },
  {
    id: 'jump',
    text: 'Pick a system in range on the map and fold there ({key:jump}, or the Fold button). Probe it when you arrive.',
    done: (t) => t.v.state().stats.jumps > 0,
  },
  {
    id: 'hail',
    text: 'Others live in this cluster. Where someone is home, press {key:hail} to hail them: trade, ask what they know, or seek a treaty. Watch their face for lies. The Quillari of the Glass Reach are a good start.',
    done: (t) => t.v.state().codex.some((x) => x.startsWith('race:')) || !!t.v.state().conversation,
  },
];

const FINAL =
  'That is the loop: fold, probe, claim, and keep the Cradle safe. Fights: {key:targetNext} targets, hold {key:faceTarget} to aim the Lance, {key:fire} fires, {key:droneRam} sends a kamikaze Ram. Press {key:advisors} to ask us anything. Good hunting.';

export class Tutorial {
  readonly el: HTMLDivElement;
  readonly seen = new Set<Action>();
  steerTime = 0;
  private i = 0;
  private timer: ReturnType<typeof setInterval>;
  private finished = false;

  constructor(
    parent: HTMLElement,
    readonly v: TutorialView,
    private readonly onEnd: (skipped: boolean) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'sw-tutor hud__panel';
    this.el.setAttribute('role', 'status');
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-tutor="skip"]')) this.end(true);
    });
    parent.appendChild(this.el);
    this.timer = setInterval(() => this.tick(0.25), 250);
    this.render();
  }

  /** Every action the player takes (the campaign forwards them). */
  onAction(a: Action): void {
    this.seen.add(a);
    this.tick(0);
  }

  get step(): string {
    return this.finished ? 'done' : (STEPS[this.i]?.id ?? 'done');
  }

  private tick(dt: number): void {
    if (this.finished) return;
    if (this.v.steering()) this.steerTime += dt;
    let moved = false;
    while (this.i < STEPS.length && STEPS[this.i]!.done(this)) {
      this.i++;
      moved = true;
    }
    if (this.i >= STEPS.length) {
      this.finished = true;
      clearInterval(this.timer);
      this.render();
      setTimeout(() => this.end(false), 12_000);
      return;
    }
    if (moved) this.render();
  }

  private render(): void {
    const map = this.v.keyMap();
    const n = Math.min(this.i + 1, STEPS.length);
    const text = this.finished ? FINAL : STEPS[this.i]!.text;
    this.el.innerHTML = `<div class="sw-tutor__head"><b>WAKE</b> · First flight ${this.finished ? '✓' : `${n}/${STEPS.length}`}<button class="sw-btn sw-btn--chip" data-tutor="skip">${this.finished ? 'Close' : 'Skip tutorial'}</button></div><p>${renderAnswer(text, map)}</p>`;
  }

  end(skipped: boolean): void {
    clearInterval(this.timer);
    if (!this.el.isConnected) return;
    this.el.remove();
    this.onEnd(skipped);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
