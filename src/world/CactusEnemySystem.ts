import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  BLOCK_UNIT,
  JUMP_PADS,
  PLATFORM_SURFACE_TILES,
  type PlatformTile,
} from './TerrainLayout';
import type { TerrainPhysics } from './TerrainPhysics';

const MODEL_URL = '/assets/low_poly_cactus_enemy.glb';

/** Target height on the tile (~1.5 blocks; was 2× block, then **25% smaller**). */
const TARGET_ENEMY_HEIGHT = BLOCK_UNIT * 1.05 * 2 * 0.75;

const ENEMY_TARGET_COUNT = 3;
const MIN_SPAWN_SEPARATION = BLOCK_UNIT * 3.2;

/**
 * **Horizontal** distance (XZ) camera ↔ cactus pivot — ~1 platform block. Vertical separation was
 * inflating 3D distance so the line never fired when standing “next to” him.
 */
const PROXIMITY_VOICE_TRIGGER_METERS = BLOCK_UNIT;
/** Step slightly farther out in XZ before the line can fire again (avoids edge flicker). */
const PROXIMITY_VOICE_RESET_METERS = BLOCK_UNIT * 1.35;
/** Prefer tiles near default spawn so at least one cactus is hearable early (see `PlayerController.position`). */
const CACTUS_SPAWN_HINT_X = 0;
const CACTUS_SPAWN_HINT_Z = 12;
/** Multiply `color` on PBR/basic materials so diffuse reads ~25% brighter (tints textured albedo too). */
const ALBEDO_BRIGHTNESS_MULT = 1.25;

/**
 * Model “face” is opposite Three’s lookAt (−Z) axis — add π so he faces the player, not away.
 */
const CACTUS_MODEL_YAW_OFFSET = Math.PI;

function boostMaterialAlbedoBrightness(material: THREE.Material, factor: number): void {
  if (!('color' in material)) {
    return;
  }
  const col = (material as THREE.MeshStandardMaterial).color;
  if (col?.isColor) {
    col.multiplyScalar(factor);
    material.needsUpdate = true;
  }
}

function boostEnemyAlbedoBrightness(root: THREE.Object3D, factor: number): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      boostMaterialAlbedoBrightness(mat, factor);
    }
  });
}

/** Strip normal/bump paths for **any** material type (GLB may use Phong, etc.). */
function stripNormalLikeMaps(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  if ('normalMap' in m && m.normalMap) {
    m.normalMap = null;
  }
  if ('bumpMap' in m && m.bumpMap) {
    m.bumpMap = null;
  }
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoatNormalMap = null;
  }
  if (m.normalScale?.set) {
    m.normalScale.set(1, 1);
  }
  material.needsUpdate = true;
}

/**
 * Cactus: **base color (`map`) only** at runtime. The GLB may still embed ORM/normal/etc.; we strip
 * every other texture slot and reset PBR extras so lighting uses vertex normals + albedo only.
 */
function sanitizeCactusShading(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) {
      return;
    }

    const geo = mesh.geometry;
    if (!(geo instanceof THREE.BufferGeometry) || !geo.getAttribute('position')) {
      return;
    }

    const hasMorph =
      geo.morphAttributes && Object.keys(geo.morphAttributes).length > 0;
    if (!hasMorph) {
      try {
        geo.computeVertexNormals();
      } catch {
        /* */
      }
      if (geo.getAttribute('tangent')) {
        geo.deleteAttribute('tangent');
      }
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const material of mats) {
      stripNormalLikeMaps(material);

      if (!(material instanceof THREE.MeshStandardMaterial)) {
        continue;
      }

      const mat = material as THREE.MeshPhysicalMaterial;

      if (mat.map?.isTexture) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }

      mat.emissiveMap = null;
      mat.emissive.setHex(0x000000);
      mat.roughnessMap = null;
      mat.metalnessMap = null;
      mat.aoMap = null;
      mat.envMap = null;
      mat.lightMap = null;
      mat.alphaMap = null;
      mat.displacementMap = null;
      mat.displacementScale = 0;
      mat.displacementBias = 0;

      mat.roughness = 1;
      mat.metalness = 0;

      if (mat instanceof THREE.MeshPhysicalMaterial) {
        mat.transmission = 0;
        mat.transmissionMap = null;
        mat.thickness = 0;
        mat.thicknessMap = null;
        mat.ior = 1;
        mat.clearcoat = 0;
        mat.clearcoatMap = null;
        mat.clearcoatRoughness = 0;
        mat.clearcoatNormalMap = null;
        mat.sheen = 0;
        mat.sheenColorMap = null;
        mat.sheenRoughnessMap = null;
        mat.iridescence = 0;
        mat.iridescenceMap = null;
        mat.iridescenceThicknessMap = null;
        mat.specularIntensity = 1;
        mat.specularColor.setHex(0xffffff);
        mat.anisotropy = 0;
        const phys = mat as THREE.MeshPhysicalMaterial & {
          specularIntensityMap?: THREE.Texture | null;
          specularColorMap?: THREE.Texture | null;
          anisotropyMap?: THREE.Texture | null;
        };
        phys.specularIntensityMap = null;
        phys.specularColorMap = null;
        phys.anisotropyMap = null;
      }

      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 0.5;
      mat.polygonOffsetUnits = 0.5;

      mat.needsUpdate = true;
    }
  });
}

