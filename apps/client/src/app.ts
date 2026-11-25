import * as THREE from 'three';
import { type ContentBundle, type EncounterResult, sensiblePilot } from '@starwake/shared';
import { Input } from './input/input.js';
import type { Action } from './input/keymap.js';
import { type Backdrop, SpaceScene } from './space/spaceScene.js';
import { TitleScene } from './title/titleScene.js';
import { TitleScreen } from './ui/title.js';
import { PauseMenu } from './ui/pause.js';
import { AdvisorPanel } from './ui/advisors.js';
import { playIntro } from './ui/intro.js';
import { audio } from './audio/audio.js';
import { Modal } from './ui/modal.js';
import { arenaPicker, crippledBody, resultBody, resultTitle } from './ui/combatScreens.js';
import { PerfOverlay } from './debug/perf.js';
import { Renderer } from './render.js';
import { DEFAULT_PROFILE, type Settings, loadSettings, sanitizeSettings, saveSettings } from './settings.js';
import { initialTheme, onThemeChange, setTheme } from './themes/theme.js';
import {
  ApiFailure,
  type SaveView,
  createProfile,
  getContent,
  getHealth,
  getProfile,
  getSave,
  listProfiles,
  listSaves,
  newSave,
  putSettings,
} from './net/api.js';
import { Campaign } from './campaign/controller.js';

type Screen = 'title' | 'flight';
const PROFILE_KEY = 'sw-profile';

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

