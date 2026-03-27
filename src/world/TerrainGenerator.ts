import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WaterSurfaceMesh } from './WaterSurfaceMesh.js';
import { BLOCK_UNIT, JUMP_PADS, MOVING_ELEVATORS, PLATFORM_TILES, getMovingElevatorTopY } from './TerrainLayout';
import { SEA_BED_SURFACE_Y, WATER_SURFACE_Y } from '../config/defaults';
import { publicUrl } from '../config/publicUrl';
import type { WaterFxSettings } from '../fx/FxSettings';
import { createMetallicFlakeOrmTexture } from '../materials/MetallicFlakeDetail';
import { getSeaBedRadiusWorld, getWaterSurfaceRadiusWorld } from './worldHorizon';

const TILE_RENDER_SCALE = BLOCK_UNIT * 1.02;
const metallicFlakeDetail = createMetallicFlakeOrmTexture(6);

/** Filled disk with inner/outer radial + angular subdivisions — enough verts for soft mesh waves. */
const WATER_DISK_THETA = 112;
const WATER_DISK_PHI = 52;
/** Avoid a visible hole at origin; ~1 mm in world units. */
const WATER_DISK_INNER_EPS = 0.001;

/**
 * Multi-component Gerstner (trochoidal) displacement on the water disk.
 * Resting grid (local X,Y in ring plane; displacement along local Z → world up after mesh Rx(-π/2)).
 * See [trochoidal / Gerstner waves](https://en.wikipedia.org/wiki/Trochoidal_wave); CG multi-wave variant
 * as in Tessendorf / common ocean shaders (cf. augmented Gerstner stacks in real-time water).
 */
const GRAVITY = 9.81;

type GerstnerWaveParams = {
  /** Horizontal direction (need not be unit — normalized internally). */
  dirX: number;
  dirY: number;
  /** Spatial period (meters). */
  wavelength: number;
  /** Vertical amplitude (meters). */
  amplitude: number;
  /** 0 = sine in Z only; higher = more horizontal orbital motion (trochoidal pinch / sharper crests). */
  steepness: number;
  /** Constant phase offset (radians). */
  phase: number;
  /** Multiplier on √(gk) angular frequency (1 ≈ deep-water dispersion). */
  speedScale: number;
};

const WATER_GERSTNER_WAVES: readonly GerstnerWaveParams[] = [
  {
    dirX: 1,
    dirY: 0.38,
    wavelength: 52,
    amplitude: 0.1,
    steepness: 0.78,
    phase: 0.35,
    speedScale: 0.92,
  },
  {
    dirX: -0.55,
    dirY: 1,
    wavelength: 38,
    amplitude: 0.078,
    steepness: 0.74,
    phase: 2.05,
    speedScale: 1.02,
  },
  {
    dirX: 0.72,
    dirY: -0.68,
    wavelength: 29,
    amplitude: 0.055,
    steepness: 0.68,
    phase: 4.2,
    speedScale: 0.88,
  },
  {
    dirX: 0.22,
    dirY: 1,
    wavelength: 67,
    amplitude: 0.062,
    steepness: 0.62,
    phase: 1.45,
    speedScale: 0.75,
  },
];

function gerstnerDisplacement(
  restX: number,
  restY: number,
  t: number,
  heightMul: number,
): { dx: number; dy: number; dz: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;

  for (const w of WATER_GERSTNER_WAVES) {
    const len = Math.hypot(w.dirX, w.dirY);
    const Dx = len > 1e-6 ? w.dirX / len : 1;
    const Dy = len > 1e-6 ? w.dirY / len : 0;
    const k = (Math.PI * 2) / Math.max(w.wavelength, 0.5);
    const omega = Math.sqrt(GRAVITY * k) * w.speedScale;
    const phase = k * (Dx * restX + Dy * restY) - omega * t + w.phase;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const horiz = w.steepness * w.amplitude * c;
    dx += horiz * Dx;
    dy += horiz * Dy;
    dz += w.amplitude * s;
  }

  return { dx: dx * heightMul, dy: dy * heightMul, dz: dz * heightMul };
}

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

