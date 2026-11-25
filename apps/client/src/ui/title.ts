import { audio } from '../audio/audio.js';
import { THEMES, type Health, type ThemeId } from '@starwake/shared';
import { currentTheme, onThemeChange, setTheme } from '../themes/theme.js';
import type { ProfileSummary, SaveMeta } from '../net/api.js';
import { esc } from './help.js';

export interface TitleHandlers {
  selectProfile(id: string): void;
  createProfile(name: string): void;
  newGame(): void;
  continueGame(): void;
  loadSave(id: string): void;
  flightTest(): void;
  arena(): void;
  settings(): void;
}

const LLM_LABEL = {
  up: 'Translator: online',
  down: 'Translator: signal degraded (scripted fallback)',
  mock: 'Translator: mock mode',
  off: 'Translator: off (scripted)',
} as const;

/**
 * Title screen (PLAN §5.1): a click-to-begin gate (browsers only allow audio after a gesture), then
 * the pilot (profile) picker and the menu.
 */
export class TitleScreen {
  readonly el: HTMLDivElement;
  private gated = true;
  private health: Health | null = null;
  private profiles: ProfileSummary[] = [];
  private profile: string | null = null;
  private saves: { id: string; meta: SaveMeta }[] = [];
  private confirmNew = false;
  private showLoad = false;
  private message = '';
  private offTheme: () => void;

  constructor(
    parent: HTMLElement,
    private readonly h: TitleHandlers,
  ) {
    this.el = document.createElement('div');
    parent.appendChild(this.el);
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('change', this.onChange);
    this.el.addEventListener('submit', this.onSubmit);
    this.offTheme = onThemeChange(() => this.render());
    this.render();
  }

  setHealth(h: Health | null): void {
    this.health = h;
    this.render();
  }

  setProfiles(list: ProfileSummary[], selected: string | null): void {
    this.profiles = list;
    this.profile = selected;
    this.render();
  }

  setSaves(saves: { id: string; meta: SaveMeta }[]): void {
    this.saves = saves;
    this.confirmNew = false;
    this.render();
  }

  setMessage(m: string): void {
    this.message = m;
    this.render();
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (on) {
      this.confirmNew = false;
      this.showLoad = false;
      this.render();
    }
  }

  private render(): void {
    if (this.gated) {
      this.el.innerHTML = `<button class="sw-gate" data-act="begin" aria-label="Click to begin"><span>Click to begin</span></button>`;
      return;
    }
    const h = this.health;
    const build = h ? `v${h.version} · ${h.gitSha.slice(0, 7)}` : 'server unreachable';
    const llm = h ? LLM_LABEL[h.llm] : 'Translator: unknown';
    const auto = this.saves.find((s) => s.meta.slot === 'auto');
    const manual = this.saves;
    const pilot = this.profile;
    const describe = (m: SaveMeta) =>
      `${m.slot === 'auto' ? 'Autosave' : `Slot ${m.slot}`} · ${esc(m.systemName)} · ${m.clock.toFixed(2)} yr${m.outcome !== 'ongoing' ? ` · ${m.outcome}` : ''}`;
    const options = this.profiles
      .map((p) => `<option value="${p.id}" ${p.id === pilot ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    this.el.innerHTML = `
      <section class="sw-panel sw-title-screen" aria-labelledby="sw-title">
        <div class="sw-kicker">Generative Distractions</div>
        <h1 class="sw-title" id="sw-title">Starwake</h1>
        <p>Pathfinder for the Long Caravan. Find it a home before the clock runs out.</p>
        <div class="sw-field"><label for="sw-pilot">Pilot</label>
          ${this.profiles.length ? `<select id="sw-pilot" class="sw-btn" data-change="pilot">${options}</select>` : '<span class="sw-meta">No pilots yet</span>'}</div>
        <form class="sw-row" data-form="pilot"><input class="sw-input" name="name" maxlength="24" placeholder="New pilot name" aria-label="New pilot name"/><button class="sw-btn" type="submit">Add pilot</button></form>
        ${this.message ? `<div class="sw-warn" role="status">${esc(this.message)}</div>` : ''}
        <nav class="sw-menu" aria-label="Main menu">
          ${
            this.confirmNew
              ? `<div class="sw-row"><span>Overwrite the current game?</span><button class="sw-btn sw-btn--danger" data-act="new-yes">Overwrite</button><button class="sw-btn" data-act="new-no">Cancel</button></div>`
              : `<button class="sw-btn ${auto ? '' : 'sw-btn--primary'}" data-act="new" ${pilot ? '' : 'disabled'}>New game</button>`
          }
          <button class="sw-btn ${auto ? 'sw-btn--primary' : ''}" data-act="continue" ${auto ? '' : 'disabled'}>Continue${auto ? ` <small>${describe(auto.meta)}</small>` : ''}</button>
          <button class="sw-btn" data-act="load" ${manual.length ? '' : 'disabled'}>Load…</button>
          ${this.showLoad ? `<div class="sw-menu sw-menu--sub">${manual.map((s) => `<button class="sw-btn" data-act="load-id" data-id="${s.id}">${describe(s.meta)}</button>`).join('')}</div>` : ''}
          <button class="sw-btn" data-act="flight">Flight test</button>
          <button class="sw-btn" data-act="arena">Practice arena</button>
          <button class="sw-btn" data-act="settings">Settings and controls</button>
        </nav>
        <div class="sw-row" role="group" aria-label="Theme">
          ${THEMES.map((t) => `<button class="sw-btn" data-theme-id="${t.id}" aria-pressed="${currentTheme() === t.id}">${t.name}</button>`).join('')}
        </div>
        <div class="sw-meta" id="sw-build">${build}</div>
        <div class="sw-meta"><span class="sw-dot sw-dot--${h?.llm ?? 'down'}"></span><span id="sw-llm">${llm}</span></div>
      </section>`;
  }

  private onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-theme-id]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'begin') {
      audio.unlock(); // the gesture browsers need before any sound
      this.gated = false;
      this.render();
    } else if (act === 'new') {
      if (this.saves.some((s) => s.meta.slot === 'auto')) {
        this.confirmNew = true;
        this.render();
      } else this.h.newGame();
    } else if (act === 'new-yes') this.h.newGame();
    else if (act === 'new-no') {
      this.confirmNew = false;
      this.render();
    } else if (act === 'continue') this.h.continueGame();
    else if (act === 'load') {
      this.showLoad = !this.showLoad;
      this.render();
    } else if (act === 'load-id' && t.dataset.id) this.h.loadSave(t.dataset.id);
    else if (act === 'flight') this.h.flightTest();
    else if (act === 'arena') this.h.arena();
    else if (act === 'settings') this.h.settings();
    else if (t.dataset.themeId) setTheme(t.dataset.themeId as ThemeId);
  };

  private onChange = (e: Event): void => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.change === 'pilot') this.h.selectProfile(t.value);
  };

  private onSubmit = (e: Event): void => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (name) this.h.createProfile(name);
  };

  dispose(): void {
    this.offTheme();
    this.el.remove();
  }
}
