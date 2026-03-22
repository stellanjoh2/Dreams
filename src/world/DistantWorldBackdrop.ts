import * as THREE from 'three';
import { WORLD_FLOOR_Y } from '../config/defaults';
import { createBackdropGridMaterial } from '../materials/BackdropGridMaterial';
import { BLOCK_UNIT, PLATFORM_TILES } from './TerrainLayout';

/** Matches `BLOCK_COLOR_PALETTE` in TerrainLayout — candy platforms in the distance. */
const BACKDROP_PALETTE = ['#ffb5d8', '#ffd86c', '#a9b8ff', '#ff9bd4', '#ffc98a', '#d8b8ff'] as const;

/** Padding beyond platform AABB — base hole before square framing. */
const PLAY_EXCLUSION_MARGIN = BLOCK_UNIT * 3;

/**
 * Extra empty shell (L∞ / “square radius”) so backdrop doesn’t hug one side of an elongated map.
 */
const BACKDROP_INNER_PUSH_BLOCKS = 5;

/**
 * Main band thickness (world units) outside the square hole.
 */
const CORE_BAND_BLOCKS = 14;

/**
 * Sparse outer band beyond the core (same symmetric square framing).
 */
const OUTER_RING_BLOCKS = 14;

/** Fewer instances; each shape is scaled up — less cluttered skyline. */
const TOTAL_SCATTER_INSTANCES = 190;

/** Extra candy boxes floating **above** the play square (sky clusters). */
const SKY_CLUSTER_MAX = 55;

/** Scales most footprint sizes (blocks) after variant pick — chunky, not needle towers. */
const FOOTPRINT_SCALE = 1.88;

/** Annulus boxes that hover above the floor (like floating pads in the real map). */
const GROUND_LEVITATE_CHANCE = 0.32;
const GROUND_LEVITATE_MIN_BLOCKS = 0.55;
const GROUND_LEVITATE_MAX_BLOCKS = 12;

/**
 * Vertical band (block units above `WORLD_FLOOR_Y`) for sky clusters over the play hole.
 * Clears typical platform stacks; reads as “above the game world”.
 */
const SKY_LIFT_MIN_BLOCKS = 14;
const SKY_LIFT_MAX_BLOCKS = 40;

/** Aerial props: keep silhouettes broad / low (no skyline over the map). */
const SKY_MAX_HEIGHT_BLOCKS = 2.15;
const SKY_FOOTPRINT_MUL = 1.06;

/** Minimum gap between box footprints on XZ (avoids intersection and face z-fighting). */
const BOX_SEPARATION_GAP = BLOCK_UNIT * 0.06;

/** Snap world coords so box bounds land on `BLOCK_UNIT` planes (world grid shader lines up). */
function snapWorldToGridPlane(w: number): number {
  return Math.round(w / BLOCK_UNIT) * BLOCK_UNIT;
}

/** Deterministic [0, 1). */
function rnd(seed: number, salt: number): number {
  const t = Math.sin(seed * 12.9898 + salt * 43758.5453) * 43758.5453123;
  return t - Math.floor(t);
}

type AxisRect = { minX: number; maxX: number; minZ: number; maxZ: number };

type XZFootprint = { minX: number; maxX: number; minZ: number; maxZ: number };

type BandCell = { gx: number; gz: number; outerRing: boolean };

/** Square framing: same “distance to backdrop start” in all compass directions from play centroid. */
type SquareFrame = {
  worldCX: number;
  worldCZ: number;
  /** L∞ radius of the empty hole (no backdrop inside). */
  halfIn: number;
  /** L∞ radius where core band ends / outer ring starts. */
  coreOuterR: number;
  /** L∞ radius of outermost backdrop cells. */
  farOuterR: number;
};

function computePlayExclusionXZ(): AxisRect {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of PLATFORM_TILES) {
    const hx = t.width * 0.5;
    const hz = t.depth * 0.5;
    minX = Math.min(minX, t.x - hx);
    maxX = Math.max(maxX, t.x + hx);
    minZ = Math.min(minZ, t.z - hz);
    maxZ = Math.max(maxZ, t.z + hz);
  }
  return {
    minX: minX - PLAY_EXCLUSION_MARGIN,
    maxX: maxX + PLAY_EXCLUSION_MARGIN,
    minZ: minZ - PLAY_EXCLUSION_MARGIN,
    maxZ: maxZ + PLAY_EXCLUSION_MARGIN,
  };
}

/**
 * Circumscribed square hole (centered on play AABB) + push — fixes “one side near, one far” on rectangular maps.
 */
