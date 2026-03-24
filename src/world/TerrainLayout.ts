export const BLOCK_UNIT = 1.75;
export const BLOCK_BASE_UNITS = -1;

export type BlockRole = 'spawn' | 'path' | 'challenge' | 'decor';
export type FootprintId = '1x1' | '1x2' | '2x2' | '2x3' | '3x3' | '4x3' | '4x4' | '5x4' | '5x5';

export const FOOTPRINTS: Record<FootprintId, { widthUnits: number; depthUnits: number }> = {
  '1x1': { widthUnits: 1, depthUnits: 1 },
  '1x2': { widthUnits: 1, depthUnits: 2 },
  '2x2': { widthUnits: 2, depthUnits: 2 },
  '2x3': { widthUnits: 2, depthUnits: 3 },
  '3x3': { widthUnits: 3, depthUnits: 3 },
  '4x3': { widthUnits: 4, depthUnits: 3 },
  '4x4': { widthUnits: 4, depthUnits: 4 },
  '5x4': { widthUnits: 5, depthUnits: 4 },
  '5x5': { widthUnits: 5, depthUnits: 5 },
};

type TileOffset = readonly [x: number, z: number];

export type PlatformCluster = {
  id: string;
  islandId: string;
  footprint: FootprintId;
  gridX: number;
  gridZ: number;
  widthUnits: number;
  depthUnits: number;
  baseHeightUnits: number;
  heightUnits: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  stackCount: number;
  topY: number;
  baseY: number;
  color: string;
  role: BlockRole;
  tiles: readonly TileOffset[];
};

export type PlatformTile = {
  id: string;
  clusterId: string;
  islandId: string;
  role: BlockRole;
  localX: number;
  localZ: number;
  gridX: number;
  gridZ: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  baseHeightUnits: number;
  heightUnits: number;
  stackCount: number;
  topY: number;
  baseY: number;
  color: string;
  exposedLeft: boolean;
  exposedRight: boolean;
  exposedFront: boolean;
  exposedBack: boolean;
};

export type JumpPadDefinition = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  y: number;
  boostX: number;
  boostY: number;
  boostZ: number;
  color: string;
};

export type MovingPlatformDefinition = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  clusterId: string;
  baseHeightUnits: number;
  travelUnits: number;
  speed: number;
  phase: number;
  color: string;
};

export type WorldAnchor = {
  x: number;
  z: number;
};

export type DecorAnchor = WorldAnchor & {
  kind: 'tree' | 'cactus' | 'rock' | 'monolith';
  yaw: number;
  scale: number;
  heightOffsetUnits: number;
  tiltAmount: number;
  primaryColor: string;
  secondaryColor?: string;
};

export type CrystalAnchor = WorldAnchor & {
  color: string;
};

type ClusterSpec = {
  id: string;
  islandId: string;
  gridX: number;
  gridZ: number;
  footprint: FootprintId;
  baseHeightUnits?: number;
  heightUnits: number;
  paletteIndex: number;
  role?: BlockRole;
  tiles?: readonly TileOffset[];
};

const BLOCK_COLOR_PALETTE = ['#ffb5d8', '#ffd86c', '#a9b8ff', '#ff9bd4', '#ffc98a', '#d8b8ff'] as const;

const rectTiles = (widthUnits: number, depthUnits: number): TileOffset[] => {
  const tiles: TileOffset[] = [];

  for (let z = 0; z < depthUnits; z += 1) {
    for (let x = 0; x < widthUnits; x += 1) {
      tiles.push([x, z]);
    }
  }

  return tiles;
};

const withoutTiles = (tiles: readonly TileOffset[], omitted: readonly TileOffset[]): TileOffset[] => {
  const omittedKeys = new Set(omitted.map(([x, z]) => `${x}:${z}`));
  return tiles.filter(([x, z]) => !omittedKeys.has(`${x}:${z}`));
};

