import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WaterSurfaceMesh } from './WaterSurfaceMesh.js';
import { BLOCK_UNIT, JUMP_PADS, MOVING_ELEVATORS, PLATFORM_TILES, getMovingElevatorTopY } from './TerrainLayout';
import { WATER_SURFACE_Y, WORLD_FLOOR_Y } from '../config/defaults';
import { createMetallicFlakeOrmTexture } from '../materials/MetallicFlakeDetail';
import { getSeaBedRadiusWorld, getWaterSurfaceRadiusWorld } from './worldHorizon';

const TILE_RENDER_SCALE = BLOCK_UNIT * 1.02;
const metallicFlakeDetail = createMetallicFlakeOrmTexture(6);

const createWaterNormalTexture = (phase: number): THREE.DataTexture => {
  const size = 512;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const waveA = Math.sin((u * 12 + phase) * Math.PI * 2);
      const waveB = Math.cos((v * 10 - phase * 0.7) * Math.PI * 2);
      const waveC = Math.sin((u * 7 + v * 8 + phase * 1.3) * Math.PI * 2);
      const waveD = Math.cos((u * 21 - v * 17 + phase * 2.1) * Math.PI * 2);
      const waveE = Math.sin((u * 29 + v * 23 - phase * 1.7) * Math.PI * 2);
      const nx = THREE.MathUtils.clamp((waveA + waveC * 0.48 + waveD * 0.22) * 0.3, -1, 1);
      const nz = THREE.MathUtils.clamp((waveB - waveC * 0.38 + waveE * 0.18) * 0.3, -1, 1);
      const up = THREE.MathUtils.clamp(0.84 + (waveA * waveB + waveD * 0.35 + 1) * 0.06, 0, 1);
      const index = (y * size + x) * 4;

      data[index] = Math.round((nx * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round(up * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

export class TerrainGenerator {
  private readonly seaBedGeometry: THREE.CircleGeometry;
  private readonly waterGeometry: THREE.CircleGeometry;
  private readonly blockGeometry = new RoundedBoxGeometry(1, 1, 1, 4, 0.048);
  private readonly waterNormal0 = createWaterNormalTexture(0.12);
  private readonly waterNormal1 = createWaterNormalTexture(0.57);
  private readonly blockMaterialCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly elevatorMeshes = new Map<string, THREE.Mesh>();
  private readonly instanceDummy = new THREE.Object3D();

  constructor() {
    const rWater = getWaterSurfaceRadiusWorld();
    const rSea = getSeaBedRadiusWorld();
    this.seaBedGeometry = new THREE.CircleGeometry(rSea, 96);
    this.waterGeometry = new THREE.CircleGeometry(rWater, 192);
  }

  createGround(): THREE.Group {
    const group = new THREE.Group();
    this.elevatorMeshes.clear();

    const seaBed = new THREE.Mesh(
      this.seaBedGeometry,
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#0d7c87'),
        roughness: 0.52,
        metalness: 0.06,
        clearcoat: 0.18,
        transparent: true,
        opacity: 0.9,
      }),
    );
    seaBed.rotation.x = -Math.PI / 2;
    seaBed.position.set(0, WORLD_FLOOR_Y - 1.25, 0);
    seaBed.receiveShadow = true;
    group.add(seaBed);

    const water = new WaterSurfaceMesh(this.waterGeometry, {
      color: '#4fd6da',
      flowDirection: new THREE.Vector2(0.35, 0.18),
      flowSpeed: 0.042,
      reflectivity: 0.22,
      scale: 5.6,
      normalMap0: this.waterNormal0,
      normalMap1: this.waterNormal1,
    });
    water.name = 'WaterSurface';
    water.frustumCulled = false;
    water.renderOrder = 12;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_SURFACE_Y, 0);
    water.receiveShadow = true;
    const waterMaterials = Array.isArray(water.material) ? water.material : [water.material];
    for (const material of waterMaterials) {
      material.side = THREE.DoubleSide;
      material.transparent = true;
      material.depthWrite = false;
      material.depthTest = true;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -2;
    }
    group.add(water);

    const instancesByColor = new Map<string, Array<{ x: number; y: number; z: number }>>();

    const pushTileStacks = (tile: (typeof PLATFORM_TILES)[number]): void => {
      let instances = instancesByColor.get(tile.color);
      if (!instances) {
        instances = [];
        instancesByColor.set(tile.color, instances);
      }

      for (let level = 0; level < tile.stackCount; level += 1) {
        instances.push({
          x: tile.x,
          y: tile.baseY + (level + 0.5) * BLOCK_UNIT,
          z: tile.z,
        });
      }
    };

    for (const tile of PLATFORM_TILES) {
      pushTileStacks(tile);
    }

    for (const [color, instances] of instancesByColor) {
      const instancedTiles = new THREE.InstancedMesh(
        this.blockGeometry,
        this.getBlockMaterial(color),
        instances.length,
      );
      instancedTiles.castShadow = true;
      instancedTiles.receiveShadow = true;
      instancedTiles.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      instances.forEach((instance, index) => {
        this.instanceDummy.position.set(instance.x, instance.y, instance.z);
        this.instanceDummy.scale.setScalar(TILE_RENDER_SCALE);
        this.instanceDummy.updateMatrix();
        instancedTiles.setMatrixAt(index, this.instanceDummy.matrix);
      });

      instancedTiles.instanceMatrix.needsUpdate = true;
      instancedTiles.computeBoundingBox();
      instancedTiles.computeBoundingSphere();
      group.add(instancedTiles);
    }

    for (const jumpPad of JUMP_PADS) {
      const jumpBlock = new THREE.Mesh(this.blockGeometry, this.createJumpPadMaterial(jumpPad.color));
      const jumpBlockHeight = BLOCK_UNIT * 0.28;
      jumpBlock.position.set(jumpPad.x, jumpPad.y + jumpBlockHeight * 0.18, jumpPad.z);
      jumpBlock.scale.set(jumpPad.width, jumpBlockHeight, jumpPad.depth);
      jumpBlock.castShadow = true;
      jumpBlock.receiveShadow = true;
      group.add(jumpBlock);
    }

    for (const elevator of MOVING_ELEVATORS) {
      const liftBlock = new THREE.Mesh(this.blockGeometry, this.getBlockMaterial(elevator.color));
      liftBlock.position.set(elevator.x, getMovingElevatorTopY(0, elevator) - BLOCK_UNIT * 0.5, elevator.z);
      liftBlock.scale.setScalar(TILE_RENDER_SCALE);
      liftBlock.castShadow = true;
      liftBlock.receiveShadow = true;
      this.elevatorMeshes.set(elevator.id, liftBlock);
      group.add(liftBlock);
    }

    return group;
  }

  update(elapsed: number): void {
    for (const elevator of MOVING_ELEVATORS) {
      const mesh = this.elevatorMeshes.get(elevator.id);
      if (!mesh) {
        continue;
      }

      mesh.position.y = getMovingElevatorTopY(elapsed, elevator) - BLOCK_UNIT * 0.5;
    }
  }

  private getBlockMaterial(color: string): THREE.MeshPhysicalMaterial {
    const cached = this.blockMaterialCache.get(color);
    if (cached) {
      return cached;
    }

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: 0.2,
      metalness: 0.14,
      transmission: 0.08,
      clearcoat: 0.9,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.75,
      roughnessMap: metallicFlakeDetail,
      metalnessMap: metallicFlakeDetail,
    });
    this.blockMaterialCache.set(color, material);
    return material;
  }

  private createJumpPadMaterial(color: string): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color).multiplyScalar(1.1),
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      transmission: 0.08,
      envMapIntensity: 1.6,
    });
  }
}
