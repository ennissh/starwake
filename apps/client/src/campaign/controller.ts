import './campaign.css';
import {
  type CampaignAction,
  type CampaignEvent,
  type CommandLog,
  type ContentBundle,
  type EncounterResult,
  byId,
  isBroken,
  itemQty,
  laneBetween,
  system,
} from '@starwake/shared';
import type { Action } from '../input/keymap.js';
import { SpaceScene } from '../space/spaceScene.js';
import type { Renderer } from '../render.js';
import type { Input } from '../input/input.js';
import { Modal } from '../ui/modal.js';
import { esc } from '../ui/help.js';
import { crippledBody, resultBody, resultTitle } from '../ui/combatScreens.js';
import { ApiFailure, type SaveView, act, postEncounterResult, startEncounter } from '../net/api.js';
import { systemBackdrop } from './backdrop.js';
import { type MapView, mapBody } from './starMap.js';
import { endingBody, readinessBody, salvageBody, systemBody } from './panels.js';

export interface CampaignHost {
  renderer: Renderer;
  ui: HTMLElement;
  input: Input;
  content: ContentBundle;
  /** Show a scene (the host disposes the previous one). */
  setScene(scene: SpaceScene): void;
  /** A panel opened: release the mouse and stop flight input. */
  panelOpened(): void;
  /** All panels closed: back to flying. */
  panelClosed(): void;
  exitToTitle(): void;
}

/**
 * The campaign on the client: shows the current system (or a fight), the panels (star map, system
 * report, readiness, salvage, ending) and sends every action to the server, which owns the state.
 */
export class Campaign {
  view: SaveView;
  scene!: SpaceScene;
  readonly modal: Modal;
  private bar: HTMLDivElement;
  private map: MapView = { yaw: 0.5, pitch: 0.45, selected: null };
  private busy = false;
  private fighting = false;
  private lastVerification: string | null = null;

  constructor(
    private readonly host: CampaignHost,
    view: SaveView,
  ) {
    this.view = view;
    this.modal = new Modal(host.ui);
    this.bar = document.createElement('div');
    this.bar.className = 'chbar';
    host.ui.appendChild(this.bar);
    void this.enter();
  }

  get c(): ContentBundle {
    return this.host.content;
  }
  get saveId(): string {
    return this.view.id;
  }

  dispose(): void {
    this.disposed = true;
    this.modal.el.remove();
    this.bar.remove();
  }

  // ---- scenes --------------------------------------------------------------------------------
  private disposed = false;

  /** Show the current system or fight; on a server failure, say so and offer a way out. */
  private async enter(): Promise<void> {
    try {
      await this.enterInner();
    } catch (err) {
      if (this.disposed) return;
      this.host.panelOpened();
      const msg = esc((err as Error).message || 'The server did not answer.');
      this.modal.show(
        'Signal lost',
        `<p>${msg}</p><div class="sw-row"><button class="sw-btn sw-btn--primary" data-act="retry">Retry</button><button class="sw-btn" data-act="title">Back to title</button></div>`,
        {
          retry: () => {
            this.modal.close();
            this.host.panelClosed();
            void this.enter();
          },
          title: () => this.host.exitToTitle(),
        },
      );
    }
  }

  private async enterInner(): Promise<void> {
    if (this.disposed) return;
    const s = this.view.state;
    if (s.pendingEncounter) return this.startFight();
    this.fighting = false;
    const sys = system(this.c, s.systemId);
    this.scene = new SpaceScene(this.host.renderer, this.host.ui, this.host.input, this.c, {
      mode: 'flight',
      seed: `${s.seed}:${s.systemId}`,
      backdrop: systemBackdrop(sys, this.c, { baseDestroyed: !!sys.occupant && isBroken(s, sys.occupant) }),
    });
    this.host.setScene(this.scene);
    this.scene.hud.setHint('Tab map · I system · H colony · P probe · F1 keys');
    this.renderBar();
    if (s.outcome !== 'ongoing') this.showEnding();
    else if (s.salvageOffer.length) this.showSalvage();
  }

