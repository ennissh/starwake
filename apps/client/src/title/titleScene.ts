import * as THREE from 'three';
import { buildStarwake } from '../models/starwake.js';
import { buildSpace } from '../scene/space.js';
import type { Renderer } from '../render.js';

/** Backdrop for the title screen: the Starwake turning slowly against its home sky. */
export class TitleScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 400_000);
  private ship = buildStarwake();
  private space = buildSpace({
    seed: 'title',
    tint: '#1d3350',
    starColor: '#ffd9a0',
    sunDir: new THREE.Vector3(0.6, 0.3, -0.7).normalize(),
  });

  constructor(private readonly r: Renderer) {
    this.scene.add(this.space.group, this.ship.group);
    this.camera.position.set(340, 120, -280);
    this.camera.lookAt(-30, 0, 30);
  }

  update(dt: number): void {
    this.ship.group.rotation.y += dt * 0.12;
    this.space.update(this.camera);
    this.space.setPixelScale(this.r.vga ? 0.5 : 1);
  }

  render(): void {
    this.r.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ship.dispose();
    this.space.dispose();
  }
}
