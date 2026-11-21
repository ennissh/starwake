import type * as THREE from 'three';

/** Performance overlay (` key): fps, frame time, draw calls, triangles. For the 60 fps budget. */
export class PerfOverlay {
  private el: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private last = '';
  visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sw-perf';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  frame(dtMs: number, gl: THREE.WebGLRenderer): void {
    this.frames++;
    this.acc += dtMs;
    this.worst = Math.max(this.worst, dtMs);
    if (this.acc >= 500) {
      const fps = (this.frames * 1000) / this.acc;
      const i = gl.info.render;
      this.last = `${fps.toFixed(0)} fps  avg ${(this.acc / this.frames).toFixed(1)} ms  worst ${this.worst.toFixed(1)} ms\n${i.calls} draw calls  ${(i.triangles / 1000).toFixed(1)}k tris`;
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
    if (this.visible) this.el.textContent = this.last;
  }
}