  private async startFight(): Promise<void> {
    this.fighting = true;
    const s = this.view.state;
    const start = await startEncounter(this.saveId);
    if (this.disposed) return;
    const sys = system(this.c, s.systemId);
    this.scene = new SpaceScene(this.host.renderer, this.host.ui, this.host.input, this.c, {
      mode: 'fight',
      seed: start.options.seed,
      fight: start.options,
      backdrop: systemBackdrop(sys, this.c, { baseDestroyed: start.reason === 'attack' }),
      onCrippled: () => this.showCrippled(),
      onEnd: (r, log) => void this.finishFight(start.encounterId, r, log),
    });
    this.host.setScene(this.scene);
    this.renderBar();
    this.scene.hud.toast(`${start.name}! T to target, fire with Left mouse / Space`, 3500);
  }

  private showCrippled(): void {
    this.host.panelOpened();
    this.modal.show('The Starwake is crippled', crippledBody(), {
      fold: () => {
        this.modal.close();
        this.scene.chooseCrippled('emergencyFold');
      },
      lifeboat: () => {
        this.modal.close();
        this.scene.chooseCrippled('lifeboat');
      },
    });
  }

  private async finishFight(id: string, r: EncounterResult, log: CommandLog): Promise<void> {
    this.host.panelOpened();
    try {
      const v = await postEncounterResult(id, this.saveId, r, log);
      this.view = v;
      this.lastVerification = v.verification;
      this.modal.show(
        resultTitle(r),
        resultBody(r, this.c, false).replace(/<div class="sw-row">.*<\/div>\s*$/s, '') +
          '<button class="sw-btn sw-btn--primary" data-act="continue">Continue</button>',
        {
          continue: () => {
            this.modal.close();
            this.host.panelClosed();
            void this.enter();
          },
        },
      );
    } catch (err) {
      this.modal.show(
        'The fight could not be recorded',
        `<p>${(err as Error).message}</p><button class="sw-btn" data-act="title">Back to title</button>`,
        {
          title: () => this.host.exitToTitle(),
        },
      );
    }
  }

  // ---- input ---------------------------------------------------------------------------------
  /** Campaign keys. Returns true when handled. */
  handle(a: Action): boolean {
    if (this.fighting) return false;
    switch (a) {
      case 'starMap':
        this.toggle('map', () => this.showMap());
        return true;
      case 'systemReport':
        this.toggle('system', () => this.showSystem());
        return true;
      case 'colony':
        this.toggle('readiness', () => this.showReadiness());
        return true;
      case 'probe':
        void this.do({ type: 'probe' }).then((ok) => ok && this.showSystem());
        return true;
      case 'jump':
        if (this.map.selected && this.modal.kind === 'map') void this.jumpTo(this.map.selected);
        else this.scene.hud.toast('Open the star map (Tab) and pick a system');
        return true;
      default:
        return false;
    }
  }

  /** Keys that still work while a campaign panel is open. */
  handlePanelKey(e: KeyboardEvent): boolean {
    const handled = this.panelKey(e);
    // Stop the same keydown reaching Input (which may be re-enabled by now) and re-opening a panel.
    if (handled) e.stopImmediatePropagation();
    return handled;
  }

  private panelKey(e: KeyboardEvent): boolean {
    if (this.modal.isOpen && ['map', 'system', 'readiness'].includes(this.modal.kind ?? '')) {
      const bind = this.host.input.keyMap;
      const is = (a: Action) => bind[a].includes(e.code);
      if (is('starMap') || is('systemReport') || is('colony') || e.code === 'Escape') {
        e.preventDefault();
        const kind = this.modal.kind;
        this.closePanel();
        if (is('starMap') && kind !== 'map') this.handle('starMap');
        else if (is('systemReport') && kind !== 'system') this.handle('systemReport');
        else if (is('colony') && kind !== 'readiness') this.handle('colony');
        return true;
      }
      if (is('jump') && this.modal.kind === 'map' && this.map.selected) {
        e.preventDefault();
        void this.jumpTo(this.map.selected);
        return true;
      }
    }
    return false;
  }

  private toggle(kind: string, open: () => void): void {
    if (this.modal.isOpen && this.modal.kind === kind) this.closePanel();
    else open();
  }

