import * as THREE from 'three';
import { type ContentBundle, Rng, type StarSystem, byId } from '@starwake/shared';
import type { Backdrop } from '../space/spaceScene.js';
import { buildMurmurCloud, buildQuillariSpire, buildWaystation } from '../models/scenery.js';
import { buildVoskBase } from '../models/vosk.js';

/** The 3D set for a star system: sky tint, star, planets and whoever lives there. Deterministic. */
export function systemBackdrop(
  sys: StarSystem,
  c: ContentBundle,
  opts: { baseDestroyed: boolean },
): Backdrop {
  const rng = new Rng(`backdrop:${sys.id}`);
  const sunDir = new THREE.Vector3(rng.range(-1, 1), rng.range(0.1, 0.5), rng.range(-1, -0.3)).normalize();
  const planets = sys.planets.map((p, i) => {
    const ang = -0.9 + i * 1.1 + rng.range(-0.2, 0.2);
    const d = 40_000 + i * 22_000;
    return {
      kind: p.kind,
      radius: p.kind === 'gas' ? 14_000 : 5_000 + rng.range(0, 3_000),
      pos: new THREE.Vector3(Math.sin(ang) * d, rng.range(-6_000, 4_000), -Math.cos(ang) * d),
      seed: p.id,
    };
  });
  const scenery: THREE.Object3D[] = [];
  const place = (o: THREE.Object3D, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    scenery.push(o);
  };
  if (sys.station === 'waystation') place(buildWaystation(), 900, 120, -2600);
  if (sys.occupant) {
    const pal = byId(c.races, sys.occupant).palette;
    if (sys.occupant === 'quillari') place(buildQuillariSpire(pal), -1400, -100, -5200);
    if (sys.occupant === 'murmur') place(buildMurmurCloud(pal), 0, 300, -6000);
    if (sys.occupant === 'vosk' && sys.baseEncounter && !opts.baseDestroyed) {
      const enc = byId(c.encounters, sys.baseEncounter);
      const hull = byId(c.hulls, enc.roster.hulls[0]!);
      place(buildVoskBase(pal, hull.subsystems).group, 600, 0, -7000);
    }
  }
  return { seed: sys.id, tint: sys.tint, starColor: sys.starColor, sunDir, planets, buoys: false, scenery };
}