function computeSquareFrame(inner: AxisRect): SquareFrame {
  const worldCX = (inner.minX + inner.maxX) * 0.5;
  const worldCZ = (inner.minZ + inner.maxZ) * 0.5;
  const halfX = (inner.maxX - inner.minX) * 0.5;
  const halfZ = (inner.maxZ - inner.minZ) * 0.5;
  const halfRect = Math.max(halfX, halfZ);
  const halfIn = halfRect + BACKDROP_INNER_PUSH_BLOCKS * BLOCK_UNIT;
  const coreOuterR = halfIn + CORE_BAND_BLOCKS * BLOCK_UNIT;
  const farOuterR = coreOuterR + OUTER_RING_BLOCKS * BLOCK_UNIT;
  return { worldCX, worldCZ, halfIn, coreOuterR, farOuterR };
}

function chebFromCenter(cx: number, cz: number, frame: SquareFrame): number {
  return Math.max(Math.abs(cx - frame.worldCX), Math.abs(cz - frame.worldCZ));
}

/** Tile center convention: same as `anchorFromGridUnits` in TerrainLayout. */
function gridCenterX(gx: number): number {
  return (gx + 0.5) * BLOCK_UNIT;
}

function gridCenterZ(gz: number): number {
  return (gz + 0.5) * BLOCK_UNIT;
}

function gridIndexRange(rect: AxisRect): { minGx: number; maxGx: number; minGz: number; maxGz: number } {
  return {
    minGx: Math.ceil(rect.minX / BLOCK_UNIT - 0.5),
    maxGx: Math.floor(rect.maxX / BLOCK_UNIT - 0.5),
    minGz: Math.ceil(rect.minZ / BLOCK_UNIT - 0.5),
    maxGz: Math.floor(rect.maxZ / BLOCK_UNIT - 0.5),
  };
}

function xzFootprintsOverlap(a: XZFootprint, b: XZFootprint, gap: number): boolean {
  return !(
    a.maxX + gap <= b.minX ||
    b.maxX + gap <= a.minX ||
    a.maxZ + gap <= b.minZ ||
    b.maxZ + gap <= a.minZ
  );
}

function footprintConflicts(fp: XZFootprint, placed: XZFootprint[], gap: number): boolean {
  for (const p of placed) {
    if (xzFootprintsOverlap(fp, p, gap)) {
      return true;
    }
  }
  return false;
}

function collectBandCellsSquare(frame: SquareFrame): BandCell[] {
  const pad = BLOCK_UNIT * 2;
  const R = frame.farOuterR + pad;
  const rect: AxisRect = {
    minX: frame.worldCX - R,
    maxX: frame.worldCX + R,
    minZ: frame.worldCZ - R,
    maxZ: frame.worldCZ + R,
  };
  const band = gridIndexRange(rect);
  const cells: BandCell[] = [];
  for (let gx = band.minGx; gx <= band.maxGx; gx += 1) {
    for (let gz = band.minGz; gz <= band.maxGz; gz += 1) {
      const cx = gridCenterX(gx);
      const cz = gridCenterZ(gz);
      const d = chebFromCenter(cx, cz, frame);
      if (d <= frame.halfIn) {
        continue;
      }
      if (d > frame.farOuterR) {
        continue;
      }
      const outerRing = d > frame.coreOuterR;
      cells.push({ gx, gz, outerRing });
    }
  }
  return cells;
}

/** Grid cells inside the square hole — for levitating clusters **above** the play world (XZ only vs other floaters). */
function collectHoleInteriorCells(frame: SquareFrame): BandCell[] {
  const R = frame.halfIn + BLOCK_UNIT * 2;
  const rect: AxisRect = {
    minX: frame.worldCX - R,
    maxX: frame.worldCX + R,
    minZ: frame.worldCZ - R,
    maxZ: frame.worldCZ + R,
  };
  const band = gridIndexRange(rect);
  const cells: BandCell[] = [];
  for (let gx = band.minGx; gx <= band.maxGx; gx += 1) {
    for (let gz = band.minGz; gz <= band.maxGz; gz += 1) {
      const cx = gridCenterX(gx);
      const cz = gridCenterZ(gz);
      if (chebFromCenter(cx, cz, frame) <= frame.halfIn) {
        cells.push({ gx, gz, outerRing: false });
      }
    }
  }
  return cells;
}

