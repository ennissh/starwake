import {
  type CampaignState,
  type ContentBundle,
  type RefitLoc,
  type RefitMove,
  RuleError,
  SYSTEM_IDS,
  applyMoves,
  byId,
  shipStats,
  system,
} from '@starwake/shared';
import { esc } from '../ui/help.js';
import type { Modal } from '../ui/modal.js';

/**
 * Engine room (M4, F): six systems × slots and the hold. Pick a part (click, or drag it), then pick
 * where it goes; every pending move is previewed with the same shared rules the server applies.
 * Confirm sends one refit action; away from the Waystation each swap costs time.
 */
export class EngineRoom {
  private moves: RefitMove[] = [];
  private picked: RefitLoc | null = null;
  private note = '';
  private dragFrom: RefitLoc | null = null;

  constructor(
    private readonly modal: Modal,
    private readonly o: {
      content: () => ContentBundle;
      state: () => CampaignState;
      confirm: (moves: RefitMove[]) => Promise<boolean>;
      close: () => void;
    },
  ) {
    const el = modal.el;
    el.addEventListener('dragstart', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-loc][draggable="true"]');
      if (!t || !this.isOpen) return;
      this.dragFrom = JSON.parse(t.dataset.loc!) as RefitLoc;
      e.dataTransfer?.setData('text/plain', t.dataset.loc!);
    });
    el.addEventListener('dragover', (e) => {
      if (this.dragFrom && (e.target as HTMLElement).closest('[data-loc]')) e.preventDefault();
    });
    el.addEventListener('drop', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-loc]');
      if (!t || !this.dragFrom) return;
      e.preventDefault();
      this.tryMove(this.dragFrom, JSON.parse(t.dataset.loc!) as RefitLoc);
      this.dragFrom = null;
    });
  }

  get isOpen(): boolean {
    return this.modal.isOpen && this.modal.kind === 'engine';
  }

  open(): void {
    this.moves = [];
    this.picked = null;
    this.note = 'Pick a part, then where it goes. Or drag it.';
    this.modal.show('Engine room', this.body(), this.handlers(), {
      wide: true,
      kind: 'engine',
      closable: true,
    });
  }

  /** The current state changed under us (e.g. after confirm). */
  refresh(): void {
    if (this.isOpen) this.modal.update(this.body());
  }

  private handlers(): Record<string, (el: HTMLElement) => void> {
    return {
      close: () => this.o.close(),
      loc: (el) => {
        const loc = JSON.parse(el.dataset.loc!) as RefitLoc;
        if (!this.picked) {
          if (el.dataset.empty === '1') return this.say('That place is empty: pick a part first.');
          this.picked = loc;
          this.say('Now pick where it goes (a slot, or the hold).');
        } else if (same(this.picked, loc)) {
          this.picked = null;
          this.say('Put back.');
        } else {
          this.tryMove(this.picked, loc);
        }
      },
      undo: () => {
        this.moves.pop();
        this.picked = null;
        this.say('Undone.');
      },
      reset: () => {
        this.moves = [];
        this.picked = null;
        this.say('All pending moves cleared.');
      },
      confirm: () => {
        if (!this.moves.length) return;
        const moves = this.moves;
        void this.o.confirm(moves).then((ok) => {
          if (ok) {
            this.moves = [];
            this.picked = null;
            this.say('Refit done.');
          }
        });
      },
    };
  }

  private tryMove(a: RefitLoc, b: RefitLoc): void {
    const next = [...this.moves, { a, b }];
    try {
      const s = this.o.state();
      applyMoves({ installed: s.installed, hold: s.hold }, next, this.o.content());
      this.moves = next;
      this.picked = null;
      this.say(`${next.length} pending move${next.length === 1 ? '' : 's'}.`);
    } catch (err) {
      this.picked = null;
      this.say(err instanceof RuleError ? err.message : String(err));
    }
  }

  private say(msg: string): void {
    this.note = msg;
    this.refresh();
  }

  private body(): string {
    const c = this.o.content();
    const s = this.o.state();
    const now = shipStats(s.installed, c);
    let after = { installed: s.installed, hold: s.hold };
    try {
      after = applyMoves(after, this.moves, c);
    } catch {
      /* moves were validated when added */
    }
    const next = shipStats(after.installed, c);
    const station = system(c, s.systemId).station === 'waystation';
    const cost = station ? 0 : this.moves.length * c.rules.clock.swapYears;
    const pickedFamily = this.picked ? this.familyAt(after, this.picked) : null;

    const systems = SYSTEM_IDS.map((sys) => {
      const def = c.player.systems[sys];
      const slots = Array.from({ length: def.slots }, (_, slot) => {
        const loc: RefitLoc = { system: sys, slot };
        const i = after.installed.find((x) => x.system === sys && x.slot === slot);
        const ok = pickedFamily ? def.accepts.includes(pickedFamily as never) : false;
        const cls = [
          'er-slot',
          this.picked && same(this.picked, loc) ? 'er--picked' : '',
          pickedFamily && ok ? 'er--ok' : '',
          pickedFamily && !ok ? 'er--no' : '',
        ].join(' ');
        if (!i)
          return `<button class="${cls}" data-act="loc" data-empty="1" data-loc='${JSON.stringify(loc)}' aria-label="${esc(def.name)} slot ${slot + 1}: empty">Empty</button>`;
        const comp = byId(c.components, i.componentId);
        return `<button class="${cls}" draggable="true" data-act="loc" data-loc='${JSON.stringify(loc)}' aria-label="${esc(def.name)} slot ${slot + 1}: ${esc(comp.name)}, ${Math.round(i.condition)}%">${esc(comp.name)}<span class="er-cond"><i style="width:${i.condition}%"></i></span></button>`;
      }).join('');
      const o0 = Math.round(now.outputs[sys] * 100);
      const o1 = Math.round(next.outputs[sys] * 100);
      return `<div class="er-sys"><div class="er-sys__head"><b>${esc(def.name)}</b> <span>${o0}%${o1 !== o0 ? ` → <b class="${o1 > o0 ? 'er-up' : 'er-down'}">${o1}%</b>` : ''}</span></div>
        <div class="sw-meta">Takes ${def.accepts.join(', ')}</div><div class="er-slots">${slots}</div></div>`;
    }).join('');

    const hold = after.hold
      .map((h, i) => {
        const loc: RefitLoc = { hold: i };
        if (h.type === 'item') {
          const item = byId(c.items, h.itemId);
          return `<span class="er-slot er-item">${esc(item.name)} ×${h.qty}</span>`;
        }
        const comp = byId(c.components, h.componentId);
        const cls = `er-slot ${this.picked && same(this.picked, loc) ? 'er--picked' : ''}`;
        return `<button class="${cls}" draggable="true" data-act="loc" data-loc='${JSON.stringify(loc)}' aria-label="Hold: ${esc(comp.name)}, ${Math.round(h.condition)}%">${esc(comp.name)}<span class="er-cond"><i style="width:${h.condition}%"></i></span></button>`;
      })
      .join('');
    const free = c.rules.start.hold - after.hold.length;
    const holdTarget = this.picked
      ? `<button class="er-slot er--ok" data-act="loc" data-empty="1" data-loc='${JSON.stringify({ hold: after.hold.length })}'>To the hold</button>`
      : '';

    const row = (label: string, a: number, b: number, fmt: (n: number) => string, higherIsBetter = true) => {
      const d = b - a;
      const cls = Math.abs(d) < 1e-6 ? '' : d > 0 === higherIsBetter ? 'er-up' : 'er-down';
      return `<tr><td>${label}</td><td>${fmt(a)}</td><td class="${cls}">${fmt(b)}</td></tr>`;
    };
    const f1 = (n: number) => n.toFixed(1);
    const f2 = (n: number) => n.toFixed(2);
    const f0 = (n: number) => n.toFixed(0);
    const preview = `<table class="sw-table er-preview"><tr><th>Stat</th><th>Now</th><th>After</th></tr>
      ${row('Jump range (pc)', now.range, next.range, f1)}
      ${row('Fold mass per pc', now.fuelPerParsec, next.fuelPerParsec, f2, false)}
      ${row('Top speed', now.flight.maxSpeed, next.flight.maxSpeed, f0)}
      ${row('Turn rate (°/s)', (now.flight.yawRate * 180) / Math.PI, (next.flight.yawRate * 180) / Math.PI, f1)}
      ${row('Lance damage per s', now.lance.dps, next.lance.dps, f1)}
      ${row('Lance recharge (s)', now.lance.cooldown, next.lance.cooldown, f1, false)}
      ${row('Turret damage per s', now.turret.dps, next.turret.dps, f1)}
      ${row('Fore shield', now.shields.fore, next.shields.fore, f0)}
      ${row('Aft shield', now.shields.aft, next.shields.aft, f0)}
      ${row('Shield recharge per s', now.shields.rechargePerS, next.shields.rechargePerS, f1)}</table>`;

    return `<div class="er">
      <div class="er-grid">${systems}</div>
      <div class="er-side">
        <div class="er-sys"><div class="er-sys__head"><b>Hold</b> <span>${after.hold.length}/${c.rules.start.hold}${free <= 0 ? ' full' : ''}</span></div><div class="er-slots er-slots--hold">${hold}${holdTarget}</div></div>
        ${preview}
      </div>
      <p class="sw-note" role="status">${esc(this.note)}</p>
      <div class="sw-row">
        <button class="sw-btn sw-btn--primary" data-act="confirm" ${this.moves.length ? '' : 'disabled'}>Confirm refit${this.moves.length ? ` (${this.moves.length} swap${this.moves.length === 1 ? '' : 's'}, ${cost ? `${cost.toFixed(2)} yr` : 'free at the Waystation'})` : ''}</button>
        <button class="sw-btn" data-act="undo" ${this.moves.length ? '' : 'disabled'}>Undo</button>
        <button class="sw-btn" data-act="reset" ${this.moves.length ? '' : 'disabled'}>Reset</button>
      </div></div>`;
  }

  private familyAt(
    l: { installed: CampaignState['installed']; hold: CampaignState['hold'] },
    loc: RefitLoc,
  ): string | null {
    const c = this.o.content();
    if ('system' in loc) {
      const i = l.installed.find((x) => x.system === loc.system && x.slot === loc.slot);
      return i ? byId(c.components, i.componentId).family : null;
    }
    const h = l.hold[loc.hold];
    return h?.type === 'component' ? byId(c.components, h.componentId).family : null;
  }
}

function same(a: RefitLoc, b: RefitLoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
