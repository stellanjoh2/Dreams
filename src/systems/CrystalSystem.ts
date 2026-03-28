import * as THREE from 'three';
import type { LensFlareEmissiveCandidate } from '../fx/LensFlareOverlay';
import { CrystalPickupVfxHost } from '../fx/CrystalPickupVfx';
import { CRYSTAL_INSTANCE_SCALE } from '../world/TerrainLayout';

export interface CrystalInstance {
  id: string;
  instancedMesh: THREE.InstancedMesh;
  instanceIndex: number;
  basePosition: THREE.Vector3;
  /** Hex tint — matches anchor; used for pickup dissolve / sparks. */
  color: string;
  collected: boolean;
  respawnAt: number;
  rotationY: number;
}

export class CrystalSystem {
  private readonly crystals: CrystalInstance[] = [];
  private readonly flareWorld = new THREE.Vector3();
  private readonly crystalDummy = new THREE.Object3D();
  private readonly nearestScratch = new THREE.Vector3();
  private readonly motionMatrixScratch = new THREE.Matrix4();
  private readonly zeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private elapsed = 0;
  private vfx: CrystalPickupVfxHost | null = null;
  private crystalGeometry: THREE.BufferGeometry | null = null;
  private screenPickupPulse = 0;

  setCrystals(crystals: CrystalInstance[]): void {
    this.crystals.length = 0;
    this.crystals.push(...crystals);
  }

  /** Scene + shared crystal geometry for pickup dissolve (call once after world build). */
  attachVfxResources(scene: THREE.Scene, crystalGeometry: THREE.BufferGeometry): void {
    this.vfx?.dispose();
    this.vfx = new CrystalPickupVfxHost(scene);
    this.crystalGeometry = crystalGeometry;
  }

  /** Decaying 0–1 strength for post-process pickup tint. */
  getScreenPickupPulse(): number {
    return this.screenPickupPulse;
  }

  private writeActiveCrystalMatrix(crystal: CrystalInstance, target: THREE.Matrix4): void {
    const bobWave = Math.sin(this.elapsed * 1.8 + crystal.basePosition.x * 0.15);
    const bob = 0.16 + (bobWave * 0.5 + 0.5) * 0.12;

    this.crystalDummy.position.set(crystal.basePosition.x, crystal.basePosition.y + bob, crystal.basePosition.z);
    this.crystalDummy.rotation.set(
      0,
      crystal.rotationY,
      Math.sin(this.elapsed * 2.2 + crystal.basePosition.z * 0.1) * 0.04,
    );
    this.crystalDummy.scale.set(...CRYSTAL_INSTANCE_SCALE);
    this.crystalDummy.updateMatrix();
    target.copy(this.crystalDummy.matrix);
  }

  update(delta: number): void {
    this.elapsed += delta;

    if (this.screenPickupPulse > 0.001) {
      this.screenPickupPulse *= Math.exp(-delta * 4.0);
    } else {
      this.screenPickupPulse = 0;
    }

    this.vfx?.update(delta);

    const touchedMeshes = new Set<THREE.InstancedMesh>();

    for (const crystal of this.crystals) {
      if (crystal.collected) {
        continue;
      }

      crystal.rotationY += delta * 0.9;

      const bobWave = Math.sin(this.elapsed * 1.8 + crystal.basePosition.x * 0.15);
      const bob = 0.16 + (bobWave * 0.5 + 0.5) * 0.12;

      this.crystalDummy.position.set(crystal.basePosition.x, crystal.basePosition.y + bob, crystal.basePosition.z);
      this.crystalDummy.rotation.set(
        0,
        crystal.rotationY,
        Math.sin(this.elapsed * 2.2 + crystal.basePosition.z * 0.1) * 0.04,
      );
      this.crystalDummy.scale.set(...CRYSTAL_INSTANCE_SCALE);
      this.crystalDummy.updateMatrix();

      crystal.instancedMesh.setMatrixAt(crystal.instanceIndex, this.crystalDummy.matrix);
      touchedMeshes.add(crystal.instancedMesh);

      const material = crystal.instancedMesh.material;
      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.emissiveIntensity = 0.9 + Math.sin(this.elapsed * 8 + crystal.basePosition.x) * 0.45;
      }
    }

    for (const mesh of touchedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Screen-space lens flare picks the best candidate; crystals use animated emissive strength. */
  appendFlareCandidates(out: LensFlareEmissiveCandidate[]): void {
    for (const crystal of this.crystals) {
      if (crystal.collected) {
        continue;
      }

      const bobWave = Math.sin(this.elapsed * 1.8 + crystal.basePosition.x * 0.15);
      const bob = 0.16 + (bobWave * 0.5 + 0.5) * 0.12;
      this.flareWorld.set(crystal.basePosition.x, crystal.basePosition.y + bob, crystal.basePosition.z);

      const pulse = 0.38 + Math.sin(this.elapsed * 8 + crystal.basePosition.x) * 0.22;
      out.push({
        x: this.flareWorld.x,
        y: this.flareWorld.y,
        z: this.flareWorld.z,
        intensity: pulse,
        color: crystal.color,
      });
    }
  }

  getNearestCrystal(position: THREE.Vector3, maxDistance: number): CrystalInstance | null {
    let nearest: CrystalInstance | null = null;
    let nearestDistance = maxDistance;

    for (const crystal of this.crystals) {
      if (crystal.collected) {
        continue;
      }

      const bobWave = Math.sin(this.elapsed * 1.8 + crystal.basePosition.x * 0.15);
      const bob = 0.16 + (bobWave * 0.5 + 0.5) * 0.12;
      this.nearestScratch.set(crystal.basePosition.x, crystal.basePosition.y + bob, crystal.basePosition.z);

      const distance = this.nearestScratch.distanceTo(position);
      if (distance < nearestDistance) {
        nearest = crystal;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  collect(crystal: CrystalInstance): void {
    if (this.vfx && this.crystalGeometry) {
      this.writeActiveCrystalMatrix(crystal, this.motionMatrixScratch);
      this.vfx.spawn(this.motionMatrixScratch, crystal.color, this.crystalGeometry);
    }

    this.screenPickupPulse = 1;

    crystal.collected = true;
    crystal.respawnAt = Number.POSITIVE_INFINITY;
    crystal.instancedMesh.setMatrixAt(crystal.instanceIndex, this.zeroScaleMatrix);
    crystal.instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