/** Fisher–Yates shuffle so fill order isn’t biased to one corner. */
function shuffleBandCells(cells: BandCell[]): void {
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd(i * 834437 + cells.length, 88) * (i + 1));
    const t = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = t;
  }
}

/** Low attempt rate — fewer pieces; outer ring very sparse. */
function cellScatterPass(gx: number, gz: number, outerRing: boolean): boolean {
  const r = rnd(gx * 524287 + gz * 6151, 20);
  if (outerRing) {
    const hi = 0.07 + rnd(gx + gz * 193, 21) * 0.14;
    return r < hi;
  }
  const lo = 0.14 + rnd(gx * 131 + gz * 977, 22) * 0.2;
  return r < lo;
}

/** Sky layer over the hole — sparse so it reads as drifting clusters, not a ceiling. */
function skyCellScatterPass(gx: number, gz: number): boolean {
  const r = rnd(gx * 322951 + gz * 499, 400);
  const lo = 0.15 + rnd(gx + gz * 277, 401) * 0.32;
  return r < lo;
}

type SizeTry = { footW: number; footD: number; heightBlocks: number };

function scaleTryFeet(t: SizeTry, k: number): SizeTry {
  return {
    footW: t.footW * k,
    footD: t.footD * k,
    heightBlocks: t.heightBlocks,
  };
}

/** Keep skinny footprints from becoming skyscrapers — landscape of blocks, not a skyline. */
function clampNeedleTowers(t: SizeTry): SizeTry {
  const minFoot = Math.min(t.footW, t.footD);
  if (minFoot >= 1.15) {
    return t;
  }
  const maxRatio = minFoot < 0.48 ? 3.0 : minFoot < 0.72 ? 2.45 : 2.05;
  const cap = minFoot * maxRatio;
  if (t.heightBlocks > cap) {
    return { ...t, heightBlocks: Math.max(0.22, cap) };
  }
  return t;
}

/**
 * Box archetypes biased **larger** (pads, mesas, planks, cubes); thin tiles are rarer.
 * `aerial`: sky clusters — slightly wider feet, hard cap on height (no skyline over the map).
 */
