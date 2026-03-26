import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WATER_SURFACE_Y } from '../config/defaults';

import { publicUrl } from '../config/publicUrl';
import {
  applyShadowFlags,
  normalizeVerticalForWaterline,
  tunePropMaterialsForWater,
} from './WaterFloatingPropUtils';
import {
  BLOCK_UNIT,
  MOVING_ELEVATORS,
  PLATFORM_SURFACE_TILES,
  computePlatformPlayfieldWorldBounds,
} from './TerrainLayout';
import {
  boatExclusionDistSqFromShore,
  collectBarrelShoreCandidateSpots,
  getShoreGrassWorldSpots,
} from './WaterEdgeGrassScatter';
import { FLOATING_BARREL_SPAWN, getBarrelSpawnDerived } from './floatingBarrelSpawnConfig';

const MODEL_URL = publicUrl('assets/source.glb');

/** Longest axis after fit — 50% vs prior ~3.85 so they read smaller vs the boat. */
const TARGET_BARREL_EXTENT = 1.925;

/** Extra negative = more hull below the analytical water plane (reads more submerged). */
const WATERLINE_ADJUST = -0.58;

/** Deeper pivot vs surface so less of the barrel rides above the waterline. */
const ROOT_SINK_BELOW_SURFACE = 0.92;

const MODEL_UP_FIX = new THREE.Euler(0, 0, 0);

const BARREL_COUNT = FLOATING_BARREL_SPAWN.count;
const SPAWN = getBarrelSpawnDerived();

const TILE_HALF = BLOCK_UNIT * 0.5;

type BarrelFloatSlot = {
  rootName: string;
  worldX: number;
  worldZ: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  bobPhaseOffset: number;
};

function rnd(seed: number): number {
  const t = Math.sin(seed * 9919 + 433.1) * 87531.341;
  return t - Math.floor(t);
}

function randomBarrelOrientation(seed: number): { yaw: number; tiltX: number; tiltZ: number } {
  const yaw = rnd(seed) * Math.PI * 2;
  const heavy = rnd(seed + 1) > 0.22;
  const amp = heavy ? 0.48 + rnd(seed + 2) * 0.44 : 0.28 + rnd(seed + 2) * 0.32;
  const tiltX = (rnd(seed + 3) - 0.5) * 2 * amp;
  const tiltZ = (rnd(seed + 4) - 0.5) * 2 * amp;
  return { yaw, tiltX, tiltZ };
}

function xzDistSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function insideExpandedSurfaceTile(x: number, z: number): boolean {
  const hx = TILE_HALF + SPAWN.platformSurfaceMargin;
  const hz = TILE_HALF + SPAWN.platformSurfaceMargin;
  for (const t of PLATFORM_SURFACE_TILES) {
    if (Math.abs(x - t.x) <= hx && Math.abs(z - t.z) <= hz) {
      return true;
    }
  }
  return false;
}

function insideElevatorFootprint(x: number, z: number): boolean {
  for (const e of MOVING_ELEVATORS) {
    const hx = e.width * 0.5 + SPAWN.elevatorPad;
    const hz = e.depth * 0.5 + SPAWN.elevatorPad;
    if (Math.abs(x - e.x) <= hx && Math.abs(z - e.z) <= hz) {
      return true;
    }
  }
  return false;
}

function tooCloseToGrass(x: number, z: number, grass: ReadonlyArray<{ x: number; z: number }>): boolean {
  for (const g of grass) {
    if (xzDistSq(x, z, g.x, g.z) < SPAWN.grassClearRSq) {
      return true;
    }
  }
  return false;
}

function isValidBarrelPosition(
  x: number,
  z: number,
  grass: ReadonlyArray<{ x: number; z: number }>,
): boolean {
  if (insideExpandedSurfaceTile(x, z)) {
    return false;
  }
  if (insideElevatorFootprint(x, z)) {
    return false;
  }
  if (tooCloseToGrass(x, z, grass)) {
    return false;
  }
  if (boatExclusionDistSqFromShore(x, z) < SPAWN.boatExclusionRSq) {
    return false;
  }
  return true;
}

function farEnoughFromChosen(
  x: number,
  z: number,
  chosen: ReadonlyArray<{ x: number; z: number }>,
  pairMinSq: number,
): boolean {
  for (const p of chosen) {
    if (xzDistSq(x, z, p.x, p.z) < pairMinSq) {
      return false;
    }
  }
  return true;
}

/** If position is valid and not too close to existing picks, append and return true. */
function tryPushBarrel(
  x: number,
  z: number,
  grass: ReadonlyArray<{ x: number; z: number }>,
  chosen: { x: number; z: number }[],
  pairMinSq: number,
  maxCount: number,
): boolean {
  if (chosen.length >= maxCount) {
    return false;
  }
  if (!isValidBarrelPosition(x, z, grass)) {
    return false;
  }
  if (!farEnoughFromChosen(x, z, chosen, pairMinSq)) {
    return false;
  }
  chosen.push({ x, z });
  return true;
}

function greedyPick(
  grass: ReadonlyArray<{ x: number; z: number }>,
  candidates: ReadonlyArray<{ x: number; z: number }>,
  pairMinSq: number,
): { x: number; z: number }[] {
  const chosen: { x: number; z: number }[] = [];
  for (const c of candidates) {
    if (tryPushBarrel(c.x, c.z, grass, chosen, pairMinSq, BARREL_COUNT)) {
      if (chosen.length >= BARREL_COUNT) {
        break;
      }
    }
  }
  return chosen;
}

