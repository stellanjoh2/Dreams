import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  BLOCK_UNIT,
  CRYSTAL_ANCHORS,
  JUMP_PADS,
  MOVING_ELEVATORS,
  PLATFORM_SURFACE_TILES,
} from './TerrainLayout';

const MODEL_URL = '/assets/butterflies.glb';

/** Well above platform top so wings/body clear plants and floor geometry. */
const FLOAT_Y_ABOVE_TOP = BLOCK_UNIT * 2.05;

/** Max dimension after fit (was 1.05; +50% scale). */
const TARGET_BUTTERFLY_EXTENT = 1.575;

const BUTTERFLY_COUNT = 13;

const MIN_DIST_CRYSTAL_SQ = 2.85 * 2.85;
const MIN_DIST_PEER_SQ = 1.55 * 1.55;
const JUMP_PAD_CLEAR = BLOCK_UNIT * 1.35;
const ELEVATOR_PAD = BLOCK_UNIT * 0.45;

type ButterflyInstance = {
  pivot: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  prevWx: number;
  prevWz: number;
};

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

/** Soft glow so butterflies read in shadow / distance without blowing out bloom. */
const BUTTERFLY_EMISSIVE_FROM_COLOR = 0.11;
const BUTTERFLY_EMISSIVE_INTENSITY = 0.42;

function tuneButterflyGraph(object: THREE.Object3D): void {
  object.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
    }
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const mat of mats) {
        if (
          mat instanceof THREE.MeshStandardMaterial ||
          mat instanceof THREE.MeshPhysicalMaterial ||
          mat instanceof THREE.MeshLambertMaterial ||
          mat instanceof THREE.MeshPhongMaterial
        ) {
          mat.emissive.copy(mat.color).multiplyScalar(BUTTERFLY_EMISSIVE_FROM_COLOR);
          mat.emissiveIntensity = BUTTERFLY_EMISSIVE_INTENSITY;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

function normalizeButterflyToFoot(obj: THREE.Object3D, targetMaxDim: number): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  obj.scale.setScalar(targetMaxDim / maxDim);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const center = b2.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -b2.min.y, -center.z);
}

function pickClip(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (clips.length === 0) {
    return null;
  }
  const scored = clips.map((c) => {
    const n = (c.name ?? '').toLowerCase();
    let score = 0;
    if (/fly|flutter|wing|flap|idle|hover/.test(n)) {
      score += 3;
    }
    if (/butter/.test(n)) {
      score += 1;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.c;
}

function startMixer(root: THREE.Object3D, clip: THREE.AnimationClip | null): THREE.AnimationMixer | null {
  if (!clip) {
    return null;
  }
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip, root);
  action.loop = THREE.LoopRepeat;
  action.clampWhenFinished = false;
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  return mixer;
}

function xzNearJumpPad(x: number, z: number): boolean {
  for (const p of JUMP_PADS) {
    const hx = p.width * 0.5 + JUMP_PAD_CLEAR;
    const hz = p.depth * 0.5 + JUMP_PAD_CLEAR;
    if (Math.abs(x - p.x) <= hx && Math.abs(z - p.z) <= hz) {
      return true;
    }
  }
  return false;
}

function xzOnMovingElevator(x: number, z: number): boolean {
  for (const e of MOVING_ELEVATORS) {
    const hx = e.width * 0.5 + ELEVATOR_PAD;
    const hz = e.depth * 0.5 + ELEVATOR_PAD;
    if (Math.abs(x - e.x) <= hx && Math.abs(z - e.z) <= hz) {
      return true;
    }
  }
  return false;
}

function xzNearCrystal(x: number, z: number): boolean {
  for (const c of CRYSTAL_ANCHORS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < MIN_DIST_CRYSTAL_SQ) {
      return true;
    }
  }
  return false;
}

function collectScatterPositions(): Array<{ x: number; y: number; z: number }> {
  const tiles = [...PLATFORM_SURFACE_TILES];
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd(i * 7919 + 101) * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }

  const placed: Array<{ x: number; y: number; z: number }> = [];
  let seed = 2203;

  outer: for (const tile of tiles) {
    if (placed.length >= BUTTERFLY_COUNT) {
      break;
    }
    const margin = Math.max(BLOCK_UNIT * 0.22, Math.min(tile.width, tile.depth) * 0.12);
    const halfW = tile.width * 0.5 - margin;
    const halfD = tile.depth * 0.5 - margin;
    if (halfW <= 0 || halfD <= 0) {
      continue;
    }

    for (let attempt = 0; attempt < 7; attempt += 1) {
      seed += 1;
      const x = tile.x + (rnd(seed) * 2 - 1) * halfW;
      const z = tile.z + (rnd(seed + 999) * 2 - 1) * halfD;
      const y = tile.topY + FLOAT_Y_ABOVE_TOP;

      if (xzNearJumpPad(x, z) || xzOnMovingElevator(x, z) || xzNearCrystal(x, z)) {
        continue;
      }

      let ok = true;
      for (const p of placed) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz < MIN_DIST_PEER_SQ) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        continue;
      }

      placed.push({ x, y, z });
      continue outer;
    }
  }

  return placed;
}

