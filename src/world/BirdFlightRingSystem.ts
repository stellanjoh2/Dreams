import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WATER_SURFACE_Y } from '../config/defaults';
import { BLOCK_UNIT, PLATFORM_TILES } from './TerrainLayout';
import { publicUrl } from '../config/publicUrl';

const MODEL_URL = publicUrl('assets/birds.glb');

/** Max dimension after normalize — readable from the ground but not dominating the sky. */
const TARGET_FLOCK_EXTENT = 9;

/** Cruise speed along the spline (world units / second); 20% slower than the first ship pass. */
const FLIGHT_SPEED = 15.2;

/** Single animated GLB on the sky spline (was 3 — fewer skinned draws / mixers). */
const FLOCK_COUNT = 1;

/** Extra world Y per flock index (only index 0 used). */
const FLOCK_Y_OFFSETS: readonly number[] = [0];

const scratchPos = new THREE.Vector3();
const scratchTan = new THREE.Vector3();
const scratchUp = new THREE.Vector3(0, 1, 0);
const scratchRight = new THREE.Vector3();
const scratchLookTarget = new THREE.Vector3();
const scratchTanDelta = new THREE.Vector3();

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
    }
  });
}

function tuneSkinnedMeshes(object: THREE.Object3D): void {
  object.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
    }
  });
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

function normalizeFlockToOrigin(flock: THREE.Object3D, targetMaxExtent: number): void {
  flock.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(flock);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const s = targetMaxExtent / maxDim;
  flock.scale.setScalar(s);
  flock.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(flock);
  const center = box2.getCenter(new THREE.Vector3());
  flock.position.sub(center);
}

function markNoLensflareOcclusion(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.Points ||
      obj instanceof THREE.Line ||
      obj instanceof THREE.LineSegments
    ) {
      obj.userData.lensflare = 'no-occlusion';
    }
  });
}

/** Same inner clearance idea as `StylizedCloudRing` — birds loop outside that band, under backdrop sky. */
const CLOUD_RING_INNER_FLOOR = BLOCK_UNIT * 26;
const ORBIT_CLEARANCE_BEYOND_PLAYFIELD = BLOCK_UNIT * 28;
/** Push mean radius past the cloud inner ring toward the first backdrop candy annulus. */
const BIRD_ORBIT_PAST_CLOUD_INNER = BLOCK_UNIT * 18;

/** Tighten the sky lane vs last ship (20% smaller ring). */
const RING_RADIUS_SCALE = 0.8;

/** Matches `playfieldCenterAndHalfExtent` in `StylizedCloudRing` — shared orbit pivot with clouds. */
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

function buildSkyLaneCurve(centerX: number, centerZ: number, halfExtent: number): THREE.CatmullRomCurve3 {
  const cloudInner = Math.max(CLOUD_RING_INNER_FLOOR, halfExtent + ORBIT_CLEARANCE_BEYOND_PLAYFIELD);
  const meanR = (cloudInner + BIRD_ORBIT_PAST_CLOUD_INNER) * RING_RADIUS_SCALE;
  const rx = meanR * 1.14;
  const rz = meanR * 0.94;
  const wobble = BLOCK_UNIT * 5.5 * RING_RADIUS_SCALE;
  /** ~50% lower than the old +44 band. */
  const baseY = WATER_SURFACE_Y + 22;
  const yBob = 2.5;
  const pts: THREE.Vector3[] = [];
  const n = 10;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const bx = Math.cos(a) * rx + Math.sin(a * 2.1) * wobble * 0.35;
    const bz = Math.sin(a) * rz + Math.cos(a * 1.7) * wobble * 0.28;
    const yy =
      baseY +
      Math.sin(a * 2) * yBob * 0.45 +
      Math.cos(a * 3 + 0.4) * yBob * 0.35 +
      Math.sin(a * 1.1) * 1.1;
    pts.push(new THREE.Vector3(centerX + bx, yy, centerZ + bz));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35);
}

function startBirdAnimation(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): THREE.AnimationMixer | null {
  if (clips.length === 0) {
    return null;
  }
  const clip = clips[0].clone();
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip, root);
  action.loop = THREE.LoopRepeat;
  action.clampWhenFinished = false;
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  return mixer;
}

type FlockInstance = {
  pivot: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  phase: number;
  yOffset: number;
  bankPhase: number;
};

