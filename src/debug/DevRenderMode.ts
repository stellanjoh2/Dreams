import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export type DevRenderMode = 'normal' | 'unlit' | 'wireframe';

const ORIG_KEY = '__devRenderOriginalMaterial';

/**
 * WebGPURenderer only applies scene overrides that are Node materials; legacy MeshBasicMaterial is ignored.
 */
const wireframeOverride = new MeshBasicNodeMaterial();
wireframeOverride.color.set(0x5ecfff);
wireframeOverride.wireframe = true;
wireframeOverride.fog = false;
wireframeOverride.side = THREE.DoubleSide;
wireframeOverride.lights = false;

function isObjectMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true;
}

function disposeDevUnlitMaterials(mat: THREE.Material | THREE.Material[] | undefined): void {
  if (!mat) {
    return;
  }
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    if (m.userData?.devUnlitDisposable) {
      m.dispose();
    }
  }
}

/**
 * Water uses `NodeMaterial` + TSL; base tint is not on `material.color`. See `WaterSurfaceMesh.userData.devUnlitWaterColor`.
 */
function materialToUnlitWater(mesh: THREE.Mesh, src: THREE.Material): MeshBasicNodeMaterial {
  const out = new MeshBasicNodeMaterial({ fog: false });
  out.userData.devUnlitDisposable = true;
  const tint = mesh.userData.devUnlitWaterColor as THREE.Color | undefined;
  out.color.copy(tint ?? new THREE.Color('#4fd6da'));
  out.side = src.side;
  out.transparent = src.transparent;
  out.opacity = src.opacity;
  out.depthWrite = src.depthWrite;
  out.depthTest = src.depthTest;
  out.lights = false;
  return out;
}

/**
 * Per-mesh unlit albedo: copies map/color (and a few blend flags) so WebGPU shows textures instead of a flat override.
 */
function materialToUnlit(src: THREE.Material): MeshBasicNodeMaterial {
  const out = new MeshBasicNodeMaterial({ fog: false });
  out.userData.devUnlitDisposable = true;
  out.lights = false;
  out.side = src.side;
  out.transparent = src.transparent;
  out.opacity = src.opacity;
  out.depthWrite = src.depthWrite;
  out.depthTest = src.depthTest;

  const anySrc = src as THREE.Material & {
    alphaTest?: number;
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    vertexColors?: boolean;
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveMap?: THREE.Texture | null;
    emissiveIntensity?: number;
    envMap?: THREE.Texture | null;
    envMapIntensity?: number;
  };

  if (typeof anySrc.alphaTest === 'number') {
    out.alphaTest = anySrc.alphaTest;
  }
  if (typeof anySrc.vertexColors === 'boolean') {
    out.vertexColors = anySrc.vertexColors;
  }

  const hasBaseMap = !!anySrc.map;
  if (anySrc.map) {
    out.map = anySrc.map;
  }
  if (anySrc.alphaMap) {
    out.alphaMap = anySrc.alphaMap;
  }

  if (anySrc.color) {
    out.color.copy(anySrc.color);
  } else {
    out.color.set(0xffffff);
  }

  const em = 'emissive' in anySrc ? anySrc.emissive : undefined;
  const emMap = 'emissiveMap' in anySrc ? anySrc.emissiveMap : undefined;
  const emInt = 'emissiveIntensity' in anySrc ? (anySrc.emissiveIntensity ?? 1) : 1;
  if (em && em instanceof THREE.Color) {
    if (!hasBaseMap && emMap) {
      out.map = emMap;
      out.color.copy(em).multiplyScalar(Math.min(1, emInt));
    } else if (!hasBaseMap && em.getHex() !== 0) {
      out.color.copy(em).multiplyScalar(Math.min(1, emInt));
    }
  }

  /**
   * Materials with **no albedo `map`** but strong **scene IBL** (`envMapIntensity`, often with `scene.environment`
   * so `material.envMap` is still null): lit mode is bright from reflections, unlit would look “wrong black/dim”.
   * Stylized clouds also strip maps and may keep **vertex colors** that were only meant to read under lights.
   */
  const isStdPhys =
    src instanceof THREE.MeshStandardMaterial || src instanceof THREE.MeshPhysicalMaterial;
  const envInt = typeof anySrc.envMapIntensity === 'number' ? anySrc.envMapIntensity : 0;
  const noAlbedoMap = !hasBaseMap && !emMap;
  const iblHeavy = isStdPhys && noAlbedoMap && envInt > 0.05;
  const rgbSum = anySrc.color ? anySrc.color.r + anySrc.color.g + anySrc.color.b : 0;

  if (iblHeavy && anySrc.vertexColors) {
    out.vertexColors = false;
    if (rgbSum < 0.25) {
      out.color.set(0.9, 0.91, 0.93);
    }
  } else if (iblHeavy && rgbSum < 0.12) {
    out.color.set(0.9, 0.91, 0.93);
  }

  return out;
}

function restoreOriginalMaterials(scene: THREE.Scene): void {
  scene.overrideMaterial = null;
  scene.traverse((obj) => {
    if (!isObjectMesh(obj) || !obj.material) {
      return;
    }
    const stash = obj.userData[ORIG_KEY] as THREE.Material | THREE.Material[] | undefined;
    if (!stash) {
      return;
    }
    disposeDevUnlitMaterials(obj.material);
    obj.material = stash;
    delete obj.userData[ORIG_KEY];
  });
}

function applyUnlitMaterials(scene: THREE.Scene): void {
  scene.overrideMaterial = null;
  scene.traverse((obj) => {
    if (!isObjectMesh(obj) || !obj.material) {
      return;
    }
    if (obj.userData[ORIG_KEY]) {
      return;
    }
    obj.userData[ORIG_KEY] = obj.material;
    const m = obj.material;
    const waterMesh = obj as THREE.Mesh & { isWater?: boolean };
    if (waterMesh.isWater === true) {
      const src = Array.isArray(m) ? m[0]! : m;
      obj.material = materialToUnlitWater(waterMesh, src);
      return;
    }
    obj.material = Array.isArray(m) ? m.map(materialToUnlit) : materialToUnlit(m);
  });
}

/**
 * Keys: 1 = normal, 2 = unlit, 3 = wireframe.
 * Unlit swaps per-mesh MeshBasicNodeMaterial (map/color) so albedo shows; wireframe uses a scene override.
 */
export function applyDevRenderMode(scene: THREE.Scene, mode: DevRenderMode): void {
  if (mode === 'normal') {
    restoreOriginalMaterials(scene);
    return;
  }
  if (mode === 'unlit') {
    applyUnlitMaterials(scene);
    return;
  }
  scene.overrideMaterial = wireframeOverride;
}
