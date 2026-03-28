import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WORLD_FLOOR_Y } from '../config/defaults';
import { getBackdropFarFrameMetrics } from './DistantWorldBackdrop';
import { BLOCK_UNIT, RESPAWN_ANCHORS } from './TerrainLayout';
import {
  MOUNTAIN_BASE_TARGET_EXTENT,
  MOUNTAIN_MESH_HEIGHT_SCALE,
  MOUNTAIN_MESH_UNIFORM_SCALE,
  MOUNTAIN_ORBIT_MARGIN_BLOCKS,
  MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS,
} from './worldHorizon';

import { publicUrl } from '../config/publicUrl';

const MODEL_URL = publicUrl('assets/low_poly_mountains.glb');

const BASE_TARGET_MAX_EXTENT = MOUNTAIN_BASE_TARGET_EXTENT;

/** How many mountain clones ring the playfield (user asked 3–4). */
const MOUNTAIN_RING_COUNT = 4;

/**
 * Per-instance scale variance (multiplies `BASE_TARGET_MAX_EXTENT`) so silhouettes don’t clone-match.
 */
const SIZE_MULTIPLIERS: readonly number[] = [0.82, 1.0, 1.14, 0.91];

/** Push orbit **beyond** farthest backdrop L∞ radius so cubes sit in front. */
const ORBIT_MARGIN_BEYOND_BACKDROP = BLOCK_UNIT * MOUNTAIN_ORBIT_MARGIN_BLOCKS;

/**
 * Extra radius **only** for the mountain whose orbit point is nearest primary spawn (`RESPAWN_ANCHORS[0]`),
 * so the silhouette past the south/south-west start doesn’t loom too close.
 */
const SPAWN_NEAREST_EXTRA_MARGIN = BLOCK_UNIT * MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS;

/** Tiny angle jitter (rad) per slot — breaks perfect symmetry. */
const ANGLE_JITTER_SEED = 11.17;

/**
 * Per-asset fix for GLB orientation (Y-up vs Z-up, etc.).
 * If the mountain lies flat or upside down, try `new THREE.Euler(-Math.PI / 2, 0, 0)` or flip Y.
 */
const MODEL_UP_FIX = new THREE.Euler(0, 0, 0);

/** Slight embed into floor / seabed to hide gaps. */
const BASE_SINK_INTO_GROUND = 0.42;

/** Extra yaw added to “face playfield” heuristic (mesh forward axis varies by asset). */
const FACE_CENTER_YAW_BIAS = 0.08;

/** +50% contrast on the base colour `map` (per channel, pivoted at 0.5 in 8-bit space). */
const MOUNTAIN_MAP_CONTRAST = 1.5;

/** Approx. −25% “exposure” on diffuse: scales `material.color` (diffuse is `map × color`). */
const MOUNTAIN_EXPOSURE_COLOR_SCALE = 0.75;

const mountainContrastedMapCache = new Map<string, THREE.Texture>();

function isDrawableMapImage(image: unknown): image is CanvasImageSource {
  if (!image) {
    return false;
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return true;
  }
  if (image instanceof HTMLCanvasElement) {
    return true;
  }
  if (image instanceof HTMLVideoElement) {
    return image.readyState >= 2;
  }
  if (image instanceof HTMLImageElement) {
    return image.complete && image.naturalWidth > 0;
  }
  return false;
}

function drawableWH(image: CanvasImageSource): { w: number; h: number } {
  if (image instanceof HTMLVideoElement) {
    return {
      w: Math.max(image.videoWidth || image.width, 1),
      h: Math.max(image.videoHeight || image.height, 1),
    };
  }
  if (image instanceof HTMLImageElement) {
    return { w: Math.max(image.naturalWidth, 1), h: Math.max(image.naturalHeight, 1) };
  }
  if (image instanceof HTMLCanvasElement) {
    return { w: Math.max(image.width, 1), h: Math.max(image.height, 1) };
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return { w: Math.max(image.width, 1), h: Math.max(image.height, 1) };
  }
  return { w: 1, h: 1 };
}

