/**
 * Procedural audio (M6, PLAN §2.5): WebAudio synthesis only, no sample files. Sound effects for
 * combat, folds and the UI, and a short leitmotif per race generated from its persona seed.
 * The context starts on the title's click-to-begin gesture (browsers block autoplay).
 */
export interface Volumes {
  master: number;
  sfx: number;
  music: number;
}

type Osc = OscillatorType;

/** Scales as semitone offsets (modes and pentatonics; generic music theory, nothing borrowed). */
const SCALES = [
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 3, 5, 7, 9, 10], // dorian
  [0, 1, 3, 5, 7, 8, 10], // phrygian
  [0, 2, 4, 6, 8, 10], // whole tone
];
const TIMBRES: Osc[] = ['triangle', 'sine', 'square', 'sawtooth'];

function lcg(seed: number) {
  let s = seed >>> 0 || 7;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

export interface Motif {
  bpm: number;
  timbre: Osc;
  root: number;
  /** [semitones from root, beats] per note; null semitone = rest. */
  notes: [number | null, number][];
  drone: number;
}

/** A race's leitmotif from its seed: same seed, same tune (tested). */
export function motifFromSeed(seed: number): Motif {
  const r = lcg(seed);
  const scale = SCALES[Math.floor(r() * SCALES.length)]!;
  const timbre = TIMBRES[Math.floor(r() * TIMBRES.length)]!;
  const bpm = 64 + Math.floor(r() * 56);
  const root = 45 + Math.floor(r() * 12); // MIDI A2..G#3
  const notes: [number | null, number][] = [];
  let degree = Math.floor(r() * scale.length);
  let beats = 0;
  while (beats < 16) {
    const len = [0.5, 1, 1, 1.5, 2][Math.floor(r() * 5)]!;
    if (r() < 0.12) notes.push([null, len]);
    else {
      degree = Math.max(0, Math.min(scale.length * 2 - 1, degree + Math.floor(r() * 5) - 2));
      const oct = Math.floor(degree / scale.length);
      notes.push([12 + scale[degree % scale.length]! + 12 * oct, len]);
    }
    beats += len;
  }
  return { bpm, timbre, root, notes, drone: scale[0]! };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private vol: Volumes = { master: 0.8, sfx: 0.8, music: 0.5 };
  private motifStop: (() => void) | null = null;
  private lastShot = 0;

  /** Call from a user gesture. Safe to call again. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.sfx.connect(this.master);
        this.music.connect(this.master);
        this.master.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, n, n);
        const d = this.noise.getChannelData(0);
        const r = lcg(12345);
        for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
        this.apply();
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null; // no audio: the game is fully playable silently (captions only, R17)
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes(v: Volumes): void {
    this.vol = { ...v };
    this.apply();
  }

  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(this.vol.master, t, 0.02);
    this.sfx!.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.music!.gain.setTargetAtTime(this.vol.music * 0.6, t, 0.02);
  }

  // ---- building blocks ---------------------------------------------------------------------------
  private tone(f0: number, f1: number, dur: number, type: Osc, gain: number, at = 0, out?: AudioNode): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.sfx!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, gain: number, q = 0.8, at = 0): void {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.noise) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq / 8), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---- sound effects ----------------------------------------------------------------------------
  ui(): void {
    this.tone(880, 1320, 0.05, 'triangle', 0.08);
  }
  lance(blocked: boolean): void {
    this.tone(1400, 90, 0.6, 'sawtooth', 0.22);
    this.tone(700, 60, 0.7, 'square', 0.1);
    if (blocked) this.tone(300, 280, 0.25, 'sine', 0.15, 0.1);
  }
  shot(player: boolean): void {
    const now = performance.now();
    if (now - this.lastShot < 45) return; // turrets fire fast: don't stack voices
    this.lastShot = now;
    this.tone(player ? 900 : 520, player ? 300 : 160, 0.08, 'square', player ? 0.05 : 0.04);
  }
  hit(): void {
    this.burst(0.12, 2500, 0.12);
  }
  playerHit(): void {
    this.burst(0.25, 900, 0.3);
    this.tone(120, 60, 0.25, 'sine', 0.25);
  }
  explosion(size: number): void {
    const big = Math.min(1, size / 400);
    this.burst(0.6 + big * 1.2, 1400 + big * 1200, 0.35 + big * 0.3);
    this.tone(90, 30, 0.8 + big, 'sine', 0.3);
  }
  launch(): void {
    this.burst(0.35, 4000, 0.12, 2);
    this.tone(200, 600, 0.3, 'triangle', 0.08);
  }
  fold(): void {
    this.tone(60, 240, 1.0, 'sawtooth', 0.12);
    this.tone(90, 480, 1.0, 'sine', 0.15);
    this.burst(0.9, 600, 0.12, 4, 0.9);
  }
  alarm(): void {
    for (let i = 0; i < 3; i++) this.tone(660, 440, 0.22, 'square', 0.08, i * 0.3);
  }
  chime(): void {
    this.tone(660, 660, 0.25, 'sine', 0.1);
    this.tone(990, 990, 0.35, 'sine', 0.08, 0.12);
  }

  // ---- music --------------------------------------------------------------------------------------
  /** Loop a race's leitmotif softly until stopMotif(). */
  playMotif(seed: number): void {
    this.stopMotif();
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const m = motifFromSeed(seed);
    const bus = c.createGain();
    bus.gain.setValueAtTime(0.0001, c.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 1.5);
    bus.connect(this.music!);
    const beat = 60 / m.bpm;
    const phrase = m.notes.reduce((n, x) => n + x[1], 0) * beat;
    let stopped = false;
    const timers: number[] = [];
    const drone = c.createOscillator();
    const dg = c.createGain();
    drone.type = 'sine';
    drone.frequency.value = hz(m.root + m.drone);
    dg.gain.value = 0.12;
    drone.connect(dg).connect(bus);
    drone.start();
    const play = () => {
      if (stopped) return;
      let at = 0;
      for (const [semi, len] of m.notes) {
        if (semi !== null)
          this.tone(hz(m.root + semi), hz(m.root + semi), len * beat * 0.95, m.timbre, 0.18, at, bus);
        at += len * beat;
      }
      timers.push(window.setTimeout(play, phrase * 1000 + 1500));
    };
    play();
    this.motifStop = () => {
      stopped = true;
      timers.forEach((t) => clearTimeout(t));
      const t = c.currentTime;
      bus.gain.setTargetAtTime(0.0001, t, 0.4);
      drone.stop(t + 2);
      window.setTimeout(() => bus.disconnect(), 2500);
    };
  }

  stopMotif(): void {
    this.motifStop?.();
    this.motifStop = null;
  }
}

/** One audio engine for the page. */
export const audio = new GameAudio();