  closePanel(): void {
    if (!this.modal.isOpen) return;
    const kind = this.modal.kind;
    if (kind === 'ending' || kind === 'salvage') return; // need an explicit choice
    this.modal.close();
    this.host.panelClosed();
  }

  // ---- panels --------------------------------------------------------------------------------
  private panel(
    title: string,
    kind: string,
    body: string,
    handlers: Record<string, (el: HTMLElement) => void>,
  ): void {
    this.host.panelOpened();
    this.modal.show(
      title,
      body,
      { ...handlers, close: () => this.closePanel() },
      { wide: true, kind, closable: kind !== 'ending' && kind !== 'salvage' },
    );
  }

  showMap(): void {
    const v = this.view;
    if (!this.map.selected || this.map.selected === v.state.systemId) {
      // Preselect the first lane neighbour so J works straight away.
      const n = this.c.lanes.find((l) => l.a === v.state.systemId || l.b === v.state.systemId);
      this.map.selected = n ? (n.a === v.state.systemId ? n.b : n.a) : null;
    }
    this.panel('Star map · the Shoal', 'map', mapBody(v.state, this.c, this.map, v.ship), {
      select: (el) => {
        this.map.selected = el.dataset.id ?? null;
        this.modal.update(mapBody(this.view.state, this.c, this.map, this.view.ship));
      },
      jump: (el) => void this.jumpTo(el.dataset.id!),
    });
    this.attachMapDrag();
  }

