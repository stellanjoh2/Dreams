import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Loads `game_ready_low_poly_crystal.glb` (or any crystal GLB), merges mesh parts, and normalizes
 * bounding-sphere radius to match `sizeReference` so existing instance scales stay valid.
 */
export async function loadCrystalPickupGeometryFromGlb(
  loader: GLTFLoader,
  url: string,
  sizeReference: THREE.BufferGeometry,
): Promise<THREE.BufferGeometry> {
  const gltf = await loader.loadAsync(url);
  const parts: THREE.BufferGeometry[] = [];

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      parts.push(g);
    }
  });

  if (parts.length === 0) {
    throw new Error('Crystal GLB contains no mesh geometry');
  }

  const merged =
    parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (!merged) {
    throw new Error('Failed to merge crystal mesh parts');
  }
  merged.computeVertexNormals();

  sizeReference.computeBoundingSphere();
  const targetR = sizeReference.boundingSphere?.radius ?? 0.55;
  merged.computeBoundingSphere();
  const srcR = merged.boundingSphere?.radius ?? 1;
  const s = targetR / Math.max(srcR, 1e-6);
  merged.scale(s, s, s);

  merged.computeBoundingBox();
  const minY = merged.boundingBox?.min.y ?? 0;
  merged.translate(0, -minY, 0);

  return merged;
}
