import { BLOCK_UNIT } from './TerrainLayout';
import { getBackdropFarFrameMetrics } from './DistantWorldBackdrop';

/**
 * Shared with `MountainBackdropProp` — orbit margin beyond `farOuterR` (in block units).
 * Keep these in sync when tuning mountains or water extent.
 * Raised vs the original 54 so silhouettes sit farther from the play area.
 */
export const MOUNTAIN_ORBIT_MARGIN_BLOCKS = 76;

/** Extra blocks for the spawn-nearest mountain slot (pushes that pivot farther out). */
export const MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS = 38;

/** Base longest-axis scale for mountains (before per-instance multipliers). */
export const MOUNTAIN_BASE_TARGET_EXTENT = 118 * 2 * 1.25;

/** Largest `SIZE_MULTIPLIER` on the ring — used to size water past the biggest mesh. */
export const MOUNTAIN_MAX_SIZE_MULTIPLIER = 1.14;

/** Applied after fit-to-extent: uniform scale on X/Y/Z (broader read at range). */
export const MOUNTAIN_MESH_UNIFORM_SCALE = 1.25;

/** Multiplier on Y only after uniform scale; below 1 flattens peaks (0.75 = 25% shorter). */
export const MOUNTAIN_MESH_HEIGHT_SCALE = 0.75;

/**
 * Water disk is centered at world XZ **origin**; mountains orbit the playfield **centroid**.
 * Radius is chosen so the plane reaches the farthest mountain pivot plus mesh slack.
 */
export function getWaterSurfaceRadiusWorld(): number {
  const { centerX, centerZ, farOuterR } = getBackdropFarFrameMetrics();
  const orbitBase = farOuterR + BLOCK_UNIT * MOUNTAIN_ORBIT_MARGIN_BLOCKS;
  const orbitMax = orbitBase + BLOCK_UNIT * MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS;
  const centroidOffset = Math.hypot(centerX, centerZ);
  const meshSlack =
    MOUNTAIN_BASE_TARGET_EXTENT *
    MOUNTAIN_MAX_SIZE_MULTIPLIER *
    MOUNTAIN_MESH_UNIFORM_SCALE *
    0.52;
  return centroidOffset + orbitMax + meshSlack + BLOCK_UNIT * 8;
}

/** Seabed circle slightly wider than water so the edge doesn’t clip. */
export function getSeaBedRadiusWorld(): number {
  return getWaterSurfaceRadiusWorld() + BLOCK_UNIT * 10;
}
