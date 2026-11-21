import * as THREE from 'three';
import { PartBuilder, mat } from './build.js';

/**
 * The Starwake: a ~3 km survey-and-defence ship. Model space: 1 unit = 10 m, nose toward -Z
 * (Three.js forward), length ≈ 300 units. Pale grey hull with teal glow (PLAN §2.4).
 * Returns named mount points the flight/combat code attaches to.
 */
export interface StarwakeModel {
  group: THREE.Group;
  mounts: {
    lanceMuzzle: THREE.Object3D;
    turret: THREE.Object3D;
    droneBay: THREE.Object3D;
    bridge: THREE.Object3D;
    engines: THREE.Object3D[];
  };
  length: number;
  dispose(): void;
}

const HULL = 0xc9ced6;
const HULL_DARK = 0x8a929c;
const TRIM = 0x5a6472;
const GLOW = 0x2fd3c4;

export function buildStarwake(): StarwakeModel {
  const hull = new PartBuilder();
  const glow = new PartBuilder();
  const PI = Math.PI;

  // Spine: a long hexagonal prism, tapering toward the bow.
  hull.add(new THREE.CylinderGeometry(9, 14, 190, 6, 1), HULL, mat([0, 0, -10], [PI / 2, 0, 0]));
  // Bow wedge.
  hull.add(new THREE.ConeGeometry(9, 60, 6, 1), HULL, mat([0, 0, -135], [-PI / 2, 0, 0]));
  // Spinal lance barrel along the keel, with emitter rings.
  hull.add(new THREE.CylinderGeometry(2.2, 2.6, 150, 8), TRIM, mat([0, -11, -70], [PI / 2, 0, 0]));
  for (let i = 0; i < 4; i++) {
    glow.add(new THREE.TorusGeometry(3.6, 0.7, 4, 8), GLOW, mat([0, -11, -30 - i * 28]));
  }
  // Survey sensor blisters on the flanks.
  for (const s of [-1, 1]) {
    hull.add(
      new THREE.OctahedronGeometry(6, 0),
      HULL_DARK,
      mat([s * 12, 2, -60], [0, 0, 0], [0.8, 0.6, 2.2]),
    );
  }
  // Mid-ship ring (habitat / shield emitter collar).
  hull.add(new THREE.TorusGeometry(26, 3.2, 4, 12), HULL_DARK, mat([0, 0, 20]));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    hull.add(
      new THREE.BoxGeometry(2.2, 14, 2.2),
      TRIM,
      mat([Math.cos(a) * 18, Math.sin(a) * 18, 20], [0, 0, a + PI / 2]),
    );
  }
  // Dorsal bridge tower.
  hull.add(new THREE.BoxGeometry(10, 8, 22), HULL, mat([0, 15, -40]));
  glow.add(new THREE.BoxGeometry(8.4, 1.2, 0.6), GLOW, mat([0, 16.5, -51.2]));
  // Dorsal turret.
  hull.add(new THREE.CylinderGeometry(5, 6, 4, 8), TRIM, mat([0, 16, 0]));
  hull.add(new THREE.BoxGeometry(1.4, 1.4, 12), HULL_DARK, mat([0, 18.5, -6]));
  // Ventral drone bay.
  hull.add(new THREE.BoxGeometry(18, 10, 40), HULL_DARK, mat([0, -16, 45]));
  glow.add(new THREE.BoxGeometry(12, 0.6, 1), GLOW, mat([0, -20, 65.2]));
  // Drive section: four nacelles on pylons.
  hull.add(new THREE.CylinderGeometry(14, 16, 40, 6), HULL, mat([0, 0, 105], [PI / 2, 0, 0]));
  const engines: [number, number][] = [
    [22, 14],
    [-22, 14],
    [22, -14],
    [-22, -14],
  ];
  for (const [x, y] of engines) {
    hull.add(new THREE.BoxGeometry(Math.abs(x) - 6, 3, 18), TRIM, mat([x / 2, y / 2, 105]));
    hull.add(new THREE.CylinderGeometry(6, 7.5, 56, 6), HULL, mat([x, y, 110], [PI / 2, 0, 0]));
    glow.add(new THREE.CylinderGeometry(5.6, 5.6, 1.5, 6), GLOW, mat([x, y, 138.6], [PI / 2, 0, 0]));
  }

  const hullMesh = new THREE.Mesh(
    hull.build(),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  const glowMesh = new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  hullMesh.name = 'starwake-hull';
  glowMesh.name = 'starwake-glow';

  const group = new THREE.Group();
  group.name = 'starwake';
  group.add(hullMesh, glowMesh);

  const point = (name: string, p: [number, number, number]): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(...p);
    group.add(o);
    return o;
  };

  return {
    group,
    length: 300,
    mounts: {
      lanceMuzzle: point('lance-muzzle', [0, -11, -146]),
      turret: point('turret', [0, 19, 0]),
      droneBay: point('drone-bay', [0, -20, 66]),
      bridge: point('bridge', [0, 17, -48]),
      engines: engines.map(([x, y], i) => point(`engine-${i}`, [x, y, 139])),
    },
    dispose() {
      hullMesh.geometry.dispose();
      glowMesh.geometry.dispose();
      (hullMesh.material as THREE.Material).dispose();
      (glowMesh.material as THREE.Material).dispose();
    },
  };
}
