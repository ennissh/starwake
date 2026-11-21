import './hud.css';

/** What the HUD shows each frame. */
export interface HudData {
  camera: string;
  assist: boolean;
  /** Units per second (1 unit = 10 m). */
  speed: number;
  maxSpeed: number;
  throttle: number;
  stick: { x: number; y: number };
  /** Draw the stick marker (mouse steers the ship in this view). */
  showStick: boolean;
  /** Stick drawn in absolute-cursor mode (no pointer lock) at this radius fraction. */
  stickRadiusPx: number;
  systems: SystemStatus[];
}

export interface SystemStatus {
  id: SystemId;
  label: string;
  /** 0..1, or null while unknown. */
  output: number | null;
}
export type SystemId = 'fold' | 'thrusters' | 'lance' | 'turret' | 'foreShield' | 'aftShield';

const ICON: Record<SystemId, string> = {
  fold: '<path d="M2 8 Q8 0 14 8 Q8 16 2 8Z"/><circle cx="8" cy="8" r="2"/>',
  thrusters: '<path d="M3 4h7l3 4-3 4H3z"/><path d="M1 6h2M1 10h2"/>',
  lance: '<path d="M1 8h14M11 5l4 3-4 3"/>',
  turret: '<circle cx="8" cy="10" r="4"/><path d="M8 6V1"/>',
  foreShield: '<path d="M3 13 Q8 1 13 13"/>',
  aftShield: '<path d="M3 3 Q8 15 13 3"/>',
};

export class Hud {
  readonly el: HTMLDivElement;
  readonly radarSlot: HTMLDivElement;
  private q = <T extends Element>(sel: string): T => this.el.querySelector<T>(sel)!;
  private toastTimer = 0;
  private sysEls = new Map<SystemId, { row: HTMLElement; bar: HTMLElement; val: HTMLElement }>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <div class="hud__centre"><svg id="hud-svg" xmlns="http://www.w3.org/2000/svg">
        <g id="hud-reticle" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.85">
          <circle r="14"/><path d="M-26 0h-10M26 0h10M0 -26v-10M0 26v10"/>
        </g>
        <g id="hud-stick" stroke="var(--hud-accent)" fill="none" stroke-width="1.5">
          <line id="hud-stick-line" x1="0" y1="0" x2="0" y2="0" opacity="0.5"/>
          <circle id="hud-stick-dot" r="5" fill="var(--hud-accent)"/>
          <circle id="hud-stick-ring" r="0" opacity="0.15"/>
        </g>
      </svg></div>
      <div class="hud__tl">
        <div><span class="hud__tag" id="hud-cam">Chase</span> <span class="hud__tag" id="hud-assist">Assist</span></div>
      </div>
      <div class="hud__bottom">
        <div class="hud__speed" id="hud-speed">0 m/s</div>
        <div class="hud__bar" id="hud-speedbar"><i></i><b></b></div>
        <div class="hud__label">speed · <b>|</b> throttle</div>
      </div>
      <div class="hud__systems" id="hud-systems"></div>
      <div class="hud__radar" id="hud-radar"><span>RADAR</span></div>
      <div class="hud__toast" id="hud-toast" role="status"></div>
      <div class="hud__hint" id="hud-hint">F1 keys · Esc pause</div>`;
    parent.appendChild(this.el);
    this.radarSlot = this.q('#hud-radar');
  }

  /** Rect of the radar slot, in CSS px from the canvas's bottom-left (for the scissor render). */
  radarRect(): { x: number; y: number; size: number } {
    const r = this.radarSlot.getBoundingClientRect();
    return { x: r.left + 4, y: window.innerHeight - r.bottom + 4, size: r.width - 8 };
  }

  toast(msg: string, ms = 1800): void {
    const t = this.q<HTMLElement>('#hud-toast');
    t.textContent = msg;
    t.classList.add('hud__toast--on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('hud__toast--on'), ms);
  }

  setHint(text: string): void {
    this.q<HTMLElement>('#hud-hint').textContent = text;
  }

  update(d: HudData): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const svg = this.q<SVGSVGElement>('#hud-svg');
    svg.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
    this.q<HTMLElement>('#hud-cam').textContent = d.camera;
    const assist = this.q<HTMLElement>('#hud-assist');
    assist.textContent = d.assist ? 'Assist' : 'Drift';
    assist.classList.toggle('hud__tag--warn', !d.assist);

    const stick = this.q<SVGGElement>('#hud-stick');
    stick.style.display = d.showStick ? '' : 'none';
    if (d.showStick) {
      const R = d.stickRadiusPx;
      const x = d.stick.x * R;
      const y = d.stick.y * R;
      this.q('#hud-stick-dot').setAttribute('cx', String(x));
      this.q('#hud-stick-dot').setAttribute('cy', String(y));
      const line = this.q('#hud-stick-line');
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y));
      this.q('#hud-stick-ring').setAttribute('r', String(R));
    }

    const ms = Math.round(d.speed * 10);
    this.q<HTMLElement>('#hud-speed').textContent = `${ms} m/s`;
    const bar = this.q<HTMLElement>('#hud-speedbar');
    (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (d.speed / d.maxSpeed) * 100)}%`;
    (bar.lastElementChild as HTMLElement).style.left = `calc(${d.throttle * 100}% - 1px)`;

    const sys = this.q<HTMLElement>('#hud-systems');
    for (const s of d.systems) {
      let e = this.sysEls.get(s.id);
      if (!e) {
        const row = document.createElement('div');
        row.className = 'hud__sys';
        row.innerHTML = `<svg viewBox="0 0 16 16">${ICON[s.id]}</svg><span>${s.label}</span><div class="hud__bar"><i></i></div><span></span>`;
        sys.appendChild(row);
        e = { row, bar: row.querySelector('i')!, val: row.lastElementChild as HTMLElement };
        this.sysEls.set(s.id, e);
      }
      const pct = s.output === null ? null : Math.round(s.output * 100);
      e.bar.style.width = `${pct ?? 0}%`;
      e.val.textContent = pct === null ? '—' : `${pct}%`;
      e.row.classList.toggle('hud__sys--low', pct !== null && pct < 30);
    }
  }

  show(on: boolean): void {
    this.el.style.display = on ? '' : 'none';
  }

  dispose(): void {
    this.el.remove();
  }
}