/**
 * Animated `birds.glb` instances on a closed spline above the playfield — wing clips from the GLB,
 * position/tangent from a smooth sky lane (same XZ pivot / winding as `StylizedCloudRing`).
 */
export class BirdFlightRingSystem {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();
  private curve: THREE.CatmullRomCurve3 | null = null;
  private curveLength = 1;
  private progress = 0;
  private flocks: FlockInstance[] = [];
  private loaded = false;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'BirdFlightRing';
    parent.add(this.root);
  }

  load(): void {
    const { cx, cz, halfExtent } = playfieldCenterAndHalfExtent();
    this.curve = buildSkyLaneCurve(cx, cz, halfExtent);
    this.curveLength = Math.max(this.curve.getLength(), 1);

    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const template = gltf.scene;
        applyShadowFlags(template);
        tuneSkinnedMeshes(template);
        const clips = gltf.animations ?? [];
        const skinned = hasSkinnedDescendant(template);

        for (let i = 0; i < FLOCK_COUNT; i += 1) {
          const flock = skinned ? cloneSkinnedHierarchy(template) : template.clone(true);
          applyShadowFlags(flock);
          tuneSkinnedMeshes(flock);
          flock.name = `BirdFlock_${i}`;

          normalizeFlockToOrigin(flock, TARGET_FLOCK_EXTENT);
          const scaleJitter = 0.88 + ((i * 17) % 10) * 0.012;
          flock.scale.multiplyScalar(scaleJitter);
          /** GLB +Z is tail; keep pivot motion/tangent — spin mesh 180° so beak matches velocity. */
          flock.rotation.y = Math.PI;

          const pivot = new THREE.Group();
          pivot.name = `BirdFlockPivot_${i}`;
          pivot.frustumCulled = false;
          pivot.add(flock);

          const mixer = startBirdAnimation(flock, clips);
          if (mixer) {
            mixer.timeScale = 0.92 + ((i * 23) % 8) * 0.015;
          }

          this.root.add(pivot);
          this.flocks.push({
            pivot,
            mixer,
            phase: i / FLOCK_COUNT + (i * 0.07) % 0.04,
            yOffset: FLOCK_Y_OFFSETS[i] ?? 0,
            bankPhase: i * 1.7,
          });
          markNoLensflareOcclusion(pivot);
        }

        this.loaded = true;
      },
      undefined,
      () => {
        console.warn('[BirdFlightRingSystem] Missing or invalid', MODEL_URL);
      },
    );
  }

  update(delta: number, elapsed: number): void {
    if (!this.loaded || !this.curve || this.flocks.length === 0) {
      return;
    }

    const dt = Math.max(delta, 1 / 1000);
    /** Increasing u — CCW in XZ when viewed from +Y, same as `StylizedCloudRing` (`angle += speed`). */
    this.progress += (FLIGHT_SPEED / this.curveLength) * dt;
    this.progress -= Math.floor(this.progress);

    const curve = this.curve;

    for (const flock of this.flocks) {
      if (flock.mixer) {
        flock.mixer.update(dt);
      }

      const u = (this.progress + flock.phase) % 1;
      curve.getPointAt(u, scratchPos);
      scratchPos.y += flock.yOffset + Math.sin(elapsed * 0.55 + flock.bankPhase) * 0.45;

      curve.getTangentAt(u, scratchTan).normalize();
      if (scratchTan.lengthSq() < 1e-8) {
        continue;
      }

      /** Beak / body forward matches velocity (+tangent as u increases). */
      scratchLookTarget.copy(scratchPos).add(scratchTan);
      flock.pivot.position.copy(scratchPos);
      flock.pivot.up.copy(scratchUp);
      flock.pivot.lookAt(scratchLookTarget);

      scratchRight.crossVectors(scratchUp, scratchTan).normalize();
      const uPrev = (u - 0.008 + 1) % 1;
      const uNext = (u + 0.008) % 1;
      curve.getTangentAt(uPrev, scratchTanDelta);
      curve.getTangentAt(uNext, scratchLookTarget);
      scratchTanDelta.subVectors(scratchLookTarget, scratchTanDelta);
      const bend = scratchRight.dot(scratchTanDelta) * 22;
      const bank = THREE.MathUtils.clamp(bend, -0.38, 0.38);
      flock.pivot.rotateOnWorldAxis(scratchTan, bank);
    }
  }
}
