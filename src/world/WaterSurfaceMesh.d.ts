import type { BufferGeometry, Color, Mesh, Texture, Vector2 } from 'three';

export type WaterSurfaceMeshOptions = {
  color?: string | number | Color;
  flowDirection?: Vector2;
  flowSpeed?: number;
  reflectivity?: number;
  scale?: number;
  /** UV distortion from normals (default 0.034). */
  normalDistort?: number;
  /** Blend toward flat normal; 1 = full map (default 1). */
  normalStrength?: number;
  /** Tiling tangent-space PNG normal maps (RGB); procedural water uses false. */
  standardNormalUnpack?: boolean;
  flowMap?: Texture | null;
  normalMap0: Texture;
  normalMap1: Texture;
};

export class WaterSurfaceMesh extends Mesh {
  declare isWater: true;

  constructor(geometry: BufferGeometry, options: WaterSurfaceMeshOptions);
}