const CLUSTER_SPECS: ClusterSpec[] = [
  {
    id: 'spawn-a',
    islandId: 'south-west',
    gridX: -8,
    gridZ: 14,
    footprint: '5x5',
    heightUnits: 1,
    paletteIndex: 0,
    role: 'spawn',
    tiles: withoutTiles(rectTiles(5, 5), [[4, 4], [0, 4]]),
  },
  { id: 'spawn-b', islandId: 'south-west', gridX: -4, gridZ: 13, footprint: '3x3', heightUnits: 1, paletteIndex: 1, role: 'path' },
  { id: 'spawn-c', islandId: 'south-west', gridX: 0, gridZ: 11, footprint: '4x3', heightUnits: 2, paletteIndex: 2, role: 'path' },
  { id: 'spawn-d', islandId: 'south-west', gridX: -2, gridZ: 8, footprint: '1x1', heightUnits: 1, paletteIndex: 3, role: 'path' },
  { id: 'spawn-e', islandId: 'south-west', gridX: 3, gridZ: 8, footprint: '2x2', heightUnits: 2, paletteIndex: 4, role: 'path' },
  {
    id: 'spawn-f',
    islandId: 'south-west',
    gridX: 5,
    gridZ: 7,
    footprint: '5x4',
    heightUnits: 2,
    paletteIndex: 5,
    role: 'path',
  },
  { id: 'south-a', islandId: 'south-central', gridX: 8, gridZ: 10, footprint: '3x3', heightUnits: 1, paletteIndex: 1, role: 'spawn' },
  { id: 'south-b', islandId: 'south-central', gridX: 8, gridZ: 6, footprint: '5x5', heightUnits: 2, paletteIndex: 0, role: 'path' },
  { id: 'south-c', islandId: 'south-central', gridX: 8, gridZ: 1, footprint: '5x4', baseHeightUnits: 1, heightUnits: 4, paletteIndex: 2, role: 'path' },
  {
    id: 'south-d',
    islandId: 'south-central',
    gridX: 8,
    gridZ: -5,
    footprint: '5x5',
    baseHeightUnits: 3,
    heightUnits: 6,
    paletteIndex: 4,
    role: 'path',
    tiles: withoutTiles(rectTiles(5, 5), [[4, 0], [0, 4], [4, 4]]),
  },
  {
    id: 'south-float-a',
    islandId: 'south-central',
    gridX: 8,
    gridZ: -10,
    footprint: '2x2',
    baseHeightUnits: 5,
    heightUnits: 8,
    paletteIndex: 5,
    role: 'challenge',
  },
  { id: 'mid-a', islandId: 'midline', gridX: 3, gridZ: 2, footprint: '3x3', heightUnits: 2, paletteIndex: 3, role: 'path' },
  { id: 'mid-b', islandId: 'midline', gridX: 4, gridZ: -2, footprint: '5x5', baseHeightUnits: 2, heightUnits: 5, paletteIndex: 5, role: 'path' },
  { id: 'mid-c', islandId: 'midline', gridX: 5, gridZ: -7, footprint: '5x4', baseHeightUnits: 5, heightUnits: 8, paletteIndex: 1, role: 'path' },
  {
    id: 'mid-d',
    islandId: 'midline',
    gridX: 5,
    gridZ: -12,
    footprint: '5x5',
    baseHeightUnits: 8,
    heightUnits: 11,
    paletteIndex: 0,
    role: 'path',
    tiles: withoutTiles(rectTiles(5, 5), [[0, 4], [4, 0], [4, 4], [2, 4]]),
  },
  {
    id: 'mid-float-a',
    islandId: 'midline',
    gridX: 6,
    gridZ: -17,
    footprint: '2x3',
    baseHeightUnits: 10,
    heightUnits: 13,
    paletteIndex: 2,
    role: 'challenge',
  },
  { id: 'west-a', islandId: 'west-grove', gridX: -2, gridZ: -1, footprint: '3x3', heightUnits: 2, paletteIndex: 4, role: 'path' },
  { id: 'west-b', islandId: 'west-grove', gridX: -3, gridZ: -6, footprint: '3x3', baseHeightUnits: 3, heightUnits: 6, paletteIndex: 2, role: 'path' },
  { id: 'west-c', islandId: 'west-grove', gridX: -2, gridZ: -11, footprint: '3x3', baseHeightUnits: 6, heightUnits: 9, paletteIndex: 5, role: 'path' },
  { id: 'north-a', islandId: 'north-challenge', gridX: 6, gridZ: -22, footprint: '2x2', baseHeightUnits: 12, heightUnits: 15, paletteIndex: 3, role: 'challenge' },
  { id: 'north-b', islandId: 'north-challenge', gridX: 7, gridZ: -27, footprint: '4x3', baseHeightUnits: 14, heightUnits: 17, paletteIndex: 1, role: 'challenge' },
  {
    id: 'north-c',
    islandId: 'north-challenge',
    gridX: 8,
    gridZ: -33,
    footprint: '4x4',
    baseHeightUnits: 16,
    heightUnits: 19,
    paletteIndex: 0,
    role: 'challenge',
    tiles: withoutTiles(rectTiles(4, 4), [[0, 0], [3, 3]]),
  },
  { id: 'east-a', islandId: 'east-challenge', gridX: 11, gridZ: -17, footprint: '3x3', baseHeightUnits: 9, heightUnits: 12, paletteIndex: 4, role: 'challenge' },
  { id: 'east-b', islandId: 'east-challenge', gridX: 14, gridZ: -22, footprint: '4x3', baseHeightUnits: 12, heightUnits: 15, paletteIndex: 2, role: 'challenge' },
  { id: 'bonus-a', islandId: 'scatter', gridX: 0, gridZ: -18, footprint: '3x3', baseHeightUnits: 9, heightUnits: 12, paletteIndex: 5, role: 'challenge' },
  { id: 'bonus-b', islandId: 'scatter', gridX: 0, gridZ: -13, footprint: '4x4', baseHeightUnits: 8, heightUnits: 11, paletteIndex: 1, role: 'path' },
];

