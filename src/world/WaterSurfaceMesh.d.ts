import type { BufferGeometry, Color, Mesh, Texture, Vector2 } from 'three';

export type WaterSurfaceMeshOptions = {
  color?: string | number | Color;
  flowDirection?: Vector2;
  flowSpeed?: number;
  reflectivity?: number;
  /** Scales reflection amount in the refraction/reflection mix (default 1). */
  reflectionStrength?: number;
  /** Pow on fresnel mix factor (default 1). */
  reflectionContrast?: number;
  scale?: number;
  /** UV distortion from normals (default 0.034). */
  normalDistort?: number;
  /** Blend toward flat normal; 1 = full map (default 1). */
  normalStrength?: number;
  /** Tiling tangent-space PNG normal maps (RGB); procedural water uses false. */
  standardNormalUnpack?: boolean;
  /** Depth-buffer foam: linear-depth ramp width; small = thin rim (typ. 0.005–0.014). */
  foamDepthWidth?: number;
  /** Max blend toward foam white (0–1). */
  foamIntensity?: number;
  flowMap?: Texture | null;
  normalMap0: Texture;
  normalMap1: Texture;
};

export class WaterSurfaceMesh extends Mesh {
  declare isWater: true;

  constructor(geometry: BufferGeometry, options: WaterSurfaceMeshOptions);
}
