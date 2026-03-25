import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BLOCK_UNIT, PLATFORM_CLUSTERS, type PlatformCluster } from './TerrainLayout';
import { publicUrl } from '../config/publicUrl';

const MODEL_URL = publicUrl('assets/ufo_low_ploy_pbr_textured_game_ready.glb');

/** Spawn + first connector “south” hubs — orbit stays visually tied to early game. */
const ORBIT_ISLAND_IDS = new Set(['south-west', 'south-central']);

/** Large on purpose so the saucer reads clearly from the ground. */
const TARGET_UFO_EXTENT = BLOCK_UNIT * 11;

/** Minimum gap from platform tops to the UFO’s lowest point. */
const CLEARANCE_ABOVE_PLATFORM_TOP = BLOCK_UNIT * 3.75;

/**
 * Pull the orbit down vs the pure platform clearance solve so we sit under chunky sky candy slabs
 * (`DistantWorldBackdrop` `kind === 'sky'`).
 */
const ORBIT_DROP_FOR_SKY_CEILING = BLOCK_UNIT * 2.85;

/** Extra descent below the platform/sky height solve, in world cubes (`BLOCK_UNIT`). */
const FLIGHT_HEIGHT_DROP_BLOCKS = 3;

/** Never closer than this many blocks above the tallest crossed platform top (incl. vertical wobble). */
const PLATFORM_TOP_MIN_BLOCKS = 1.35;

const SPIN_RAD_PER_S = 1.05;
const ORBIT_ANGULAR_SPEED = 0.048;

const R_WOBBLE_MAX = BLOCK_UNIT * 3.15;

/** Cap mean orbit radius so the ring doesn’t sweep toward far tall floats (e.g. `mid-float-a`). */
const ORBIT_RADIUS_MAX = BLOCK_UNIT * 17.5;

const ORBIT_PATH_SAMPLES = 96;

function distPointXZToClusterRect(px: number, pz: number, c: PlatformCluster): number {
  const hw = c.width * 0.5;
  const hd = c.depth * 0.5;
  const dx = Math.max(Math.abs(px - c.x) - hw, 0);
  const dz = Math.max(Math.abs(pz - c.z) - hd, 0);
  return Math.hypot(dx, dz);
}

/**
 * Worst-case `topY` among all platforms whose footprint comes within `hullRadiusXZ` of any sample on
 * the orbit ring (max radius + wobble, elliptical Z).
 */
function maxTopYAlongOrbitPath(
  cx: number,
  cz: number,
  orbitRadius: number,
  hullRadiusXZ: number,
): number {
  const rMax = orbitRadius + R_WOBBLE_MAX;
  let peak = 0;
  for (let i = 0; i < ORBIT_PATH_SAMPLES; i += 1) {
    const a = (i / ORBIT_PATH_SAMPLES) * Math.PI * 2;
    const x = cx + Math.cos(a) * rMax;
    const z = cz + Math.sin(a) * rMax * 0.94;
    for (const c of PLATFORM_CLUSTERS) {
      if (distPointXZToClusterRect(x, z, c) <= hullRadiusXZ) {
        peak = Math.max(peak, c.topY);
      }
    }
  }
  return peak;
}

function boundsForOrbitIslands(): {
  cx: number;
  cz: number;
  spanX: number;
  spanZ: number;
} | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;

  for (const c of PLATFORM_CLUSTERS) {
    if (!ORBIT_ISLAND_IDS.has(c.islandId)) {
      continue;
    }
    any = true;
    const hx = c.width * 0.5;
    const hz = c.depth * 0.5;
    minX = Math.min(minX, c.x - hx);
    maxX = Math.max(maxX, c.x + hx);
    minZ = Math.min(minZ, c.z - hz);
    maxZ = Math.max(maxZ, c.z + hz);
  }

  if (!any) {
    return null;
  }

  return {
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
  };
}

function hasSkinnedDescendant(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      found = true;
    }
  });
  return found;
}

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
    }
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  });
}

/**
 * PBR saucer can read very dark under stylized lights; add a little fill so it doesn’t disappear.
 */
function tuneUfoMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const raw = mesh.material;
    const mats = Array.isArray(raw) ? raw : [raw];
    for (const mat of mats) {
      if (!mat) {
        continue;
      }
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        const isGlass = mat.transparent === true || mat.opacity < 0.999;
        mat.envMapIntensity = Math.max(mat.envMapIntensity, 1.15);
        if (isGlass) {
          mat.depthWrite = false;
          mesh.renderOrder = 4;
        } else {
          mat.emissive.copy(mat.color).multiplyScalar(0.1);
          mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.55);
        }
        mat.needsUpdate = true;
      }
    }
  });
}