function copyTexSampling(to: THREE.Texture, from: THREE.Texture): void {
  to.wrapS = from.wrapS;
  to.wrapT = from.wrapT;
  to.repeat.copy(from.repeat);
  to.offset.copy(from.offset);
  to.center.copy(from.center);
  to.rotation = from.rotation;
  to.flipY = from.flipY;
  to.anisotropy = from.anisotropy;
}

/**
 * Builds a new RGB texture with contrast applied; does not mutate the source texture image.
 */
function tryBuildContrastedMountainMap(source: THREE.Texture): THREE.Texture | null {
  const img = source.image;
  if (!isDrawableMapImage(img)) {
    return null;
  }
  const { w, h } = drawableWH(img);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const c = MOUNTAIN_MAP_CONTRAST;
  for (let i = 0; i < px.length; i += 4) {
    for (let ch = 0; ch < 3; ch += 1) {
      const v = px[i + ch]! / 255;
      const o = (v - 0.5) * c + 0.5;
      px[i + ch] = Math.round(THREE.MathUtils.clamp(o, 0, 1) * 255);
    }
  }
  ctx.putImageData(data, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  copyTexSampling(tex, source);
  tex.needsUpdate = true;
  return tex;
}

function getContrastedMountainMap(source: THREE.Texture): THREE.Texture | null {
  const cached = mountainContrastedMapCache.get(source.uuid);
  if (cached) {
    return cached;
  }
  const built = tryBuildContrastedMountainMap(source);
  if (built) {
    mountainContrastedMapCache.set(source.uuid, built);
  }
  return built;
}

const MOUNTAIN_UD_EXPOSURE = '__mountainExposureScaled';
const MOUNTAIN_UD_MAP_DONE = '__mountainMapContrasted';
const MOUNTAIN_UD_DIFFUSE_ONLY = '__mountainDiffuseOnly';

function stripMountainEmissive(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.emissive && m.emissive instanceof THREE.Color) {
    m.emissive.setRGB(0, 0, 0);
  }
  if (typeof m.emissiveIntensity === 'number') {
    m.emissiveIntensity = 0;
  }
  if ('emissiveMap' in m) {
    m.emissiveMap = null;
  }
}

/**
 * Stronger colormap separation + slightly lower diffuse level (does not change global post exposure).
 * Emissive is stripped so lighting is diffuse-only (snow/detail must live in `map`).
 */
function tuneMountainDiffuseLook(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      const m = mat as THREE.MeshStandardMaterial & {
        userData: Record<string, unknown>;
      };
      if (!m.userData[MOUNTAIN_UD_DIFFUSE_ONLY]) {
        stripMountainEmissive(m);
        m.userData[MOUNTAIN_UD_DIFFUSE_ONLY] = true;
      }
      if (!m.color) {
        continue;
      }
      if (!m.userData[MOUNTAIN_UD_EXPOSURE]) {
        m.color.multiplyScalar(MOUNTAIN_EXPOSURE_COLOR_SCALE);
        m.userData[MOUNTAIN_UD_EXPOSURE] = true;
      }
      if (!m.userData[MOUNTAIN_UD_MAP_DONE] && m.map) {
        const contrasted = getContrastedMountainMap(m.map);
        if (contrasted) {
          m.map = contrasted;
          m.userData[MOUNTAIN_UD_MAP_DONE] = true;
        }
      }
      m.needsUpdate = true;
    }
  });
}

function applyMountainShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      /** Large props with odd pivots can disappear from frustum tests at grazing angles. */
      mesh.frustumCulled = false;
    }
  });
}

function normalizeMountainToGround(model: THREE.Object3D, targetMaxExtent: number, sinkY: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(targetMaxExtent / maxDim);

  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.sub(center);

  model.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(model);
  model.position.y -= box3.min.y;
  model.position.y -= sinkY;
}

