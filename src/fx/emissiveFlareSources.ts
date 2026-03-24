import { BLOCK_UNIT, JUMP_PADS } from '../world/TerrainLayout';
import type { LensFlareEmissiveCandidate } from './LensFlareOverlay';

/** Append jump-pad block centers as bright emissive flare sources (matches TerrainGenerator emissive pads). */
export function appendJumpPadFlareCandidates(out: LensFlareEmissiveCandidate[]): void {
  for (const pad of JUMP_PADS) {
    out.push({
      x: pad.x,
      y: pad.y + BLOCK_UNIT * 0.22,
      z: pad.z,
      intensity: 0.92,
      color: pad.color,
    });
  }
}
