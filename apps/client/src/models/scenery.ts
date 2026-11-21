import * as THREE from 'three';
import type { Race } from '@starwake/shared';
import { PartBuilder, mat } from './build.js';

/** Non-combat set pieces seen in systems: the Waystation, a Quillari trade spire, the Murmur cloud. */
function meshes(hull: PartBuilder, glow: PartBuilder): THREE.Group {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(hull.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
  );
  if (!glow.empty) g.add(new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  return g;
}

export function buildWaystation(): THREE.Group {
  const h = new PartBuilder();
  const g = new PartBuilder();
  h.add(new THREE.CylinderGeometry(40, 40, 120, 8), 0xc9ced6, mat());
  h.add(new THREE.TorusGeometry(170, 14, 6, 16), 0x8a929c, mat([0, 0, 0], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    h.add(
      new THREE.BoxGeometry(130, 8, 8),
      0x5a6472,
      mat([Math.cos(a) * 95, 0, Math.sin(a) * 95], [0, -a, 0]),
    );
  }
  h.add(new THREE.BoxGeometry(70, 30, 70), 0xc9ced6, mat([0, 80, 0]));
  g.add(new THREE.TorusGeometry(52, 3, 4, 16), 0x2fd3c4, mat([0, -62, 0], [Math.PI / 2, 0, 0]));
  g.add(new THREE.BoxGeometry(60, 2, 2), 0x2fd3c4, mat([0, 96, 35.5]));
  const grp = meshes(h, g);
  grp.name = 'waystation';
  return grp;
}

export function buildQuillariSpire(p: Race['palette']): THREE.Group {
  const h = new PartBuilder();
  const g = new PartBuilder();
  h.add(new THREE.ConeGeometry(60, 700, 6), p.hull, mat([0, 250, 0]));
  h.add(new THREE.ConeGeometry(60, 260, 6), p.hull, mat([0, -230, 0], [Math.PI, 0, 0]));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    h.add(
      new THREE.BoxGeometry(14, 200, 70),
      p.trim,
      mat([Math.cos(a) * 120, 60, Math.sin(a) * 120], [0, -a, 0.5]),
    );
  }
  g.add(new THREE.TorusGeometry(130, 5, 4, 24), p.glow, mat([0, 0, 0], [Math.PI / 2, 0, 0]));
  g.add(new THREE.OctahedronGeometry(30), p.accent, mat([0, 640, 0]));
  return meshes(h, g);
}

export function buildMurmurCloud(p: Race['palette'], seed = 7): THREE.Group {
  const grp = new THREE.Group();
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const colors = [p.hull, p.glow, p.accent];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(120 + rnd() * 260, 1),
      new THREE.MeshBasicMaterial({
        color: colors[i % 3],
        transparent: true,
        opacity: 0.08 + rnd() * 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.position.set((rnd() - 0.5) * 900, (rnd() - 0.5) * 400, (rnd() - 0.5) * 900);
    grp.add(m);
  }
  return grp;
}
