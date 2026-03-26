import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WATER_SURFACE_Y } from '../config/defaults';
import { publicUrl } from '../config/publicUrl';
import { BLOCK_UNIT, PLATFORM_SURFACE_TILES } from './TerrainLayout';
import { FISHING_BOAT_PLACEMENT_LEFT, FISHING_BOAT_PLACEMENT_RIGHT } from './FishingBoatProp';

const MODEL_URL = publicUrl('assets/stylized_grass_8/stylized_grass.glb');

/** Spawn hub + first connector only — skip midline / west / north / etc. so reeds don’t line open ocean. */
const GRASS_SCATTER_ISLAND_IDS = new Set(['south-west', 'south-central']);

/** Horizontal footprint scale (XZ). */
const CLUMP_SCALE = 2.5;

/** XZ radius: half clump + gap (~1.5–2u extra vs prior) so barrels stay clearly outside reed meshes. */
export const WATER_GRASS_BARREL_CLEARANCE_RADIUS = CLUMP_SCALE * 0.56 + 2.78;

/** Vertical stretch vs `CLUMP_SCALE` (2× base, +25% = 2.5). */
const HEIGHT_Y_MULT = 2.5;

/**
 * Portion of clump height above the water plane (rest submerged).
 */
const ABOVE_WATER_HEIGHT_FRAC = 0.375;

/** Target clumps around the platform perimeter (greedy placement with min spacing). */
const TARGET_COUNT = 34;

const MIN_PEER_DIST_SQ = (BLOCK_UNIT * 0.58) ** 2;

/** Keep reeds out of the fishing boat hull footprint (world XZ). */
const BOAT_EXCLUSION_R_SQ = 11.5 ** 2;

const GRASS_RENDER_ORDER = 18;

const _dummy = new THREE.Object3D();

function rnd(seed: number): number {
  const t = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return t - Math.floor(t);
}

function hasSkinnedDescendant(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((c) => {
    if ((c as THREE.SkinnedMesh).isSkinnedMesh) {
      found = true;
    }
  });
  return found;
}

function tuneGrassMaterial(material: THREE.Material): void {
  material.side = THREE.DoubleSide;
  material.depthTest = true;
  material.needsUpdate = true;
}

/**
 * Single merged geometry in root space + one material (instancing).
 * Skipped if the asset is rigged or has no static meshes.
 */
function buildMergedGrassMeshData(
  root: THREE.Object3D,
): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  if (hasSkinnedDescendant(root)) {
    return null;
  }

  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
      meshes.push(m);
    }
  });

  if (meshes.length === 0) {
    return null;
  }

  const geometries = meshes.map((mesh) => {
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    return g;
  });

  const merged = mergeGeometries(geometries);
  for (const g of geometries) {
    g.dispose();
  }

  if (!merged) {
    return null;
  }

  const src = meshes[0].material;
  const material = (Array.isArray(src) ? src[0] : src).clone();
  tuneGrassMaterial(material);

  return { geometry: merged, material };
}

type GrassSpot = { x: number; z: number; yaw: number };

/** Grass under a platform’s XZ footprint is rarely visible (hidden from normal angles). */
export function isUnderAnyPlatformFootprint(x: number, z: number): boolean {
  const pad = BLOCK_UNIT * 0.04;
  for (const tile of PLATFORM_SURFACE_TILES) {
    const hx = tile.width * 0.5 + pad;
    const hz = tile.depth * 0.5 + pad;
    if (Math.abs(x - tile.x) <= hx && Math.abs(z - tile.z) <= hz) {
      return true;
    }
  }
  return false;
}

export function boatExclusionDistSqFromShore(x: number, z: number): number {
  const d0 =
    (x - FISHING_BOAT_PLACEMENT_RIGHT.worldX) ** 2 + (z - FISHING_BOAT_PLACEMENT_RIGHT.worldZ) ** 2;
  const d1 =
    (x - FISHING_BOAT_PLACEMENT_LEFT.worldX) ** 2 + (z - FISHING_BOAT_PLACEMENT_LEFT.worldZ) ** 2;
  return Math.min(d0, d1);
}

function collectShuffledEdgeCandidates(
  islandIds: Set<string>,
  outwardMin: number,
  outwardMax: number,
  saltBase: number,
): GrassSpot[] {
  const candidates: GrassSpot[] = [];
  let salt = saltBase;

  for (const tile of PLATFORM_SURFACE_TILES) {
    if (!islandIds.has(tile.islandId)) {
      continue;
    }
    const hx = tile.width * 0.5;
    const hz = tile.depth * 0.5;
    const { x: cx, z: cz } = tile;

    const pushEdge = (kind: 'L' | 'R' | 'F' | 'B') => {
      const out = outwardMin + rnd(salt++) * (outwardMax - outwardMin);
      const along = rnd(salt++);
      let px = cx;
      let pz = cz;
      if (kind === 'L') {
        px = cx - hx - out;
        pz = cz - hz + along * tile.depth;
      } else if (kind === 'R') {
        px = cx + hx + out;
        pz = cz - hz + along * tile.depth;
      } else if (kind === 'F') {
        pz = cz - hz - out;
        px = cx - hx + along * tile.width;
      } else {
        pz = cz + hz + out;
        px = cx - hx + along * tile.width;
      }
      const yaw = rnd(salt++) * Math.PI * 2;
      candidates.push({ x: px, z: pz, yaw });
    };

    if (tile.exposedLeft) {
      pushEdge('L');
    }
    if (tile.exposedRight) {
      pushEdge('R');
    }
    if (tile.exposedFront) {
      pushEdge('F');
    }
    if (tile.exposedBack) {
      pushEdge('B');
    }
  }

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd(salt + i * 17) * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates;
}

