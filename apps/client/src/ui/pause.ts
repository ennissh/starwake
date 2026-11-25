import { THEMES, type ThemeId } from '@starwake/shared';
import {
  ACTIONS,
  ACTION_GROUPS,
  ACTION_IDS,
  type Action,
  MAX_BINDINGS,
  defaultKeyMap,
  keyLabel,
  rebind,
} from '../input/keymap.js';
import type { Input } from '../input/input.js';
import { type Settings, saveSettings } from '../settings.js';
import { currentTheme, setTheme } from '../themes/theme.js';
import { MOUSE_HELP, esc, helpTable } from './help.js';

type Tab = 'main' | 'controls' | 'settings' | 'help' | 'saves';

/** Save/load hooks, present only while a campaign is running. */
export interface SaveHooks {
  list(): Promise<{ id: string; label: string; slot: string }[]>;
  save(slot: '1' | '2' | '3'): Promise<void>;
  load(id: string): Promise<void>;
}

export interface PauseHandlers {
  resume(): void;
  quit(): void;
  settingsChanged(s: Settings): void;
  /** Replay the first-flight tutorial (campaign only; absent elsewhere). */
  tutorial?: () => void;
  /** Open the advisors. */
  advisors?: () => void;
}

/** Pause menu (Esc): resume, controls (rebinding), settings, key help, quit to title. */
export class PauseMenu {
  readonly el: HTMLDivElement;
  private tab: Tab = 'main';
  private waiting: { action: Action; slot: number } | null = null;
  private note = '';
  saveHooks: SaveHooks | null = null;
  private saveList: { id: string; label: string; slot: string }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
    private settings: Settings,
    private profile: string,
    private readonly h: PauseHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'sw-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('input', this.onInput);
  }

  /** Set while a campaign is running (enables campaign-only items). */
  inCampaign = false;

  setProfile(profile: string, settings: Settings): void {
    this.profile = profile;
    this.settings = settings;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(tab: Tab = 'main'): void {
    this.tab = tab;
    this.note = '';
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.waiting = null;
    this.el.hidden = true;
  }

  private persist(): void {
    saveSettings(this.settings, this.profile);
    this.h.settingsChanged(this.settings);
  }

  private render(): void {
    const tabs: [Tab, string][] = [
      ['main', 'Paused'],
      ...(this.saveHooks ? ([['saves', 'Save / load']] as [Tab, string][]) : []),
      ['controls', 'Controls'],
      ['settings', 'Settings'],
      ['help', 'Key help'],
    ];
    const head = `
      <div class="sw-dialog__head"><h2 id="sw-pause-title">${tabs.find((t) => t[0] === this.tab)![1]}</h2>
        <button class="sw-btn sw-btn--primary" data-act="resume">Resume</button></div>
      <div class="sw-tabs" role="tablist">${tabs
        .map(
          ([id, label]) =>
            `<button class="sw-tab" role="tab" aria-selected="${id === this.tab}" data-tab="${id}">${label}</button>`,
        )
        .join('')}</div>`;
    let body: string;
    if (this.tab === 'main') {
      body = `<div class="sw-menu">
        <button class="sw-btn" data-act="resume">Resume</button>
        ${this.h.advisors ? '<button class="sw-btn" data-act="advisors">Ask the advisors</button>' : ''}
        ${this.h.tutorial && this.inCampaign ? '<button class="sw-btn" data-act="tutorial">Replay tutorial</button>' : ''}
        <button class="sw-btn" data-tab="controls">Controls</button>
        <button class="sw-btn" data-tab="settings">Settings</button>
        <button class="sw-btn" data-act="quit">Quit to title</button></div>`;
    } else if (this.tab === 'controls') {
      body = this.controlsBody();
    } else if (this.tab === 'settings') {
      body = this.settingsBody();
    } else if (this.tab === 'saves') {
      body = this.savesBody();
    } else {
      body = helpTable(this.settings.bindings, MOUSE_HELP);
    }
    this.el.innerHTML = `<section class="sw-panel sw-dialog" role="dialog" aria-modal="true" aria-labelledby="sw-pause-title">${head}${body}</section>`;
  }

  private controlsBody(): string {
    const rows: string[] = [];
    for (const g of ACTION_GROUPS) {
      rows.push(`<tr><th>${g}</th><th>Key</th><th>Alternate</th></tr>`);
      for (const a of ACTION_IDS.filter((x) => ACTIONS[x].group === g)) {
        const cells: string[] = [];
        for (let slot = 0; slot < MAX_BINDINGS; slot++) {
          const b = this.settings.bindings[a][slot];
          const wait = this.waiting?.action === a && this.waiting.slot === slot;
          cells.push(
            `<td><button class="sw-btn sw-bind ${wait ? 'sw-bind--wait' : ''}" data-bind="${a}" data-slot="${slot}" aria-label="${esc(ACTIONS[a].label)} key ${slot + 1}">${wait ? 'Press a key…' : b ? esc(keyLabel(b)) : '—'}</button></td>`,
          );
        }
        rows.push(`<tr><td>${ACTIONS[a].label}</td>${cells.join('')}</tr>`);
      }
    }
    return `<p class="sw-meta">Click a key, then press the new key or mouse button. Esc cancels. Only Shift can modify a key; browser keys (Ctrl/Alt combinations, F5, F11, F12) can't be bound.</p>
      <div class="sw-note" role="status">${esc(this.note)}</div>
      <table class="sw-table">${rows.join('')}</table>
      <div class="sw-row"><button class="sw-btn" data-act="reset-keys">Reset all to defaults</button></div>`;
  }

  private savesBody(): string {
    const label = (slot: string) => this.saveList.find((x) => x.slot === slot)?.label ?? 'empty';
    const rows = (['1', '2', '3'] as const)
      .map(
        (slot) => `<tr><td>Slot ${slot}</td><td>${esc(label(slot))}</td>
          <td><button class="sw-btn" data-save="${slot}">Save here</button></td>
          <td>${this.saveList.some((x) => x.slot === slot) ? `<button class="sw-btn" data-load="${this.saveList.find((x) => x.slot === slot)!.id}">Load</button>` : ''}</td></tr>`,
      )
      .join('');
    return `<p class="sw-meta">The game autosaves after every action. Manual slots keep a copy you can return to.</p>
      <div class="sw-note" role="status">${esc(this.note)}</div>
      <table class="sw-table"><tr><th>Slot</th><th>Saved</th><th></th><th></th></tr>
      <tr><td>Autosave</td><td>${esc(label('auto'))}</td><td></td><td></td></tr>${rows}</table>`;
  }

  private async refreshSaves(): Promise<void> {
    if (!this.saveHooks) return;
    this.saveList = await this.saveHooks.list();
    if (this.tab === 'saves') this.render();
  }

  private settingsBody(): string {
    const s = this.settings;
    return `<div class="sw-menu">
      <label class="sw-field">Mouse sensitivity <input type="range" min="0.25" max="4" step="0.05" value="${s.mouseSensitivity}" data-set="sens" aria-label="Mouse sensitivity"/></label>
      <label class="sw-field">Mouse steers the ship <input type="checkbox" ${s.mouseSteering ? 'checked' : ''} data-set="steer"/></label>
      <label class="sw-field">Invert mouse pitch <input type="checkbox" ${s.invertY ? 'checked' : ''} data-set="invert"/></label>
      <div class="sw-field">Theme <div class="sw-row">${THEMES.map(
        (t) =>
          `<button class="sw-btn" data-theme-id="${t.id}" aria-pressed="${currentTheme() === t.id}">${t.name}</button>`,
      ).join('')}</div></div>
      <p class="sw-meta">Settings are saved for this profile.</p></div>`;
  }

  private onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-act],[data-tab],[data-bind],[data-theme-id],[data-save],[data-load]',
    );
    if (!t) return;
    if (t.dataset.save && this.saveHooks) {
      const slot = t.dataset.save as '1' | '2' | '3';
      void this.saveHooks.save(slot).then(
        () => {
          this.note = `Saved to slot ${slot}.`;
          void this.refreshSaves();
        },
        (err: Error) => {
          this.note = err.message;
          this.render();
        },
      );
      return;
    }
    if (t.dataset.load && this.saveHooks) {
      void this.saveHooks.load(t.dataset.load);
      return;
    }
    if (t.dataset.tab) {
      this.tab = t.dataset.tab as Tab;
      this.note = '';
      this.render();
      if (this.tab === 'saves') void this.refreshSaves();
    } else if (t.dataset.act === 'resume') this.h.resume();
    else if (t.dataset.act === 'quit') this.h.quit();
    else if (t.dataset.act === 'tutorial') this.h.tutorial?.();
    else if (t.dataset.act === 'advisors') this.h.advisors?.();
    else if (t.dataset.act === 'reset-keys') {
      this.settings.bindings = defaultKeyMap();
      this.note = 'All keys reset to defaults.';
      this.persist();
      this.render();
    } else if (t.dataset.themeId) {
      setTheme(t.dataset.themeId as ThemeId);
      this.settings.theme = t.dataset.themeId as ThemeId;
      this.persist();
      this.render();
    } else if (t.dataset.bind) {
      const action = t.dataset.bind as Action;
      const slot = Number(t.dataset.slot);
      this.waiting = { action, slot };
      this.note = '';
      this.render();
      this.input.capture((b) => {
        this.waiting = null;
        if (b) {
          try {
            const r = rebind(this.settings.bindings, action, slot, b);
            this.settings.bindings = r.map;
            this.note = r.stolenFrom.length
              ? `${keyLabel(b)} moved from ${r.stolenFrom.map((a) => ACTIONS[a].label).join(', ')} to ${ACTIONS[action].label}.`
              : `${ACTIONS[action].label}: ${keyLabel(b)}.`;
            this.persist();
          } catch (err) {
            this.note = `${keyLabel(b)}: ${(err as Error).message}`;
          }
        }
        this.render();
      });
    }
  };

  private onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.set === 'sens') this.settings.mouseSensitivity = Number(t.value);
    else if (t.dataset.set === 'invert') this.settings.invertY = t.checked;
    else if (t.dataset.set === 'steer') this.settings.mouseSteering = t.checked;
    else return;
    this.persist();
  };
}
