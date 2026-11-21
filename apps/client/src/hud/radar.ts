import * as THREE from 'three';

/**
 * 3D radar globe (PLAN §2.4) drawn into a corner of the main canvas with a scissor viewport (no
 * second WebGL context). Contacts are placed in the ship's frame, distance on a log scale.
 */
export type ContactKind = 'planet' | 'station' | 'buoy' | 'hostile' | 'neutral' | 'friendly' | 'drone';
export interface Contact {
  pos: THREE.Vector3;
  kind: ContactKind;
}

const KIND_COLOR: Record<ContactKind, number> = {
  planet: 0x7fb3ad,
  station: 0x2fd3c4,
  buoy: 0xdff7f4,
  hostile: 0xf27d74,
  neutral: 0xf0c060,
  friendly: 0x5cc48f,
  drone: 0x8db6f4,
};
const MAX = 96;

export class Radar {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  private pts: THREE.Points;
  private stalks: THREE.LineSegments;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private stalkPos = new Float32Array(MAX * 6);
  private inv = new THREE.Quaternion();
  private tmp = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    private readonly range = 60_000,
    color = 0x2fd3c4,
  ) {
    const globe = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.0, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    const ship = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.16, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    ship.rotation.x = -Math.PI / 2; // points to -Z (forward)
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(
      ptsGeo,
      new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }),
    );
    this.pts.frustumCulled = false;
    const stalkGeo = new THREE.BufferGeometry();
    stalkGeo.setAttribute('position', new THREE.BufferAttribute(this.stalkPos, 3));
    this.stalks = new THREE.LineSegments(
      stalkGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }),
    );
    this.stalks.frustumCulled = false;
    this.scene.add(globe, disc, ring, ship, this.pts, this.stalks);
    // Look from above and behind, so "ahead" is up/away on the globe.
    this.camera.position.set(0, 2.3, 3.1);
    this.camera.lookAt(0, -0.15, 0);
  }

  update(shipPos: THREE.Vector3, shipQuat: THREE.Quaternion, contacts: Contact[]): void {
    this.inv.copy(shipQuat).invert();
    const n = Math.min(MAX, contacts.length);
    const logMax = Math.log1p(this.range / 400);
    for (let i = 0; i < n; i++) {
      const ct = contacts[i]!;
      const rel = this.tmp.copy(ct.pos).sub(shipPos).applyQuaternion(this.inv);
      const d = rel.length();
      const r = Math.min(0.97, (0.97 * Math.log1p(d / 400)) / logMax);
      if (d > 1e-6) rel.multiplyScalar(r / d);
      this.pos.set([rel.x, rel.y, rel.z], i * 3);
      this.stalkPos.set([rel.x, rel.y, rel.z, rel.x, 0, rel.z], i * 6);
      this.c.setHex(KIND_COLOR[ct.kind]);
      this.col.set([this.c.r, this.c.g, this.c.b], i * 3);
    }
    this.pts.geometry.setDrawRange(0, n);
    this.stalks.geometry.setDrawRange(0, n * 2);
    this.pts.geometry.attributes.position!.needsUpdate = true;
    this.pts.geometry.attributes.color!.needsUpdate = true;
    this.stalks.geometry.attributes.position!.needsUpdate = true;
  }

  /** Render into a rect given in CSS pixels from the bottom-left of the canvas. */
  render(renderer: THREE.WebGLRenderer, rect: { x: number; y: number; size: number }): void {
    const size = renderer.getSize(new THREE.Vector2());
    // The VGA theme renders at 320×200 and stretches it: scale x and y separately.
    const kx = size.x / window.innerWidth;
    const ky = size.y / window.innerHeight;
    const x = Math.round(rect.x * kx);
    const y = Math.round(rect.y * ky);
    const s = Math.round(rect.size * kx);
    const sy = Math.round(rect.size * ky);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // draw over the main view, don't wipe the corner
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, s, sy);
    renderer.setViewport(x, y, s, sy);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.autoClear = autoClear;
    renderer.setViewport(0, 0, size.x, size.y);
  }
}
