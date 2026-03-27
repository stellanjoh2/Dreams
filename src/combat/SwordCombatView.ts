import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { publicUrl } from '../config/publicUrl';

const SWING_DURATION = 0.52;
const STAB_DURATION = 0.38;
/** Normalized longest axis in camera-local units (ice sword, boosted for readable FPS silhouette). */
const TARGET_MAX_EXTENT = 0.92 * 1.035 * 1.5 * 1.12;

/**
 * `ice_sword.glb` is authored pointing into / mirroring the FPS camera vs `low_poly_sword`.
 * Y = turn away from camera; Z = roll fix (blade “flipped”).
 */
const ICE_SWORD_ROOT_FIX = new THREE.Euler(0, Math.PI, Math.PI, 'YXZ');

/** Single-axis horizontal slash (rad), ~140° — large readable arc, no extra twist. */
const SWING_ANGLE = 2.45;
/** Translation at peak: pulls blade through space (camera-local) for weight. */
const SWING_SHIFT_X = 0.22;
const SWING_SHIFT_Y = 0.14;
const SWING_SHIFT_Z = -0.08;
const STAB_FORWARD = 0.78;
const STAB_PITCH = 0.52;

/**
 * Bottom-right FPS idle — relaxed carry: blade tipped **up** (not level / stabbing forward),
 * hilt pulled in so a bit of handle shows above the bottom edge.
 */
const IDLE_POSITION = new THREE.Vector3(0.28, 0.05, -0.5);
const IDLE_EULER = new THREE.Euler(0.58, -0.05, 0.38, 'YXZ');

const swingAxisY = new THREE.Vector3(0, 1, 0);
const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const swingQuatY = new THREE.Quaternion();
const swingPosScratch = new THREE.Vector3();

type AttackKind = 'swing' | 'stab';

function tuneSwordMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
    const m = material.metalness * 0.28 + 0.02;
    const r = material.roughness + 0.42;
    const e = material.envMapIntensity * 0.35;
    material.metalness = THREE.MathUtils.clamp(m * 1.25, 0, 0.95);
    material.roughness = THREE.MathUtils.clamp(r * 0.75, 0.08, 1);
    material.envMapIntensity = THREE.MathUtils.clamp(e * 1.25, 0, 1.25);
    material.color.multiplyScalar(0.75);
  }
}

/**
 * First-person free-floating sword: loads `ice_sword.glb`, idle pose on camera,
 * procedural swing / stab (random on trigger).
 */
export class SwordCombatView {
  private readonly holder: THREE.Group;
  private readonly loader = new GLTFLoader();
  private loaded = false;

  private phase: 'idle' | AttackKind = 'idle';
  private animTime = 0;
  /** ±1 per swing: alternates slash direction for bigger, varied arcs. */
  private swingDir = 1;
  /** Holstered: no draw, no attacks (toggle H / gamepad Y). */
  private weaponHidden = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.holder = new THREE.Group();
    this.holder.name = 'FpsSwordHolder';
    this.holder.visible = false;
    camera.add(this.holder);
  }

  async load(): Promise<void> {
    const url = publicUrl('assets/ice_sword.glb');
    const gltf = await this.loader.loadAsync(url);
    const root = gltf.scene.clone(true);
    root.rotation.copy(ICE_SWORD_ROOT_FIX);
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const s = TARGET_MAX_EXTENT / maxDim;
    root.scale.setScalar(s);

    const centered = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    centered.getCenter(center);
    root.position.sub(center);

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        const mats = mesh.material;
        if (Array.isArray(mats)) {
          for (const m of mats) {
            tuneSwordMaterial(m);
          }
        } else {
          tuneSwordMaterial(mats);
        }
      }
    });

    this.holder.add(root);
    this.applyIdleTransform();
    this.loaded = true;
  }

  /** First-person in-world (not editor / free flight); still respects holster. Pointer lock not required. */
  setGameplayVisible(inWorldFirstPerson: boolean): void {
    this.holder.visible = this.loaded && inWorldFirstPerson && !this.weaponHidden;
  }

  toggleWeaponHidden(): void {
    this.weaponHidden = !this.weaponHidden;
    if (this.weaponHidden) {
      this.phase = 'idle';
      this.applyIdleTransform();
    }
  }

  isWeaponHidden(): boolean {
    return this.weaponHidden;
  }

  dispose(): void {
    this.holder.removeFromParent();
  }

  /** Start swing or stab if idle; otherwise ignored (no animation stacking). */
  triggerAttack(): void {
    if (!this.loaded || this.weaponHidden || this.phase !== 'idle') {
      return;
    }
    if (Math.random() < 0.5) {
      this.phase = 'swing';
      this.swingDir = Math.random() < 0.5 ? 1 : -1;
    } else {
      this.phase = 'stab';
    }
    this.animTime = 0;
  }

  update(delta: number): void {
    if (!this.loaded) {
      return;
    }

    if (this.weaponHidden) {
      if (this.phase !== 'idle') {
        this.phase = 'idle';
        this.applyIdleTransform();
      }
      return;
    }

    if (this.phase === 'idle') {
      this.applyIdleTransform();
      return;
    }

    this.animTime += delta;
    const dur = this.phase === 'swing' ? SWING_DURATION : STAB_DURATION;
    const u = Math.min(1, this.animTime / dur);
    const wave = Math.sin(u * Math.PI);

    if (this.phase === 'swing') {
      this.applyIdleTransform();
      swingPosScratch
        .set(SWING_SHIFT_X * this.swingDir, SWING_SHIFT_Y, SWING_SHIFT_Z)
        .multiplyScalar(wave);
      this.holder.position.add(swingPosScratch);
      swingQuatY.setFromAxisAngle(swingAxisY, wave * SWING_ANGLE * this.swingDir);
      this.holder.quaternion.setFromEuler(IDLE_EULER);
      this.holder.quaternion.multiply(swingQuatY);
    } else {
      this.applyIdleTransform();
      this.holder.position.z -= wave * STAB_FORWARD;
      scratchEuler.copy(IDLE_EULER);
      scratchEuler.x += wave * STAB_PITCH;
      this.holder.rotation.copy(scratchEuler);
    }

    if (u >= 1) {
      this.phase = 'idle';
      this.applyIdleTransform();
    }
  }

  private applyIdleTransform(): void {
    this.holder.position.copy(IDLE_POSITION);
    this.holder.rotation.copy(IDLE_EULER);
  }
}
