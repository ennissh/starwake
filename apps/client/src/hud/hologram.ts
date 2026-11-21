import * as THREE from 'three';

/**
 * Target hologram (PLAN §2.4): a slowly turning wireframe of the targeted ship with its subsystems
 * marked (live, destroyed, selected). Drawn into a HUD corner with a scissor viewport.
 */
export class Hologram {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100_000);
  private pivot = new THREE.Group();
  private current: string | null = null;
  private lines: THREE.LineSegments | null = null;
  private markers = new Map<string, THREE.Mesh>();
  private disposables: { dispose(): void }[] = [];
  private lineMat = new THREE.LineBasicMaterial({ color: 0x2fd3c4, transparent: true, opacity: 0.75 });

  constructor() {
    this.scene.add(this.pivot);
  }

  /** Show a ship (id is just for change detection). */
  set(
    id: string | null,
    geometry: THREE.BufferGeometry | null,
    radius: number,
    subs: { id: string; offset: { x: number; y: number; z: number }; radius: number }[],
  ): void {
    if (id === this.current) return;
    this.clear();
    this.current = id;
    if (!id || !geometry) return;
    const edges = new THREE.EdgesGeometry(geometry, 20);
    this.lines = new THREE.LineSegments(edges, this.lineMat);
    this.pivot.add(this.lines);
    this.disposables.push(edges);
    for (const s of subs) {
      const g = new THREE.IcosahedronGeometry(s.radius, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf0c060, wireframe: true }));
      m.position.set(s.offset.x, s.offset.y, s.offset.z);
      this.pivot.add(m);
      this.markers.set(s.id, m);
      this.disposables.push(g, m.material as THREE.Material);
    }
    const r = Math.max(radius, ...subs.map((s) => Math.hypot(s.offset.x, s.offset.y, s.offset.z) + s.radius));
    this.camera.position.set(0, r * 0.9, r * 3.2);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = r * 0.1;
    this.camera.far = r * 10;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, subs: { id: string; alive: boolean }[], selected: string | null): void {
    this.pivot.rotation.y += dt * 0.4;
    for (const s of subs) {
      const m = this.markers.get(s.id);
      if (!m) continue;
      (m.material as THREE.MeshBasicMaterial).color.setHex(
        !s.alive ? 0x444444 : s.id === selected ? 0xffffff : 0xf0c060,
      );
      m.scale.setScalar(s.id === selected ? 1.5 : 1);
    }
  }

  get active(): boolean {
    return this.current !== null;
  }

  render(renderer: THREE.WebGLRenderer, rect: { x: number; y: number; size: number }): void {
    if (!this.active) return;
    const size = renderer.getSize(new THREE.Vector2());
    const k = size.x / window.innerWidth;
    const x = Math.round(rect.x * k);
    const y = Math.round(rect.y * k);
    const s = Math.round(rect.size * k);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, s, s);
    renderer.setViewport(x, y, s, s);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = autoClear;
  }

  private clear(): void {
    if (this.lines) this.pivot.remove(this.lines);
    for (const m of this.markers.values()) this.pivot.remove(m);
    this.markers.clear();
    this.lines = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  dispose(): void {
    this.clear();
    this.lineMat.dispose();
  }
}
