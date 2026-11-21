import type { ContentBundle } from '@starwake/shared';
import { Input } from './input/input.js';
import type { Action } from './input/keymap.js';
import { FlightScene } from './flight/flightScene.js';
import { TitleScene } from './title/titleScene.js';
import { TitleScreen } from './ui/title.js';
import { PauseMenu } from './ui/pause.js';
import { PerfOverlay } from './debug/perf.js';
import { Renderer } from './render.js';
import { DEFAULT_PROFILE, type Settings, loadSettings } from './settings.js';
import { initialTheme, onThemeChange, setTheme } from './themes/theme.js';
import { getContent, getHealth } from './net/api.js';

type Screen = 'title' | 'flight';

/** Top-level game controller: screens, pause, the frame loop. */
export class Game {
  private renderer: Renderer;
  private input: Input;
  private settings: Settings;
  private screen: Screen = 'title';
  private paused = false;
  private titleScene: TitleScene;
  private title: TitleScreen;
  private pause: PauseMenu;
  private perf: PerfOverlay;
  private flight: FlightScene | null = null;
  private content: ContentBundle | null = null;
  private last = performance.now();
  private lastAutoPause = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
    private readonly profile = DEFAULT_PROFILE,
  ) {
    this.settings = loadSettings(profile);
    setTheme(this.settings.theme ?? initialTheme());
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas, this.settings.bindings);
    this.applySettings(this.settings);
    this.titleScene = new TitleScene(this.renderer);
    this.title = new TitleScreen(ui, {
      flightTest: () => void this.startFlight(),
      settings: () => this.openPause('controls'),
    });
    this.pause = new PauseMenu(ui, this.input, this.settings, profile, {
      resume: () => this.resume(),
      quit: () => this.quitToTitle(),
      settingsChanged: (s) => this.applySettings(s),
    });
    this.perf = new PerfOverlay(ui);

    window.addEventListener('resize', () => this.renderer.resize());
    onThemeChange(() => this.renderer.resize());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('click', () => {
      if (this.screen === 'flight' && !this.paused) void this.input.lockPointer();
    });

    getHealth().then(
      (h) => this.title.setHealth(h),
      () => this.title.setHealth(null),
    );
    this.exposeTestHook();
    this.renderer.gl.setAnimationLoop(this.frame);
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.input.setKeyMap(s.bindings);
    this.input.stickOpts = { ...this.input.stickOpts, sensitivity: s.mouseSensitivity, invertY: s.invertY };
  }

  private async startFlight(): Promise<void> {
    this.content ??= await getContent();
    this.flight?.dispose();
    this.flight = new FlightScene(this.renderer, this.ui, this.input, this.content);
    this.screen = 'flight';
    this.title.show(false);
    this.paused = false;
    this.input.enabled = true;
    this.input.centreStick();
    const locked = await this.input.lockPointer();
    this.flight.hud.setHint(
      locked ? 'F1 keys · Esc pause' : 'Click to capture the mouse · F1 keys · Esc pause',
    );
  }

  private openPause(tab: Parameters<PauseMenu['open']>[0] = 'main'): void {
    if (this.screen === 'flight') this.paused = true;
    this.input.enabled = false;
    this.input.unlockPointer();
    this.pause.open(tab);
  }

  private resume(): void {
    this.pause.close();
    if (this.screen === 'flight') {
      this.paused = false;
      this.input.enabled = true;
      void this.input.lockPointer();
    }
  }

  private quitToTitle(): void {
    this.pause.close();
    this.flight?.dispose();
    this.flight = null;
    this.screen = 'title';
    this.paused = false;
    this.input.enabled = false;
    this.input.unlockPointer();
    this.title.show(true);
  }

  private onPointerLockChange = (): void => {
    // Esc in pointer lock is eaten by the browser (it releases the mouse): treat that as pause.
    if (!this.input.pointerLocked && this.screen === 'flight' && !this.paused) {
      this.lastAutoPause = performance.now();
      this.openPause();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (performance.now() - this.lastAutoPause < 400) return; // same Esc that just released the lock
    if (this.pause.isOpen) {
      if (this.screen === 'flight') this.resume();
      else this.pause.close();
    } else if (this.screen === 'flight') this.openPause();
  };

  private handleAction(a: Action): void {
    if (a === 'help') return this.openPause('help');
    if (a === 'perf') return this.perf.toggle();
    this.flight?.handle(a);
  }

  private frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.renderer.gl.info.reset();
    for (const a of this.input.drainPressed()) this.handleAction(a);
    if (this.screen === 'flight' && this.flight) {
      this.flight.update(dt, this.paused);
      this.flight.render();
    } else {
      this.titleScene.update(dt);
      this.titleScene.render();
    }
    this.perf.frame(dt * 1000, this.renderer.gl);
  };

  /** Read-only hook for the Playwright smoke tests and debugging in the console. */
  private exposeTestHook(): void {
    (window as unknown as { __starwake: unknown }).__starwake = {
      screen: () => this.screen,
      paused: () => this.paused,
      flight: () => this.flight?.snapshot() ?? null,
      bindings: () => this.settings.bindings,
    };
  }
}