function buildSizeAttempts(gx: number, gz: number, outerRing: boolean, aerial: boolean): SizeTry[] {
  const variantRoll = rnd(gx * 7919 + gz, 4);
  let primary: SizeTry;

  if (variantRoll < 0.06) {
    primary = {
      footW: 1.0 + rnd(gx, 5) * 3.8,
      footD: 1.0 + rnd(gz, 6) * 3.8,
      heightBlocks: 0.22 + rnd(gx + gz, 7) * 0.42,
    };
  } else if (variantRoll < 0.17) {
    primary = {
      footW: 1.35 + rnd(gx, 8) * 3.6,
      footD: 1.2 + rnd(gz, 9) * 3.4,
      heightBlocks: 0.42 + rnd(gx * 13 + gz, 10) * 0.65,
    };
  } else if (variantRoll < 0.32) {
    primary = {
      footW: 1.55 + rnd(gx, 11) * 4.5,
      footD: 1.35 + rnd(gz, 12) * 4.0,
      heightBlocks: 0.62 + rnd(gx + gz * 19, 13) * 1.05,
    };
  } else if (variantRoll < 0.44) {
    const long = 2.6 + rnd(gx, 14) * 5.2;
    const short = 0.65 + rnd(gz, 15) * 1.55;
    primary = {
      footW: long,
      footD: short,
      heightBlocks: 0.48 + rnd(gx * 29 + gz, 16) * 0.88,
    };
  } else if (variantRoll < 0.55) {
    const s = 0.78 + rnd(gx + gz * 23, 17) * 1.45;
    const squash = 0.78 + rnd(gx, 18) * 0.38;
    primary = {
      footW: s * squash * 0.92,
      footD: s * (1.12 - squash * 0.35 + rnd(gz, 19) * 0.25) * 0.92,
      heightBlocks: s * (0.72 + rnd(gx * 7 + gz, 20) * 0.55),
    };
  } else if (variantRoll < 0.65) {
    primary = {
      footW: 1.05 + rnd(gx, 21) * 2.85,
      footD: 1.05 + rnd(gz, 22) * 2.85,
      heightBlocks: 0.82 + rnd(gx * 41 + gz, 23) * 1.35,
    };
  } else if (variantRoll < 0.74) {
    primary = {
      footW: 1.65 + rnd(gx, 24) * 4.2,
      footD: 1.4 + rnd(gz, 25) * 3.6,
      heightBlocks: 0.95 + rnd(gx + gz * 31, 26) * 1.45,
    };
  } else if (variantRoll < 0.82) {
    const e = 0.62 + rnd(gx * 17 + gz, 27) * 0.85;
    primary = {
      footW: e * (0.88 + rnd(gx, 28) * 0.22),
      footD: e * (0.88 + rnd(gz, 29) * 0.22),
      heightBlocks: e * (0.92 + rnd(gx + gz, 30) * 0.4),
    };
  } else if (variantRoll < 0.89) {
    primary = {
      footW: 0.85 + rnd(gx, 31) * 3.2,
      footD: 2.0 + rnd(gz, 32) * 4.5,
      heightBlocks: 0.55 + rnd(gx * 53 + gz, 33) * 1.0,
    };
  } else if (variantRoll < 0.96) {
    primary = {
      footW: 0.88 + rnd(gx, 34) * 1.85,
      footD: 0.88 + rnd(gz, 35) * 1.85,
      heightBlocks: 1.2 + rnd(gx * 59 + gz, 36) * 1.55,
    };
  } else {
    primary = {
      footW: 0.52 + rnd(gx, 37) * 0.48,
      footD: 0.52 + rnd(gz, 38) * 0.48,
      heightBlocks: 2.1 + rnd(gx + gz * 37, 39) * 2.35,
    };
  }

  primary = scaleTryFeet(primary, FOOTPRINT_SCALE);
  primary = clampNeedleTowers(primary);

  if (outerRing) {
    primary = {
      footW: Math.max(0.42, primary.footW * (0.72 + rnd(gx, 60) * 0.2)),
      footD: Math.max(0.42, primary.footD * (0.72 + rnd(gz, 61) * 0.2)),
      heightBlocks: Math.max(0.22, primary.heightBlocks * (0.65 + rnd(gx + gz, 62) * 0.26)),
    };
    primary = clampNeedleTowers(primary);
  }

  if (aerial) {
    primary = {
      footW: primary.footW * SKY_FOOTPRINT_MUL,
      footD: primary.footD * SKY_FOOTPRINT_MUL,
      heightBlocks: Math.min(primary.heightBlocks, SKY_MAX_HEIGHT_BLOCKS),
    };
    primary = clampNeedleTowers(primary);
  }

  const shrink = (t: SizeTry, k: number): SizeTry =>
    clampNeedleTowers({
      footW: Math.max(0.4, t.footW * k),
      footD: Math.max(0.4, t.footD * k),
      heightBlocks: Math.max(0.22, t.heightBlocks * (0.78 + (1 - k) * 0.14)),
    });

  return [
    primary,
    shrink(primary, 0.76),
    shrink(primary, 0.56),
    shrink(primary, 0.4),
    clampNeedleTowers(
      scaleTryFeet(
        {
          footW: 0.55 + rnd(gx, 200) * 3.0,
          footD: 0.55 + rnd(gz, 201) * 3.0,
          heightBlocks: 0.32 + rnd(gx + gz, 202) * 1.05,
        },
        FOOTPRINT_SCALE * 0.92,
      ),
    ),
    clampNeedleTowers(
      scaleTryFeet(
        {
          footW: 0.65 + rnd(gx, 203) * 1.35,
          footD: 0.65 + rnd(gz, 204) * 1.35,
          heightBlocks: 0.62 + rnd(gx * 67 + gz, 205) * 1.15,
        },
        FOOTPRINT_SCALE * 0.88,
      ),
    ),
  ];
}

type BackdropPlacementKind = 'annulus' | 'sky';

/**
 * Place one candy box at (gx,gz) if some footprint size fits without XZ overlap with existing boxes.
 * Annulus: optional low hover above the floor. Sky: stacked band well above the play square.
 */
