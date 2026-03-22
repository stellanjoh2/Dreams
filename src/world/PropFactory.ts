import * as THREE from 'three';
import { createMetallicFlakeOrmTexture } from '../materials/MetallicFlakeDetail';

const toColor = (value: string): THREE.Color => new THREE.Color(value);
const CRYSTAL_ROTATION = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const createCrystalGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.OctahedronGeometry(0.85, 0).applyMatrix4(CRYSTAL_ROTATION);
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  geometry.translate(0, -minY, 0);
  return geometry;
};

const metallicFlakeDetail = createMetallicFlakeOrmTexture(8);

export class PropFactory {
  private readonly sharedCandyMaterialOptions: THREE.MeshPhysicalMaterialParameters = {
    roughness: 0.2,
    metalness: 0.16,
    transmission: 0.24,
    thickness: 0.7,
    clearcoat: 1,
    clearcoatRoughness: 0.055,
    iridescence: 0.35,
    iridescenceIOR: 1.18,
    envMapIntensity: 1.7,
    roughnessMap: metallicFlakeDetail,
    metalnessMap: metallicFlakeDetail,
  };
  private readonly materialCache = new Map<string, THREE.Material>();
  private readonly candyRockGeometry = new THREE.IcosahedronGeometry(1, 5);
  private readonly monolithGeometry = new THREE.BoxGeometry(1, 1, 1, 6, 6, 6);
  private readonly cactusTrunkGeometry = new THREE.CylinderGeometry(0.55, 0.75, 6, 10);
  private readonly cactusArmGeometry = new THREE.CylinderGeometry(0.22, 0.35, 2.8, 8);
  private readonly treeTrunkGeometry = new THREE.CylinderGeometry(0.24, 0.34, 2.2, 10);
  private readonly treeTopGeometry = new THREE.SphereGeometry(1.2, 28, 22);
  private readonly crystalGeometry = createCrystalGeometry();

  createCandyRock(color: string, scale: THREE.Vector3Tuple): THREE.Mesh {
    const mesh = new THREE.Mesh(this.candyRockGeometry, this.createCandyMaterial(color));
    mesh.scale.set(...scale);
    this.applyShadowFlags(mesh);
    return mesh;
  }

  createMonolith(color: string, scale: THREE.Vector3Tuple): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.monolithGeometry,
      this.createCandyMaterial(color, {
        transmission: 0.12,
        iridescence: 0.18,
      }),
    );
    mesh.scale.set(...scale);
    this.applyShadowFlags(mesh);
    return mesh;
  }

  createCactus(color: string): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = this.createCandyMaterial(color, {
      transmission: 0.18,
      roughness: 0.48,
    });

    const trunk = new THREE.Mesh(this.cactusTrunkGeometry, bodyMaterial);
    trunk.position.y = 3;
    group.add(trunk);

    const leftArm = new THREE.Mesh(this.cactusArmGeometry, bodyMaterial);
    leftArm.position.set(-0.85, 3.6, 0);
    leftArm.rotation.z = Math.PI / 3.6;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(this.cactusArmGeometry, bodyMaterial);
    rightArm.position.set(0.9, 4.2, 0.12);
    rightArm.rotation.z = -Math.PI / 3.6;
    group.add(rightArm);

    this.applyShadowFlags(group);
    return group;
  }

  createTree(trunkColor: string, topColor: string): THREE.Group {
    const group = new THREE.Group();

    const trunk = new THREE.Mesh(
      this.treeTrunkGeometry,
      this.createCandyMaterial(trunkColor, {
        transmission: 0.08,
      }),
    );
    trunk.position.y = 1.1;
    group.add(trunk);

    const top = new THREE.Mesh(
      this.treeTopGeometry,
      this.createCandyMaterial(topColor, {
        emissive: toColor(topColor).multiplyScalar(0.06),
      }),
    );
    top.scale.set(1.35, 1, 1.1);
    top.position.y = 2.7;
    group.add(top);

    this.applyShadowFlags(group);
    return group;
  }

  createCrystal(color: string): THREE.Mesh {
    const material = this.createCandyMaterial(color, {
      transmission: 0.78,
      roughness: 0.18,
      clearcoat: 1,
      iridescence: 0.9,
      emissive: toColor(color).multiplyScalar(0.35),
      emissiveIntensity: 1.2,
    });

    const crystal = new THREE.Mesh(this.crystalGeometry, material);
    crystal.scale.set(0.58, 0.92, 0.58);
    crystal.userData.isCrystal = true;
    this.applyShadowFlags(crystal);
    return crystal;
  }

  private createCandyMaterial(
    color: string,
    overrides: THREE.MeshPhysicalMaterialParameters = {},
  ): THREE.MeshPhysicalMaterial {
    const key = this.getMaterialKey('candy', color, overrides);
    const cached = this.materialCache.get(key);
    if (cached instanceof THREE.MeshPhysicalMaterial) {
      return cached;
    }

    const material = new THREE.MeshPhysicalMaterial({
      ...this.sharedCandyMaterialOptions,
      color: toColor(color),
      emissive: new THREE.Color(color).multiplyScalar(0.02),
      ...overrides,
    });
    this.materialCache.set(key, material);
    return material;
  }

  private getMaterialKey(
    family: string,
    color: string,
    overrides: Record<string, unknown>,
  ): string {
    const serialized = Object.keys(overrides)
      .sort()
      .map((key) => `${key}:${this.serializeMaterialValue(overrides[key])}`)
      .join('|');

    return `${family}|${color}|${serialized}`;
  }

  private serializeMaterialValue(value: unknown): string {
    if (value instanceof THREE.Color) {
      return `color:${value.getHexString()}`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.serializeMaterialValue(entry)).join(',');
    }

    return String(value);
  }

  private applyShadowFlags(object: THREE.Object3D): void {
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }
}
