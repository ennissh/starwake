import * as THREE from 'three';
import { PartBuilder, mat } from './build.js';
import type { HullModel } from './vosk.js';

/** Drone frames launched from the Starwake's bay: same pale grey and teal as the mothership. */
const HULL = 0xc9ced6;
const TRIM = 0x5a6472;
const GLOW = 0x2fd3c4;

function make(hull: PartBuilder, glow: PartBuilder): HullModel {
  const hg = hull.build();
  const gg = glow.build();
  const hm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const gm = new THREE.MeshBasicMaterial({ vertexColors: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(hg, hm), new THREE.Mesh(gg, gm));
  return {
    group,
    hullGeometry: hg,
    subMarkers: new Map(),
    dispose: () => [hg, gg, hm, gm].forEach((d) => d.dispose()),
  };
}

export function buildHornet(): HullModel {
  const h = new PartBuilder();
  const g = new PartBuilder();
  h.add(new THREE.ConeGeometry(2.4, 11, 6), HULL, mat([0, 0, -1], [-Math.PI / 2, 0, 0]));
  for (const s of [-1, 1])
    h.add(new THREE.BoxGeometry(7, 0.5, 3.5), TRIM, mat([s * 3.6, 0, 2], [0, 0, s * -0.15]));
  g.add(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 6), GLOW, mat([0, 0, 4.6], [Math.PI / 2, 0, 0]));
  return make(h, g);
}

export function buildLanceDrone(): HullModel {
  const h = new PartBuilder();
  const g = new PartBuilder();
  h.add(new THREE.CylinderGeometry(0.8, 0.8, 8, 6), HULL, mat([0, 0, 0], [Math.PI / 2, 0, 0]));
  h.add(new THREE.ConeGeometry(0.8, 2.5, 6), TRIM, mat([0, 0, -5.2], [-Math.PI / 2, 0, 0]));
  g.add(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 6), GLOW, mat([0, 0, 4.2], [Math.PI / 2, 0, 0]));
  return make(h, g);
}

export function buildRam(): HullModel {
  const h = new PartBuilder();
  const g = new PartBuilder();
  h.add(new THREE.BoxGeometry(6, 6, 16), TRIM, mat());
  h.add(new THREE.ConeGeometry(4.2, 7, 4), HULL, mat([0, 0, -11], [-Math.PI / 2, Math.PI / 4, 0]));
  g.add(new THREE.BoxGeometry(4, 4, 0.5), GLOW, mat([0, 0, 8.2]));
  return make(h, g);
}