/** Top-level game controller: profiles, screens, pause, the frame loop. */
export class Game {
  private renderer: Renderer;
  private input: Input;
  private settings: Settings;
  private profile: string | null = null;
  private screen: Screen = 'title';
  private paused = false;
  private titleScene: TitleScene;
  private title: TitleScreen;
  private pause: PauseMenu;
  private perf: PerfOverlay;
  private modal: Modal;
  /** Advisors outside a campaign (flight test, arena); the campaign has its own. */
  private advisors: AdvisorPanel;
  private scene: SpaceScene | null = null;
  private campaign: Campaign | null = null;
  private content: ContentBundle | null = null;
  private arenaId: string | null = null;
  private last = performance.now();
  // Test hooks only (headless playthrough): a scripted fight pilot and a sim time scale.
  private autopilot = false;
  private timeScale = 1;
  private lastAutoPause = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
  ) {
    this.settings = loadSettings(DEFAULT_PROFILE);
    setTheme(this.settings.theme ?? initialTheme());
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas, this.settings.bindings);
    this.applySettings(this.settings);
    this.titleScene = new TitleScene(this.renderer);
    this.title = new TitleScreen(ui, {
      selectProfile: (id) => void this.selectProfile(id),
      createProfile: (name) => void this.addProfile(name),
      newGame: () => void this.newGame(),
      continueGame: () => void this.continueGame(),
      loadSave: (id) => void this.loadSave(id),
      flightTest: () => void this.startSpace(null),
      arena: () => void this.openArenaPicker(),
      settings: () => this.openPause('controls'),
    });
    this.pause = new PauseMenu(ui, this.input, this.settings, DEFAULT_PROFILE, {
      resume: () => this.resume(),
      quit: () => this.quitToTitle(),
      settingsChanged: (s) => this.settingsChanged(s),
      tutorial: () => {
        this.pause.close();
        this.paused = false;
        this.campaign?.startTutorial();
        this.backToFlying();
      },
      advisors: () => {
        this.pause.close();
        this.paused = false;
        this.input.enabled = true;
        this.handleAction('advisors');
      },
    });
    this.perf = new PerfOverlay(ui);
    this.modal = new Modal(ui);
    this.advisors = new AdvisorPanel(this.modal, {
      content: () => this.content!,
      saveId: () => null,
      keyMap: () => this.input.keyMap,
      onClose: () => this.closeAdvisors(),
    });

    window.addEventListener('resize', () => this.renderer.resize());
    onThemeChange(() => this.renderer.resize());
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    // A soft click for every button (procedural, no samples).
    ui.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.sw-btn,.sw-tab,.er-slot')) audio.ui();
    });
    window.addEventListener('keydown', this.onKeyDown, true);
    canvas.addEventListener('click', () => {
      if (this.screen === 'flight' && !this.paused && !this.anyModal()) this.syncPointer();
    });

    getHealth().then(
      (h) => this.title.setHealth(h),
      () => this.title.setHealth(null),
    );
    void this.loadProfiles();
    this.exposeTestHook();
    this.renderer.gl.setAnimationLoop(this.frame);
  }

  // ---- profiles and settings ------------------------------------------------------------------
  private async loadProfiles(prefer?: string): Promise<void> {
    try {
      const list = await listProfiles();
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(PROFILE_KEY);
      } catch {
        /* storage blocked */
      }
      const pick = list.find((p) => p.id === (prefer ?? saved))?.id ?? list[0]?.id ?? null;
      this.title.setProfiles(list, pick);
      if (pick) await this.selectProfile(pick);
    } catch {
      this.title.setMessage('The server did not answer.');
    }
  }

  private async selectProfile(id: string): Promise<void> {
    this.profile = id;
    try {
      localStorage.setItem(PROFILE_KEY, id);
    } catch {
      /* storage blocked */
    }
    // The server's copy is the source of truth; the browser keeps a cache.
    let s = loadSettings(id);
    try {
      const p = await getProfile(id);
      if (p.settings) s = sanitizeSettings(p.settings);
    } catch {
      /* offline: use the cache */
    }
    saveSettings(s, id);
    this.applySettings(s);
    if (s.theme) setTheme(s.theme);
    this.pause.setProfile(id, s);
    this.title.setSaves(await listSaves(id).catch(() => []));
  }

  private async addProfile(name: string): Promise<void> {
    try {
      const p = await createProfile(name);
      this.title.setMessage('');
      await this.loadProfiles(p.id);
    } catch (err) {
      this.title.setMessage(err instanceof ApiFailure ? err.message : 'Could not create the pilot.');
    }
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.input.setKeyMap(s.bindings);
    this.input.stickOpts = { ...this.input.stickOpts, sensitivity: s.mouseSensitivity, invertY: s.invertY };
    this.input.mouseSteering = s.mouseSteering;
    audio.setVolumes(s.volume);
  }

  private settingsChanged(s: Settings): void {
    this.applySettings(s);
    if (this.profile) void putSettings(this.profile, s).catch(() => undefined);
  }

  // ---- campaign -------------------------------------------------------------------------------
  private async newGame(): Promise<void> {
    if (!this.profile) return;
    const view = await newSave(this.profile, 'auto');
    this.content ??= await getContent();
    this.title.show(false);
    // WAKE's intro plays over the title scene, then the campaign (and the tutorial) begin.
    await playIntro(this.ui, this.content.codex.intro);
    await this.startCampaign(view);
    if (!this.settings.tutorialDone) this.campaign?.startTutorial();
  }

  private async continueGame(): Promise<void> {
    if (!this.profile) return;
    await this.startCampaign(await getSave(`${this.profile}.auto`));
  }

  private async loadSave(id: string): Promise<void> {
    if (!this.profile) return;
    const v = id.endsWith('.auto') ? await getSave(id) : await newSave(this.profile, 'auto', id);
    await this.startCampaign(v);
  }

  private async startCampaign(view: SaveView): Promise<void> {
    this.content ??= await getContent();
    this.campaign?.dispose();
    this.modal.close();
    this.pause.close();
    const profile = this.profile!;
    this.pause.saveHooks = {
      list: async () =>
        (await listSaves(profile)).map((x) => ({
          id: x.id,
          slot: x.meta.slot,
          label: `${x.meta.systemName} · ${x.meta.clock.toFixed(2)} yr · ${new Date(x.meta.savedAt).toLocaleString()}`,
        })),
      save: async (slot) => void (await newSave(profile, slot, `${profile}.auto`)),
      load: async (id) => this.loadSave(id),
    };
    this.title.show(false);
    this.campaign = new Campaign(
      {
        renderer: this.renderer,
        ui: this.ui,
        input: this.input,
        content: this.content,
        setScene: (s) => this.setScene(s),
        panelOpened: () => this.releaseForModal(),
        panelClosed: () => this.backToFlying(),
        exitToTitle: () => this.quitToTitle(),
        tutorialEnded: () => {
          this.settings.tutorialDone = true;
          if (this.profile) saveSettings(this.settings, this.profile);
          this.settingsChanged(this.settings);
        },
      },
      view,
    );
    this.pause.inCampaign = true;
  }

  // ---- scenes ---------------------------------------------------------------------------------
  private setScene(s: SpaceScene): void {
    if (this.scene && this.scene !== s) this.scene.dispose();
    this.scene = s;
    this.applyTestHooks();
    this.screen = 'flight';
    this.paused = false;
    if (!this.anyModal()) {
      this.input.enabled = true;
      this.input.centreStick();
      this.syncPointer();
    }
  }

  private async openArenaPicker(): Promise<void> {
    this.content ??= await getContent();
    this.modal.show('Practice arena', arenaPicker(this.content), {
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
    this.arenaId = encounterId;
    this.title.show(false);
    this.setScene(
      new SpaceScene(this.renderer, this.ui, this.input, this.content, {
        mode: encounterId ? 'fight' : 'flight',
        encounterId: encounterId ?? undefined,
        seed: `${encounterId ?? 'flight'}:${Date.now()}`,
        backdrop: encounterId ? CINDER : HARBOR,
        onCrippled: () => this.showCrippled(),
        onEnd: (r) => this.showResult(r),
      }),
    );
    this.scene?.hud.setHint('Arrows steer · W/S throttle · L mouse steering · F1 keys · Esc pause');
  }

  private anyModal(): boolean {
    return this.modal.isOpen || !!this.campaign?.modal.isOpen || this.pause.isOpen;
  }

  private releaseForModal(): void {
    this.paused = true;
    this.input.enabled = false;
    this.input.unlockPointer();
  }

  private backToFlying(): void {
    if (this.screen !== 'flight' || this.anyModal()) return;
    this.paused = false;
    this.input.enabled = true;
    this.syncPointer();
  }

  /** Lock the pointer when the current view wants the mouse, else leave a free cursor. */
  private syncPointer(): void {
    if (this.screen !== 'flight' || this.paused || this.anyModal()) return;
    if (this.scene?.wantsPointer() ?? true) void this.input.lockPointer();
    else this.input.unlockPointer();
  }

  private openAdvisors(): void {
    if (this.screen !== 'flight' || this.anyModal() || !this.content) return;
    this.releaseForModal();
    this.advisors.open();
  }

  private closeAdvisors(): void {
    this.modal.close();
    this.backToFlying();
  }

  private toggleMouseSteering(): void {
    this.settings.mouseSteering = !this.settings.mouseSteering;
    if (this.profile) saveSettings(this.settings, this.profile);
    this.settingsChanged(this.settings);
    this.scene?.hud.toast(
      this.settings.mouseSteering
        ? 'Mouse steering ON (L to turn off)'
        : 'Mouse steering OFF: arrow keys steer, the cursor is free',
    );
    this.syncPointer();
  }

  private showCrippled(): void {
    this.releaseForModal();
    this.modal.show('The Starwake is crippled', crippledBody(), {
      fold: () => {
        this.modal.close();
        this.scene?.chooseCrippled('emergencyFold');
      },
      lifeboat: () => {
        this.modal.close();
        this.scene?.chooseCrippled('lifeboat');
      },
    });
  }

  private showResult(r: EncounterResult): void {
    this.releaseForModal();
    this.modal.show(resultTitle(r), resultBody(r, this.content!, true), {
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
    this.backToFlying();
  }

  private quitToTitle(): void {
    this.pause.close();
    this.modal.close();
    this.campaign?.dispose();
    this.campaign = null;
    this.pause.saveHooks = null;
    this.pause.inCampaign = false;
    this.scene?.dispose();
    this.scene = null;
    this.screen = 'title';
    this.paused = false;
    this.input.enabled = false;
    this.input.unlockPointer();
    this.title.show(true);
    if (this.profile)
      void listSaves(this.profile).then(
        (s) => this.title.setSaves(s),
        () => undefined,
      );
  }

  // ---- input ----------------------------------------------------------------------------------
  private onPointerLockChange = (): void => {
    // Esc in pointer lock is eaten by the browser (it releases the mouse): treat that as pause.
    if (
      !this.input.pointerLocked &&
      this.input.lockWanted &&
      this.screen === 'flight' &&
      !this.paused &&
      !this.anyModal()
    ) {
      this.lastAutoPause = performance.now();
      this.openPause();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.input.capturing) return; // the rebinding UI owns this key (Esc cancels the capture only)
    if (this.campaign?.handlePanelKey(e)) return;
    if (e.code !== 'Escape' || e.repeat) return;
    if (this.advisors.isOpen) return this.closeAdvisors();
    if (performance.now() - this.lastAutoPause < 400) return; // same Esc that just released the lock
    if (this.pause.isOpen) {
      this.resume();
    } else if (this.screen === 'flight' && !this.anyModal()) this.openPause();
  };

  private handleAction(a: Action): void {
    if (a === 'help') return this.openPause('help');
    if (a === 'perf') return this.perf.toggle();
    if (a === 'mouseSteer') return this.toggleMouseSteering();
    if (this.campaign?.handle(a)) return;
    if (a === 'advisors') return this.openAdvisors();
    this.scene?.handle(a);
    if (a === 'cycleCamera') this.syncPointer();
  }

  private frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.renderer.gl.info.reset();
    for (const a of this.input.drainPressed()) this.handleAction(a);
    if (this.screen === 'flight' && this.scene) {
      this.scene.update(dt, this.paused);
      this.scene.render();
    } else {
      this.titleScene.update(dt);
      this.titleScene.render();
    }
    this.perf.frame(dt * 1000, this.renderer.gl);
    const i = this.renderer.gl.info.render;
    this.lastFrame = { calls: i.calls, triangles: i.triangles };
  };

  /** Last frame's draw calls and triangles (perf budget, PLAN §2.4). */
  private lastFrame = { calls: 0, triangles: 0 };

  private applyTestHooks(): void {
    if (!this.scene) return;
    this.scene.autopilot = this.autopilot ? sensiblePilot : null;
    this.scene.timeScale = this.timeScale;
  }

  /** Read-only hook for the Playwright smoke tests and debugging in the console. */
  private exposeTestHook(): void {
    (window as unknown as { __starwake: unknown }).__starwake = {
      screen: () => this.screen,
      paused: () => this.paused,
      flight: () => this.scene?.snapshot() ?? null,
      campaign: () => this.campaign?.snapshot() ?? null,
      bindings: () => this.settings.bindings,
      profile: () => this.profile,
      debugCripple: () => this.scene?.debugCripple() ?? false,
      perf: () => ({ ...this.lastFrame }),
      /** Fights are flown by the scripted sensible pilot (the server still verifies them by replay). */
      autopilot: (on: boolean) => {
        this.autopilot = !!on;
        this.applyTestHooks();
        return this.autopilot;
      },
      /** Run the sim faster than real time (1–8×); commands per tick are unchanged. */
      timeScale: (n: number) => {
        this.timeScale = Math.max(1, Math.min(8, Number(n) || 1));
        this.applyTestHooks();
        return this.timeScale;
      },
    };
  }
}
