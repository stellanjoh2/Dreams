import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WATER_SURFACE_Y } from '../config/defaults';
import { BLOCK_UNIT, PLATFORM_TILES } from './TerrainLayout';

import { publicUrl } from '../config/publicUrl';

const CLOUD_PACK_URL = publicUrl('assets/stylized_clouds_pack_vol_01.glb');

/** Few large masses — not dozens of tiny puffs on the ring. */
const CLOUD_COUNT = 7;

/** Ring radii in world units (around playfield center, XZ). Wider spread = less overlap. */
const RING_INNER = BLOCK_UNIT * 26;
const RING_OUTER = BLOCK_UNIT * 68;

/** Keep orbit inside this margin **beyond** platform bounds so clouds rarely sit on top of the player. */
const ORBIT_CLEARANCE_BEYOND_PLAYFIELD = BLOCK_UNIT * 28;

/**
 * Vertical band above highest platform top — kept **high** so ring clouds clear bg mountain silhouettes
 * (same XZ orbit as before; altitude was raised vs the pre-mountain era).
 */
const HEIGHT_MIN_ABOVE_TOP = BLOCK_UNIT * 46;
const HEIGHT_MAX_ABOVE_TOP = BLOCK_UNIT * 74;

/** After normalization each cloud is roughly this big (world units, max axis). */
const CLOUD_TARGET_SIZE = BLOCK_UNIT * 22;

/**
 * Only meshes at least this large in world space (before bake) become templates — drops filler
 * “dust” that made swarms of micro-clusters.
 */
const MIN_SIGNIFICANT_MESH_DIM = BLOCK_UNIT * 1.35;

/** At most this many distinct shapes from the pack (largest by world AABB first). */
const MAX_CLOUD_SHAPES = 10;

/** Orbit speed (rad/s); positive = counter-clockwise when viewed from +Y. */
const ORBIT_SPEED = 0.038;

/**
 * Per-instance scale: 1× baseline, up to ~this mult for a few larger “hero” clouds (upward-only).
 */
const CLOUD_SCALE_MAX_MULT = 1.92;

/** Tiny vertical bob on top of orbit height (scaled with cloud size). */
const BOB_AMPLITUDE = BLOCK_UNIT * 0.96;

/** Slightly dim albedo so AO crevices read softer; emissive lift adds a flat glow that fills dark patches. */
const CLOUD_ALBEDO_AFTER_PRIOR_LIFT = 0.87 + (1 - 0.87) * 0.25;
/** +50% brighter vs prior: move halfway again from current dim toward full albedo. */
const CLOUD_ALBEDO_DIM = CLOUD_ALBEDO_AFTER_PRIOR_LIFT + (1 - CLOUD_ALBEDO_AFTER_PRIOR_LIFT) * 0.5;
/** Emissive = this fraction × **original** albedo color (before dim); +50% vs prior (`0.085 × 1.25 × 1.5`). */
const CLOUD_EMISSIVE_FROM_ALBEDO = 0.085 * 1.25 * 1.5;
const BOB_SPEED = 0.18;

/** Smooth turn toward playfield focal point (higher = snappier). */
const TURN_SMOOTH = 5.2;

const _lookAtTarget = new THREE.Vector3();
const _lookAtDummy = new THREE.Object3D();

export type OrbitalCloud = {
  root: THREE.Object3D;
  radius: number;
  angle: number;
  angularSpeed: number;
  baseHeight: number;
  bobPhase: number;
};

function playfieldCenterAndHalfExtent(): { cx: number; cz: number; halfExtent: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of PLATFORM_TILES) {
    const hx = t.width * 0.5;
    const hz = t.depth * 0.5;
    minX = Math.min(minX, t.x - hx);
    maxX = Math.max(maxX, t.x + hx);
    minZ = Math.min(minZ, t.z - hz);
    maxZ = Math.max(maxZ, t.z + hz);
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const halfExtent = Math.max(maxX - minX, maxZ - minZ) * 0.5;
  return { cx, cz, halfExtent };
}

function highestPlatformTopY(): number {
  let maxY = -Infinity;
  for (const t of PLATFORM_TILES) {
    maxY = Math.max(maxY, t.topY);
  }
  return maxY;
}

function cloneMaterialDeep(m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  return Array.isArray(m) ? m.map((x) => x.clone()) : m.clone();
}

function getMeshWorldMaxDimension(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z, 1e-6);
}