function normalizeUfoToOrigin(object: THREE.Object3D, targetMaxExtent: number): number {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return 0;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  object.scale.setScalar(targetMaxExtent / maxDim);
  object.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(object);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(object);
  return (box3.max.y - box3.min.y) * 0.5;
}

export class OrbitingUfoProp {
  readonly root = new THREE.Group();

  private readonly orbitPivot = new THREE.Group();
  private readonly spinPivot = new THREE.Group();

  private readonly loader: GLTFLoader;

  private loaded = false;
  private baseOrbitY = 22;
  private halfHeight = 1.2;
  private orbitCx = 0;
  private orbitCz = 0;
  private orbitRadius = BLOCK_UNIT * 14;
  private orbitPhase = 0;

  constructor(parent: THREE.Object3D, loader: GLTFLoader) {
    this.loader = loader;
    this.root.name = 'OrbitingUFO';
    this.root.frustumCulled = false;
    this.orbitPivot.name = 'UFO_OrbitPivot';
    this.orbitPivot.frustumCulled = false;
    this.spinPivot.name = 'UFO_SpinPivot';
    this.spinPivot.frustumCulled = false;
    this.root.add(this.orbitPivot);
    this.orbitPivot.add(this.spinPivot);
    parent.add(this.root);
  }

  load(): void {
    const region = boundsForOrbitIslands();
    if (!region) {
      return;
    }

    const { cx, cz, spanX, spanZ } = region;
    this.orbitCx = cx;
    this.orbitCz = cz;
    const halfDiag = 0.5 * Math.hypot(spanX, spanZ);
    const autoR = halfDiag * 0.56 + BLOCK_UNIT * 3.2;
    this.orbitRadius = Math.min(autoR, ORBIT_RADIUS_MAX);
    this.orbitPhase = 1.17;

    const hullRadiusXZ = TARGET_UFO_EXTENT * 0.46;
    const peakTopY = maxTopYAlongOrbitPath(cx, cz, this.orbitRadius, hullRadiusXZ);

    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const skinned = hasSkinnedDescendant(gltf.scene);
        const model = skinned ? cloneSkinnedHierarchy(gltf.scene) : gltf.scene.clone(true);
        model.name = 'UFO_Model';
        model.visible = true;
        model.traverse((o) => {
          o.visible = true;
        });
        applyShadowFlags(model);
        tuneUfoMaterials(model);
        this.halfHeight = normalizeUfoToOrigin(model, TARGET_UFO_EXTENT);
        const yWobbleAbsMax = BLOCK_UNIT * 1.05;
        const platformFloor =
          peakTopY + PLATFORM_TOP_MIN_BLOCKS * BLOCK_UNIT + this.halfHeight + yWobbleAbsMax;
        const fromPlatforms = peakTopY + CLEARANCE_ABOVE_PLATFORM_TOP + this.halfHeight;
        this.baseOrbitY = Math.max(
          platformFloor,
          fromPlatforms - ORBIT_DROP_FOR_SKY_CEILING - FLIGHT_HEIGHT_DROP_BLOCKS * BLOCK_UNIT,
        );

        this.spinPivot.add(model);
        this.loaded = true;
        this.root.updateMatrixWorld(true);
      },
      undefined,
      (err) => {
        console.warn('[OrbitingUfoProp] Failed to load', MODEL_URL, err);
      },
    );
  }

  update(delta: number, elapsed: number): void {
    if (!this.loaded) {
      return;
    }

    const dt = Math.max(delta, 1 / 1000);
    this.spinPivot.rotation.y += SPIN_RAD_PER_S * dt;

    const t = elapsed;
    const angle = t * ORBIT_ANGULAR_SPEED + this.orbitPhase;
    const rWobble =
      Math.sin(t * 0.26) * (R_WOBBLE_MAX * 0.92) + Math.cos(t * 0.17) * (R_WOBBLE_MAX * 0.55);
    const r = this.orbitRadius + rWobble;
    const yWobble =
      Math.sin(t * 0.31) * BLOCK_UNIT * 0.62 + Math.cos(t * 0.22) * BLOCK_UNIT * 0.38;

    this.orbitPivot.position.set(
      this.orbitCx + Math.cos(angle) * r,
      this.baseOrbitY + yWobble,
      this.orbitCz + Math.sin(angle) * r * 0.94,
    );
  }
}
