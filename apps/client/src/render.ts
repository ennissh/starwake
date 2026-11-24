import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { currentTheme } from './themes/theme.js';

/**
 * One WebGL renderer for the whole game. Modern themes render at full resolution with subtle bloom;
 * the VGA theme renders at 320×200 and the canvas is upscaled with nearest-neighbour (CSS).
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.gl.autoClear = true;
    this.gl.info.autoReset = false; // reset once per frame so the perf overlay counts every pass
    this.resize();
  }

  get vga(): boolean {
    return currentTheme() === 'vga';
  }

  resize(): void {
    if (this.vga) {
      this.gl.setPixelRatio(1);
      this.gl.setSize(320, 200, false);
    } else {
      this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.gl.setSize(window.innerWidth, window.innerHeight, false);
    }
    const s = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(s.x / this.gl.getPixelRatio(), s.y / this.gl.getPixelRatio());
    this.bloom?.setSize(s.x, s.y);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (this.vga) {
      this.gl.render(scene, camera);
      return;
    }
    if (!this.composer) {
      this.composer = new EffectComposer(this.gl);
      this.renderPass = new RenderPass(scene, camera);
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.55,
        0.5,
        0.82,
      );
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.resize();
    }
    this.renderPass!.scene = scene;
    this.renderPass!.camera = camera;
    this.composer.render();
  }
}
