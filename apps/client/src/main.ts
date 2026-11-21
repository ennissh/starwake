import './themes/theme.js';
import './styles/app.css';
import * as THREE from 'three';
import { Health, THEMES, type ThemeId } from '@starwake/shared';
import { currentTheme, initialTheme, onThemeChange, setTheme } from './themes/theme.js';
import { buildStarwake } from './models/starwake.js';

setTheme(initialTheme());

// --- M0 placeholder: the Starwake turning slowly, build info and LLM status. -------------------
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
camera.position.set(260, 120, 360);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x101418, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(300, 400, 200);
scene.add(sun);

const ship = buildStarwake();
scene.add(ship.group);

const VGA_W = 320;
const VGA_H = 200;
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (currentTheme() === 'vga') {
    renderer.setPixelRatio(1);
    renderer.setSize(VGA_W, VGA_H, false);
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function applySceneTheme(): void {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--space-tint').trim() || '#05070b';
  scene.background = new THREE.Color(css);
  renderer.setClearColor(scene.background);
  resize();
}
window.addEventListener('resize', resize);
onThemeChange(applySceneTheme);
applySceneTheme();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  ship.group.rotation.y += clock.getDelta() * 0.15;
  renderer.render(scene, camera);
});

const ui = document.querySelector<HTMLDivElement>('#ui')!;
ui.innerHTML = `
  <section class="sw-panel sw-landing" aria-labelledby="sw-title">
    <div class="sw-kicker">Generative Distractions</div>
    <h1 class="sw-title" id="sw-title">Starwake</h1>
    <p>Pathfinder for the Long Caravan. Flight arrives in M1.</p>
    <div class="sw-row" role="group" aria-label="Theme">
      ${THEMES.map((t) => `<button class="sw-btn" data-theme-id="${t.id}" aria-pressed="false">${t.name}</button>`).join('')}
    </div>
    <div class="sw-meta" id="sw-build">…</div>
    <div class="sw-meta"><span class="sw-dot" id="sw-llm-dot"></span><span id="sw-llm">Translator: checking…</span></div>
  </section>`;

function markTheme(t: ThemeId): void {
  for (const b of ui.querySelectorAll<HTMLButtonElement>('[data-theme-id]')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeId === t));
  }
}
ui.addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-id]');
  if (b?.dataset.themeId) setTheme(b.dataset.themeId as ThemeId);
});
onThemeChange(markTheme);
markTheme(currentTheme());

const LLM_LABEL = {
  up: 'Translator: online',
  down: 'Translator: signal degraded (scripted fallback)',
  mock: 'Translator: mock mode',
  off: 'Translator: off (scripted)',
} as const;

fetch('/healthz')
  .then((r) => r.json())
  .then((j: unknown) => {
    const h = Health.parse(j);
    document.querySelector('#sw-build')!.textContent = `v${h.version} · ${h.gitSha.slice(0, 7)}`;
    document.querySelector('#sw-llm')!.textContent = LLM_LABEL[h.llm];
    document.querySelector('#sw-llm-dot')!.className = `sw-dot sw-dot--${h.llm}`;
  })
  .catch(() => {
    document.querySelector('#sw-build')!.textContent = 'server unreachable';
  });
