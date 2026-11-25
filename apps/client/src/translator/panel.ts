import {
  type CampaignState,
  type ContentBundle,
  type GoodQty,
  type PlayerMove,
  type Race,
  byId,
  diplomacyFacts,
  evaluateTrade,
  goodKind,
  goodName,
  playerHas,
  raceStock,
  relationLabel,
} from '@starwake/shared';
import {
  ApiFailure,
  type TranslatorReply,
  type TranslatorView,
  openChannel,
  sayToChannel,
} from '../net/api.js';
import { esc } from '../ui/help.js';
import type { Modal } from '../ui/modal.js';
import { type Mood, portraitSvg } from './portrait.js';

/**
 * The translator screen (PLAN §5): portrait with mood and tell, transcript, free text and quick
 * chips, a trade panel with a balance bar, relation and patience meters. Every reply shown is the
 * engine's applied version from the server; this screen never changes campaign state itself.
 */
export class TranslatorPanel {
  private raceId = '';
  private mood: Mood = 'neutral';
  private tell = false;
  private busy = false;
  private degraded = false;
  private error = '';
  private tradeOpen = false;
  private give = new Map<string, number>();
  private get = new Map<string, number>();

  constructor(
    private readonly modal: Modal,
    private readonly o: {
      content: () => ContentBundle;
      saveId: () => string;
      state: () => CampaignState;
      /** A reply arrived: the controller takes the new view (and narrates events). */
      update: (v: TranslatorView) => void;
      /** The channel closed (the controller decides what's next: fight, or back to flying). */
      ended: () => void;
      llmMode: () => string;
    },
  ) {
    modal.el.addEventListener('submit', (e) => {
      const f = (e.target as HTMLElement).closest('form[data-form="say"]');
      if (!f || !this.isOpen) return;
      e.preventDefault();
      const input = f.querySelector<HTMLInputElement>('input[name="say"]')!;
      const text = input.value.trim();
      if (text) void this.send({ type: 'say', text });
    });
  }

  get isOpen(): boolean {
    return this.modal.isOpen && this.modal.kind === 'translator';
  }

  private get race(): Race {
    return byId(this.o.content().races, this.raceId);
  }

  async open(raceId: string): Promise<void> {
    this.raceId = raceId;
    this.mood = 'neutral';
    this.tell = false;
    this.tradeOpen = false;
    this.give.clear();
    this.get.clear();
    this.error = '';
    this.busy = true;
    this.show();
    try {
      const v = await openChannel(this.o.saveId(), raceId);
      this.take(v);
    } catch (err) {
      this.busy = false;
      this.error = err instanceof ApiFailure ? err.message : 'The translator could not open a channel.';
      this.render();
    }
  }

  /** Reopen after a reload while a channel was open. */
  resume(): void {
    const conv = this.o.state().conversation;
    if (!conv) return;
    this.raceId = conv.raceId;
    this.degraded = conv.degraded;
    const last = [...conv.transcript].reverse().find((t) => t.who === 'alien');
    this.mood = (last?.mood as Mood) ?? 'neutral';
    this.show();
  }

  async leave(): Promise<void> {
    if (this.busy) return;
    await this.send({ type: 'leave' });
  }

  private show(): void {
    this.modal.show(`Translator · ${esc(this.race.name)}`, this.body(), this.handlers(), {
      wide: true,
      kind: 'translator',
      closable: false,
    });
    this.focusInput();
  }

  private take(v: TranslatorView): void {
    this.busy = false;
    this.degraded = v.degraded || !!v.state.conversation?.degraded;
    if (v.reply) this.setReply(v.reply);
    if (v.events.some((e) => e.t === 'traded' || e.t === 'tribute')) {
      this.give.clear();
      this.get.clear();
    }
    this.o.update(v);
    if (v.ended || !v.state.conversation) {
      this.o.ended();
      return;
    }
    this.render();
    this.focusInput();
  }

  private setReply(r: TranslatorReply): void {
    this.mood = r.mood;
    this.tell = r.tell;
  }

