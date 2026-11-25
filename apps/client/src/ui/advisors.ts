import type { ContentBundle } from '@starwake/shared';
import { type Action, ACTIONS, type KeyMap, keyLabel } from '../input/keymap.js';
import { type AdvisorReply, ApiFailure, askAdvisor } from '../net/api.js';
import { esc } from './help.js';
import type { Modal } from './modal.js';

/** Render answer text: escape it, then show `{key:<action>}` as the player's own key. */
export function renderAnswer(text: string, map: KeyMap): string {
  return esc(text).replace(/\{key:([A-Za-z]+)\}/g, (_m, a: string) => {
    if (!(a in ACTIONS)) return '';
    const b = map[a as Action][0];
    return `<span class="sw-kbd">${b ? esc(keyLabel(b)) : 'unbound'}</span>`;
  });
}

interface Line {
  who: string;
  text: string;
  player?: boolean;
}

/**
 * The advisors panel (playtest batch 1, #3): WAKE and the bridge council. Pick who to ask, click a
 * suggested question or type your own. Answers come from the server (scripted now; M5 routes them
 * through the translator) and never change the campaign.
 */
export class AdvisorPanel {
  private who = 'wake';
  private log: Line[] = [];
  private suggestions: string[] = [];
  private busy = false;

  constructor(
    private readonly modal: Modal,
    private readonly o: {
      content: () => ContentBundle;
      saveId: () => string | null;
      keyMap: () => KeyMap;
      onClose: () => void;
    },
  ) {
    modal.el.addEventListener('submit', (e) => {
      const f = (e.target as HTMLElement).closest('form[data-form="advisor"]');
      if (!f) return;
      e.preventDefault();
      const input = f.querySelector<HTMLInputElement>('input[name="q"]')!;
      const q = input.value.trim();
      if (q) void this.ask(q);
    });
  }

  get isOpen(): boolean {
    return this.modal.isOpen && this.modal.kind === 'advisors';
  }

  open(who = this.who, question?: string): void {
    this.who = who;
    const a = this.advisor();
    if (!this.log.length) this.log.push({ who: a.name, text: a.greeting });
    this.suggestions = a.suggestions;
    this.modal.show('Advisors', this.body(), this.handlers(), {
      wide: true,
      kind: 'advisors',
      closable: true,
    });
    this.focusInput();
    if (question) void this.ask(question);
  }

  private advisor() {
    const list = this.o.content().advisors.advisors;
    return list.find((x) => x.id === this.who) ?? list[0]!;
  }

  private handlers(): Record<string, (el: HTMLElement) => void> {
    return {
      close: () => this.o.onClose(),
      who: (el) => {
        this.who = el.dataset.id ?? 'wake';
        const a = this.advisor();
        this.log.push({ who: a.name, text: a.greeting });
        this.suggestions = a.suggestions;
        this.refresh();
        this.focusInput();
      },
      suggest: (el) => void this.ask(el.dataset.q ?? ''),
    };
  }

  async ask(q: string): Promise<void> {
    if (this.busy || !q) return;
    this.busy = true;
    this.log.push({ who: 'You', text: q, player: true });
    this.refresh();
    let reply: AdvisorReply;
    try {
      reply = await askAdvisor(this.o.saveId(), this.who, q);
    } catch (err) {
      this.log.push({
        who: 'WAKE',
        text:
          err instanceof ApiFailure ? err.message : 'The council cannot hear you: the server did not answer.',
      });
      this.busy = false;
      this.refresh();
      return;
    }
    const by = this.o.content().advisors.advisors.find((x) => x.id === reply.advisorId);
    this.log.push({ who: by?.name ?? reply.advisorId, text: reply.text });
    if (reply.handoff && by) this.who = by.id;
    this.suggestions = reply.suggestions;
    this.busy = false;
    this.refresh();
    this.focusInput(true);
  }

  private refresh(): void {
    if (!this.isOpen) return;
    this.modal.update(this.body());
    const log = this.modal.el.querySelector('.sw-advisor__log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  private focusInput(clear = false): void {
    const i = this.modal.el.querySelector<HTMLInputElement>('input[name="q"]');
    if (!i) return;
    if (clear) i.value = '';
    i.focus();
  }

  private body(): string {
    const c = this.o.content();
    const map = this.o.keyMap();
    const tabs = c.advisors.advisors
      .map(
        (a) =>
          `<button class="sw-btn" data-act="who" data-id="${a.id}" aria-pressed="${a.id === this.who}" title="${esc(a.role)}">${esc(a.name.split(' ')[0] ?? a.name)}</button>`,
      )
      .join('');
    const lines = this.log
      .slice(-12)
      .map(
        (l) =>
          `<div class="sw-advisor__line ${l.player ? 'sw-advisor__line--you' : ''}"><b>${esc(l.who)}</b> ${l.player ? esc(l.text) : renderAnswer(l.text, map)}</div>`,
      )
      .join('');
    const chips = this.suggestions
      .map(
        (q) => `<button class="sw-btn sw-btn--chip" data-act="suggest" data-q="${esc(q)}">${esc(q)}</button>`,
      )
      .join('');
    const a = this.advisor();
    return `<div class="sw-advisor">
      <div class="sw-row" role="group" aria-label="Who to ask">${tabs}</div>
      <p class="sw-meta">${esc(a.name)}: ${esc(a.role)}</p>
      <div class="sw-advisor__log" role="log" aria-live="polite" tabindex="0" aria-label="Conversation">${lines}${this.busy ? '<div class="sw-meta">…</div>' : ''}</div>
      <div class="sw-row sw-advisor__chips">${chips}</div>
      <form class="sw-row" data-form="advisor"><input class="sw-input" name="q" maxlength="300" autocomplete="off" placeholder="Ask ${esc(a.name)} a question" aria-label="Your question"/><button class="sw-btn sw-btn--primary" type="submit">Ask</button></form>
    </div>`;
  }
}