/**
 * One mesh → centered pivot, world transform baked into vertices.
 */
function meshToCenteredTemplate(mesh: THREE.Mesh): THREE.Group | null {
  mesh.updateWorldMatrix(true, false);

  const src = mesh.geometry;
  if (!(src instanceof THREE.BufferGeometry) || !src.getAttribute('position')) {
    return null;
  }

  const geom = src.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) {
    geom.dispose();
    return null;
  }

  const size = bb.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  if (maxDim < 1e-5) {
    geom.dispose();
    return null;
  }

  const center = bb.getCenter(new THREE.Vector3());
  geom.translate(-center.x, -center.y, -center.z);

  const outMesh = new THREE.Mesh(geom, cloneMaterialDeep(mesh.material));
  outMesh.name = mesh.name ? `Cloud_${mesh.name}` : 'CloudMesh';

  const root = new THREE.Group();
  root.name = `Tpl_${mesh.name || 'cloud'}`;
  root.add(outMesh);
  return root;
}

/**
 * Use only the **largest** meshes in the file as templates so orbit picks big shapes, not micro-puffs.
 */
function extractLargeCloudTemplates(scene: THREE.Object3D): THREE.Object3D[] {
  scene.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      return;
    }
    if (node instanceof THREE.Mesh && node.geometry) {
      meshes.push(node);
    }
  });

  const sized = meshes.map((m) => ({
    mesh: m,
    maxDim: getMeshWorldMaxDimension(m),
  }));

  sized.sort((a, b) => b.maxDim - a.maxDim);

  const significant = sized.filter((x) => x.maxDim >= MIN_SIGNIFICANT_MESH_DIM).slice(0, MAX_CLOUD_SHAPES);

  const templates: THREE.Object3D[] = [];
  for (const { mesh } of significant) {
    const root = meshToCenteredTemplate(mesh);
    if (root) {
      prepareCloudGraph(root);
      templates.push(root);
    }
  }

  if (templates.length === 0) {
    const relaxed = sized.slice(0, Math.min(6, sized.length));
    for (const { mesh } of relaxed) {
      const root = meshToCenteredTemplate(mesh);
      if (root) {
        prepareCloudGraph(root);
        templates.push(root);
      }
    }
  }

  if (templates.length === 0) {
    for (const child of scene.children) {
      const c = child.clone(true);
      c.name = `CloudFallback_${child.name}`;
      prepareCloudGraph(c);
      templates.push(c);
    }
  }

  return templates;
}

function normalizeTemplateToOrigin(obj: THREE.Object3D, targetMaxDim: number): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const s = targetMaxDim / maxDim;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const center = b2.getCenter(new THREE.Vector3());
  obj.position.sub(center);
}

function tuneCloudMaterial(mat: THREE.Material): void {
  const isStd = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial;
  const isPhong = mat instanceof THREE.MeshPhongMaterial;
  const isLambert = mat instanceof THREE.MeshLambertMaterial;
  if (!isStd && !isPhong && !isLambert) {
    return;
  }

  const m = mat as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshLambertMaterial;
  const preDim = m.color.clone();
  m.color.multiplyScalar(CLOUD_ALBEDO_DIM);
  m.emissive.copy(preDim).multiplyScalar(CLOUD_EMISSIVE_FROM_ALBEDO);
  m.emissiveIntensity = 1;

  if (isStd) {
    const std = mat as THREE.MeshStandardMaterial;
    std.metalness = 0;
    std.roughness = 1;
    std.envMapIntensity = 0;
    if (mat instanceof THREE.MeshPhysicalMaterial) {
      const phys = mat;
      phys.specularIntensity = 0;
      phys.specularIntensityMap = null;
      phys.clearcoat = 0;
      phys.clearcoatMap = null;
      phys.sheen = 0;
      phys.sheenRoughness = 1;
      phys.iridescence = 0;
      phys.transmission = 0;
    }
  }
  if (isPhong) {
    const ph = mat as THREE.MeshPhongMaterial;
    ph.specular.setRGB(0, 0, 0);
    ph.shininess = 0;
  }

  mat.needsUpdate = true;
}

function prepareCloudGraph(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const m = node as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        tuneCloudMaterial(mat);
      }
    }
  });
}

function rnd(seed: number): number {
  const t = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return t - Math.floor(t);
}

/**
 * Load GLB and build orbital cloud instances. Caller adds `group` to the scene.
 */
