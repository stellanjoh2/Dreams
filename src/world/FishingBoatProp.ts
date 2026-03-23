import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WATER_SURFACE_Y } from '../config/defaults';
import { BLOCK_UNIT } from './TerrainLayout';

const MODEL_URL = '/assets/fishing_boat_stylized.glb';

/** Push **3 platform cube widths** (+X) farther into open water vs the prior spot (avoids hull clipping tiles). */
const BOAT_OFFSET_INTO_WATER = 3 * BLOCK_UNIT;

/** Extra push into open water after the 3×`BLOCK_UNIT` offset (world units). */
const BOAT_EXTRA_OUT = 2;

/**
 * Open water **away** from the south platform edge (white cubes).
 * **+X** = east/right when looking from spawn toward the map; **−X** mirrors for the west/left boat.
 */
const BOAT_ANCHOR_X_MAG = 24 + BOAT_OFFSET_INTO_WATER + BOAT_EXTRA_OUT;
const BOAT_Z = 23.5;

/** Longest axis after fit. */
const TARGET_BOAT_EXTENT = 16.5;

/**
 * After bottom alignment: **negative** lowers the mesh vs the water plane (more hull underwater).
 */
const WATERLINE_ADJUST = -0.88;

/** Extra world‑space sink for the whole prop (meters). */
const ROOT_SINK_BELOW_SURFACE = 0.14 + 1 + 1 + 1;

/**
 * World yaw: bow toward spawn area; `π` flip + **two** extra **+45°** turns (`π/2` total).
 */
const BOAT_YAW = 0.95 + Math.PI + Math.PI / 2;

/**
 * Applied to the loaded scene **before** bounding-box fit (fixes common GLB “upside down”).
 * Tweak per asset: try `[0, 0, Math.PI]` if still inverted.
 */
const MODEL_UP_FIX = new THREE.Euler(Math.PI, 0, 0);

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

/**
 * Water is transparent with `depthWrite: false`; keep the hull **opaque** with normal depth so the GPU
 * can resolve most of the surface. Avoid extra polygonOffset on the boat — it stacks oddly with the
 * water material’s offset and can shimmer at the waterline.
 */
function tuneBoatMaterialsForWater(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    /** Draw with default opaque ordering; water mesh uses `renderOrder` 12. */
    mesh.renderOrder = 0;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      const m = mat as THREE.MeshPhysicalMaterial;
      /** Leave refractive / alpha glass as authored. */
      const transmission = 'transmission' in m ? Number(m.transmission) : 0;
      if (transmission > 0.05) {
        m.depthWrite = true;
        m.depthTest = true;
        m.needsUpdate = true;
        continue;
      }
      /** Solid hull: avoid accidental transparency from the GLB (breaks vs water). */
      if (m.opacity === undefined || m.opacity >= 0.99) {
        m.transparent = false;
        m.opacity = 1;
      }
      m.depthWrite = true;
      m.depthTest = true;
      m.polygonOffset = false;
      m.needsUpdate = true;
    }
  });
}

/**
 * Scale to target size, center on XZ, rest bottom slightly below y=0 so the hull sits in the “water plane”.
 */
function normalizeBoatForWaterline(model: THREE.Object3D, targetMaxExtent: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const s = targetMaxExtent / maxDim;
  model.scale.setScalar(s);

  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.sub(center);

  model.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(model);
  model.position.y -= box3.min.y;
  model.position.y += WATERLINE_ADJUST;
}

/**
 * Picks clips that look like rig motion (flag, etc.). If none match by name, plays **all** embedded clips.
 */
function selectBoatAnimationClips(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip[] {
  if (clips.length === 0) {
    return [];
  }
  const hints = /flag|wave|wind|flutter|sail|rig|idle|bounce|anim/i;
  const matched = clips.filter((c) => hints.test(c.name ?? ''));
  return matched.length > 0 ? matched : [...clips];
}

export type FishingBoatPlacement = {
  /** `Object3D.name` on the root group. */
  rootName: string;
  worldX: number;
  worldZ: number;
  /** Radians, Y-up. */
  yaw: number;
  /** Desync procedural bob vs a twin instance. */
  bobPhaseOffset?: number;
};

/** East/right-side boat (original spot). */
export const FISHING_BOAT_PLACEMENT_RIGHT: FishingBoatPlacement = {
  rootName: 'FishingBoat',
  worldX: BOAT_ANCHOR_X_MAG,
  worldZ: BOAT_Z,
  yaw: BOAT_YAW,
};

/** West/left-side boat — mirrored X, yaw + π so the hull still reads toward the playfield. */
export const FISHING_BOAT_PLACEMENT_LEFT: FishingBoatPlacement = {
  rootName: 'FishingBoat_West',
  worldX: -BOAT_ANCHOR_X_MAG,
  worldZ: BOAT_Z,
  yaw: BOAT_YAW + Math.PI,
  bobPhaseOffset: 2.31,
};

/**
 * Fishing boat: procedural bob + optional GLB clips (e.g. flag) via `AnimationMixer`.
 */
export class FishingBoatProp {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();
  private readonly motion = new THREE.Group();
  private readonly bobPhaseOffset: number;
  private mixer: THREE.AnimationMixer | null = null;
  private loaded = false;

  constructor(parent: THREE.Object3D, placement: FishingBoatPlacement) {
    this.bobPhaseOffset = placement.bobPhaseOffset ?? 0;
    this.root.name = placement.rootName;
    this.motion.name = `${placement.rootName}_Motion`;
    this.root.add(this.motion);

    /** Pivot slightly below the analytical plane so the visible hull isn’t hovering. */
    this.root.position.set(
      placement.worldX,
      WATER_SURFACE_Y - ROOT_SINK_BELOW_SURFACE,
      placement.worldZ,
    );
    this.root.rotation.y = placement.yaw;

    parent.add(this.root);
  }

  load(): void {
    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const boat = gltf.scene;
        applyShadowFlags(boat);
        boat.rotation.copy(MODEL_UP_FIX);
        normalizeBoatForWaterline(boat, TARGET_BOAT_EXTENT);
        tuneBoatMaterialsForWater(boat);
        boat.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            /** Avoid wrong bounds culling the hull when the GLB pivot is odd. */
            mesh.frustumCulled = false;
          }
        });
        this.motion.add(boat);

        const clips = selectBoatAnimationClips(gltf.animations ?? []);
        if (clips.length > 0) {
          this.mixer = new THREE.AnimationMixer(boat);
          for (const clip of clips) {
            const action = this.mixer.clipAction(clip);
            action.loop = THREE.LoopRepeat;
            action.clampWhenFinished = false;
            action.enabled = true;
            action.setEffectiveWeight(1);
            action.play();
          }
        }

        this.loaded = true;
      },
      undefined,
      () => {
        /* Missing `public/assets/fishing_boat_stylized.glb` — prop stays empty */
      },
    );
  }

  update(delta: number, elapsed: number): void {
    if (!this.loaded) {
      return;
    }

    const dt = Math.max(delta, 1 / 1000);
    this.mixer?.update(dt);

    const t = elapsed + this.bobPhaseOffset;
    /** Bob stays shallow — large hull + deep bob reads as sorting glitches in the water shader. */
    this.motion.position.y =
      Math.sin(t * 0.85) * 0.032 + Math.sin(t * 0.31 + 0.7) * 0.015;
    this.motion.rotation.z = Math.sin(t * 0.62 + 0.25) * 0.052;
    this.motion.rotation.x = Math.sin(t * 0.48 + 1.05) * 0.034;
  }
}
