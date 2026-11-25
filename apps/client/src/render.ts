import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { currentTheme } from './themes/theme.js';
import { RetroShader } from './retroShader.js';

/**
 * One WebGL renderer for the whole game. Every theme renders at full resolution. Modern themes add a
 * subtle bloom; the VGA theme instead maps the finished frame onto the 16-colour VGA palette with an
 * ordered (Bayer) dither: retro colours, modern sharpness.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private retro: ShaderPass | null = null;

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
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
    const s = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(s.x / this.gl.getPixelRatio(), s.y / this.gl.getPixelRatio());
    this.bloom?.setSize(s.x, s.y);
    if (this.retro) this.retro.uniforms.pixelRatio!.value = this.gl.getPixelRatio();
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (!this.composer) {
      this.composer = new EffectComposer(this.gl);
      this.renderPass = new RenderPass(scene, camera);
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.55,
        0.5,
        0.82,
      );
      this.retro = new ShaderPass(RetroShader);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.composer.addPass(this.retro); // after OutputPass: quantise display-space colours
      this.resize();
    }
    const vga = this.vga;
    this.bloom!.enabled = !vga;
    this.retro!.enabled = vga;
    this.renderPass!.scene = scene;
    this.renderPass!.camera = camera;
    this.composer.render();
  }
}