/** Same fractional hash as `WorldManager.hashTile` (deterministic “RNG”). */
function hashTile(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 91.7) * 43758.5453123;
  return value - Math.floor(value);
}

function jumpPadBlockedGridKeys(): Set<string> {
  return new Set(
    JUMP_PADS.map((pad) => `${Math.round(pad.x / BLOCK_UNIT - 0.5)}:${Math.round(pad.z / BLOCK_UNIT - 0.5)}`),
  );
}

/**
 * Mirrors `populatePlantScatter` density roll (jump pads excluded by caller — scatter never places plants there).
 */
function tileWouldSpawnPlant(tile: PlatformTile): boolean {
  const baseDensity = tile.role === 'spawn' ? 0.34 : tile.role === 'path' ? 0.26 : 0.12;
  const scatterRoll = hashTile(tile.gridX, tile.gridZ, 0.17);
  return scatterRoll <= baseDensity;
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

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const skinned = mesh as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) {
        skinned.frustumCulled = false;
      }
    }
  });
}

function clipLabelLower(c: THREE.AnimationClip): string {
  return (c.name ?? '').toLowerCase();
}

/**
 * Pick the best idle-style clip from the GLB (name heuristics, else first clip).
 */
function pickIdleClip(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (clips.length === 0) {
    return null;
  }

  const calmHints =
    /idle|neutral|relax|calm|default|stand|tpose|rest|happy|walk|patrol|sit|sleep|bind|waiting|wait|peace|chill|loop|base|easy|quiet|still|breathe/i;

  for (const c of clips) {
    const n = clipLabelLower(c);
    if (calmHints.test(n)) {
      return c;
    }
  }

  return clips[0];
}

/** Scale + XZ center + bottom on local y=0 (feet on block top). */
function normalizeEnemyOnTile(model: THREE.Object3D, targetHeight: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const s = targetHeight / maxDim;
  model.scale.setScalar(s);

  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box2.min.y;
  const surfaceSink = BLOCK_UNIT * 0.012;
  model.position.y -= surfaceSink;
}

type EnemyInstance = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | null;
};

/**
 * Decorative cactus enemies on platform tiles (no plants, no jump pads). Idle animation only; faces the player.
 */