export async function buildStylizedCloudRing(
  loader: GLTFLoader,
): Promise<{ group: THREE.Group; clouds: OrbitalCloud[] }> {
  const group = new THREE.Group();
  group.name = 'StylizedCloudRing';

  const gltf = await new Promise<{
    scene: THREE.Group;
  }>((resolve, reject) => {
    loader.load(CLOUD_PACK_URL, resolve, undefined, reject);
  });

  const rawTemplates = extractLargeCloudTemplates(gltf.scene);
  const prepared: THREE.Object3D[] = rawTemplates.map((t, i) => {
    const root = t.clone(true);
    root.name = `CloudTemplate_${i}`;
    normalizeTemplateToOrigin(root, CLOUD_TARGET_SIZE * (0.92 + rnd(i * 17) * 0.14));
    prepareCloudGraph(root);
    return root;
  });

  const { cx, cz, halfExtent } = playfieldCenterAndHalfExtent();
  const inner = Math.max(RING_INNER, halfExtent + ORBIT_CLEARANCE_BEYOND_PLAYFIELD);
  const outer = Math.max(RING_OUTER, inner + BLOCK_UNIT * 22);
  const floorY = highestPlatformTopY();

  const clouds: OrbitalCloud[] = [];

  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    const template = prepared[Math.floor(rnd(i * 7919) * prepared.length)]!;
    const instance = template.clone(true);
    instance.name = `StylizedCloud_${i}`;

    // Evenly stagger around the ring + jitter so clouds don’t bunch in one arc.
    const slot = (i + 0.5) / CLOUD_COUNT;
    const angle = slot * Math.PI * 2 + (rnd(i * 1103 + 5) - 0.5) * 0.55;
    const radiusBand = inner + (0.35 + 0.6 * rnd(i * 503 + 2)) * (outer - inner);
    const radius = radiusBand;

    // High band clears mountain silhouettes; blend mostly toward `bandY` (not down to water).
    const bandLow = floorY + HEIGHT_MIN_ABOVE_TOP;
    const bandHigh = floorY + HEIGHT_MAX_ABOVE_TOP;
    const bandY = bandLow + rnd(i * 2203 + 7) * (bandHigh - bandLow);
    const baseHeight = WATER_SURFACE_Y + 0.82 * (bandY - WATER_SURFACE_Y);
    // Upward-only scale variance; square bias → mostly ~1×, occasional big masses.
    const up = rnd(i * 3301 + 11);
    const scaleMult = 1 + up * up * (CLOUD_SCALE_MAX_MULT - 1);
    instance.scale.multiplyScalar(scaleMult);
    instance.quaternion.identity();

    group.add(instance);

    clouds.push({
      root: instance,
      radius,
      angle,
      angularSpeed: ORBIT_SPEED * (0.88 + rnd(i * 5501 + 17) * 0.22),
      baseHeight,
      bobPhase: rnd(i * 6607 + 19) * Math.PI * 2,
    });
  }

  group.userData.cloudOrbitCX = cx;
  group.userData.cloudOrbitCZ = cz;
  /** Focal Y between water and highest walkable top so clouds tilt toward the play volume. */
  group.userData.cloudLookAtY = (WATER_SURFACE_Y + floorY) * 0.5;

  return { group, clouds };
}

export function updateStylizedCloudRing(clouds: OrbitalCloud[], group: THREE.Group, delta: number, elapsed: number): void {
  const cx = (group.userData.cloudOrbitCX as number) ?? 0;
  const cz = (group.userData.cloudOrbitCZ as number) ?? 0;
  const lookAtY = (group.userData.cloudLookAtY as number) ?? 0;
  const turnT = 1 - Math.exp(-TURN_SMOOTH * delta);

  for (const c of clouds) {
    c.angle += c.angularSpeed * delta;
    const bob = Math.sin(elapsed * BOB_SPEED + c.bobPhase) * BOB_AMPLITUDE;
    c.root.position.set(
      cx + Math.cos(c.angle) * c.radius,
      c.baseHeight + bob,
      cz + Math.sin(c.angle) * c.radius,
    );

    _lookAtTarget.set(cx, lookAtY, cz);
    _lookAtDummy.position.copy(c.root.position);
    _lookAtDummy.quaternion.identity();
    _lookAtDummy.lookAt(_lookAtTarget);
    c.root.quaternion.slerp(_lookAtDummy.quaternion, turnT);
  }
}