  private attachMapDrag(): void {
    let drag: { x: number; y: number } | null = null;
    const svgOf = () => this.modal.el.querySelector<SVGSVGElement>('#cmap-svg');
    this.modal.el.onpointerdown = (e) => {
      if (!(e.target as Element).closest('#cmap-svg') || (e.target as Element).closest('[data-act]')) return;
      drag = { x: e.clientX, y: e.clientY };
      svgOf()?.setPointerCapture(e.pointerId);
    };
    this.modal.el.onpointermove = (e) => {
      if (!drag) return;
      this.map.yaw += (e.clientX - drag.x) * 0.01;
      this.map.pitch = Math.max(-1.4, Math.min(1.4, this.map.pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      this.modal.update(mapBody(this.view.state, this.c, this.map, this.view.ship));
    };
    this.modal.el.onpointerup = () => (drag = null);
  }

  showSystem(): void {
    const v = this.view;
    this.panel(system(this.c, v.state.systemId).name, 'system', systemBody(v.state, this.c, v.readiness), {
      probe: () => void this.do({ type: 'probe' }).then(() => this.refresh()),
      claim: (el) => void this.do({ type: 'claim', planetId: el.dataset.id! }).then(() => this.refresh()),
      dock: () => void this.do({ type: 'dock' }).then(() => this.refresh()),
      buy: (el) => void this.do({ type: 'buy', componentId: el.dataset.id! }).then(() => this.refresh()),
      repair: () => void this.do({ type: 'repair' }).then(() => this.refresh()),
      drop: (el) =>
        void this.do({ type: 'dropHold', index: Number(el.dataset.id) }).then(() => this.refresh()),
      attack: () => void this.attack(),
      signal: () =>
        void this.do({ type: 'signalCaravan' }).then(
          () => this.view.state.outcome !== 'ongoing' && this.showEnding(),
        ),
    });
  }

  showReadiness(): void {
    const v = this.view;
    this.panel('Colony Readiness', 'readiness', readinessBody(v.state, this.c, v.readiness), {
      signal: () =>
        void this.do({ type: 'signalCaravan' }).then(
          () => this.view.state.outcome !== 'ongoing' && this.showEnding(),
        ),
    });
  }

  private showSalvage(): void {
    this.panel('Salvage', 'salvage', salvageBody(this.view.state, this.c), {
      take: () => {
        const ids = [...this.modal.el.querySelectorAll<HTMLInputElement>('[data-salvage]')]
          .filter((x) => x.checked)
          .map((x) => this.view.state.salvageOffer[Number(x.dataset.salvage)]!);
        void this.do({ type: 'takeSalvage', componentIds: ids }).then((ok) => {
          if (ok) {
            this.modal.close();
            this.host.panelClosed();
          }
        });
      },
      leave: () =>
        void this.do({ type: 'takeSalvage', componentIds: [] }).then(() => {
          this.modal.close();
          this.host.panelClosed();
        }),
    });
  }

  private showEnding(): void {
    const s = this.view.state;
    this.panel(
      s.outcome === 'won' ? 'The Caravan is coming' : 'The Caravan Clock ran out',
      'ending',
      endingBody(s, this.c),
      {
        title: () => this.host.exitToTitle(),
      },
    );
  }

  /** Re-render whichever panel is open with the latest state. */
  private refresh(): void {
    if (this.modal.kind === 'system')
      this.modal.update(systemBody(this.view.state, this.c, this.view.readiness));
    else if (this.modal.kind === 'map')
      this.modal.update(mapBody(this.view.state, this.c, this.map, this.view.ship));
    this.renderBar();
  }

  // ---- actions -------------------------------------------------------------------------------
  private async do(a: CampaignAction): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const v = await act(this.saveId, a);
      this.view = v;
      this.narrate(v.events);
      this.renderBar();
      return true;
    } catch (err) {
      this.scene.hud.toast(err instanceof ApiFailure ? err.message : 'The server did not answer', 2600);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async jumpTo(to: string): Promise<void> {
    if (!laneBetween(this.c, this.view.state.systemId, to))
      return void this.scene.hud.toast('No lane from here');
    const ok = await this.do({ type: 'jump', to });
    if (!ok) return;
    this.modal.close();
    this.host.panelClosed();
    await this.enter();
    if (this.view.state.outcome === 'lost') this.showEnding();
  }

  private async attack(): Promise<void> {
    const ok = await this.do({ type: 'attackBase' });
    if (!ok) return;
    this.modal.close();
    this.host.panelClosed();
    await this.enter();
  }

  private narrate(events: CampaignEvent[]): void {
    const c = this.c;
    for (const e of events) {
      let msg = '';
      if (e.t === 'jumped')
        msg = `Fold complete: ${byId(c.systems, e.to).name}. −${e.fuel.toFixed(1)} fold mass, −${e.years.toFixed(2)} years`;
      else if (e.t === 'encounter')
        msg =
          e.reason === 'ambush'
            ? 'Ambush! Pulled out of the fold'
            : e.reason === 'patrol'
              ? 'A patrol moves to intercept'
              : 'Weapons free';
      else if (e.t === 'claimLost')
        msg = `Raiders destroyed your beacon on ${c.systems.flatMap((s) => s.planets).find((p) => p.id === e.planetId)?.name}`;
      else if (e.t === 'claimed') msg = 'Claim beacon placed';
      else if (e.t === 'relation' && e.delta)
        msg = `${byId(c.races, e.raceId).name}: relation ${e.delta > 0 ? '+' : ''}${e.delta}`;
      else if (e.t === 'docked') msg = 'Refit complete';
      else if (e.t === 'probed') msg = 'Probe report received (I)';
      if (msg) this.scene.hud.toast(msg, 2600);
    }
  }

  private renderBar(): void {
    const s = this.view.state;
    const c = this.c;
    const low = (b: boolean) => (b ? 'chbar--low' : '');
    this.bar.innerHTML = `<span><b>${system(c, s.systemId).name}</b></span>
      <span class="${low(s.clock < 2)}">Clock <b>${s.clock.toFixed(2)}</b> yr</span>
      <span class="${low(s.fuel < 20)}">Fold mass <b>${s.fuel.toFixed(0)}</b>/${c.rules.fuel.capacity}</span>
      <span>Range <b>${this.view.ship.range.toFixed(1)}</b> pc</span>
      <span>Beacons <b>${s.beacons}</b></span>
      <span class="${low(s.hull < 0.5)}">Hull <b>${Math.round(s.hull * 100)}%</b></span>
      <span>Data Cores <b>${itemQty(s, 'data-core')}</b></span>`;
  }

  /** For the Playwright hook. */
  snapshot() {
    return {
      systemId: this.view.state.systemId,
      clock: this.view.state.clock,
      fuel: this.view.state.fuel,
      panel: this.modal.kind,
      pending: !!this.view.state.pendingEncounter,
      fighting: this.fighting,
      verification: this.lastVerification,
      state: this.view.state,
    };
  }
}