/** Planar UVs on horizontal disk (geometry in XY before mesh Rx(-π/2)). */
function applyPlanarSandUVs(geometry: THREE.BufferGeometry, metersPerRepeat: number): void {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, pos.getX(i) / metersPerRepeat, pos.getY(i) / metersPerRepeat);
  }
  uv.needsUpdate = true;
}

const SAND_TILE_METERS = 7.5;

/**
 * Mix sand albedo toward luminance so refracted/seen-through water stays easier to tint.
 * `1` = fully grayscale; `0.75` ≈ strong desat (default); `0` = raw texture.
 */
const SAND_TEXTURE_DESATURATION = 0.75;

function desaturateTexture(tex: THREE.Texture, amount: number): void {
  if (amount <= 0) {
    return;
  }
  const img = tex.image as HTMLImageElement | HTMLCanvasElement;
  const w = img.width;
  const h = img.height;
  if (!w || !h) {
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return;
  }
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const a = THREE.MathUtils.clamp(amount, 0, 1);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = r + (y - r) * a;
    d[i + 1] = g + (y - g) * a;
    d[i + 2] = b + (y - b) * a;
  }
  ctx.putImageData(imageData, 0, 0);
  tex.image = canvas;
}

export class TerrainGenerator {
  private readonly seaBedGeometry: THREE.CircleGeometry;
  private readonly waterGeometry: THREE.RingGeometry;
  private readonly blockGeometry = new RoundedBoxGeometry(1, 1, 1, 4, 0.048);
  private readonly waterNormal0 = createWaterNormalTexture(0.12);
  private readonly waterNormal1 = createWaterNormalTexture(0.57);
  private readonly blockMaterialCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly elevatorMeshes = new Map<string, THREE.Mesh>();
  private readonly instanceDummy = new THREE.Object3D();
  private waterSurface: WaterSurfaceMesh | null = null;
  private waterBasePositions: Float32Array | null = null;
  /** From `WaterFxSettings.waveHeight` — scales mesh swell each frame. */
  private waterMeshWaveHeight = 1;

  constructor() {
    const rWater = getWaterSurfaceRadiusWorld();
    const rSea = getSeaBedRadiusWorld();
    this.seaBedGeometry = new THREE.CircleGeometry(rSea, 96);
    this.waterGeometry = new THREE.RingGeometry(
      WATER_DISK_INNER_EPS,
      rWater,
      WATER_DISK_THETA,
      WATER_DISK_PHI,
    );
  }

  createGround(waterHighFrequencyNormal?: THREE.Texture, waterTint?: string): THREE.Group {
    const waterColor = waterTint ?? '#4fd6da';
    const group = new THREE.Group();
    this.elevatorMeshes.clear();

    const seaBedGeometry = this.seaBedGeometry.clone();
    applyPlanarSandUVs(seaBedGeometry, SAND_TILE_METERS);

    const seaBedMaterial = new THREE.MeshStandardMaterial({
      /** Near-neutral multiply — sand detail comes from (desaturated) map. */
      color: new THREE.Color('#eae8e5'),
      roughness: 0.91,
      metalness: 0.02,
    });
    const seaBed = new THREE.Mesh(seaBedGeometry, seaBedMaterial);
    seaBed.name = 'SeaBed';
    seaBed.rotation.x = -Math.PI / 2;
    seaBed.position.set(0, SEA_BED_SURFACE_Y, 0);
    seaBed.receiveShadow = true;
    seaBed.castShadow = false;
    group.add(seaBed);

    new THREE.TextureLoader().load(
      publicUrl('assets/alfie-jaarf-sandtexture4.jpg'),
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        desaturateTexture(tex, SAND_TEXTURE_DESATURATION);
        tex.needsUpdate = true;
        seaBedMaterial.map = tex;
        seaBedMaterial.needsUpdate = true;
      },
      undefined,
      () => {
        console.warn('[TerrainGenerator] Sand texture missing — flat tint only');
      },
    );

    const foamOpts = {
      /** Tight rim at geometry/water cut; raise slightly if foam disappears. */
      foamDepthWidth: 0.0075,
      foamIntensity: 0.16,
    };

