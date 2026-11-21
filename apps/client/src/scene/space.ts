import * as THREE from 'three';
import { Rng } from '@starwake/shared';

/**
 * The space backdrop (PLAN §2.4): gradient skybox tinted per system, a three-layer instanced
 * starfield, near-field dust that sells speed, and a distant star sprite (bloomed by the renderer).
 * Everything here follows the camera; nothing here is gameplay.
 */
export interface SpaceOptions {
  seed: string;
  /** Sky tint (system colour), e.g. "#1b2a4a". */
  tint: string;
  /** Star colour. */
  starColor: string;
  /** Unit direction toward the system's star. */
  sunDir: THREE.Vector3;
}

export interface Space {
  group: THREE.Group;
  sunLight: THREE.DirectionalLight;
  update(camera: THREE.Camera): void;
  /** Point sizes are in drawing-buffer pixels: shrink them when rendering at low resolution (VGA). */
  setPixelScale(k: number): void;
  dispose(): void;
}

const SKY_RADIUS = 150_000;

export function buildSpace(o: SpaceOptions): Space {
  const rng = new Rng(`space:${o.seed}`);
  const group = new THREE.Group();
  group.name = 'space';
  const disposables: { dispose(): void }[] = [];

  // --- Skybox: gradient from tint at the sun's side to near-black opposite. -----------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      tint: { value: new THREE.Color(o.tint) },
      sunDir: { value: o.sunDir.clone().normalize() },
      deep: { value: new THREE.Color(0x020306) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint; uniform vec3 sunDir; uniform vec3 deep;
      varying vec3 vDir;
      void main() {
        float s = dot(normalize(vDir), sunDir) * 0.5 + 0.5;
        float band = 1.0 - abs(vDir.y);
        vec3 c = mix(deep, tint, pow(s, 2.2) * 0.9 + band * 0.08);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);
  disposables.push(sky.geometry, skyMat);

  // --- Starfield: three layers of points on spheres, with slight parallax for the nearer two. -----
  const layers: { pts: THREE.Points; parallax: number; size: number }[] = [];
  const layerDefs = [
    { count: 2600, radius: 120_000, size: 1.6, parallax: 0 },
    { count: 900, radius: 60_000, size: 2.2, parallax: 0.01 },
    { count: 250, radius: 30_000, size: 3.0, parallax: 0.04 },
  ];
  for (const def of layerDefs) {
    const pos = new Float32Array(def.count * 3);
    const col = new Float32Array(def.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < def.count; i++) {
      // Uniform direction on a sphere.
      const u = rng.range(-1, 1);
      const th = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * def.radius;
      pos[i * 3 + 1] = u * def.radius;
      pos[i * 3 + 2] = r * Math.sin(th) * def.radius;
      const temp = rng.next();
      c.setHSL(temp < 0.7 ? 0.6 : temp < 0.9 ? 0.12 : 0.02, rng.range(0.1, 0.5), rng.range(0.6, 0.95));
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: def.size,
      sizeAttenuation: false,
      vertexColors: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = -9;
    group.add(pts);
    layers.push({ pts, parallax: def.parallax, size: def.size });
    disposables.push(g, m);
  }

  // --- Dust: points in a box that wraps around the camera (shader), so motion reads at any speed. -
  const DUST = 700;
  const BOX = 2400;
  const dpos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST * 3; i++) dpos[i] = rng.range(0, BOX);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      camPos: { value: new THREE.Vector3() },
      box: { value: BOX },
      color: { value: new THREE.Color(0x9fb4c8) },
      pointSize: { value: 2 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 camPos; uniform float box; uniform float pointSize;
      varying float vFade;
      void main() {
        vec3 p = mod(position - camPos, box) - box * 0.5 + camPos;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = length(mv.xyz);
        vFade = smoothstep(box * 0.5, box * 0.2, d) * smoothstep(20.0, 120.0, d);
        gl_PointSize = pointSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; varying float vFade;
      void main() { gl_FragColor = vec4(color, vFade * 0.7); }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  group.add(dust);
  disposables.push(dustGeo, dustMat);

  // --- The system's star: an additive glow sprite far away along sunDir. ---------------------------
  const tex = glowTexture(o.starColor);
  const sunMat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const sun = new THREE.Sprite(sunMat);
  sun.scale.setScalar(14_000);
  sun.renderOrder = -8;
  group.add(sun);
  disposables.push(tex, sunMat);

  const sunLight = new THREE.DirectionalLight(
    new THREE.Color(o.starColor).lerp(new THREE.Color(0xffffff), 0.6),
    2.4,
  );
  sunLight.position.copy(o.sunDir).multiplyScalar(1000);
  const ambient = new THREE.HemisphereLight(0x9fb8e0, 0x1a1e26, 0.9);
  group.add(sunLight, ambient);

  return {
    group,
    sunLight,
    update(camera) {
      const cp = camera.getWorldPosition(new THREE.Vector3());
      sky.position.copy(cp);
      for (const l of layers) l.pts.position.copy(cp).multiplyScalar(1 - l.parallax);
      dustMat.uniforms.camPos!.value.copy(cp);
      sun.position.copy(cp).addScaledVector(o.sunDir, 100_000);
      sunLight.position.copy(cp).addScaledVector(o.sunDir, 1000);
      sunLight.target.position.copy(cp);
      sunLight.target.updateMatrixWorld();
    },
    setPixelScale(k) {
      for (const l of layers) (l.pts.material as THREE.PointsMaterial).size = Math.max(1, l.size * k);
      dustMat.uniforms.pointSize!.value = Math.max(1, 2 * k);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function glowTexture(color: string): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.12, color);
  grad.addColorStop(0.4, `${color}55`);
  grad.addColorStop(1, '#00000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
