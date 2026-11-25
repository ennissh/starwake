/**
 * Fold-jump transition (playtest batch 1, #5): star streaks rush outward while the next system
 * loads, a white flash, then an arrival card ("Arrived: <system>") that fades on its own. Purely
 * cosmetic: it never takes the mouse and never blocks the game. Reduced motion: a plain fade.
 */
const STREAKS = 220;

export class FoldFx {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private t0 = 0;
  private stars: { a: number; r: number; v: number }[] = [];
  private readonly reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(private readonly parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sw-fold';
    this.el.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    // Cosmetic layout only: a fixed pattern, so no randomness leaks into anything that matters.
    for (let i = 0; i < STREAKS; i++) {
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const f = h - Math.floor(h);
      this.stars.push({ a: i * 2.399963, r: 0.02 + f * 0.25, v: 0.6 + ((i * 7) % 11) / 11 });
    }
  }

  /** Start the streaks. Resolves after the minimum on-screen time, so a fast load still reads. */
  start(): Promise<void> {
    this.parent.appendChild(this.el);
    this.el.classList.remove('sw-fold--out');
    this.el.classList.add('sw-fold--in');
    this.t0 = performance.now();
    if (!this.reduced) this.raf = requestAnimationFrame(this.draw);
    return new Promise((r) => setTimeout(r, this.reduced ? 250 : 900));
  }

  /** Flash, show the arrival card, then fade away (does not wait for the fade). */
  finish(title: string, sub: string): void {
    cancelAnimationFrame(this.raf);
    this.el.innerHTML = `<div class="sw-fold__card"><div class="sw-kicker">Fold complete</div><div class="sw-fold__name"></div><div class="sw-fold__sub"></div></div>`;
    this.el.querySelector('.sw-fold__name')!.textContent = `Arrived: ${title}`;
    this.el.querySelector('.sw-fold__sub')!.textContent = sub;
    this.el.classList.remove('sw-fold--in');
    this.el.classList.add('sw-fold--out');
    setTimeout(() => this.el.remove(), 3200);
  }

  /** Abort without the card (the jump failed). */
  cancel(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  private draw = (now: number): void => {
    const c = this.canvas;
    const w = (c.width = window.innerWidth);
    const h = (c.height = window.innerHeight);
    const g = c.getContext('2d');
    if (!g) return;
    const t = (now - this.t0) / 1000;
    const k = Math.min(1, t / 0.9); // acceleration
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(cx, cy);
    g.fillStyle = `rgba(0,0,0,${0.25 + 0.6 * k})`;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = getComputedStyle(this.el).color || '#fff';
    g.lineCap = 'round';
    for (const s of this.stars) {
      const r0 = ((s.r + t * s.v * (0.3 + 2.2 * k)) % 1.1) * R;
      const len = (0.02 + 0.35 * k * k) * R * s.v;
      const dx = Math.cos(s.a);
      const dy = Math.sin(s.a);
      g.globalAlpha = Math.min(1, r0 / (R * 0.15));
      g.lineWidth = 1 + 1.5 * k * s.v;
      g.beginPath();
      g.moveTo(cx + dx * r0, cy + dy * r0);
      g.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.draw);
  };
}