    const waterOptions =
      waterHighFrequencyNormal !== undefined
        ? {
            color: waterColor,
            flowDirection: new THREE.Vector2(0.35, 0.18),
            flowSpeed: 0.052,
            reflectivity: 0.28,
            scale: 26,
            normalDistort: 0.024,
            normalStrength: 0.92,
            standardNormalUnpack: true as const,
            normalMap0: waterHighFrequencyNormal,
            normalMap1: waterHighFrequencyNormal,
            ...foamOpts,
          }
        : {
            color: '#4fd6da',
            flowDirection: new THREE.Vector2(0.35, 0.18),
            flowSpeed: 0.042,
            reflectivity: 0.22,
            scale: 5.6,
            standardNormalUnpack: false as const,
            normalMap0: this.waterNormal0,
            normalMap1: this.waterNormal1,
            ...foamOpts,
          };

    const water = new WaterSurfaceMesh(this.waterGeometry, waterOptions);
    water.name = 'WaterSurface';
    water.frustumCulled = false;
    water.renderOrder = 12;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_SURFACE_Y, 0);
    water.receiveShadow = true;

    this.waterSurface = water;
    const wPos = water.geometry.attributes.position;
    this.waterBasePositions = new Float32Array(wPos.array);
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

  applyWaterFxSettings(settings: WaterFxSettings): void {
    const water = this.waterSurface;
    if (!water) {
      return;
    }

    const wh = Number(settings.waveHeight);
    this.waterMeshWaveHeight = Number.isFinite(wh) ? THREE.MathUtils.clamp(wh, 0, 4) : 1;

    type WaterUniformNode = {
      color: { value: THREE.Color };
      reflectivity: { value: number };
      reflectionStrength: { value: number };
      reflectionContrast: { value: number };
      scale: { value: number };
      normalStrength: { value: number };
      flowSpeed: { value: number };
      foamIntensity: { value: number };
      normalDistort: { value: number };
      opacity: { value: number };
    };

    const node = (water.material as { colorNode?: WaterUniformNode }).colorNode;
    if (!node?.reflectivity) {
      return;
    }

    node.color.value.set(settings.color);
    node.reflectivity.value = settings.reflectivity;
    node.reflectionStrength.value = settings.reflectionStrength;
    node.reflectionContrast.value = settings.reflectionContrast;
    node.scale.value = settings.waveScale;
    node.normalStrength.value = settings.normalStrength;
    node.flowSpeed.value = settings.flowSpeed;
    node.foamIntensity.value = settings.foamIntensity;
    node.normalDistort.value = settings.normalDistort;
    if (node.opacity) {
      const o = Number(settings.opacity);
      node.opacity.value = Number.isFinite(o) ? THREE.MathUtils.clamp(o, 0, 2) : 1;
    }
  }

  update(elapsed: number): void {
    for (const elevator of MOVING_ELEVATORS) {
      const mesh = this.elevatorMeshes.get(elevator.id);
      if (!mesh) {
        continue;
      }

      mesh.position.y = getMovingElevatorTopY(elapsed, elevator) - BLOCK_UNIT * 0.5;
    }

    this.updateWaterSwell(elapsed);
  }

  /**
   * Gerstner swell on the water disk (rest X,Y → displaced X,Y,Z in local space;
   * local Z → world up after Rx(-π/2)).
   */
  private updateWaterSwell(elapsed: number): void {
    const mesh = this.waterSurface;
    const base = this.waterBasePositions;
    if (!mesh || !base) {
      return;
    }

    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const arr = posAttr.array as Float32Array;
    const n = base.length;
    const hm = this.waterMeshWaveHeight;

    for (let i = 0; i < n; i += 3) {
      const x0 = base[i]!;
      const y0 = base[i + 1]!;
      const z0 = base[i + 2]!;
      const { dx, dy, dz } = gerstnerDisplacement(x0, y0, elapsed, hm);
      arr[i] = x0 + dx;
      arr[i + 1] = y0 + dy;
      arr[i + 2] = z0 + dz;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
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