function collectShuffledCandidates(): GrassSpot[] {
  return collectShuffledEdgeCandidates(
    GRASS_SCATTER_ISLAND_IDS,
    BLOCK_UNIT * -0.18,
    BLOCK_UNIT * 0.62,
    0,
  );
}

const BARREL_CANDIDATE_ISLAND_IDS = new Set(['south-west', 'south-central', 'midline']);

/**
 * Shore-adjacent XZ samples farther into open water than reed scatter — for props that need grass / tile clearance.
 */
export function collectBarrelShoreCandidateSpots(): ReadonlyArray<{ x: number; z: number }> {
  return collectShuffledEdgeCandidates(
    BARREL_CANDIDATE_ISLAND_IDS,
    BLOCK_UNIT * 1.45,
    BLOCK_UNIT * 3.85,
    88_301,
  );
}

function pickSpots(): GrassSpot[] {
  const candidates = collectShuffledCandidates();
  const chosen: GrassSpot[] = [];

  for (const c of candidates) {
    if (isUnderAnyPlatformFootprint(c.x, c.z)) {
      continue;
    }
    if (boatExclusionDistSqFromShore(c.x, c.z) < BOAT_EXCLUSION_R_SQ) {
      continue;
    }
    let ok = true;
    for (const p of chosen) {
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      if (dx * dx + dz * dz < MIN_PEER_DIST_SQ) {
        ok = false;
        break;
      }
    }
    if (ok) {
      chosen.push(c);
      if (chosen.length >= TARGET_COUNT) {
        break;
      }
    }
  }

  return chosen;
}

/** Same XZ as each shore grass instance (deterministic; safe before GLB load). */
export function getShoreGrassWorldSpots(): ReadonlyArray<{ x: number; z: number }> {
  return pickSpots();
}

/**
 * Waterline grass: one {@link THREE.InstancedMesh} (merged GLB), **2×** height on Y vs XZ scale.
 */
export class WaterEdgeGrassScatter {
  readonly root = new THREE.Group();

  private readonly loader: GLTFLoader;

  constructor(parent: THREE.Object3D, loader: GLTFLoader) {
    this.loader = loader;
    this.root.name = 'WaterEdgeGrassScatter';
    this.root.frustumCulled = false;
    parent.add(this.root);
  }

  load(): Promise<void> {
    const spots = pickSpots();

    return new Promise((resolve) => {
      this.loader.load(
        MODEL_URL,
        (gltf) => {
          const data = buildMergedGrassMeshData(gltf.scene);
          if (!data) {
            console.warn(
              '[WaterEdgeGrassScatter] Could not merge static meshes (skinned or empty) — no grass.',
            );
            resolve();
            return;
          }

          const { geometry, material } = data;
          const count = spots.length;
          if (count === 0) {
            geometry.dispose();
            material.dispose();
            resolve();
            return;
          }

          const sx = CLUMP_SCALE;
          const sy = CLUMP_SCALE * HEIGHT_Y_MULT;
          const sz = CLUMP_SCALE;

          const tmp = new THREE.Mesh(geometry, material);
          tmp.scale.set(sx, sy, sz);
          tmp.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(tmp);

          if (box.isEmpty()) {
            geometry.dispose();
            material.dispose();
            resolve();
            return;
          }

          const maxY = box.max.y;
          const h = box.max.y - box.min.y;
          const poke = ABOVE_WATER_HEIGHT_FRAC * h;
          const baseY = WATER_SURFACE_Y + poke - maxY;

          const instanced = new THREE.InstancedMesh(geometry, material, count);
          instanced.name = 'WaterGrass_Instanced';
          instanced.frustumCulled = false;
          instanced.castShadow = false;
          instanced.receiveShadow = false;
          instanced.renderOrder = GRASS_RENDER_ORDER;

          for (let i = 0; i < count; i += 1) {
            const spot = spots[i];
            _dummy.position.set(spot.x, baseY, spot.z);
            _dummy.rotation.set(0, spot.yaw, 0);
            _dummy.scale.set(sx, sy, sz);
            _dummy.updateMatrix();
            instanced.setMatrixAt(i, _dummy.matrix);
          }
          instanced.instanceMatrix.needsUpdate = true;

          this.root.add(instanced);
          resolve();
        },
        undefined,
        () => {
          console.warn('[WaterEdgeGrassScatter] Missing or invalid', MODEL_URL);
          resolve();
        },
      );
    });
  }
}
