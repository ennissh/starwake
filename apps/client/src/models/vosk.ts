import * as THREE from 'three';
import type { Race } from '@starwake/shared';
import { PartBuilder, mat } from './build.js';

/**
 * Vosk hulls: armoured, hive-ranked salvagers. Heavy angular plates in rust and bronze, with an
 * orange furnace glow. Model space matches the sim: 1 unit = 10 m, nose toward -Z.
 * Subsystem markers are separate meshes (keyed by subsystem id) so they can change when destroyed.
 */
export interface HullModel {
  group: THREE.Group;
  /** Hull mesh geometry, for the target hologram. */
  hullGeometry: THREE.BufferGeometry;
  subMarkers: Map<string, THREE.Mesh>;
  dispose(): void;
}

function finish(
  hull: PartBuilder,
  glow: PartBuilder,
): { group: THREE.Group; hullGeometry: THREE.BufferGeometry; disposables: { dispose(): void }[] } {
  const hg = hull.build();
  const hm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(hg, hm));
  const disposables: { dispose(): void }[] = [hg, hm];
  if (!glow.empty) {
    const gg = glow.build();
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true });
    group.add(new THREE.Mesh(gg, gm));
    disposables.push(gg, gm);
  }
  return { group, hullGeometry: hg, disposables };
}

export function buildVoskFighter(p: Race['palette']): HullModel {
  const hull = new PartBuilder();
  const glow = new PartBuilder();
  // A blunt wedge with forward mandible prongs.
  hull.add(
    new THREE.ConeGeometry(6, 22, 4, 1),
    p.hull,
    mat([0, 0, 0], [-Math.PI / 2, Math.PI / 4, 0], [1, 1, 0.6]),
  );
  for (const s of [-1, 1]) {
    hull.add(new THREE.BoxGeometry(1.6, 1.6, 10), p.trim, mat([s * 4, 0, -9], [0, s * 0.25, 0]));
    hull.add(new THREE.BoxGeometry(9, 0.8, 5), p.accent, mat([s * 6, 0, 4], [0, 0, s * 0.2]));
  }
  glow.add(new THREE.BoxGeometry(4, 1.6, 0.6), p.glow, mat([0, 0, 9.6]));
  const f = finish(hull, glow);
  return {
    group: f.group,
    hullGeometry: f.hullGeometry,
    subMarkers: new Map(),
    dispose: () => f.disposables.forEach((d) => d.dispose()),
  };
}

export function buildVoskFrigate(p: Race['palette']): HullModel {
  const hull = new PartBuilder();
  const glow = new PartBuilder();
  // Long segmented carapace with jaw plates at the bow and a furnace stern.
  for (let i = 0; i < 5; i++) {
    const w = 26 - Math.abs(i - 1.5) * 4;
    hull.add(
      new THREE.BoxGeometry(w, 16, 24),
      i % 2 ? p.hull : p.trim,
      mat([0, 0, -48 + i * 24], [0, 0, 0], [1, 1, 1]),
    );
    hull.add(new THREE.ConeGeometry(4, 10, 4), p.accent, mat([0, 10, -48 + i * 24], [0, Math.PI / 4, 0]));
  }
  for (const s of [-1, 1]) {
    hull.add(new THREE.BoxGeometry(6, 10, 34), p.trim, mat([s * 12, -2, -70], [0, s * 0.3, 0]));
  }
  hull.add(new THREE.CylinderGeometry(4, 5, 8, 6), p.trim, mat([0, 12, -30]));
  hull.add(new THREE.CylinderGeometry(4, 5, 8, 6), p.trim, mat([0, 12, 30]));
  glow.add(new THREE.CylinderGeometry(8, 8, 1.5, 6), p.glow, mat([0, 0, 61], [Math.PI / 2, 0, 0]));
  const f = finish(hull, glow);
  return {
    group: f.group,
    hullGeometry: f.hullGeometry,
    subMarkers: new Map(),
    dispose: () => f.disposables.forEach((d) => d.dispose()),
  };
}

export function buildVoskBase(
  p: Race['palette'],
  subs: { id: string; kind: string; offset: { x: number; y: number; z: number }; radius: number }[],
): HullModel {
  const hull = new PartBuilder();
  const glow = new PartBuilder();
  // A hollowed asteroid fortress: a chunky core, spiked ring, docking maw.
  hull.add(new THREE.IcosahedronGeometry(230, 1), p.hull);
  hull.add(new THREE.TorusGeometry(300, 26, 4, 10), p.trim, mat([0, -40, 0], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    hull.add(
      new THREE.ConeGeometry(18, 120, 4),
      p.accent,
      mat([Math.cos(a) * 330, -40, Math.sin(a) * 330], [0, 0, -Math.PI / 2], [1, 1, 1]).premultiply(
        new THREE.Matrix4().makeRotationY(-a),
      ),
    );
  }
  hull.add(new THREE.BoxGeometry(110, 70, 60), p.trim, mat([0, -60, -215]));
  glow.add(new THREE.BoxGeometry(80, 40, 2), p.glow, mat([0, -60, -246]));
  const f = finish(hull, glow);
  const markers = new Map<string, THREE.Mesh>();
  const emitterMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff });
  const turretMat = new THREE.MeshLambertMaterial({ color: p.accent, flatShading: true });
  for (const s of subs) {
    const geo =
      s.kind === 'emitter'
        ? new THREE.IcosahedronGeometry(s.radius * 0.9, 0)
        : new THREE.CylinderGeometry(s.radius * 0.6, s.radius * 0.9, s.radius, 6);
    const m = new THREE.Mesh(geo, s.kind === 'emitter' ? emitterMat.clone() : turretMat.clone());
    m.position.set(s.offset.x, s.offset.y, s.offset.z);
    m.name = `sub:${s.id}`;
    f.group.add(m);
    markers.set(s.id, m);
    f.disposables.push(geo, m.material as THREE.Material);
  }
  return {
    group: f.group,
    hullGeometry: f.hullGeometry,
    subMarkers: markers,
    dispose: () => f.disposables.forEach((d) => d.dispose()),
  };
}
