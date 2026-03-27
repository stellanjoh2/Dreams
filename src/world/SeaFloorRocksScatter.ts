import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SEA_BED_SURFACE_Y, WATER_SURFACE_Y } from '../config/defaults';
import { publicUrl } from '../config/publicUrl';
import {
  FISHING_BOAT_PLACEMENT_LEFT,
  FISHING_BOAT_PLACEMENT_RIGHT,
} from './FishingBoatProp';
import { PLATFORM_CLUSTERS } from './TerrainLayout';
import { getSeaBedRadiusWorld } from './worldHorizon';

const MODEL_URL = publicUrl('assets/free_pack_rocks_stylized.glb');

/** Total instanced rocks across all variants (each variant is its own InstancedMesh). */
/** 75% of prior 58 ≈ 25% fewer instances. */
const TOTAL_INSTANCES = 43;
/** Skip the heaviest mesh in the pack (~4k verts) to keep GPU cost sane. */
const MAX_TEMPLATE_VERTS = 2200;
/** Longest axis after normalization (meters). */
const TARGET_MAX_EXTENT = 2.05 * 1.25 * 1.25;
/** Min radius from world origin — small hole only; rocks sit in water near platforms. */
const R_INNER = 5.5;
/** Don’t push scatter to the far rim of the sea disk; keep near the main play volume. */
const R_OUTER_CAP = 76;
/** Only clear the boat pivot — rings around hull can hold rocks. */
const BOAT_EXCLUSION_R = 3.35;
/** Most samples land in disks around hubs + boats; rest fill the mid annulus. */
const FOCAL_SAMPLE_FRACTION = 0.88;

type FocalDisk = { cx: number; cz: number; radius: number; weight: number };

function averageClusterWorldXZ(clusterIds: readonly string[]): { cx: number; cz: number } | null {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const id of clusterIds) {
    const c = PLATFORM_CLUSTERS.find((cl) => cl.id === id);
    if (c) {
      sx += c.x;
      sz += c.z;
      n += 1;
    }
  }
  if (n === 0) {
    return null;
  }
  return { cx: sx / n, cz: sz / n };
}

function buildRockFocalDisks(): FocalDisk[] {
  const disks: FocalDisk[] = [];

  const sw = averageClusterWorldXZ(['spawn-a', 'spawn-c', 'spawn-f', 'spawn-b', 'spawn-e', 'spawn-d']);
  if (sw) {
    disks.push({ ...sw, radius: 27, weight: 1.2 });
  }

  const mid = averageClusterWorldXZ(['mid-b', 'mid-a', 'mid-c']);
  if (mid) {
    disks.push({ ...mid, radius: 24, weight: 1.05 });
  }

  const south = averageClusterWorldXZ(['south-a', 'south-b', 'south-c']);
  if (south) {
    disks.push({ ...south, radius: 30, weight: 1.25 });
  }

  disks.push(
    {
      cx: FISHING_BOAT_PLACEMENT_RIGHT.worldX,
      cz: FISHING_BOAT_PLACEMENT_RIGHT.worldZ,
      radius: 21,
      weight: 1.35,
    },
    {
      cx: FISHING_BOAT_PLACEMENT_LEFT.worldX,
      cz: FISHING_BOAT_PLACEMENT_LEFT.worldZ,
      radius: 21,
      weight: 1.35,
    },
  );

  return disks;
}

let cachedFocalDisks: FocalDisk[] | null = null;

function getRockFocalDisks(): FocalDisk[] {
  if (!cachedFocalDisks) {
    cachedFocalDisks = buildRockFocalDisks();
  }
  return cachedFocalDisks;
}

function pickWeightedFocal(rnd: () => number, disks: FocalDisk[]): FocalDisk {
  let sum = 0;
  for (const d of disks) {
    sum += d.weight;
  }
  let t = rnd() * sum;
  for (const d of disks) {
    t -= d.weight;
    if (t <= 0) {
      return d;
    }
  }
  return disks[disks.length - 1]!;
}

function samplePointInDisk(cx: number, cz: number, radius: number, rnd: () => number): { x: number; z: number } {
  const ang = rnd() * Math.PI * 2;
  const rr = Math.sqrt(rnd()) * radius;
  return { x: cx + Math.cos(ang) * rr, z: cz + Math.sin(ang) * rr };
}

const _dummy = new THREE.Object3D();
const _vec = new THREE.Vector3();
const _size = new THREE.Vector3();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * Skewed toward larger scales; a minority can grow tall enough to break the surface slightly
 * (mesh rests on seabed; local Y is up after yaw-only instance rotation).
 */
