import { Color } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, float, fract, min, mix, positionWorld, smoothstep, color } from 'three/tsl';

export type BackdropGridMaterialOptions = {
  /** World cell size — same as {@link BLOCK_UNIT} for tiles that match the level grid. */
  cellSize: number;
  /** Line thickness in world units (typically ~0.04–0.06 × cellSize). */
  lineWidth?: number;
  /** Darkening on lines (0–1). */
  strength?: number;
};

/**
 * World-space square grid: same spacing on X, Y, Z so every face shows **square** cells in world
 * units. Works with axis-aligned boxes when placement snaps sizes/positions to `cellSize` multiples
 * (see `DistantWorldBackdrop`).
 */
export function createBackdropGridMaterial(
  colorHex: string,
  { cellSize, lineWidth = cellSize * 0.052, strength = 0.12 }: BackdropGridMaterialOptions,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ fog: true });
  const base = color(new Color(colorHex));
  const cell = float(cellSize);
  const lw = float(lineWidth);
  const str = float(strength);
  const one = float(1);

  material.colorNode = Fn(() => {
    const gp = positionWorld;
    const fq = fract(gp.div(cell));
    const wx = min(fq.x, one.sub(fq.x)).mul(cell);
    const wy = min(fq.y, one.sub(fq.y)).mul(cell);
    const wz = min(fq.z, one.sub(fq.z)).mul(cell);
    const edgeDist = min(wx, min(wy, wz));
    const lineFactor = smoothstep(float(0), lw, edgeDist);
    const shade = mix(one.sub(str), one, lineFactor);
    return base.mul(shade);
  })();

  return material;
}
