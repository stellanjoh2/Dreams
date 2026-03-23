import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WORLD_FLOOR_Y } from '../config/defaults';
import { publicUrl } from '../config/publicUrl';

/**
 * Reef fish pack (`school_of_fish.glb`): one scene with several species (e.g. clownfish, blue tang,
 * Moorish idol) and a single shared **swimming** animation (many bone channels). We clone the
 * skinned hierarchy per instance and run a **fresh clip clone** on each `AnimationMixer` so rigs
 * stay independent.
 */
const MODEL_URL = publicUrl('assets/school_of_fish.glb');

/** Below water surface (`WATER_SURFACE_Y` in defaults); tall rig bounds stay submerged. */
const SWIM_DEPTH_Y = WORLD_FLOOR_Y - 3.92;

/** Target max dimension per school after normalization (meters-ish world units). */
const TARGET_SCHOOL_EXTENT = 3.2;

type SchoolSlot = {
  readonly baseX: number;
  readonly baseZ: number;
  readonly orbitRadius: number;
  readonly phase: number;
  readonly angularSpeed: number;
  readonly swayAmp: number;
  /** Extra world Y (negative = deeper). */
  readonly depthOffset?: number;
};

const SCHOOL_SLOTS: readonly SchoolSlot[] = [
  {
    baseX: -14,
    baseZ: 16,
    orbitRadius: 5.2,
    phase: 0.2,
    angularSpeed: 0.11,
    swayAmp: 0.07,
    depthOffset: -0.25,
  },
  { baseX: 19, baseZ: 7, orbitRadius: 4.1, phase: 1.4, angularSpeed: 0.14, swayAmp: 0.09 },
  { baseX: -7, baseZ: -19, orbitRadius: 5.8, phase: 2.2, angularSpeed: 0.1, swayAmp: 0.06 },
  { baseX: 27, baseZ: -11, orbitRadius: 4.6, phase: 0.9, angularSpeed: 0.13, swayAmp: 0.08 },
  { baseX: 5, baseZ: 30, orbitRadius: 6, phase: 3.1, angularSpeed: 0.095, swayAmp: 0.1 },
];

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

/** Skinned meshes can be culled incorrectly when bounds lag bone animation. */
function tuneSkinnedMeshes(object: THREE.Object3D): void {
  object.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
    }
  });
}

function normalizeSchoolToOrigin(school: THREE.Object3D, targetMaxExtent: number): void {
  school.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(school);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const s = targetMaxExtent / maxDim;
  school.scale.setScalar(s);
  school.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(school);
  const center = box2.getCenter(new THREE.Vector3());
  school.position.sub(center);
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

/** Prefer the pack’s swim cycle; clone so each school mixer owns its own clip data. */
function cloneSwimmingClip(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (clips.length === 0) {
    return null;
  }
  const named = clips.find((c) => /swim/i.test(c.name ?? ''));
  return (named ?? clips[0]).clone();
}

function startSchoolSwimAnimation(
  school: THREE.Object3D,
  swimClip: THREE.AnimationClip | null,
): THREE.AnimationMixer | null {
  if (!swimClip) {
    return null;
  }
  const mixer = new THREE.AnimationMixer(school);
  const action = mixer.clipAction(swimClip, school);
  action.loop = THREE.LoopRepeat;
  action.clampWhenFinished = false;
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  return mixer;
}

/** When there are no clips, fake schooling motion on mesh children. */
function applyProceduralSchoolMotion(school: THREE.Object3D, elapsed: number, phase: number): void {
  let meshIndex = 0;
  school.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      return;
    }
    const t = elapsed * 2.2 + phase + meshIndex * 0.55;
    mesh.rotation.y = Math.sin(t) * 0.35;
    mesh.rotation.z = Math.cos(t * 0.9) * 0.12;
    meshIndex += 1;
  });
  school.rotation.z = Math.sin(elapsed * 1.4 + phase) * 0.08;
  school.rotation.x = Math.sin(elapsed * 1.9 + phase * 1.2) * 0.05;
}

/**
 * Several orbiting clones of the reef fish GLB, kept below the water surface.
 */
export class FishSchoolsSystem {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();
  private schools: Array<{
    pivot: THREE.Group;
    school: THREE.Object3D;
    slot: SchoolSlot;
    mixer: THREE.AnimationMixer | null;
  }> = [];

  constructor(parent: THREE.Object3D) {
    this.root.name = 'FishSchools';
    parent.add(this.root);
  }

  load(): void {
    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const template = gltf.scene;
        applyShadowFlags(template);
        const clips = gltf.animations ?? [];
        const skinned = hasSkinnedDescendant(template);

        for (const slot of SCHOOL_SLOTS) {
          const school = skinned ? cloneSkinnedHierarchy(template) : template.clone(true);
          applyShadowFlags(school);
          tuneSkinnedMeshes(school);

          normalizeSchoolToOrigin(school, TARGET_SCHOOL_EXTENT);

          const swimClip = cloneSwimmingClip(clips);
          const mixer = startSchoolSwimAnimation(school, swimClip);
          if (mixer) {
            mixer.timeScale = 0.75 + (slot.phase % 1) * 0.45;
          }

          const pivot = new THREE.Group();
          pivot.name = 'FishSchoolPivot';
          pivot.add(school);
          this.root.add(pivot);
          this.schools.push({ pivot, school, slot, mixer });
        }

        this.update(0, 0);
      },
      undefined,
      () => {
        /* Missing `public/assets/school_of_fish.glb` — leave schools empty */
      },
    );
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.max(delta, 1 / 1000);
    for (const { pivot, school, slot, mixer } of this.schools) {
      if (mixer) {
        mixer.update(dt);
      }

      const a = elapsed * slot.angularSpeed + slot.phase;
      const x = slot.baseX + Math.cos(a) * slot.orbitRadius;
      const z = slot.baseZ + Math.sin(a) * slot.orbitRadius * 0.88;
      const y =
        SWIM_DEPTH_Y +
        (slot.depthOffset ?? 0) +
        Math.sin(elapsed * 0.65 + slot.phase * 2) * slot.swayAmp;
      pivot.position.set(x, y, z);
      pivot.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a) * 0.88);

      if (!mixer) {
        applyProceduralSchoolMotion(school, elapsed, slot.phase);
      }
      // Do not add extra rotation on `school` when the GLB swim clip is running — it fights bone tracks.
    }
  }
}