function gridScanFill(
  grass: ReadonlyArray<{ x: number; z: number }>,
  chosen: { x: number; z: number }[],
  pairMinSq: number,
): void {
  if (chosen.length >= BARREL_COUNT) {
    return;
  }
  const { minX, maxX, minZ, maxZ } = computePlatformPlayfieldWorldBounds();
  const pad = SPAWN.gridPad;
  const step = SPAWN.gridStep;
  for (let x = minX - pad; x <= maxX + pad && chosen.length < BARREL_COUNT; x += step) {
    for (let z = minZ - pad; z <= maxZ + pad && chosen.length < BARREL_COUNT; z += step) {
      tryPushBarrel(x, z, grass, chosen, pairMinSq, BARREL_COUNT);
    }
  }
}

function appendGreedyFromCandidates(
  grass: ReadonlyArray<{ x: number; z: number }>,
  candidates: ReadonlyArray<{ x: number; z: number }>,
  chosen: { x: number; z: number }[],
  pairMinSq: number,
): void {
  for (const c of candidates) {
    if (chosen.length >= BARREL_COUNT) {
      break;
    }
    tryPushBarrel(c.x, c.z, grass, chosen, pairMinSq, BARREL_COUNT);
  }
}

function pickBarrelWorldPositions(): { x: number; z: number }[] {
  const grass = getShoreGrassWorldSpots();
  const candidates = collectBarrelShoreCandidateSpots();

  const chosen = greedyPick(grass, candidates, SPAWN.pairMinSq);
  gridScanFill(grass, chosen, SPAWN.pairMinSq);
  if (chosen.length < BARREL_COUNT) {
    appendGreedyFromCandidates(grass, candidates, chosen, SPAWN.pairRelaxedSq);
  }
  if (chosen.length < BARREL_COUNT) {
    gridScanFill(grass, chosen, SPAWN.pairRelaxedSq);
  }

  return chosen;
}

function buildBarrelSlots(): BarrelFloatSlot[] {
  const positions = pickBarrelWorldPositions();
  const slots: BarrelFloatSlot[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    const { x, z } = positions[i]!;
    const seed = i * 19_883 + Math.floor(x * 1.7 + z * 2.3);
    const { yaw, tiltX, tiltZ } = randomBarrelOrientation(seed);
    slots.push({
      rootName: `FloatingBarrels_${String.fromCharCode(65 + i)}`,
      worldX: x,
      worldZ: z,
      yaw,
      tiltX,
      tiltZ,
      bobPhaseOffset: rnd(seed + 99) * Math.PI * 2,
    });
  }
  return slots;
}

type SlotRuntime = {
  motion: THREE.Group;
  bobPhaseOffset: number;
};

function buildBarrelSlot(parent: THREE.Object3D, p: BarrelFloatSlot): SlotRuntime {
  const root = new THREE.Group();
  root.name = p.rootName;
  root.position.set(p.worldX, WATER_SURFACE_Y - ROOT_SINK_BELOW_SURFACE, p.worldZ);
  root.rotation.y = p.yaw;

  const tilt = new THREE.Group();
  tilt.name = `${p.rootName}_Tilt`;
  tilt.rotation.x = p.tiltX;
  tilt.rotation.z = p.tiltZ;
  root.add(tilt);

  const motion = new THREE.Group();
  motion.name = `${p.rootName}_Motion`;
  tilt.add(motion);

  parent.add(root);
  return { motion, bobPhaseOffset: p.bobPhaseOffset };
}

/**
 * Three floating barrels: positions are chosen from wide shore candidates, then filtered so they never sit
 * inside expanded platform tiles, elevator pads, grass instances, or fishing-boat hull zones.
 */
export class FloatingBarrelsProp {
  private readonly loader = new GLTFLoader();
  private readonly slots: SlotRuntime[] = [];
  private loaded = false;

  constructor(parent: THREE.Object3D) {
    for (const p of buildBarrelSlots()) {
      this.slots.push(buildBarrelSlot(parent, p));
    }
  }

  load(): void {
    this.loader.load(
      MODEL_URL,
      (gltf) => {
        for (const slot of this.slots) {
          const barrels = gltf.scene.clone(true);
          applyShadowFlags(barrels);
          barrels.rotation.copy(MODEL_UP_FIX);
          normalizeVerticalForWaterline(barrels, TARGET_BARREL_EXTENT, WATERLINE_ADJUST);
          tunePropMaterialsForWater(barrels);
          barrels.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.frustumCulled = false;
            }
          });
          slot.motion.add(barrels);
        }
        this.loaded = true;
      },
      undefined,
      () => {
        /* Missing `public/assets/source.glb` — slots stay empty */
      },
    );
  }

  update(_delta: number, elapsed: number): void {
    if (!this.loaded) {
      return;
    }

    for (const slot of this.slots) {
      const t = elapsed + slot.bobPhaseOffset;
      slot.motion.position.y =
        Math.sin(t * 0.85) * 0.036 + Math.sin(t * 0.31 + 0.7) * 0.018;
      slot.motion.rotation.z = Math.sin(t * 0.62 + 0.25) * 0.078;
      slot.motion.rotation.x = Math.sin(t * 0.48 + 1.05) * 0.055;
    }
  }
}