  private async send(move: PlayerMove): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      const v = await sayToChannel(this.o.saveId(), move);
      if (move.type === 'offer') this.tradeOpen = true;
      if (move.type === 'acceptCounter' || move.type === 'payTribute') {
        this.give.clear();
        this.get.clear();
      }
      this.take(v);
    } catch (err) {
      this.busy = false;
      this.error = err instanceof ApiFailure ? err.message : 'The translator lost the signal. Try again.';
      this.render();
    }
  }

  private handlers(): Record<string, (el: HTMLElement) => void> {
    const qty = (m: Map<string, number>, id: string, d: number, max: number) => {
      const n = Math.max(0, Math.min(max, (m.get(id) ?? 0) + d));
      if (n) m.set(id, n);
      else m.delete(id);
      this.render();
    };
    return {
      chip: (el) =>
        void this.send({
          type: el.dataset.move as Exclude<PlayerMove['type'], 'say' | 'offer'>,
        } as PlayerMove),
      trade: () => {
        this.tradeOpen = !this.tradeOpen;
        this.render();
      },
      give: (el) =>
        qty(
          this.give,
          el.dataset.id!,
          Number(el.dataset.d),
          playerHas(this.o.state(), el.dataset.id!, this.o.content()),
        ),
      get: (el) =>
        qty(
          this.get,
          el.dataset.id!,
          Number(el.dataset.d),
          raceStock(this.o.state(), this.race, el.dataset.id!),
        ),
      offer: () => void this.send({ type: 'offer', trade: this.trade() }),
      clearTrade: () => {
        this.give.clear();
        this.get.clear();
        this.render();
      },
      leave: () => void this.leave(),
    };
  }

  private trade() {
    const list = (m: Map<string, number>): GoodQty[] => [...m].map(([itemId, qty]) => ({ itemId, qty }));
    return { playerGives: list(this.give), raceGives: list(this.get) };
  }

  private render(): void {
    if (!this.isOpen) return;
    const log = this.modal.el.querySelector('.tr-log');
    const keepScroll = log ? log.scrollHeight - log.scrollTop - log.clientHeight < 40 : true;
    const draft = this.modal.el.querySelector<HTMLInputElement>('input[name="say"]')?.value ?? '';
    this.modal.update(this.body());
    const input = this.modal.el.querySelector<HTMLInputElement>('input[name="say"]');
    if (input) input.value = draft;
    const l2 = this.modal.el.querySelector('.tr-log');
    if (l2 && keepScroll) l2.scrollTop = l2.scrollHeight;
  }

  private focusInput(): void {
    const i = this.modal.el.querySelector<HTMLInputElement>('input[name="say"]');
    if (i && !this.busy) {
      i.value = '';
      i.focus();
    }
  }

  private body(): string {
    const c = this.o.content();
    const s = this.o.state();
    const race = this.race;
    const conv = s.conversation;
    const f = diplomacyFacts(s, race.id, c);
    const rel = f.relation;
    const patience = conv?.patience ?? 0;
    const maxP = race.diplomacy.patienceTurns;
    const status = this.busy
      ? '<span class="tr-decoding" aria-live="polite">decoding<span>…</span></span>'
      : this.degraded
        ? '<span class="tr-degraded">Signal degraded: the translator is using its phrasebook</span>'
        : this.o.llmMode() === 'mock'
          ? '<span class="sw-meta">Translator (mock)</span>'
          : '<span class="sw-meta">Translator online</span>';

    const lines = (conv?.transcript ?? [])
      .map((t) => {
        if (t.who === 'system') return `<div class="tr-line tr-line--sys">${esc(t.text)}</div>`;
        if (t.who === 'player') return `<div class="tr-line tr-line--you"><b>You</b> ${esc(t.text)}</div>`;
        const tags = [
          t.tell ? `<span class="tr-tag tr-tag--tell" title="${esc(race.persona.tell)}">tell</span>` : '',
          t.unverified ? '<span class="tr-tag">unverified</span>' : '',
        ].join('');
        return `<div class="tr-line"><b>${esc(race.name)}</b> ${esc(t.text)} ${tags}</div>`;
      })
      .join('');

    const chips: [string, PlayerMove['type']][] = [
      ['Ask about yourselves', 'about'],
      ['Ask about the cluster', 'askKnowledge'],
      ['Propose treaty', 'askTreaty'],
      ['Ask for safe passage', 'askPassage'],
    ];
    const demand = conv?.demand;
    const counter = conv?.counter;

    const tradeHtml = this.tradeOpen ? this.tradePanel(s, c, race) : '';
    const meter = (v: number, lo: number, hi: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
    return `<div class="tr">
      <div class="tr-side">
        <div class="tr-portrait">${portraitSvg(race, this.mood, this.tell)}</div>
        <div class="tr-meter-row"><span>Relation: <b>${esc(relationLabel(rel, c))}</b> (${rel})</span>
          <div class="sw-meter" role="meter" aria-label="Relation" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${rel}"><i style="left:${meter(rel, -100, 100)}"></i></div></div>
        <div class="tr-meter-row"><span>Patience</span>
          <div class="tr-bar" role="meter" aria-label="Patience" aria-valuemin="0" aria-valuemax="${maxP}" aria-valuenow="${patience}"><i style="width:${meter(patience, 0, maxP)}"></i></div></div>
        <div class="sw-meta">${f.treaty ? 'Treaty signed · ' : ''}${f.passage ? 'Safe passage · ' : ''}Their tell: ${esc(race.persona.tell.toLowerCase())}</div>
        <div>${status}</div>
      </div>
      <div class="tr-main">
        <div class="tr-log" role="log" aria-live="polite">${lines || '<div class="sw-meta">The channel is open.</div>'}</div>
        ${this.error ? `<p class="sw-warn" role="alert">${esc(this.error)}</p>` : ''}
        ${demand ? `<div class="tr-demand"><b>They demand:</b> ${demand.map((g) => `${g.qty} ${esc(goodName(c, g.itemId, race))}`).join(', ')} <button class="sw-btn sw-btn--primary" data-act="chip" data-move="payTribute" ${this.busy ? 'disabled' : ''}>Pay tribute</button></div>` : ''}
        ${counter ? `<div class="tr-demand"><b>Their counter-offer:</b> you give ${counter.playerGives.map((g) => `${g.qty} ${esc(goodName(c, g.itemId, race))}`).join(', ') || 'nothing'}; they give ${counter.raceGives.map((g) => `${g.qty} ${esc(goodName(c, g.itemId, race))}`).join(', ')} <button class="sw-btn sw-btn--primary" data-act="chip" data-move="acceptCounter" ${this.busy ? 'disabled' : ''}>Accept counter</button></div>` : ''}
        <div class="sw-row tr-chips">${chips.map(([label, m]) => `<button class="sw-btn sw-btn--chip" data-act="chip" data-move="${m}" ${this.busy ? 'disabled' : ''}>${label}</button>`).join('')}
          <button class="sw-btn sw-btn--chip" data-act="trade" aria-expanded="${this.tradeOpen}">Trade</button>
          <button class="sw-btn sw-btn--chip" data-act="leave" ${this.busy ? 'disabled' : ''}>Leave (Esc)</button></div>
        ${tradeHtml}
        <form class="sw-row" data-form="say"><input class="sw-input" name="say" maxlength="500" autocomplete="off" placeholder="Say something to the ${esc(race.name)}" aria-label="What you say" ${this.busy ? 'disabled' : ''}/><button class="sw-btn sw-btn--primary" type="submit" ${this.busy ? 'disabled' : ''}>Say</button></form>
      </div></div>`;
  }

  private tradePanel(s: CampaignState, c: ContentBundle, race: Race): string {
    const mine = new Set<string>();
    for (const h of s.hold) mine.add(h.type === 'item' ? h.itemId : h.componentId);
    if (s.fuel >= 1) mine.add('fold-mass');
    const theirs = Object.keys({ ...race.economy.stock, ...(s.raceStock[race.id] ?? {}) }).filter(
      (id) =>
        raceStock(s, race, id) > 0 &&
        !(goodKind(c, id) === 'service' && s.flags.includes(`${id}:${race.id}`)),
    );
    const step = (id: string) => (id === 'fold-mass' ? 5 : 1);
    const row = (act: 'give' | 'get', id: string, have: number, n: number) =>
      `<div class="tr-good"><span>${esc(goodName(c, id, race))} <small>(${have})</small></span>
        <span class="tr-qty"><button class="sw-btn sw-btn--chip" data-act="${act}" data-id="${id}" data-d="-${step(id)}" aria-label="${act === 'give' ? 'Give less' : 'Ask for less'} ${esc(goodName(c, id, race))}" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button class="sw-btn sw-btn--chip" data-act="${act}" data-id="${id}" data-d="${step(id)}" aria-label="${act === 'give' ? 'Give more' : 'Ask for more'} ${esc(goodName(c, id, race))}" ${n < have ? '' : 'disabled'}>+</button></span></div>`;
    const t = this.trade();
    const ev = evaluateTrade(s, race.id, t, c);
    // Balance bar: centre = even; right = in their favour (more likely accepted).
    const span = Math.max(20, ev.give, ev.get);
    const pos = Math.max(0, Math.min(100, 50 + ((ev.give - ev.get) / span) * 50));
    const verdict =
      ev.reason === 'empty'
        ? 'Add goods to either side.'
        : ev.acceptable
          ? 'Looks fair to them.'
          : ev.reason === 'unbalanced'
            ? `They will want about ${Math.ceil(ev.get * (1 - ev.tolerance) - ev.give)} more in value.`
            : `Can't offer that: ${ev.reason.replace('_', ' ')}.`;
    return `<div class="tr-trade">
      <div><div class="sw-kicker">You give</div>${[...mine].map((id) => row('give', id, playerHas(s, id, c), this.give.get(id) ?? 0)).join('') || '<p class="sw-meta">Nothing to trade.</p>'}</div>
      <div><div class="sw-kicker">They give</div>${theirs.map((id) => row('get', id, raceStock(s, race, id), this.get.get(id) ?? 0)).join('') || '<p class="sw-meta">They have nothing left.</p>'}</div>
      <div class="tr-balance"><div class="tr-balance__bar" role="meter" aria-label="Trade balance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pos.toFixed(0)}"><i style="left:${pos}%"></i><span class="tr-balance__mid"></span></div>
        <div class="sw-row"><span class="sw-meta">${esc(verdict)}</span>
        <button class="sw-btn sw-btn--primary" data-act="offer" ${ev.reason === 'ok' || ev.reason === 'unbalanced' ? '' : 'disabled'} ${this.busy ? 'disabled' : ''}>Offer</button>
        <button class="sw-btn" data-act="clearTrade">Clear</button></div></div>
    </div>`;
  }
}
