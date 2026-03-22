import * as THREE from 'three';

export interface CrystalInstance {
  id: string;
  mesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  collected: boolean;
  respawnAt: number;
}

export class CrystalSystem {
  private readonly crystals: CrystalInstance[] = [];
  private elapsed = 0;

  setCrystals(crystals: CrystalInstance[]): void {
    this.crystals.length = 0;
    this.crystals.push(...crystals);
  }

  update(delta: number): void {
    this.elapsed += delta;

    for (const crystal of this.crystals) {
      if (crystal.collected) {
        continue;
      }

      const bobWave = Math.sin(this.elapsed * 1.8 + crystal.basePosition.x * 0.15);
      const bob = 0.16 + (bobWave * 0.5 + 0.5) * 0.12;
      crystal.mesh.position.copy(crystal.basePosition);
      crystal.mesh.position.y += bob;
      crystal.mesh.rotation.y += delta * 0.9;
      crystal.mesh.rotation.z = Math.sin(this.elapsed * 2.2 + crystal.basePosition.z * 0.1) * 0.04;

      const material = crystal.mesh.material;
      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.emissiveIntensity = 0.9 + Math.sin(this.elapsed * 8 + crystal.basePosition.x) * 0.45;
      }
    }
  }

  getNearestCrystal(position: THREE.Vector3, maxDistance: number): CrystalInstance | null {
    let nearest: CrystalInstance | null = null;
    let nearestDistance = maxDistance;

    for (const crystal of this.crystals) {
      if (crystal.collected) {
        continue;
      }

      const distance = crystal.mesh.position.distanceTo(position);
      if (distance < nearestDistance) {
        nearest = crystal;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  collect(crystal: CrystalInstance): void {
    crystal.collected = true;
    crystal.mesh.visible = false;
    crystal.respawnAt = Number.POSITIVE_INFINITY;
  }
}
