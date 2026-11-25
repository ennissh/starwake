/**
 * VGA-theme post-process: snap every pixel to the 16-colour VGA default palette (the standard
 * hardware palette, not any game's art) after a 4×4 ordered dither. The frame stays full resolution:
 * the look is the colour depth, not big pixels.
 */
const PALETTE = [
  0x000000, 0x0000a8, 0x00a800, 0x00a8a8, 0xa80000, 0xa800a8, 0xa85400, 0xa8a8a8, 0x545454, 0x5454fc,
  0x54fc54, 0x54fcfc, 0xfc5454, 0xfc54fc, 0xfcfc54, 0xfcfcfc,
];

const vec3 = (c: number) =>
  `vec3(${(((c >> 16) & 255) / 255).toFixed(4)}, ${(((c >> 8) & 255) / 255).toFixed(4)}, ${((c & 255) / 255).toFixed(4)})`;

export const RetroShader = {
  name: 'RetroShader',
  uniforms: {
    tDiffuse: { value: null },
    pixelRatio: { value: 1 },
    /** How far the dither may push a colour toward its neighbours (0 = hard posterise). */
    spread: { value: 0.14 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float pixelRatio;
    uniform float spread;
    varying vec2 vUv;
    const vec3 PAL[16] = vec3[16](${PALETTE.map(vec3).join(', ')});
    float bayer4(vec2 p) {
      ivec2 i = ivec2(mod(p, 4.0));
      int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      return (float(m[i.y * 4 + i.x]) + 0.5) / 16.0 - 0.5;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // One dither cell per CSS pixel, so HiDPI screens keep the same texture.
      // No dither in near-black space, so the sky stays clean and stars stay crisp.
      float luma = dot(c, vec3(0.30, 0.59, 0.11));
      c += bayer4(floor(gl_FragCoord.xy / pixelRatio)) * spread * smoothstep(0.10, 0.28, luma);
      vec3 best = PAL[0];
      float bd = 1e9;
      for (int k = 0; k < 16; k++) {
        vec3 d = c - PAL[k];
        float e = dot(d * d, vec3(0.30, 0.59, 0.11));
        if (e < bd) { bd = e; best = PAL[k]; }
      }
      gl_FragColor = vec4(best, 1.0);
    }`,
};