export const PLATFORM_CLUSTERS: PlatformCluster[] = CLUSTER_SPECS.map((spec) => {
  const footprint = FOOTPRINTS[spec.footprint];
  const baseHeightUnits = spec.baseHeightUnits ?? BLOCK_BASE_UNITS;
  const topY = spec.heightUnits * BLOCK_UNIT;
  const stackCount = spec.heightUnits - baseHeightUnits;
  const baseY = baseHeightUnits * BLOCK_UNIT;

  return {
    id: spec.id,
    islandId: spec.islandId,
    footprint: spec.footprint,
    gridX: spec.gridX,
    gridZ: spec.gridZ,
    widthUnits: footprint.widthUnits,
    depthUnits: footprint.depthUnits,
    baseHeightUnits,
    heightUnits: spec.heightUnits,
    x: (spec.gridX + footprint.widthUnits * 0.5) * BLOCK_UNIT,
    z: (spec.gridZ + footprint.depthUnits * 0.5) * BLOCK_UNIT,
    width: footprint.widthUnits * BLOCK_UNIT,
    depth: footprint.depthUnits * BLOCK_UNIT,
    height: topY - baseY,
    stackCount,
    topY,
    baseY,
    color: BLOCK_COLOR_PALETTE[spec.paletteIndex % BLOCK_COLOR_PALETTE.length],
    role: spec.role ?? 'path',
    tiles: spec.tiles ?? rectTiles(footprint.widthUnits, footprint.depthUnits),
  };
});

const CLUSTER_COLOR_BY_ID = new Map(PLATFORM_CLUSTERS.map((cluster) => [cluster.id, cluster.color] as const));
const colorForCluster = (clusterId: string, fallbackPaletteIndex = 0): string =>
  CLUSTER_COLOR_BY_ID.get(clusterId) ?? BLOCK_COLOR_PALETTE[fallbackPaletteIndex % BLOCK_COLOR_PALETTE.length];

const tileKey = (gridX: number, gridZ: number): string => `${gridX}:${gridZ}`;

/** One decor prop (plant/tree/crystal/etc.) per surface cell — same key as jump-pad blocking. */
export function surfaceGridKeyFromWorldXZ(x: number, z: number): string {
  const gx = Math.round(x / BLOCK_UNIT - 0.5);
  const gz = Math.round(z / BLOCK_UNIT - 0.5);
  return `${gx}:${gz}`;
}

export function surfaceGridKeyFromTile(tile: { gridX: number; gridZ: number }): string {
  return `${tile.gridX}:${tile.gridZ}`;
}