function sampleRockScale(rnd: () => number, geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) {
    return 0.9 + rnd() * 0.8;
  }
  const h = Math.max(box.max.y - box.min.y, 1e-4);
  const depth = Math.max(WATER_SURFACE_Y - SEA_BED_SURFACE_Y, 0.5);
  /** Scale where rock top ≈ surface (with small slice past). */
  const scaleForSurfaceBreak = (depth + 0.35) / h;

  const u = rnd();
  if (u < 0.12) {
    /** Rare “monoliths” — can poke through the water plane. */
    const target = scaleForSurfaceBreak * (0.88 + rnd() * 0.26);
    return THREE.MathUtils.clamp(target, 1.75, 4.75);
  }
  if (u < 0.38) {
    return 1.35 + rnd() * 1.25;
  }
  if (u < 0.72) {
    return 0.82 + rnd() * 0.95;
  }
  /** Long tail of medium-large pieces. */
  return 1.12 + rnd() * rnd() * 1.85;
}

function cloneRockMaterial(src: THREE.Material): THREE.Material {
  const darkenAlbedo = (c: THREE.Color): void => {
    c.multiplyScalar(0.68);
  };

  const std = src as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    const m = std.clone();
    darkenAlbedo(m.color);
    m.roughness = 0.94;
    m.metalness = 0.02;
    m.envMapIntensity = 0.14;
    m.needsUpdate = true;
    return m;
  }
  const ph = src as THREE.MeshPhongMaterial;
  if (ph.isMeshPhongMaterial) {
    const c = ph.color.clone();
    darkenAlbedo(c);
    return new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.94,
      metalness: 0.02,
      envMapIntensity: 0.14,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x4a433c,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.14,
  });
}

type RockTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

function bakeNormalizedTemplate(mesh: THREE.Mesh): RockTemplate | null {
  const posAttr = mesh.geometry.attributes.position;
  if (!posAttr || posAttr.count < 12 || posAttr.count > MAX_TEMPLATE_VERTS) {
    return null;
  }

  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) {
    geometry.dispose();
    return null;
  }

  box.getSize(_size);
  const span = Math.max(_size.x, _size.y, _size.z);
  if (span > 85) {
    geometry.scale(0.01, 0.01, 0.01);
    geometry.computeBoundingBox();
  }

  const b2 = geometry.boundingBox!;
  b2.getCenter(_vec);
  const liftY = b2.min.y;
  geometry.translate(-_vec.x, -liftY, -_vec.z);

  geometry.computeBoundingBox();
  geometry.boundingBox!.getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z, 1e-4);
  const s = TARGET_MAX_EXTENT / maxDim;
  geometry.scale(s, s, s);

  geometry.computeVertexNormals();

  return {
    geometry,
    material: cloneRockMaterial(
      Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material,
    ),
  };
}

function allocateCounts(variantCount: number, total: number): number[] {
  if (variantCount <= 0) {
    return [];
  }
  const base = Math.floor(total / variantCount);
  let rem = total - base * variantCount;
  const counts = Array.from({ length: variantCount }, () => base);
  for (let i = 0; rem > 0; rem -= 1, i += 1) {
    counts[i % variantCount] += 1;
  }
  return counts;
}

function pickSpot(
  rnd: () => number,
  rOuter: number,
  used: { x: number; z: number }[],
  minDistSq: number,
  focalDisks: FocalDisk[],
): { x: number; z: number } | null {
  for (let attempt = 0; attempt < 110; attempt += 1) {
    let x: number;
    let z: number;

    if (rnd() < FOCAL_SAMPLE_FRACTION && focalDisks.length > 0) {
      const disk = pickWeightedFocal(rnd, focalDisks);
      const p = samplePointInDisk(disk.cx, disk.cz, disk.radius, rnd);
      x = p.x;
      z = p.z;
    } else {
      const t = rnd();
      const u = rnd();
      const rIn2 = R_INNER * R_INNER;
      const rOut2 = rOuter * rOuter;
      const r = Math.sqrt(t * (rOut2 - rIn2) + rIn2);
      const ang = u * Math.PI * 2;
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r;
    }

    const distFromOrigin = Math.hypot(x, z);
    if (distFromOrigin > rOuter || distFromOrigin < 1.25) {
      continue;
    }

    if (
      distSq(x, z, FISHING_BOAT_PLACEMENT_RIGHT.worldX, FISHING_BOAT_PLACEMENT_RIGHT.worldZ) <
      BOAT_EXCLUSION_R * BOAT_EXCLUSION_R
    ) {
      continue;
    }
    if (
      distSq(x, z, FISHING_BOAT_PLACEMENT_LEFT.worldX, FISHING_BOAT_PLACEMENT_LEFT.worldZ) <
      BOAT_EXCLUSION_R * BOAT_EXCLUSION_R
    ) {
      continue;
    }

    let ok = true;
    for (const p of used) {
      if (distSq(x, z, p.x, p.z) < minDistSq) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { x, z };
    }
  }
  return null;
}