/**
 * Loads `butterflies.glb` and scatters instances over walkable platform tops — same float height as
 * crystals, with clearance from jump pads, moving elevators, and crystal anchors.
 */
export class ButterflyScatterSystem {
  readonly root = new THREE.Group();

  private readonly loader: GLTFLoader;
  private instances: ButterflyInstance[] = [];

  constructor(parent: THREE.Object3D, loader: GLTFLoader) {
    this.loader = loader;
    this.root.name = 'ButterflyScatter';
    parent.add(this.root);
  }

  load(): Promise<void> {
    const spots = collectScatterPositions();

    return new Promise((resolve) => {
      this.loader.load(
        MODEL_URL,
        (gltf) => {
          const templateScene = gltf.scene;
          const clips = gltf.animations ?? [];
          const clip = pickClip(clips);
          const skinned = hasSkinnedDescendant(templateScene);

          let index = 0;
          for (const spot of spots) {
            const model = skinned ? cloneSkinnedHierarchy(templateScene) : templateScene.clone(true);
            model.name = `Butterfly_${index}`;
            tuneButterflyGraph(model);
            normalizeButterflyToFoot(model, TARGET_BUTTERFLY_EXTENT);

            const pivot = new THREE.Group();
            pivot.name = `ButterflyPivot_${index}`;
            pivot.position.set(spot.x, spot.y, spot.z);
            pivot.add(model);

            const mixer = startMixer(model, clip ? clip.clone() : null);
            if (mixer) {
              mixer.timeScale = 0.65 + rnd(index * 503 + 17) * 0.55;
            }

            this.root.add(pivot);
            const phase = rnd(index * 1103 + 3) * Math.PI * 2;
            const t0 = phase;
            const wx0 = Math.sin(t0 * 1.15) * 0.38 + Math.cos(t0 * 0.73) * 0.22;
            const wz0 = Math.cos(t0 * 1.05) * 0.38 + Math.sin(t0 * 0.81) * 0.22;
            this.instances.push({
              pivot,
              model,
              mixer,
              baseX: spot.x,
              baseY: spot.y,
              baseZ: spot.z,
              phase,
              prevWx: wx0,
              prevWz: wz0,
            });
            index += 1;
          }

          resolve();
        },
        undefined,
        () => {
          console.warn('[ButterflyScatterSystem] Missing or invalid', MODEL_URL);
          resolve();
        },
      );
    });
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.max(delta, 1 / 1000);
    for (const b of this.instances) {
      if (b.mixer) {
        b.mixer.update(dt);
      }
      const t = elapsed + b.phase;
      const wx = Math.sin(t * 1.15) * 0.38 + Math.cos(t * 0.73) * 0.22;
      const wz = Math.cos(t * 1.05) * 0.38 + Math.sin(t * 0.81) * 0.22;
      const wy = Math.sin(t * 2.4) * BLOCK_UNIT * 0.14;
      b.pivot.position.set(b.baseX + wx, b.baseY + wy, b.baseZ + wz);
      const vx = wx - b.prevWx;
      const vz = wz - b.prevWz;
      b.prevWx = wx;
      b.prevWz = wz;
      if (vx * vx + vz * vz > 1e-8) {
        b.pivot.rotation.y = Math.atan2(vx, vz);
      }
    }
  }
}
