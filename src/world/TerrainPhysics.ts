import * as THREE from 'three';
import { BLOCK_UNIT, JUMP_PADS, MOVING_ELEVATORS, PLATFORM_TILES, getMovingElevatorTopY } from './TerrainLayout';

const SURFACE_MARGIN = BLOCK_UNIT * 0.02;
const SPAWN_MARGIN = BLOCK_UNIT * 0.22;
const COLLISION_EPSILON = BLOCK_UNIT * 0.045;
const GROUND_SUPPORT_LIP = BLOCK_UNIT * 0.08;
/** Extra headroom vs `maxHeight` for moving lifts only (rising platform + frame timing). */
const MOVING_ELEVATOR_MAX_HEIGHT_SLACK = BLOCK_UNIT * 3.6;

type CollisionSurface = {
  x: number;
  z: number;
  width: number;
  depth: number;
  topY: number;
  baseY: number;
  exposedLeft: boolean;
  exposedRight: boolean;
  exposedFront: boolean;
  exposedBack: boolean;
  /** Relaxed `maxHeight` ceiling so rising lifts still register when landing / riding up. */
  isMovingElevator?: boolean;
};

export type TerrainSurfaceSample = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  distanceSq: number;
};

export class TerrainPhysics {
  private readonly movingSurfaces: CollisionSurface[] = MOVING_ELEVATORS.map((platform) => ({
    x: platform.x,
    z: platform.z,
    width: platform.width,
    depth: platform.depth,
    topY: platform.baseHeightUnits * BLOCK_UNIT,
    baseY: platform.baseHeightUnits * BLOCK_UNIT - BLOCK_UNIT,
    exposedLeft: true,
    exposedRight: true,
    exposedFront: true,
    exposedBack: true,
    isMovingElevator: true,
  }));

  constructor() {
    this.update(0);
  }

  update(elapsed: number): void {
    MOVING_ELEVATORS.forEach((platform, index) => {
      const topY = getMovingElevatorTopY(elapsed, platform);
      const surface = this.movingSurfaces[index];
      surface.topY = topY;
      surface.baseY = topY - BLOCK_UNIT;
    });
  }

  getGroundHeightAt(
    x: number,
    z: number,
    supportRadius = 0,
    maxHeight = Number.POSITIVE_INFINITY,
  ): number | null {
    let bestHeight: number | null = null;

    for (const tile of PLATFORM_TILES) {
      bestHeight = this.collectGroundHeight(bestHeight, x, z, supportRadius, maxHeight, tile);
    }

    for (const surface of this.movingSurfaces) {
      bestHeight = this.collectGroundHeight(bestHeight, x, z, supportRadius, maxHeight, surface);
    }

    return bestHeight;
  }

  getNearestSpawnSurface(x: number, z: number): TerrainSurfaceSample | null {
    let bestSample: TerrainSurfaceSample | null = null;

    for (const tile of PLATFORM_TILES) {
      const sample = this.sampleSurface(x, z, tile);
      if (!bestSample || sample.distanceSq < bestSample.distanceSq) {
        bestSample = sample;
      }
    }

    return bestSample;
  }

  resolvePlayerCollisions(position: THREE.Vector3, radius: number, grounded: boolean): void {
    for (const tile of PLATFORM_TILES) {
      this.resolveSurfaceCollision(position, radius, grounded, tile);
    }

    for (const surface of this.movingSurfaces) {
      this.resolveSurfaceCollision(position, radius, grounded, surface);
    }
  }

