import * as THREE from 'three';
import type { ParticleSettings } from '../fx/FxSettings';

const DEFAULT_MAX_PARTICLES = 320;
const createDustSprite = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Candy Lands could not create the ambient dust sprite.');
  }

  const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

export class AmbientDustSystem {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly sprite = createDustSprite();
  private readonly material = new THREE.PointsMaterial({
    color: new THREE.Color('#b9fff4'),
    size: 0.62,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    map: this.sprite,
    alphaMap: this.sprite,
    alphaTest: 0.02,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  private readonly positions: Float32Array;
  private readonly origins: Float32Array;
  private readonly horizontalAmplitude: Float32Array;
  private readonly verticalAmplitude: Float32Array;
  private readonly driftSpeed: Float32Array;
  private readonly phase: Float32Array;

  constructor(maxParticles = DEFAULT_MAX_PARTICLES) {
    this.positions = new Float32Array(maxParticles * 3);
    this.origins = new Float32Array(maxParticles * 3);
    this.horizontalAmplitude = new Float32Array(maxParticles);
    this.verticalAmplitude = new Float32Array(maxParticles);
    this.driftSpeed = new Float32Array(maxParticles);
    this.phase = new Float32Array(maxParticles);

    for (let index = 0; index < maxParticles; index += 1) {
      const i3 = index * 3;
      const originX = (Math.random() - 0.5) * 54;
      const originY = 1.4 + Math.random() * 7.2;
      const originZ = (Math.random() - 0.36) * 52;

      this.origins[i3] = originX;
      this.origins[i3 + 1] = originY;
      this.origins[i3 + 2] = originZ;

      this.positions[i3] = originX;
      this.positions[i3 + 1] = originY;
      this.positions[i3 + 2] = originZ;

      this.horizontalAmplitude[index] = 0.3 + Math.random() * 1.5;
      this.verticalAmplitude[index] = 0.12 + Math.random() * 0.9;
      this.driftSpeed[index] = 0.05 + Math.random() * 0.12;
      this.phase[index] = Math.random() * Math.PI * 2;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 120);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  applySettings(settings: ParticleSettings): void {
    const count = THREE.MathUtils.clamp(Math.round(settings.amount), 0, this.positions.length / 3);
    this.geometry.setDrawRange(0, count);
    this.material.color.set(settings.color);
    this.material.opacity = count > 0 ? 0.72 : 0;
    this.material.needsUpdate = true;
  }

  update(elapsed: number): void {
    const count = this.geometry.drawRange.count;
    if (count === 0) {
      return;
    }

    const positionAttribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let index = 0; index < count; index += 1) {
      const i3 = index * 3;
      const phase = this.phase[index];
      const speed = this.driftSpeed[index];
      const horizontalAmplitude = this.horizontalAmplitude[index];
      const verticalAmplitude = this.verticalAmplitude[index];
      const sway = elapsed * speed + phase;

      this.positions[i3] = this.origins[i3] + Math.sin(sway) * horizontalAmplitude;
      this.positions[i3 + 1] =
        this.origins[i3 + 1] +
        Math.sin(sway * 0.65 + index * 0.17) * verticalAmplitude +
        Math.cos(elapsed * 0.06 + phase) * 0.12;
      this.positions[i3 + 2] = this.origins[i3 + 2] + Math.cos(sway * 0.8 + phase) * horizontalAmplitude;
    }

    positionAttribute.needsUpdate = true;
  }
}
