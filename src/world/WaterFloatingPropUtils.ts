import * as THREE from 'three';

export function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

/**
 * Water is transparent with `depthWrite: false`; keep opaque props writing depth so sorting stays stable.
 */
export function tunePropMaterialsForWater(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    mesh.renderOrder = 0;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      const m = mat as THREE.MeshPhysicalMaterial;
      const transmission = 'transmission' in m ? Number(m.transmission) : 0;
      if (transmission > 0.05) {
        m.depthWrite = true;
        m.depthTest = true;
        m.needsUpdate = true;
        continue;
      }
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
 * Scale to target size, center on XZ, align bottom to local y=0 then nudge for waterline.
 */
export function normalizeVerticalForWaterline(
  model: THREE.Object3D,
  targetMaxExtent: number,
  waterlineAdjust: number,
): void {
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
  model.position.y += waterlineAdjust;
}