export class CactusEnemySystem {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();
  private readonly terrainPhysics: TerrainPhysics;
  private readonly playProximitySound?: (x: number, y: number, z: number) => void;
  private enemies: EnemyInstance[] = [];
  /** After playing, `false` until the player moves beyond `PROXIMITY_VOICE_RESET_METERS` from the nearest cactus. */
  private cactusVoiceArmed = true;
  private readonly scratchWorld = new THREE.Vector3();
  private readonly scratchListener = new THREE.Vector3();
  private readonly scratchLookAt = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    terrainPhysics: TerrainPhysics,
    playProximitySound?: (x: number, y: number, z: number) => void,
  ) {
    this.terrainPhysics = terrainPhysics;
    this.playProximitySound = playProximitySound;
    this.root.name = 'CactusEnemies';
    parent.add(this.root);
  }

  load(): void {
    this.loader.load(
      MODEL_URL,
      (gltf) => {
        const template = gltf.scene;
        applyShadowFlags(template);
        const clips = gltf.animations ?? [];
        if (import.meta.env?.DEV && clips.length > 0) {
          console.info(
            '[CactusEnemy] GLB animation clips:',
            clips.map((c) => c.name || '(unnamed)'),
          );
        }
        const idleClip = pickIdleClip(clips);
        if (import.meta.env?.DEV) {
          console.info('[CactusEnemy] idle clip:', idleClip?.name ?? '(none)');
        }
        const skinned = hasSkinnedDescendant(template);

        const blockedGrid = jumpPadBlockedGridKeys();
        const candidates = PLATFORM_SURFACE_TILES.filter((tile) => {
          if (blockedGrid.has(`${tile.gridX}:${tile.gridZ}`)) {
            return false;
          }
          return !tileWouldSpawnPlant(tile);
        }).sort((a, b) => {
          const da = Math.hypot(a.x - CACTUS_SPAWN_HINT_X, a.z - CACTUS_SPAWN_HINT_Z);
          const db = Math.hypot(b.x - CACTUS_SPAWN_HINT_X, b.z - CACTUS_SPAWN_HINT_Z);
          if (Math.abs(da - db) > BLOCK_UNIT * 0.25) {
            return da - db;
          }
          return hashTile(a.gridX, a.gridZ, 44.3) - hashTile(b.gridX, b.gridZ, 44.3);
        });

        const spawns: PlatformTile[] = [];
        for (const tile of candidates) {
          if (spawns.length >= ENEMY_TARGET_COUNT) {
            break;
          }
          const ok = spawns.every((t) => {
            const dx = t.x - tile.x;
            const dz = t.z - tile.z;
            return Math.hypot(dx, dz) >= MIN_SPAWN_SEPARATION;
          });
          if (ok) {
            spawns.push(tile);
          }
        }

        for (const tile of spawns) {
          const enemy = skinned ? cloneSkinnedHierarchy(template) : template.clone(true);
          applyShadowFlags(enemy);
          sanitizeCactusShading(enemy);
          normalizeEnemyOnTile(enemy, TARGET_ENEMY_HEIGHT);
          boostEnemyAlbedoBrightness(enemy, ALBEDO_BRIGHTNESS_MULT);
          enemy.rotation.y = CACTUS_MODEL_YAW_OFFSET;

          const groundY = this.terrainPhysics.getGroundHeightAt(tile.x, tile.z) ?? tile.topY;

          const pivot = new THREE.Group();
          pivot.name = 'CactusEnemyPivot';
          pivot.add(enemy);
          pivot.position.set(tile.x, groundY, tile.z);
          this.root.add(pivot);

          const mixer = new THREE.AnimationMixer(enemy);
          let idleAction: THREE.AnimationAction | null = null;

          if (idleClip) {
            const ic = idleClip.clone();
            idleAction = mixer.clipAction(ic);
            idleAction.loop = THREE.LoopRepeat;
            idleAction.clampWhenFinished = false;
            idleAction.play();
          }

          this.enemies.push({
            root: pivot,
            mixer,
            idleAction,
          });
        }
      },
      undefined,
      () => {
        /* Missing `public/assets/low_poly_cactus_enemy.glb` */
      },
    );
  }

  update(
    delta: number,
    _elapsed: number,
    playerWorldPosition: THREE.Vector3 | null,
    listenerCamera: THREE.Camera | null,
  ): void {
    const dt = Math.max(delta, 1 / 1000);
    const player = playerWorldPosition;

    if (!player) {
      for (const inst of this.enemies) {
        inst.mixer.update(dt);
      }
      return;
    }

    const px = player.x;
    const pz = player.z;

    let closestDist = Infinity;
    let voiceX = 0;
    let voiceY = 0;
    let voiceZ = 0;

    for (const inst of this.enemies) {
      inst.mixer.update(dt);

      inst.root.updateWorldMatrix(true, false);
      inst.root.getWorldPosition(this.scratchWorld);

      /** XZ only — same platform “next to him” matches one block, without eye-height blowing up range. */
      let d: number;
      if (listenerCamera) {
        listenerCamera.getWorldPosition(this.scratchListener);
        const dx = this.scratchListener.x - this.scratchWorld.x;
        const dz = this.scratchListener.z - this.scratchWorld.z;
        d = Math.hypot(dx, dz);
      } else {
        d = Math.hypot(px - this.scratchWorld.x, pz - this.scratchWorld.z);
      }

      if (d < closestDist) {
        closestDist = d;
        voiceX = this.scratchWorld.x;
        voiceY = this.scratchWorld.y + TARGET_ENEMY_HEIGHT * 0.55;
        voiceZ = this.scratchWorld.z;
      }

      /** Track player on XZ; pitch/roll locked — “locked eyes” without leaving the tile. */
      this.scratchLookAt.set(px, this.scratchWorld.y, pz);
      inst.root.lookAt(this.scratchLookAt);
      inst.root.rotation.x = 0;
      inst.root.rotation.z = 0;
    }

    if (this.enemies.length === 0) {
      return;
    }

    if (closestDist > PROXIMITY_VOICE_RESET_METERS) {
      this.cactusVoiceArmed = true;
    } else if (
      closestDist < PROXIMITY_VOICE_TRIGGER_METERS &&
      this.cactusVoiceArmed &&
      this.playProximitySound
    ) {
      this.playProximitySound(voiceX, voiceY, voiceZ);
      this.cactusVoiceArmed = false;
    }
  }
}
