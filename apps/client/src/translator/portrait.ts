import type { Race } from '@starwake/shared';

/**
 * Procedural alien portraits (PLAN §2.4): flat vector SVG from the race's palette, a mood
 * expression and the race's tell (shown when they lie and the translator catches it). Original
 * designs; commissioned art can replace them later as content.
 */
export type Mood = 'neutral' | 'pleased' | 'amused' | 'annoyed' | 'angry' | 'afraid' | 'scheming';

/** Small deterministic generator from the race's seed (variation only; never game state). */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

/** Brow tilt (deg, + = angry inward), eye openness (0..1), mouth curve (− frown, + smile). */
const FACE: Record<Mood, { brow: number; eye: number; mouth: number }> = {
  neutral: { brow: 0, eye: 0.8, mouth: 0 },
  pleased: { brow: -6, eye: 0.7, mouth: 0.8 },
  amused: { brow: -10, eye: 0.5, mouth: 1 },
  annoyed: { brow: 10, eye: 0.6, mouth: -0.4 },
  angry: { brow: 22, eye: 0.55, mouth: -1 },
  afraid: { brow: -18, eye: 1, mouth: -0.6 },
  scheming: { brow: 14, eye: 0.35, mouth: 0.5 },
};

function quillari(r: Race, m: Mood): string {
  const p = r.palette;
  const f = FACE[m];
  const rnd = lcg(r.leitmotifSeed);
  const feathers = Array.from({ length: 7 }, (_, i) => {
    const a = -70 + i * 23 + (rnd() - 0.5) * 6;
    const len = 62 + rnd() * 20;
    return `<path transform="rotate(${a} 120 92)" d="M116 92 L120 ${92 - len} L124 92 Z" fill="${i % 2 ? p.accent : p.trim}"/>`;
  }).join('');
  const eyeH = 9 * f.eye;
  return `
    <g class="pt-crest">${feathers}</g>
    <path d="M92 230 C96 180 98 150 104 128 L136 128 C142 150 144 180 148 230 Z" fill="${p.hull}"/>
    <ellipse cx="120" cy="118" rx="40" ry="34" fill="${p.hull}"/>
    <path d="M120 112 L176 126 L120 140 Z" fill="${p.accent}"/>
    <path d="M120 126 L176 126" stroke="${p.trim}" stroke-width="2"/>
    <g transform="rotate(${-f.brow / 2} 100 104)"><path d="M86 100 L112 104" stroke="${p.trim}" stroke-width="4" stroke-linecap="round"/></g>
    <ellipse cx="100" cy="114" rx="9" ry="${eyeH}" fill="${p.accent}"/><circle cx="100" cy="114" r="${3.5 * f.eye + 1}" fill="#111"/>
    <path d="M126 ${134 - 4 * f.mouth} Q150 ${134 + 6 * f.mouth} 168 130" stroke="${p.trim}" stroke-width="2" fill="none"/>`;
}

function vosk(r: Race, m: Mood): string {
  const p = r.palette;
  const f = FACE[m];
  const rnd = lcg(r.leitmotifSeed);
  const plates = Array.from({ length: 6 }, (_, i) => {
    const x = 70 + (i % 3) * 34;
    const y = 56 + Math.floor(i / 3) * 30;
    const w = 32 + rnd() * 4;
    return `<path d="M${x} ${y + 8} L${x + w / 2} ${y} L${x + w} ${y + 8} L${x + w} ${y + 24} L${x + w / 2} ${y + 30} L${x} ${y + 24} Z" fill="${i % 2 ? p.hull : p.trim}" stroke="#0005"/>`;
  }).join('');
  const eyes = Array.from({ length: 6 }, (_, i) => {
    const x = 92 + (i % 3) * 18;
    const y = 124 + Math.floor(i / 3) * 12 + (i % 3 === 1 ? -3 : 0);
    return `<circle cx="${x}" cy="${y}" r="${2.6 + 2 * f.eye}" fill="${p.glow}"/>`;
  }).join('');
  const spread = 6 + 10 * Math.max(0, f.mouth) + (m === 'angry' ? 10 : 0);
  return `
    <path d="M60 230 L66 120 L120 96 L174 120 L180 230 Z" fill="${p.trim}"/>
    <path d="M64 110 L120 40 L176 110 L168 150 L72 150 Z" fill="${p.hull}"/>
    ${plates}
    <g transform="rotate(${f.brow / 3} 120 112)"><path d="M78 112 L162 112" stroke="${p.accent}" stroke-width="5"/></g>
    ${eyes}
    <g class="pt-mandibles">
      <path class="pt-mand-l" d="M100 152 C${84 - spread} 170 ${88 - spread} 196 104 206 L108 190 C98 182 98 168 108 156 Z" fill="${p.accent}"/>
      <path class="pt-mand-r" d="M140 152 C${156 + spread} 170 ${152 + spread} 196 136 206 L132 190 C142 182 142 168 132 156 Z" fill="${p.accent}"/>
    </g>`;
}

function murmur(r: Race, m: Mood): string {
  const p = r.palette;
  const f = FACE[m];
  const rnd = lcg(r.leitmotifSeed);
  const motes = Array.from({ length: 46 }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    const d = 20 + rnd() * 80;
    const x = 120 + Math.cos(a) * d;
    const y = 120 + Math.sin(a) * d * 0.8;
    const rr = 2 + rnd() * 5;
    const c = i % 3 ? p.glow : p.accent;
    return `<circle class="pt-mote" style="--d:${(i % 7) * 0.17}s" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${c}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
  }).join('');
  const eye = (x: number) =>
    `<ellipse cx="${x}" cy="108" rx="10" ry="${2 + 8 * f.eye}" fill="${p.accent}" opacity="0.9"/>`;
  return `
    <defs><radialGradient id="pt-cloud"><stop offset="0" stop-color="${p.hull}" stop-opacity="0.9"/><stop offset="1" stop-color="${p.trim}" stop-opacity="0"/></radialGradient></defs>
    <circle cx="120" cy="120" r="110" fill="url(#pt-cloud)"/>
    <g class="pt-motes">${motes}</g>
    <g transform="rotate(${f.brow / 2} 120 108)">${eye(96)}${eye(144)}</g>
    <path d="M92 ${150 - 8 * f.mouth} Q120 ${150 + 10 * f.mouth} 148 ${150 - 8 * f.mouth}" stroke="${p.glow}" stroke-width="3" fill="none" opacity="0.8"/>`;
}

export function portraitSvg(race: Race, mood: Mood, tell: boolean): string {
  const body =
    race.id === 'quillari'
      ? quillari(race, mood)
      : race.id === 'vosk'
        ? vosk(race, mood)
        : murmur(race, mood);
  return `<svg class="pt pt--${race.id} ${tell ? 'pt--tell' : ''}" viewBox="0 0 240 240" role="img" aria-label="${race.name}, ${mood}${tell ? `: ${race.persona.tell.toLowerCase()}` : ''}">
    <rect width="240" height="240" fill="${race.palette.trim}" opacity="0.18"/>${body}</svg>`;
}