  getJumpPadImpulse(position: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 | null {
    for (const jumpPad of JUMP_PADS) {
      if (
        Math.abs(position.x - jumpPad.x) <= jumpPad.width * 0.5 &&
        Math.abs(position.z - jumpPad.z) <= jumpPad.depth * 0.5 &&
        Math.abs(position.y - jumpPad.y) <= BLOCK_UNIT * 0.08
      ) {
        return target.set(jumpPad.boostX, jumpPad.boostY, jumpPad.boostZ);
      }
    }

    return null;
  }

  private collectGroundHeight(
    currentBest: number | null,
    x: number,
    z: number,
    supportRadius: number,
    maxHeight: number,
    surface: CollisionSurface,
  ): number | null {
    const halfWidth = surface.width * 0.5;
    const halfDepth = surface.depth * 0.5;
    const margin = Math.min(SURFACE_MARGIN, halfWidth * 0.06, halfDepth * 0.06);
    const effectiveMaxHeight =
      maxHeight + (surface.isMovingElevator ? MOVING_ELEVATOR_MAX_HEIGHT_SLACK : 0);

    if (supportRadius <= 0) {
      if (
        surface.topY <= effectiveMaxHeight + COLLISION_EPSILON &&
        x >= surface.x - halfWidth + margin &&
        x <= surface.x + halfWidth - margin &&
        z >= surface.z - halfDepth + margin &&
        z <= surface.z + halfDepth - margin
      ) {
        return currentBest === null ? surface.topY : Math.max(currentBest, surface.topY);
      }

      return currentBest;
    }

    if (
      surface.topY <= effectiveMaxHeight + COLLISION_EPSILON &&
      this.circleOverlapsSurfaceTop(x, z, supportRadius, surface, margin)
    ) {
      return currentBest === null ? surface.topY : Math.max(currentBest, surface.topY);
    }

    return currentBest;
  }

  private resolveSurfaceCollision(
    position: THREE.Vector3,
    radius: number,
    grounded: boolean,
    surface: CollisionSurface,
  ): void {
    /** Wider band on lifts: avoids treating a descending/landing player as "inside" the block and shoving sideways. */
    const topBand = surface.isMovingElevator
      ? COLLISION_EPSILON + BLOCK_UNIT * 0.14
      : COLLISION_EPSILON;
    if (position.y >= surface.topY - topBand) {
      return;
    }

    const groundedTopBand = surface.isMovingElevator ? BLOCK_UNIT * 0.28 : BLOCK_UNIT * 0.1;
    if (grounded && position.y >= surface.topY - groundedTopBand) {
      return;
    }

    if (position.y <= surface.baseY - BLOCK_UNIT * 0.12) {
      return;
    }

    const minX = surface.x - surface.width * 0.5;
    const maxX = surface.x + surface.width * 0.5;
    const minZ = surface.z - surface.depth * 0.5;
    const maxZ = surface.z + surface.depth * 0.5;

    if (
      position.x < minX - radius ||
      position.x > maxX + radius ||
      position.z < minZ - radius ||
      position.z > maxZ + radius
    ) {
      return;
    }

    const candidates: Array<{ distance: number; axis: 'left' | 'right' | 'front' | 'back' }> = [];

    if (surface.exposedLeft) {
      candidates.push({ distance: position.x - (minX - radius), axis: 'left' });
    }

    if (surface.exposedRight) {
      candidates.push({ distance: maxX + radius - position.x, axis: 'right' });
    }

    if (surface.exposedFront) {
      candidates.push({ distance: position.z - (minZ - radius), axis: 'front' });
    }

    if (surface.exposedBack) {
      candidates.push({ distance: maxZ + radius - position.z, axis: 'back' });
    }

    if (candidates.length === 0) {
      return;
    }

    let smallest = candidates[0];

    for (let index = 1; index < candidates.length; index += 1) {
      if (candidates[index].distance < smallest.distance) {
        smallest = candidates[index];
      }
    }

    if (smallest.axis === 'left') {
      position.x = minX - radius;
    } else if (smallest.axis === 'right') {
      position.x = maxX + radius;
    } else if (smallest.axis === 'front') {
      position.z = minZ - radius;
    } else {
      position.z = maxZ + radius;
    }
  }

  private sampleSurface(x: number, z: number, surface: CollisionSurface): TerrainSurfaceSample {
    const halfWidth = surface.width * 0.5;
    const halfDepth = surface.depth * 0.5;
    const margin = Math.min(SPAWN_MARGIN, halfWidth * 0.35, halfDepth * 0.35);
    const sampleX = THREE.MathUtils.clamp(x, surface.x - halfWidth + margin, surface.x + halfWidth - margin);
    const sampleZ = THREE.MathUtils.clamp(z, surface.z - halfDepth + margin, surface.z + halfDepth - margin);

    return {
      position: new THREE.Vector3(sampleX, surface.topY, sampleZ),
      normal: new THREE.Vector3(0, 1, 0),
      distanceSq: (sampleX - x) * (sampleX - x) + (sampleZ - z) * (sampleZ - z),
    };
  }

  private circleOverlapsSurfaceTop(
    x: number,
    z: number,
    radius: number,
    surface: CollisionSurface,
    margin: number,
  ): boolean {
    const minX = surface.x - surface.width * 0.5 + margin - GROUND_SUPPORT_LIP;
    const maxX = surface.x + surface.width * 0.5 - margin + GROUND_SUPPORT_LIP;
    const minZ = surface.z - surface.depth * 0.5 + margin - GROUND_SUPPORT_LIP;
    const maxZ = surface.z + surface.depth * 0.5 - margin + GROUND_SUPPORT_LIP;
    const nearestX = THREE.MathUtils.clamp(x, minX, maxX);
    const nearestZ = THREE.MathUtils.clamp(z, minZ, maxZ);
    const deltaX = x - nearestX;
    const deltaZ = z - nearestZ;

    return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
  }
}