function tryPushBackdropInstance(
  matrices: THREE.Matrix4[][],
  dummy: THREE.Object3D,
  gx: number,
  gz: number,
  outerRing: boolean,
  placed: XZFootprint[],
  gap: number,
  kind: BackdropPlacementKind,
): boolean {
  const attempts = buildSizeAttempts(gx, gz, outerRing, kind === 'sky');

  for (const { footW, footD, heightBlocks } of attempts) {
    let cx = gridCenterX(gx);
    let cz = gridCenterZ(gz);
    const effW = footW;
    const effD = footD;
    /** Integer block counts so every face shows whole grid cells (matches world-space grid shader). */
    const nW = Math.max(1, Math.round(effW));
    const nD = Math.max(1, Math.round(effD));
    const nH = Math.max(1, Math.round(heightBlocks));
    const xScale = nW * BLOCK_UNIT;
    const zScale = nD * BLOCK_UNIT;
    const yScale = nH * BLOCK_UNIT;
    const hw = xScale * 0.5;
    const hd = zScale * 0.5;

    const minXAligned = snapWorldToGridPlane(cx - hw);
    const minZAligned = snapWorldToGridPlane(cz - hd);
    cx = minXAligned + hw;
    cz = minZAligned + hd;

    const fp: XZFootprint = {
      minX: cx - hw,
      maxX: cx + hw,
      minZ: cz - hd,
      maxZ: cz + hd,
    };
    if (footprintConflicts(fp, placed, gap)) {
      continue;
    }

    let liftBottom = 0;
    if (kind === 'annulus') {
      if (rnd(gx * 223 + gz, 410) < GROUND_LEVITATE_CHANCE) {
        liftBottom =
          (GROUND_LEVITATE_MIN_BLOCKS +
            rnd(gx * 877 + gz * 431, 411) * (GROUND_LEVITATE_MAX_BLOCKS - GROUND_LEVITATE_MIN_BLOCKS)) *
          BLOCK_UNIT;
      }
    } else {
      liftBottom =
        (SKY_LIFT_MIN_BLOCKS +
          rnd(gx * 1201 + gz * 919, 412) * (SKY_LIFT_MAX_BLOCKS - SKY_LIFT_MIN_BLOCKS)) *
        BLOCK_UNIT;
    }

    const bottomY = snapWorldToGridPlane(WORLD_FLOOR_Y + liftBottom);
    const y = bottomY + yScale * 0.5;

    dummy.position.set(cx, y, cz);
    dummy.scale.set(xScale, yScale, zScale);
    dummy.rotation.y = 0;
    dummy.updateMatrix();

    const c =
      Math.floor(rnd(gx * 1109 + gz * 104729, 15) * BACKDROP_PALETTE.length) % BACKDROP_PALETTE.length;
    matrices[c].push(dummy.matrix.clone());
    placed.push(fp);
    return true;
  }

  return false;
}

/**
 * Square **annulus** (L∞ distance from play centroid) so backdrop sits evenly on all sides.
 * Integer `n×BLOCK_UNIT` sizes + snapped origins so the **world-space** grid on backdrop materials
 * shows square cells with edges on grid lines.
 */
export function createDistantWorldBackdrop(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'DistantWorldBackdrop';

  const inner = computePlayExclusionXZ();
  const frame = computeSquareFrame(inner);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();

  const matrices: THREE.Matrix4[][] = BACKDROP_PALETTE.map(() => []);
  const placedFootprints: XZFootprint[] = [];
  let placed = 0;

  const candidates = collectBandCellsSquare(frame);
  shuffleBandCells(candidates);

  for (const { gx, gz, outerRing } of candidates) {
    if (!cellScatterPass(gx, gz, outerRing)) {
      continue;
    }
    if (
      tryPushBackdropInstance(
        matrices,
        dummy,
        gx,
        gz,
        outerRing,
        placedFootprints,
        BOX_SEPARATION_GAP,
        'annulus',
      )
    ) {
      placed += 1;
      if (placed >= TOTAL_SCATTER_INSTANCES) {
        break;
      }
    }
  }

  const skyCells = collectHoleInteriorCells(frame);
  shuffleBandCells(skyCells);
  let skyPlaced = 0;
  for (const { gx, gz } of skyCells) {
    if (!skyCellScatterPass(gx, gz)) {
      continue;
    }
    if (
      tryPushBackdropInstance(
        matrices,
        dummy,
        gx,
        gz,
        false,
        placedFootprints,
        BOX_SEPARATION_GAP,
        'sky',
      )
    ) {
      skyPlaced += 1;
      if (skyPlaced >= SKY_CLUSTER_MAX) {
        break;
      }
    }
  }

  for (let c = 0; c < BACKDROP_PALETTE.length; c += 1) {
    const n = matrices[c].length;
    if (n === 0) {
      continue;
    }
    const material = createBackdropGridMaterial(BACKDROP_PALETTE[c], {
      cellSize: BLOCK_UNIT,
      lineWidth: BLOCK_UNIT * 0.055,
      strength: 0.125,
    });
    const mesh = new THREE.InstancedMesh(unitBox, material, n);
    mesh.name = `DistantBackdrop_${c}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (let i = 0; i < n; i += 1) {
      mesh.setMatrixAt(i, matrices[c][i]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
  }

  return root;
}