/** Re-seat lowest point after non-uniform scale (keeps mesh embedded in ground). */
function snapMountainFeetToLocalGround(model: THREE.Object3D, sinkY: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }
  model.position.y -= box.min.y;
  model.position.y -= sinkY;
}

function angleJitter(i: number): number {
  const t = Math.sin(i * 19.231 + ANGLE_JITTER_SEED) * 43758.5453123;
  const f = t - Math.floor(t);
  return (f - 0.5) * 0.22;
}

/**
 * Several clones of `low_poly_mountains.glb` on a wide orbit **outside** instanced backdrop cubes.
 * Base colour map: +50% contrast; diffuse level: `color × 0.75` (−25%). Emissive cleared (diffuse-only).
 * Loaded asynchronously; safe if the file is missing (console warning).
 */
export class MountainBackdropProp {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();

  constructor(parent: THREE.Object3D) {
    this.root.name = 'MountainBackdrop';
    parent.add(this.root);
  }

  load(): void {
    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const { centerX, centerZ, farOuterR } = getBackdropFarFrameMetrics();
        const orbitR = farOuterR + ORBIT_MARGIN_BEYOND_BACKDROP;

        const n = MOUNTAIN_RING_COUNT;
        const baseAngle = -Math.PI / 2;
        const spawnHint = RESPAWN_ANCHORS[0]!;
        const spawnX = spawnHint.x;
        const spawnZ = spawnHint.z;

        const ringAngles: number[] = [];
        for (let i = 0; i < n; i += 1) {
          ringAngles.push(baseAngle + (i * Math.PI * 2) / n + angleJitter(i));
        }

        let nearestSpawnIdx = 0;
        let nearestSpawnDistSq = Infinity;
        for (let i = 0; i < n; i += 1) {
          const a = ringAngles[i]!;
          const cx = centerX + Math.cos(a) * orbitR;
          const cz = centerZ + Math.sin(a) * orbitR;
          const dx = cx - spawnX;
          const dz = cz - spawnZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < nearestSpawnDistSq) {
            nearestSpawnDistSq = d2;
            nearestSpawnIdx = i;
          }
        }

        for (let i = 0; i < n; i += 1) {
          const mountain = gltf.scene.clone(true);
          mountain.name = `LowPolyMountains_${i}`;
          mountain.rotation.copy(MODEL_UP_FIX);

          const sizeMul = SIZE_MULTIPLIERS[i % SIZE_MULTIPLIERS.length] ?? 1;
          normalizeMountainToGround(
            mountain,
            BASE_TARGET_MAX_EXTENT * sizeMul,
            BASE_SINK_INTO_GROUND,
          );
          mountain.scale.multiplyScalar(MOUNTAIN_MESH_UNIFORM_SCALE);
          mountain.scale.y *= MOUNTAIN_MESH_HEIGHT_SCALE;
          snapMountainFeetToLocalGround(mountain, BASE_SINK_INTO_GROUND);
          applyMountainShadowFlags(mountain);
          tuneMountainDiffuseLook(mountain);
          requestAnimationFrame(() => tuneMountainDiffuseLook(mountain));

          const angle = ringAngles[i]!;
          const r = orbitR + (i === nearestSpawnIdx ? SPAWN_NEAREST_EXTRA_MARGIN : 0);
          const cx = centerX + Math.cos(angle) * r;
          const cz = centerZ + Math.sin(angle) * r;

          const pivot = new THREE.Group();
          pivot.name = `MountainPivot_${i}`;
          pivot.position.set(cx, WORLD_FLOOR_Y, cz);
          pivot.rotation.y = Math.atan2(centerX - cx, centerZ - cz) + FACE_CENTER_YAW_BIAS;
          pivot.add(mountain);
          this.root.add(pivot);
        }
      },
      undefined,
      () => {
        console.warn('[MountainBackdropProp] Missing or invalid', MODEL_URL);
      },
    );
  }
}
