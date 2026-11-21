import * as THREE from 'three';
import { Rng } from '@starwake/shared';

/**
 * Low-poly planet (PLAN §2.4): an icosphere with per-face colour noise from a seed, plus an
 * atmosphere rim. Kind picks the palette; the same seed always gives the same planet.
 */
export type PlanetKind = 'rock' | 'ice' | 'gas' | 'ocean' | 'jungle' | 'desert';

const PALETTES: Record<PlanetKind, { colors: number[]; atmosphere: number | null }> = {
  rock: { colors: [0x6b625a, 0x7e746a, 0x5a524b, 0x8c8073], atmosphere: null },
  ice: { colors: [0xd8e6f0, 0xbcd2e3, 0xe9f2f8, 0x9fbad0], atmosphere: 0xbfe3ff },
  gas: { colors: [0xc9a46b, 0xb5895a, 0xd9bf8c, 0x9e7650], atmosphere: 0xf0c890 },
  ocean: { colors: [0x1f4f7a, 0x2a6493, 0x163c60, 0x3d7a5a], atmosphere: 0x79b8ff },
  jungle: { colors: [0x2f6b3a, 0x3f7d3a, 0x24552c, 0x6b8a3a], atmosphere: 0x9fe0b0 },
  desert: { colors: [0xc28a4a, 0xd4a160, 0xa86f3a, 0xe0b47a], atmosphere: 0xf3c99a },
};

export function buildPlanet(kind: PlanetKind, radius: number, seed: string): THREE.Group {
  const rng = new Rng(`planet:${seed}`);
  const pal = PALETTES[kind];
  const geo = new THREE.IcosahedronGeometry(radius, kind === 'gas' ? 3 : 2).toNonIndexed();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let f = 0; f < pos.count / 3; f++) {
    v.fromBufferAttribute(pos, f * 3);
    // Gas giants band by latitude; solid worlds are patchy.
    const base =
      kind === 'gas'
        ? pal.colors[Math.floor(((v.y / radius + 1) * 3.5 + rng.range(0, 0.6)) % pal.colors.length)]!
        : pal.colors[rng.int(0, pal.colors.length - 1)]!;
    c.setHex(base).offsetHSL(0, 0, rng.range(-0.04, 0.04));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f * 3 + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  body.name = 'planet-body';

  const group = new THREE.Group();
  group.name = `planet:${seed}`;
  group.add(body);

  if (pal.atmosphere !== null) {
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.06, 32, 24),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { color: { value: new THREE.Color(pal.atmosphere) } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color; varying vec3 vN; varying vec3 vV;
          void main() {
            float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
            gl_FragColor = vec4(color, rim * 0.8);
          }`,
      }),
    );
    atmo.name = 'planet-atmosphere';
    group.add(atmo);
  }
  return group;
}

/** Small glowing navigation buoy: something to fly past and see on radar. */
export function buildBuoy(color = 0x2fd3c4): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(6, 0), new THREE.MeshBasicMaterial({ color }));
  m.name = 'buoy';
  return m;
}
