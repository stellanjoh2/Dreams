import { BLOCK_UNIT } from './TerrainLayout';
import { WATER_GRASS_BARREL_CLEARANCE_RADIUS } from './WaterEdgeGrassScatter';

/**
 * Single place to tune floating barrel spawn distances (platform / grass / boats / spacing).
 * Geometry checks live in {@link FloatingBarrelsProp}; values here are world-space where noted.
 */
export const FLOATING_BARREL_SPAWN = {
  count: 3,
  /** Fishing boat hull clearance (world units); squared for dist² checks. */
  boatExclusionRadius: 11.5,
  /** Added to `BLOCK_UNIT * tileEdgeMarginBase` for platform top clearance past tile edges. */
  tileEdgeMarginBase: 0.72,
  tileEdgeMarginExtra: 1.55,
  elevatorPadBase: 0.62,
  elevatorPadExtra: 1.15,
  pairSpacingMultMin: 2.85,
  pairSpacingMultRelaxed: 1.45,
  gridPadBlocks: 9,
  gridStepMult: 0.52,
} as const;

export type BarrelSpawnDerived = {
  boatExclusionRSq: number;
  platformSurfaceMargin: number;
  elevatorPad: number;
  grassClearRSq: number;
  pairMinSq: number;
  pairRelaxedSq: number;
  gridPad: number;
  gridStep: number;
};

export function getBarrelSpawnDerived(): BarrelSpawnDerived {
  const s = FLOATING_BARREL_SPAWN;
  return {
    boatExclusionRSq: s.boatExclusionRadius ** 2,
    platformSurfaceMargin: BLOCK_UNIT * s.tileEdgeMarginBase + s.tileEdgeMarginExtra,
    elevatorPad: BLOCK_UNIT * s.elevatorPadBase + s.elevatorPadExtra,
    grassClearRSq: WATER_GRASS_BARREL_CLEARANCE_RADIUS ** 2,
    pairMinSq: (BLOCK_UNIT * s.pairSpacingMultMin) ** 2,
    pairRelaxedSq: (BLOCK_UNIT * s.pairSpacingMultRelaxed) ** 2,
    gridPad: BLOCK_UNIT * s.gridPadBlocks,
    gridStep: BLOCK_UNIT * s.gridStepMult,
  };
}
