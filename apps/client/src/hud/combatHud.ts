import { esc } from '../ui/help.js';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TargetHud {
  name: string;
  cls: string;
  /** Units. */
  distance: number;
  hull: number;
  emitters: boolean;
  subs: { id: string; label: string; hp: number; alive: boolean; selected: boolean }[];
  /** Projected centre and apparent radius in CSS px; null when behind the camera. */
  screen: (ScreenPoint & { r: number }) | null;
  /** Direction to the target as an angle (radians, screen space) when off screen. */
  edgeAngle: number | null;
  sub: ScreenPoint | null;
  lead: ScreenPoint | null;
  /** Lance alignment: degrees off the aim point, and whether the assist will bend the beam onto it. */
  align: { deg: number; inCone: boolean } | null;
}

export interface CombatHudData {
  hull: number;
  fore: number;
  aft: number;
  lance: number;
  turret: 'WAKE' | 'Manual';
  frames: number;
  active: number;
  maxActive: number;
  riding: string | null;
  target: TargetHud | null;
  hostiles: number;
  /** One line of the main combat keys, from the player's own bindings. */
  keys: string;
}

/** Combat overlays: ship status, target panel (with the hologram slot), brackets, damage flash. */
export class CombatHud {
  readonly el: HTMLDivElement;
  readonly holoSlot: HTMLDivElement;
  private flashT = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'chud';
    this.el.innerHTML = `
      <svg class="chud__svg" id="chud-svg" xmlns="http://www.w3.org/2000/svg">
        <g id="chud-bracket" fill="none" stroke="var(--hud-danger)" stroke-width="1.5"></g>
        <g id="chud-sub" fill="none" stroke="var(--hud-warn)" stroke-width="1.5"></g>
        <g id="chud-lead" fill="none" stroke="var(--hud-accent)" stroke-width="1.5"></g>
        <g id="chud-edge" fill="var(--hud-danger)"></g>
      </svg>
      <div class="chud__flash" id="chud-flash"></div>
      <div class="chud__status hud__panel">
        <div class="chud__row"><span>Hull</span><div class="hud__bar"><i id="chud-hull"></i></div></div>
        <div class="chud__row"><span>Fore sh.</span><div class="hud__bar"><i id="chud-fore"></i></div></div>
        <div class="chud__row"><span>Aft sh.</span><div class="hud__bar"><i id="chud-aft"></i></div></div>
        <div class="chud__row"><span>Lance</span><div class="hud__bar"><i id="chud-lance"></i></div></div>
        <div class="chud__row"><span>Turret</span><b id="chud-turret">WAKE</b></div>
        <div class="chud__row"><span>Drones</span><b id="chud-drones">8 · 0/3</b></div>
        <div class="chud__row" id="chud-riding-row"><span>Riding</span><b id="chud-riding"></b></div>
        <div class="chud__keys" id="chud-keys"></div>
      </div>
      <div class="chud__target hud__panel" id="chud-target">
        <div class="chud__holo" id="chud-holo"></div>
        <div class="chud__tname" id="chud-tname"></div>
        <div class="chud__row"><span>Hull</span><div class="hud__bar"><i id="chud-thull"></i></div></div>
        <div class="chud__warn" id="chud-twarn">EMITTERS UP · LANCE BLOCKED</div>
        <div class="chud__align" id="chud-align" role="status"></div>
        <div id="chud-tsubs"></div>
      </div>`;
    parent.appendChild(this.el);
    this.holoSlot = this.el.querySelector('#chud-holo')!;
  }

  private q<T extends Element>(sel: string): T {
    return this.el.querySelector<T>(sel)!;
  }

  holoRect(): { x: number; y: number; size: number } | null {
    const t = this.q<HTMLElement>('#chud-target');
    if (t.hidden) return null;
    const r = this.holoSlot.getBoundingClientRect();
    return { x: r.left, y: window.innerHeight - r.bottom, size: r.width };
  }

  flash(): void {
    this.flashT = 0.35;
  }

  update(dt: number, d: CombatHudData | null): void {
    this.el.hidden = !d;
    if (!d) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.q<SVGSVGElement>('#chud-svg').setAttribute('viewBox', `0 0 ${w} ${h}`);
    const bar = (id: string, v: number) =>
      (this.q<HTMLElement>(id).style.width = `${Math.max(0, Math.min(1, v)) * 100}%`);
    bar('#chud-hull', d.hull);
    bar('#chud-fore', d.fore);
    bar('#chud-aft', d.aft);
    bar('#chud-lance', d.lance);
    this.q<HTMLElement>('#chud-lance').classList.toggle('chud--ready', d.lance >= 1);
    this.q<HTMLElement>('#chud-turret').textContent = d.turret;
    this.q<HTMLElement>('#chud-drones').textContent = `${d.frames} frames · ${d.active}/${d.maxActive} out`;
    this.q<HTMLElement>('#chud-riding-row').hidden = !d.riding;
    this.q<HTMLElement>('#chud-riding').textContent = d.riding ?? '';
    const keys = this.q<HTMLElement>('#chud-keys');
    if (keys.textContent !== d.keys) keys.textContent = d.keys;

    this.flashT = Math.max(0, this.flashT - dt);
    this.q<HTMLElement>('#chud-flash').style.opacity = String(this.flashT * 1.6);

    const t = d.target;
    this.q<HTMLElement>('#chud-target').hidden = !t;
    const br = this.q<SVGGElement>('#chud-bracket');
    const sb = this.q<SVGGElement>('#chud-sub');
    const ld = this.q<SVGGElement>('#chud-lead');
    const edge = this.q<SVGGElement>('#chud-edge');
    br.innerHTML = sb.innerHTML = ld.innerHTML = edge.innerHTML = '';
    if (!t) return;
    this.q<HTMLElement>('#chud-tname').textContent =
      `${t.name} · ${t.cls} · ${((t.distance * 10) / 1000).toFixed(1)} km`;
    bar('#chud-thull', t.hull);
    this.q<HTMLElement>('#chud-twarn').hidden = !t.emitters;
    const al = this.q<HTMLElement>('#chud-align');
    const ready = d.lance >= 1;
    const on = !!t.align?.inCone;
    al.textContent = !t.align
      ? ''
      : on
        ? ready
          ? 'LANCE ON TARGET · FIRE'
          : 'Lance on target · charging'
        : `Lance ${Math.round(t.align.deg)}° off · hold G to face`;
    al.classList.toggle('chud--on', on && ready);
    br.setAttribute('stroke', on ? 'var(--hud-ok)' : 'var(--hud-danger)');
    this.q<HTMLElement>('#chud-tsubs').innerHTML = t.subs
      .map(
        (s) =>
          `<div class="chud__row ${s.alive ? '' : 'chud--dead'} ${s.selected ? 'chud--sel' : ''}"><span>${s.selected ? '▸ ' : ''}${esc(s.label)}</span><div class="hud__bar"><i style="width:${s.hp * 100}%"></i></div></div>`,
      )
      .join('');
    if (t.screen) {
      const { x, y } = t.screen;
      const r = Math.max(14, Math.min(220, t.screen.r));
      const c = r * 0.35;
      br.innerHTML = `<path d="M${x - r} ${y - r + c}V${y - r}H${x - r + c}M${x + r - c} ${y - r}H${x + r}V${y - r + c}M${x + r} ${y + r - c}V${y + r}H${x + r - c}M${x - r + c} ${y + r}H${x - r}V${y + r - c}"/>`;
    } else if (t.edgeAngle !== null) {
      const R = Math.min(w, h) * 0.42;
      const ex = w / 2 + Math.cos(t.edgeAngle) * R;
      const ey = h / 2 + Math.sin(t.edgeAngle) * R;
      const a = t.edgeAngle;
      const p = (dx: number, dy: number) =>
        `${ex + dx * Math.cos(a) - dy * Math.sin(a)},${ey + dx * Math.sin(a) + dy * Math.cos(a)}`;
      edge.innerHTML = `<polygon points="${p(12, 0)} ${p(-6, -8)} ${p(-6, 8)}"/>`;
    }
    if (t.sub)
      sb.innerHTML = `<circle cx="${t.sub.x}" cy="${t.sub.y}" r="10"/><path d="M${t.sub.x - 16} ${t.sub.y}h6M${t.sub.x + 10} ${t.sub.y}h6"/>`;
    if (t.lead) ld.innerHTML = `<path d="M${t.lead.x} ${t.lead.y - 7}l7 7-7 7-7-7z"/>`;
  }

  dispose(): void {
    this.el.remove();
  }
}
