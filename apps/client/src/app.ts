import type { ContentBundle } from '@starwake/shared';
import { Input } from './input/input.js';
import type { Action } from './input/keymap.js';
import * as THREE from 'three';
import { type Backdrop, SpaceScene } from './space/spaceScene.js';
import { Modal } from './ui/modal.js';
import { arenaPicker, crippledBody, resultBody, resultTitle } from './ui/combatScreens.js';
import { TitleScene } from './title/titleScene.js';
import { TitleScreen } from './ui/title.js';
import { PauseMenu } from './ui/pause.js';
import { PerfOverlay } from './debug/perf.js';
import { Renderer } from './render.js';
import { DEFAULT_PROFILE, type Settings, loadSettings } from './settings.js';
import { initialTheme, onThemeChange, setTheme } from './themes/theme.js';
import { getContent, getHealth } from './net/api.js';

type Screen = 'title' | 'flight';

const HARBOR: Backdrop = {
  seed: 'harbor',
  tint: '#1d3350',
  starColor: '#ffd9a0',
  sunDir: new THREE.Vector3(0.5, 0.25, -0.8).normalize(),
  planets: [
    { kind: 'rock', radius: 6000, pos: new THREE.Vector3(-18_000, -4_000, -42_000), seed: 'harbor-1' },
  ],
  buoys: true,
};

const CINDER: Backdrop = {
  seed: 'cinder',
  tint: '#3a1d14',
  starColor: '#ffb070',
  sunDir: new THREE.Vector3(-0.6, 0.35, -0.7).normalize(),
  planets: [
    { kind: 'desert', radius: 9000, pos: new THREE.Vector3(26_000, -9_000, -60_000), seed: 'cinder-1' },
  ],
  buoys: false,
};

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
  private flight: SpaceScene | null = null;
  private modal: Modal;
  private arenaId: string | null = null;
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
      flightTest: () => void this.startSpace(null),
      arena: () => void this.openArenaPicker(),
      settings: () => this.openPause('controls'),
    });
    this.pause = new PauseMenu(ui, this.input, this.settings, profile, {
      resume: () => this.resume(),
      quit: () => this.quitToTitle(),
      settingsChanged: (s) => this.applySettings(s),
    });
    this.perf = new PerfOverlay(ui);
    this.modal = new Modal(ui);

    window.addEventListener('resize', () => this.renderer.resize());
    onThemeChange(() => this.renderer.resize());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('click', () => {
      if (this.screen === 'flight' && !this.paused && !this.modal.isOpen) void this.input.lockPointer();
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

  private async openArenaPicker(): Promise<void> {
    this.content ??= await getContent();
    const c = this.content;
    this.modal.show('Practice arena', arenaPicker(c), {
      pick: (el) => {
        this.modal.close();
        void this.startSpace(el.dataset.id ?? null);
      },
      cancel: () => this.modal.close(),
    });
  }

  /** Open space (flight test) when encounterId is null, else a practice fight. */
  private async startSpace(encounterId: string | null): Promise<void> {
    this.content ??= await getContent();
    this.flight?.dispose();
    this.arenaId = encounterId;
    this.flight = new SpaceScene(this.renderer, this.ui, this.input, this.content, {
      mode: encounterId ? 'fight' : 'flight',
      encounterId: encounterId ?? undefined,
      seed: `${encounterId ?? 'flight'}:${Date.now()}`,
      backdrop: encounterId ? CINDER : HARBOR,
      onCrippled: () => this.showCrippled(),
      onEnd: (r) => this.showResult(r),
    });
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

  private releaseForModal(): void {
    this.input.enabled = false;
    this.input.unlockPointer();
  }

  private showCrippled(): void {
    this.releaseForModal();
    this.modal.show('The Starwake is crippled', crippledBody(), {
      fold: () => {
        this.modal.close();
        this.flight?.chooseCrippled('emergencyFold');
      },
      lifeboat: () => {
        this.modal.close();
        this.flight?.chooseCrippled('lifeboat');
      },
    });
  }

  private showResult(r: import('@starwake/shared').EncounterResult): void {
    this.releaseForModal();
    const c = this.content!;
    this.modal.show(resultTitle(r), resultBody(r, c, true), {
      again: () => {
        this.modal.close();
        void this.startSpace(this.arenaId);
      },
      title: () => {
        this.modal.close();
        this.quitToTitle();
      },
    });
  }

  private openPause(tab: Parameters<PauseMenu['open']>[0] = 'main'): void {
    if (this.screen === 'flight') this.paused = true;
    this.input.enabled = false;
    this.input.unlockPointer();
    this.pause.open(tab);
  }

  private resume(): void {
    this.pause.close();
    if (this.screen === 'flight' && !this.modal.isOpen) {
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
    if (!this.input.pointerLocked && this.screen === 'flight' && !this.paused && !this.modal.isOpen) {
      this.lastAutoPause = performance.now();
      this.openPause();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (performance.now() - this.lastAutoPause < 400) return; // same Esc that just released the lock
    if (this.pause.isOpen) {
      if (this.screen === 'flight' && !this.modal.isOpen) this.resume();
      else this.pause.close();
    } else if (this.screen === 'flight' && !this.modal.isOpen) this.openPause();
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
