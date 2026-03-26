import { MeshStandardNodeMaterial } from 'three/webgpu';

/**
 * Matte, scene-lit instanced backdrop cubes (distant candy blocks). No grid / texture — smooth albedo
 * so directional + hemi + ambient read clearly.
 */
export function createBackdropLitMaterial(colorHex: string): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ fog: true });
  material.color.set(colorHex);
  material.metalness = 0;
  material.roughness = 0.78;
  material.envMapIntensity = 0.42;
  return material;
}