export class SeaFloorRocksScatter {
  private readonly root = new THREE.Group();

  constructor() {
    this.root.name = 'SeaFloorRocksScatter';
  }

  /**
   * Parent should be the terrain group (sea bed + water + tiles) so rocks draw after the sand disk.
   */
  load(loader: GLTFLoader, attachParent: THREE.Object3D): Promise<void> {
    const rOuter = Math.min(getSeaBedRadiusWorld() * 0.91, R_OUTER_CAP);

    return new Promise((resolve) => {
      if (!this.root.parent) {
        attachParent.add(this.root);
      }

      loader.load(
        MODEL_URL,
        (gltf) => {
          const meshes: THREE.Mesh[] = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((child) => {
            const m = child as THREE.Mesh;
            if (m.isMesh && m.name.includes('SM_Rocks')) {
              meshes.push(m);
            }
          });
          if (meshes.length === 0) {
            gltf.scene.traverse((child) => {
              const m = child as THREE.Mesh;
              if (m.isMesh) {
                meshes.push(m);
              }
            });
          }

          const templates: RockTemplate[] = [];
          for (const mesh of meshes) {
            const t = bakeNormalizedTemplate(mesh);
            if (t) {
              templates.push(t);
            }
          }

          if (templates.length === 0) {
            console.warn('[SeaFloorRocksScatter] No rock meshes under vertex budget —', MODEL_URL);
            resolve();
            return;
          }

          const rnd = mulberry32(0x5ea71c);
          const focalDisks = getRockFocalDisks();
          const counts = allocateCounts(templates.length, TOTAL_INSTANCES);
          const totalNeeded = counts.reduce((a, b) => a + b, 0);
          const used: { x: number; z: number }[] = [];
          const minDistSq = 2.85 * 2.85;

          type Spot = { x: number; z: number; yaw: number };
          const spots: Spot[] = [];
          for (let n = 0; n < totalNeeded; n += 1) {
            const flat = pickSpot(rnd, rOuter, used, minDistSq, focalDisks);
            if (!flat) {
              break;
            }
            used.push(flat);
            spots.push({
              x: flat.x,
              z: flat.z,
              yaw: rnd() * Math.PI * 2,
            });
          }

          let spotIndex = 0;
          for (let v = 0; v < templates.length; v += 1) {
            const { geometry, material } = templates[v]!;
            let count = counts[v] ?? 0;
            if (count <= 0) {
              geometry.dispose();
              material.dispose();
              continue;
            }

            const available = spots.length - spotIndex;
            count = Math.min(count, Math.max(0, available));
            if (count <= 0) {
              geometry.dispose();
              material.dispose();
              continue;
            }

            const instanced = new THREE.InstancedMesh(geometry, material, count);
            instanced.name = `SeaFloorRock_${v}`;
            /** Default culling uses a tight bound at origin until this runs — rocks were often skipped. */
            instanced.frustumCulled = false;
            instanced.castShadow = false;
            instanced.receiveShadow = true;
            instanced.renderOrder = 7;

            for (let i = 0; i < count; i += 1) {
              const sp = spots[spotIndex]!;
              spotIndex += 1;
              const scale = sampleRockScale(rnd, geometry);
              _dummy.position.set(sp.x, SEA_BED_SURFACE_Y + 0.012, sp.z);
              _dummy.rotation.set(0, sp.yaw, 0);
              _dummy.scale.setScalar(scale);
              _dummy.updateMatrix();
              instanced.setMatrixAt(i, _dummy.matrix);
            }
            instanced.instanceMatrix.needsUpdate = true;
            instanced.computeBoundingSphere();
            this.root.add(instanced);
          }

          resolve();
        },
        undefined,
        () => {
          console.warn('[SeaFloorRocksScatter] Failed to load', MODEL_URL);
          resolve();
        },
      );
    });
  }
}
