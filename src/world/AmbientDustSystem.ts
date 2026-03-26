import * as THREE from 'three';
import type { ParticleSettings } from '../fx/FxSettings';

const DEFAULT_MAX_PARTICLES = 160;

/**
 * World quad scale is multiplied by (distance / this) so specks keep ~constant **screen** thickness
 * (like `PointsMaterial.sizeAttenuation: false`), while staying at real 3D positions.
 */
const PARTICLE_SCREEN_REF_DISTANCE = 9;

/**
 * WebGPU only draws point primitives at 1 pixel — `THREE.Points` + `PointsMaterial.size` is ignored.
 * We use **additive** instanced quads, billboard per particle, with **distance-scaled** size for
 * screen-space-like thickness.
 */
const createDustSprite = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Candy Lands could not create the ambient dust sprite.');
  }

  const gradient = context.createRadialGradient(32, 32, 8, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export class AmbientDustSystem {
  readonly mesh: THREE.InstancedMesh;

  private readonly sprite = createDustSprite();
  private readonly maxParticles: number;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly origins: Float32Array;
  private readonly horizontalAmplitude: Float32Array;
  private readonly verticalAmplitude: Float32Array;
  private readonly driftSpeed: Float32Array;
  private readonly phase: Float32Array;
  private readonly dummy = new THREE.Object3D();
  private readonly worldPos = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly billboardQuat = new THREE.Quaternion();
  private readonly planeNormal = new THREE.Vector3(0, 0, 1);
  private quadWorldSize = 0.04;

  constructor(maxParticles = DEFAULT_MAX_PARTICLES) {
    this.maxParticles = maxParticles;
    this.positions = new Float32Array(maxParticles * 3);
    this.origins = new Float32Array(maxParticles * 3);
    this.horizontalAmplitude = new Float32Array(maxParticles);
    this.verticalAmplitude = new Float32Array(maxParticles);
    this.driftSpeed = new Float32Array(maxParticles);
    this.phase = new Float32Array(maxParticles);

    for (let index = 0; index < maxParticles; index += 1) {
      const i3 = index * 3;
      // Fixed world volume over the play space (not camera-local — avoids “HUD” feel).
      const originX = (Math.random() - 0.5) * 88;
      const originY = 1.2 + Math.random() * 22;
      const originZ = (Math.random() - 0.42) * 96;

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

    this.material = new THREE.MeshBasicMaterial({
      map: this.sprite,
      color: new THREE.Color('#b9fff4'),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      // Depth test on so dust hides behind terrain/platforms/water; depthWrite off avoids punching holes in the buffer for additive quads behind.
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, maxParticles);
    this.mesh.name = 'AmbientDust';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.count = 70;
  }

  applySettings(settings: ParticleSettings): void {
    const count = THREE.MathUtils.clamp(Math.round(settings.amount), 0, this.maxParticles);
    const particleSize = THREE.MathUtils.clamp(
      Number.isFinite(settings.size) ? settings.size : 0.04,
      0.04,
      14,
    );
    this.mesh.count = count;
    this.quadWorldSize = particleSize;
    this.material.color.set(settings.color);
    this.material.opacity = count > 0 ? 0.92 : 0;
  }

  update(elapsed: number, camera?: THREE.Camera): void {
    const count = this.mesh.count;
    if (count === 0 || !camera) {
      return;
    }

    const camPos = camera.position;

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

      this.worldPos.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]);

      this.dummy.position.copy(this.worldPos);
      this.toCamera.subVectors(camPos, this.worldPos);
      if (this.toCamera.lengthSq() < 1e-8) {
        this.toCamera.set(0, 0, 1);
      } else {
        this.toCamera.normalize();
      }
      // PlaneGeometry faces +Z; align +Z with view direction toward camera (per-particle billboard).
      this.billboardQuat.setFromUnitVectors(this.planeNormal, this.toCamera);
      this.dummy.quaternion.copy(this.billboardQuat);

      const dist = Math.max(0.35, this.worldPos.distanceTo(camPos));
      const screenSpaceScale = this.quadWorldSize * (dist / PARTICLE_SCREEN_REF_DISTANCE);
      this.dummy.scale.set(screenSpaceScale, screenSpaceScale, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
