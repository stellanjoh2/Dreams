import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WORLD_FLOOR_Y } from '../config/defaults';
import { getBackdropFarFrameMetrics } from './DistantWorldBackdrop';
import { BLOCK_UNIT, RESPAWN_ANCHORS } from './TerrainLayout';
import {
  MOUNTAIN_BASE_TARGET_EXTENT,
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

/** Linear albedo/emissive scale — 0.5 = 50% darker vs authored GLB. */
const MOUNTAIN_ALBEDO_DARKEN = 0.5;

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

function tuneMountainMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      const m = mat as THREE.Material & {
        opacity?: number;
        transparent?: boolean;
        depthWrite?: boolean;
        depthTest?: boolean;
      };
      if (m.opacity !== undefined && m.opacity < 0.99) {
        continue;
      }
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.depthTest = true;

      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.color.multiplyScalar(MOUNTAIN_ALBEDO_DARKEN);
        mat.emissive.multiplyScalar(MOUNTAIN_ALBEDO_DARKEN);
        if (typeof mat.emissiveIntensity === 'number') {
          mat.emissiveIntensity *= MOUNTAIN_ALBEDO_DARKEN;
        }
      } else if (
        mat instanceof THREE.MeshLambertMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshBasicMaterial ||
        mat instanceof THREE.MeshToonMaterial
      ) {
        mat.color.multiplyScalar(MOUNTAIN_ALBEDO_DARKEN);
        if ('emissive' in mat && mat.emissive instanceof THREE.Color) {
          mat.emissive.multiplyScalar(MOUNTAIN_ALBEDO_DARKEN);
        }
        if ('emissiveIntensity' in mat && typeof mat.emissiveIntensity === 'number') {
          mat.emissiveIntensity *= MOUNTAIN_ALBEDO_DARKEN;
        }
      }

      m.needsUpdate = true;
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

function angleJitter(i: number): number {
  const t = Math.sin(i * 19.231 + ANGLE_JITTER_SEED) * 43758.5453123;
  const f = t - Math.floor(t);
  return (f - 0.5) * 0.22;
}

/**
 * Several clones of `low_poly_mountains.glb` on a wide orbit **outside** instanced backdrop cubes.
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
          applyMountainShadowFlags(mountain);
          tuneMountainMaterials(mountain);

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
