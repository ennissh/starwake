import * as THREE from 'three';

/**
 * Combat effects with fixed pools (no per-shot allocations, few draw calls): bolts as one
 * instanced mesh, Lance beams, explosions, and hit sparks.
 */
const MAX_BOLTS = 600;
const MAX_SPARKS = 128;

export class Fx {
  readonly group = new THREE.Group();
  private bolts: THREE.InstancedMesh;
  private beams: { mesh: THREE.Mesh; life: number }[] = [];
  private booms: { mesh: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private sparks: THREE.InstancedMesh;
  private sparkLife = new Float32Array(MAX_SPARKS);
  private sparkPos: THREE.Vector3[] = [];
  private sparkNext = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const boltGeo = new THREE.BoxGeometry(0.9, 0.9, 14);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.bolts = new THREE.InstancedMesh(boltGeo, boltMat, MAX_BOLTS);
    this.bolts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bolts.frustumCulled = false;
    this.bolts.count = 0;
    this.group.add(this.bolts);

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: 0x9ffff4,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.beams.push({ mesh, life: 0 });
      this.disposables.push(mesh.material as THREE.Material);
    }
    const boomGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        boomGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffb060,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.booms.push({ mesh, life: 0, max: 1, size: 1 });
      this.disposables.push(mesh.material as THREE.Material);
    }
    const sparkGeo = new THREE.OctahedronGeometry(1, 0);
    this.sparks = new THREE.InstancedMesh(
      sparkGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfff0c0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      MAX_SPARKS,
    );
    this.sparks.frustumCulled = false;
    for (let i = 0; i < MAX_SPARKS; i++) this.sparkPos.push(new THREE.Vector3());
    this.group.add(this.sparks);
    this.disposables.push(
      boltGeo,
      boltMat,
      beamGeo,
      boomGeo,
      sparkGeo,
      this.sparks.material as THREE.Material,
    );
  }

  /** Draw this frame's bolts: positions, velocities and side colours. */
  setBolts(
    bolts: readonly {
      pos: { x: number; y: number; z: number };
      vel: { x: number; y: number; z: number };
      side: string;
    }[],
  ): void {
    const n = Math.min(MAX_BOLTS, bolts.length);
    const fwd = new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const b = bolts[i]!;
      dir.set(b.vel.x, b.vel.y, b.vel.z).normalize();
      this.q.setFromUnitVectors(fwd, dir);
      this.s.set(1, 1, 1);
      this.m.compose(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z), this.q, this.s);
      this.bolts.setMatrixAt(i, this.m);
      this.bolts.setColorAt(i, c.setHex(b.side === 'player' ? 0x7ffff0 : 0xff8a3a));
    }
    this.bolts.count = n;
    this.bolts.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, blocked: boolean): void {
    const b = this.beams.find((x) => x.life <= 0) ?? this.beams[0]!;
    const len = from.distanceTo(to);
    b.mesh.position.copy(from).lerp(to, 0.5);
    b.mesh.lookAt(to);
    b.mesh.scale.set(4, 4, len);
    (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(blocked ? 0x6aa0ff : 0x9ffff4);
    b.mesh.visible = true;
    b.life = 0.45;
  }

  explode(pos: THREE.Vector3, size: number): void {
    const b = this.booms.find((x) => x.life <= 0) ?? this.booms[0]!;
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    b.max = b.life = 0.6 + Math.min(1.4, size / 200);
    b.size = size;
  }

  spark(pos: THREE.Vector3): void {
    const i = this.sparkNext++ % MAX_SPARKS;
    this.sparkPos[i]!.copy(pos);
    this.sparkLife[i] = 0.25;
  }

  update(dt: number): void {
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / 0.45);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      b.mesh.scale.x = b.mesh.scale.y = 1 + 5 * k;
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const b of this.booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = 1 - b.life / b.max;
      b.mesh.scale.setScalar(b.size * (0.3 + 1.2 * t));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (b.life <= 0) b.mesh.visible = false;
    }
    let n = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i]! <= 0) continue;
      this.sparkLife[i]! -= dt;
      const k = Math.max(0, this.sparkLife[i]! / 0.25);
      this.m.compose(this.sparkPos[i]!, this.q.identity(), this.s.setScalar(2 + 10 * (1 - k)));
      this.sparks.setMatrixAt(n++, this.m);
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
