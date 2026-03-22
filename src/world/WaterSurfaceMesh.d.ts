import type { BufferGeometry, Color, Mesh, Texture, Vector2 } from 'three';

export type WaterSurfaceMeshOptions = {
  color?: string | number | Color;
  flowDirection?: Vector2;
  flowSpeed?: number;
  reflectivity?: number;
  scale?: number;
  flowMap?: Texture | null;
  normalMap0: Texture;
  normalMap1: Texture;
};

export class WaterSurfaceMesh extends Mesh {
  declare isWater: true;

  constructor(geometry: BufferGeometry, options: WaterSurfaceMeshOptions);
}