/** Stamp every surface cell touched by an axis-aligned footprint (jump pad, elevator, …). */
export function addSurfaceGridKeysForFootprint(
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  target: Set<string>,
): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const x0 = centerX - halfW;
  const x1 = centerX + halfW;
  const z0 = centerZ - halfD;
  const z1 = centerZ + halfD;
  const step = BLOCK_UNIT * 0.35;
  for (let wx = x0; wx <= x1; wx += step) {
    for (let wz = z0; wz <= z1; wz += step) {
      target.add(surfaceGridKeyFromWorldXZ(wx, wz));
    }
  }
}
const clusterTileKey = (clusterId: string, localX: number, localZ: number): string => `${clusterId}:${localX}:${localZ}`;

type PlatformTileDraft = Omit<
  PlatformTile,
  'exposedLeft' | 'exposedRight' | 'exposedFront' | 'exposedBack'
>;

const tileDrafts: PlatformTileDraft[] = PLATFORM_CLUSTERS.flatMap((cluster) =>
  cluster.tiles.map(([localX, localZ]) => {
    const gridX = cluster.gridX + localX;
    const gridZ = cluster.gridZ + localZ;

    return {
      id: `${cluster.id}:${localX}-${localZ}`,
      clusterId: cluster.id,
      islandId: cluster.islandId,
      role: cluster.role,
      localX,
      localZ,
      gridX,
      gridZ,
      x: (gridX + 0.5) * BLOCK_UNIT,
      z: (gridZ + 0.5) * BLOCK_UNIT,
      width: BLOCK_UNIT,
      depth: BLOCK_UNIT,
      height: cluster.height,
      baseHeightUnits: cluster.baseHeightUnits,
      heightUnits: cluster.heightUnits,
      stackCount: cluster.stackCount,
      topY: cluster.topY,
      baseY: cluster.baseY,
      color: cluster.color,
    };
  }),
);

const TILE_GRID = new Map(tileDrafts.map((tile) => [tileKey(tile.gridX, tile.gridZ), tile] as const));

const sameSurfaceNeighbor = (tile: PlatformTileDraft, offsetX: number, offsetZ: number): boolean => {
  const neighbor = TILE_GRID.get(tileKey(tile.gridX + offsetX, tile.gridZ + offsetZ));
  return !!neighbor && Math.abs(neighbor.topY - tile.topY) < 0.0001;
};

export const PLATFORM_TILES: PlatformTile[] = tileDrafts.map((tile) => ({
  ...tile,
  exposedLeft: !sameSurfaceNeighbor(tile, -1, 0),
  exposedRight: !sameSurfaceNeighbor(tile, 1, 0),
  exposedFront: !sameSurfaceNeighbor(tile, 0, -1),
  exposedBack: !sameSurfaceNeighbor(tile, 0, 1),
}));

/**
 * One logical surface per world grid cell. When two clusters define the same (gridX, gridZ),
 * {@link PLATFORM_TILES} contains duplicate entries; scattering props on every entry stacks
 * multiple plants at the same XZ with different topY (looks like random floating). Rendering
 * and physics still use the full tile list; use this for decor that should sit on the visible top.
 */
export const PLATFORM_SURFACE_TILES: PlatformTile[] = (() => {
  const map = new Map<string, PlatformTile>();
  for (const tile of PLATFORM_TILES) {
    const key = tileKey(tile.gridX, tile.gridZ);
    const prev = map.get(key);
    if (!prev || tile.topY > prev.topY) {
      map.set(key, tile);
    }
  }
  return [...map.values()];
})();

/** Top surface tile per world grid cell — same keys as {@link surfaceGridKeyFromTile}. */
export function buildSurfaceTileByGridKey(): Map<string, PlatformTile> {
  const m = new Map<string, PlatformTile>();
  for (const t of PLATFORM_SURFACE_TILES) {
    m.set(surfaceGridKeyFromTile(t), t);
  }
  return m;
}

/**
 * The occupied cluster cell whose center is closest to the footprint's continuous center
 * (uneven sizes / cut-outs: picks the nearest tile to the true middle).
 */
