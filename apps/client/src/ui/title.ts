import { THEMES, type Health, type ThemeId } from '@starwake/shared';
import { currentTheme, onThemeChange, setTheme } from '../themes/theme.js';

export interface TitleHandlers {
  flightTest(): void;
  settings(): void;
}

const LLM_LABEL = {
  up: 'Translator: online',
  down: 'Translator: signal degraded (scripted fallback)',
  mock: 'Translator: mock mode',
  off: 'Translator: off (scripted)',
} as const;

/**
 * Title screen (PLAN §5.1). A click-to-begin gate first (browsers only allow audio after a gesture),
 * then the menu. New game, Continue and the practice arena arrive with M2/M3.
 */
export class TitleScreen {
  readonly el: HTMLDivElement;
  private gated = true;
  private health: Health | null = null;
  private offTheme: () => void;

  constructor(
    parent: HTMLElement,
    private readonly h: TitleHandlers,
  ) {
    this.el = document.createElement('div');
    parent.appendChild(this.el);
    this.el.addEventListener('click', this.onClick);
    this.offTheme = onThemeChange(() => this.render());
    this.render();
  }

  setHealth(h: Health | null): void {
    this.health = h;
    this.render();
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  private render(): void {
    if (this.gated) {
      this.el.innerHTML = `<button class="sw-gate" data-act="begin" aria-label="Click to begin"><span>Click to begin</span></button>`;
      return;
    }
    const h = this.health;
    const build = h ? `v${h.version} · ${h.gitSha.slice(0, 7)}` : 'server unreachable';
    const llm = h ? LLM_LABEL[h.llm] : 'Translator: unknown';
    this.el.innerHTML = `
      <section class="sw-panel sw-title-screen" aria-labelledby="sw-title">
        <div class="sw-kicker">Generative Distractions</div>
        <h1 class="sw-title" id="sw-title">Starwake</h1>
        <p>Pathfinder for the Long Caravan. Find it a home before the clock runs out.</p>
        <nav class="sw-menu" aria-label="Main menu">
          <button class="sw-btn" disabled>New game <small>M3</small></button>
          <button class="sw-btn" disabled>Continue <small>M3</small></button>
          <button class="sw-btn sw-btn--primary" data-act="flight">Flight test</button>
          <button class="sw-btn" disabled>Practice arena <small>M2</small></button>
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
    if (t.dataset.act === 'begin') {
      this.gated = false;
      this.render();
    } else if (t.dataset.act === 'flight') this.h.flightTest();
    else if (t.dataset.act === 'settings') this.h.settings();
    else if (t.dataset.themeId) setTheme(t.dataset.themeId as ThemeId);
  };

  dispose(): void {
    this.offTheme();
    this.el.remove();
  }
}