export function getClusterCenterSurfaceTile(
  cluster: PlatformCluster,
  surfaceByGridKey: ReadonlyMap<string, PlatformTile>,
): PlatformTile | null {
  const tiles = cluster.tiles;
  if (tiles.length === 0) {
    return null;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of tiles) {
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minZ = Math.min(minZ, lz);
    maxZ = Math.max(maxZ, lz);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let best = tiles[0]!;
  let bestD = Infinity;
  for (const t of tiles) {
    const [lx, lz] = t;
    const d = (lx - cx) * (lx - cx) + (lz - cz) * (lz - cz);
    if (d < bestD - 1e-12) {
      bestD = d;
      best = t;
    } else if (Math.abs(d - bestD) <= 1e-12) {
      if (lx < best[0] || (lx === best[0] && lz < best[1])) {
        best = t;
      }
    }
  }
  const gridX = cluster.gridX + best[0];
  const gridZ = cluster.gridZ + best[1];
  return surfaceByGridKey.get(`${gridX}:${gridZ}`) ?? null;
}

/**
 * All top-surface tiles in this cluster, ordered by distance from the footprint’s continuous center
 * in **local** tile space (center first, then rings). Use when the geometric center cell is a poor tree anchor.
 */
export function listClusterSurfaceTilesNearestFootprintCenterFirst(
  cluster: PlatformCluster,
  surfaceByGridKey: ReadonlyMap<string, PlatformTile>,
): PlatformTile[] {
  const tiles = cluster.tiles;
  if (tiles.length === 0) {
    return [];
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [lx, lz] of tiles) {
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minZ = Math.min(minZ, lz);
    maxZ = Math.max(maxZ, lz);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const wrapped: { tile: PlatformTile; d: number; lx: number; lz: number }[] = [];
  for (const [lx, lz] of tiles) {
    const gx = cluster.gridX + lx;
    const gz = cluster.gridZ + lz;
    const tile = surfaceByGridKey.get(`${gx}:${gz}`);
    if (!tile) {
      continue;
    }
    const d = (lx - cx) * (lx - cx) + (lz - cz) * (lz - cz);
    wrapped.push({ tile, d, lx, lz });
  }
  wrapped.sort((a, b) => a.d - b.d || a.lx - b.lx || a.lz - b.lz);
  return wrapped.map((w) => w.tile);
}

/** Top-surface tile in this cluster with largest world **Z** (e.g. toward the south / high‑Z coast). */
export function getClusterSurfaceTileMaxWorldZ(
  cluster: PlatformCluster,
  surfaceByGridKey: ReadonlyMap<string, PlatformTile>,
): PlatformTile | null {
  let best: PlatformTile | null = null;
  for (const [lx, lz] of cluster.tiles) {
    const gx = cluster.gridX + lx;
    const gz = cluster.gridZ + lz;
    const tile = surfaceByGridKey.get(tileKey(gx, gz));
    if (!tile) {
      continue;
    }
    if (!best || tile.z > best.z) {
      best = tile;
    }
  }
  return best;
}

/** Cardinal + diagonal neighbors in grid space (distance 1). */
const SURFACE_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * True if any **nearby** surface cell (8-neighborhood) tops out **above** this tile — vertical mass
 * right beside the spawn that tall trees tend to intersect.
 */
export function surfaceTileHasNearbyHigherSurface(
  tile: PlatformTile,
  surfaceByGridKey: ReadonlyMap<string, PlatformTile>,
  topYEpsilon = 0.06,
): boolean {
  for (const [dx, dz] of SURFACE_NEIGHBOR_OFFSETS) {
    const nb = surfaceByGridKey.get(`${tile.gridX + dx}:${tile.gridZ + dz}`);
    if (nb && nb.topY > tile.topY + topYEpsilon) {
      return true;
    }
  }
  return false;
}

/**
 * Trees want at least one **exposed** side (ledge / drop / step) so they’re not buried in the interior.
 * We do **not** reject tiles next to taller platforms — that pattern is common on climb routes and removed almost all spawns.
 */
export function surfaceTilePassesTreeSpawnClearance(
  tile: PlatformTile,
  _surfaceByGridKey: ReadonlyMap<string, PlatformTile>,
  minExposedEdges = 1,
): boolean {
  const exposed =
    (tile.exposedLeft ? 1 : 0) +
    (tile.exposedRight ? 1 : 0) +
    (tile.exposedFront ? 1 : 0) +
    (tile.exposedBack ? 1 : 0);
  return exposed >= minExposedEdges;
}

/** Grid cells that contain at least one platform tile (any height). Used to place elevators beside clusters. */
const PLATFORM_GRID_OCCUPIED = new Set(PLATFORM_TILES.map((tile) => tileKey(tile.gridX, tile.gridZ)));

const TILE_BY_CLUSTER_COORD = new Map(
  PLATFORM_TILES.map((tile) => [clusterTileKey(tile.clusterId, tile.localX, tile.localZ), tile] as const),
);

const anchorFromTileUnits = (
  clusterId: string,
  tileX: number,
  tileZ: number,
  offsetXUnits = 0,
  offsetZUnits = 0,
): WorldAnchor => {
  const tile = TILE_BY_CLUSTER_COORD.get(clusterTileKey(clusterId, tileX, tileZ));

  if (!tile) {
    throw new Error(`Unknown tile anchor "${clusterId}" (${tileX}, ${tileZ}) in TerrainLayout.`);
  }

  return {
    x: tile.x + offsetXUnits * BLOCK_UNIT,
    z: tile.z + offsetZUnits * BLOCK_UNIT,
  };
};

const anchorFromGridUnits = (gridX: number, gridZ: number): WorldAnchor => ({
  x: (gridX + 0.5) * BLOCK_UNIT,
  z: (gridZ + 0.5) * BLOCK_UNIT,
});

export const RESPAWN_ANCHORS: WorldAnchor[] = [
  anchorFromTileUnits('spawn-a', 1, 1),
  anchorFromTileUnits('spawn-f', 1, 1),
  anchorFromTileUnits('south-b', 1, 1),
  anchorFromTileUnits('mid-b', 1, 1),
];

export const JUMP_PADS: JumpPadDefinition[] = [
  {
    id: 'pad-intro-a',
    ...anchorFromTileUnits('spawn-c', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('spawn-c', 1, 1))!.topY,
    boostX: 0,
    boostY: 9.8,
    boostZ: 0,
    color: '#a8f7ff',
  },
  {
    id: 'pad-intro-b',
    ...anchorFromTileUnits('spawn-f', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('spawn-f', 1, 1))!.topY,
    boostX: 0,
    boostY: 10.6,
    boostZ: 0,
    color: '#ffe3a3',
  },
  {
    id: 'pad-south-rise',
    ...anchorFromTileUnits('south-c', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('south-c', 1, 1))!.topY,
    boostX: 0,
    boostY: 12.6,
    boostZ: 0,
    color: '#9ff6ff',
  },
  {
    id: 'pad-float-mid',
    ...anchorFromTileUnits('south-d', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('south-d', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.2,
    boostZ: 0,
    color: '#ffd38d',
  },
  {
    id: 'pad-float-east',
    ...anchorFromTileUnits('south-float-a', 1, 0),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('south-float-a', 1, 0))!.topY,
    boostX: 0,
    boostY: 14.8,
    boostZ: 0,
    color: '#ffc6a8',
  },
  {
    id: 'pad-mid-rise',
    ...anchorFromTileUnits('mid-b', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('mid-b', 1, 1))!.topY,
    boostX: 0,
    boostY: 14.2,
    boostZ: 0,
    color: '#ffb8ff',
  },
  {
    id: 'pad-mid-float-chain',
    ...anchorFromTileUnits('mid-d', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('mid-d', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.3,
    boostZ: 0,
    color: '#b8d7ff',
  },
  {
    id: 'pad-bonus-chain',
    ...anchorFromTileUnits('bonus-b', 0, 0),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('bonus-b', 0, 0))!.topY,
    boostX: 0,
    boostY: 15.0,
    boostZ: 0,
    color: '#c0d4ff',
  },
  {
    id: 'pad-north-entry',
    ...anchorFromTileUnits('mid-float-a', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('mid-float-a', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.3,
    boostZ: 0,
    color: '#d7cbff',
  },
  {
    id: 'pad-north-rise',
    ...anchorFromTileUnits('north-a', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('north-a', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.6,
    boostZ: 0,
    color: '#ffd6ff',
  },
  {
    id: 'pad-north-crown',
    ...anchorFromTileUnits('north-b', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('north-b', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.9,
    boostZ: 0,
    color: '#ffd6ff',
  },
  {
    id: 'pad-east-chain',
    ...anchorFromTileUnits('east-a', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('east-a', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.4,
    boostZ: 0,
    color: '#ffcf9a',
  },
  {
    id: 'pad-east-summit',
    ...anchorFromTileUnits('east-b', 1, 1),
    width: BLOCK_UNIT * 0.98,
    depth: BLOCK_UNIT * 0.98,
    y: TILE_BY_CLUSTER_COORD.get(clusterTileKey('east-b', 1, 1))!.topY,
    boostX: 0,
    boostY: 15.8,
    boostZ: 0,
    color: '#ffe6b8',
  },
];

/** Footprint area (in unit tiles) for "larger" clusters that get a moving elevator beside them. */
const LARGE_CLUSTER_MIN_FOOTPRINT_AREA = 9;

const elevatorGridKeyFromWorld = (x: number, z: number): string => {
  const gridX = Math.round(x / BLOCK_UNIT - 0.5);
  const gridZ = Math.round(z / BLOCK_UNIT - 0.5);
  return tileKey(gridX, gridZ);
};

/**
 * Picks a free grid cell touching the cluster footprint (prefer E/W/N/S mid-edge, then corners, then +2 rings).
 */
const findElevatorAnchorBesideCluster = (
  cluster: PlatformCluster,
  platformOccupied: Set<string>,
  reservedElevatorCells: Set<string>,
): { gridX: number; gridZ: number } | null => {
  const minX = cluster.gridX;
  const maxX = cluster.gridX + cluster.widthUnits - 1;
  const minZ = cluster.gridZ;
  const maxZ = cluster.gridZ + cluster.depthUnits - 1;
  const midZ = Math.floor((minZ + maxZ) / 2);
  const midX = Math.floor((minX + maxX) / 2);

  const candidates: Array<{ gridX: number; gridZ: number }> = [
    { gridX: maxX + 1, gridZ: midZ },
    { gridX: minX - 1, gridZ: midZ },
    { gridX: midX, gridZ: maxZ + 1 },
    { gridX: midX, gridZ: minZ - 1 },
    { gridX: maxX + 1, gridZ: minZ },
    { gridX: maxX + 1, gridZ: maxZ },
    { gridX: minX - 1, gridZ: minZ },
    { gridX: minX - 1, gridZ: maxZ },
    { gridX: maxX + 2, gridZ: midZ },
    { gridX: minX - 2, gridZ: midZ },
    { gridX: midX, gridZ: maxZ + 2 },
    { gridX: midX, gridZ: minZ - 2 },
    { gridX: maxX + 1, gridZ: midZ + 1 },
    { gridX: maxX + 1, gridZ: midZ - 1 },
    { gridX: minX - 1, gridZ: midZ + 1 },
    { gridX: minX - 1, gridZ: midZ - 1 },
  ];

  for (const c of candidates) {
    const key = tileKey(c.gridX, c.gridZ);
    if (!platformOccupied.has(key) && !reservedElevatorCells.has(key)) {
      return c;
    }
  }

  return null;
};

/** Hand-tuned gap lifts (kept for pacing); every other large cluster gets an auto-placed elevator. */
const MANUAL_MOVING_ELEVATORS: MovingPlatformDefinition[] = [
  {
    id: 'lift-south-gap',
    ...anchorFromGridUnits(14, 2),
    clusterId: 'south-c',
    width: BLOCK_UNIT,
    depth: BLOCK_UNIT,
    baseHeightUnits: 2,
    travelUnits: 3,
    speed: 0.85,
    phase: 0.4,
    color: colorForCluster('south-c', 2),
  },
  {
    id: 'lift-mid-gap',
    ...anchorFromGridUnits(10, 0),
    clusterId: 'mid-b',
    width: BLOCK_UNIT,
    depth: BLOCK_UNIT,
    baseHeightUnits: 5,
    travelUnits: 4,
    speed: 0.72,
    phase: 1.8,
    color: colorForCluster('mid-b', 5),
  },
  {
    id: 'lift-west-gap',
    ...anchorFromGridUnits(2, -10),
    clusterId: 'west-c',
    width: BLOCK_UNIT,
    depth: BLOCK_UNIT,
    baseHeightUnits: 6,
    travelUnits: 3,
    speed: 0.94,
    phase: 3.2,
    color: colorForCluster('west-c', 5),
  },
  {
    id: 'lift-east-gap',
    ...anchorFromGridUnits(15, -16),
    clusterId: 'east-a',
    width: BLOCK_UNIT,
    depth: BLOCK_UNIT,
    baseHeightUnits: 10,
    travelUnits: 4,
    speed: 0.68,
    phase: 4.6,
    color: colorForCluster('east-a', 4),
  },
];

const AUTO_MOVING_ELEVATORS: MovingPlatformDefinition[] = (() => {
  const reservedCells = new Set<string>();
  for (const lift of MANUAL_MOVING_ELEVATORS) {
    reservedCells.add(elevatorGridKeyFromWorld(lift.x, lift.z));
  }

  const clustersWithManualLift = new Set(MANUAL_MOVING_ELEVATORS.map((e) => e.clusterId));
  const auto: MovingPlatformDefinition[] = [];
  let serial = 0;

  for (const cluster of PLATFORM_CLUSTERS) {
    const area = cluster.widthUnits * cluster.depthUnits;
    if (area < LARGE_CLUSTER_MIN_FOOTPRINT_AREA) {
      continue;
    }
    if (clustersWithManualLift.has(cluster.id)) {
      continue;
    }

    const anchor = findElevatorAnchorBesideCluster(cluster, PLATFORM_GRID_OCCUPIED, reservedCells);
    if (!anchor) {
      continue;
    }

    reservedCells.add(tileKey(anchor.gridX, anchor.gridZ));
    serial += 1;

    const stack = Math.max(1, cluster.stackCount);
    const baseHeightUnits = Math.max(0, cluster.baseHeightUnits + 1);
    const travelUnits = Math.max(2, Math.min(6, stack + 2));

    auto.push({
      id: `lift-${cluster.id}`,
      ...anchorFromGridUnits(anchor.gridX, anchor.gridZ),
      clusterId: cluster.id,
      width: BLOCK_UNIT,
      depth: BLOCK_UNIT,
      baseHeightUnits,
      travelUnits,
      speed: 0.66 + (serial % 6) * 0.05,
      phase: 0.35 + serial * 0.87,
      color: cluster.color,
    });
  }

  return auto;
})();

export const MOVING_ELEVATORS: MovingPlatformDefinition[] = [
  ...MANUAL_MOVING_ELEVATORS,
  ...AUTO_MOVING_ELEVATORS,
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Raw 0–1 oscillation before bottom/top dwell (matches lift math). Used for elevator SFX edges. */
export const getMovingElevatorDriverWave = (elapsed: number, platform: MovingPlatformDefinition): number =>
  0.5 + Math.sin(elapsed * platform.speed + platform.phase) * 0.5;

export const getMovingElevatorLift = (elapsed: number, platform: MovingPlatformDefinition): number => {
  const wave = getMovingElevatorDriverWave(elapsed, platform);
  const heldWave = wave < 0.14 ? 0 : wave > 0.86 ? 1 : smoothstep01((wave - 0.14) / 0.72);
  return heldWave * platform.travelUnits * BLOCK_UNIT;
};

export const getMovingElevatorTopY = (elapsed: number, platform: MovingPlatformDefinition): number =>
  platform.baseHeightUnits * BLOCK_UNIT + getMovingElevatorLift(elapsed, platform);

export const DECOR_ANCHORS: DecorAnchor[] = [];

export const CRYSTAL_ANCHORS: CrystalAnchor[] = [
  { ...anchorFromTileUnits('spawn-a', 2, 2, -0.06, 0.05), color: '#e8ffa8' },
  { ...anchorFromTileUnits('spawn-c', 2, 1, 0.05, -0.04), color: '#ffd48a' },
  { ...anchorFromTileUnits('south-float-a', 1, 1, -0.08, 0.12), color: '#9bf4ff' },
  { ...anchorFromTileUnits('mid-float-a', 0, 2, 0.08, -0.06), color: '#ffb7fb' },
  { ...anchorFromTileUnits('bonus-a', 0, 2, -0.04, 0.04), color: '#b4f4ff' },
  { ...anchorFromTileUnits('north-a', 0, 0, -0.06, 0.06), color: '#c7f1ff' },
  { ...anchorFromTileUnits('north-c', 2, 1, -0.06, 0.06), color: '#84b7ff' },
  { ...anchorFromTileUnits('east-b', 2, 1, 0.06, -0.08), color: '#9af6ff' },
];
