import * as THREE from 'three';
import { FOREGROUND_MOUNDS, PATH_PADS } from './TerrainLayout';

const SPAWN_SURFACE_MARGIN = 0.82;

const sampleEllipsoidTop = (
  x: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): number | null => {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  const horizontal = 1 - dx * dx - dz * dz;

  if (horizontal <= 0) {
    return null;
  }

  return cy + ry * Math.sqrt(horizontal);
};

export type TerrainSurfaceSample = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  distanceSq: number;
};

export class TerrainPhysics {
  getGroundHeightAt(x: number, z: number): number | null {
    let bestHeight: number | null = null;

    for (const [cx, cy, cz, sx, sy, sz] of FOREGROUND_MOUNDS) {
      const moundHeight = sampleEllipsoidTop(x, z, cx, cy, cz, sx, sy, sz);
      if (moundHeight !== null) {
        bestHeight = bestHeight === null ? moundHeight : Math.max(bestHeight, moundHeight);
      }
    }

    for (const [cx, cy, cz, sx, sy, sz] of PATH_PADS) {
      const dx = (x - cx) / (0.55 * sx);
      const dz = (z - cz) / (0.55 * sz);

      if (dx * dx + dz * dz <= 1) {
        const padHeight = cy + sy * 0.5;
        bestHeight = bestHeight === null ? padHeight : Math.max(bestHeight, padHeight);
      }
    }

    return bestHeight;
  }

  getNearestSpawnSurface(x: number, z: number): TerrainSurfaceSample | null {
    let bestSample: TerrainSurfaceSample | null = null;

    for (const [cx, cy, cz, sx, sy, sz] of FOREGROUND_MOUNDS) {
      const sample = this.sampleMoundSurface(x, z, cx, cy, cz, sx, sy, sz);
      if (!bestSample || sample.distanceSq < bestSample.distanceSq) {
        bestSample = sample;
      }
    }

    for (const [cx, cy, cz, sx, sy, sz] of PATH_PADS) {
      const sample = this.samplePadSurface(x, z, cx, cy, cz, sx, sy, sz);
      if (!bestSample || sample.distanceSq < bestSample.distanceSq) {
        bestSample = sample;
      }
    }

    return bestSample;
  }

  resolvePlayerCollisions(position: THREE.Vector3, radius: number, grounded: boolean): void {
    for (const [cx, cy, cz, sx, sy, sz] of FOREGROUND_MOUNDS) {
      this.resolveEllipsoidCollision(position, radius, grounded, cx, cy, cz, sx, sy, sz);
    }

    for (const [cx, cy, cz, sx, sy, sz] of PATH_PADS) {
      this.resolvePadCollision(position, radius, grounded, cx, cy, cz, sx, sy, sz);
    }
  }

  private resolveEllipsoidCollision(
    position: THREE.Vector3,
    radius: number,
    grounded: boolean,
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
  ): void {
    if (grounded) {
      return;
    }

    const topHeight = sampleEllipsoidTop(position.x, position.z, cx, cy, cz, rx, ry, rz);
    if (topHeight === null || position.y >= topHeight - 0.15) {
      return;
    }

    const expandedRx = rx + radius;
    const expandedRz = rz + radius;
    let dx = position.x - cx;
    let dz = position.z - cz;

    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) {
      dx = 0.0001;
    }

    const normalized = (dx * dx) / (expandedRx * expandedRx) + (dz * dz) / (expandedRz * expandedRz);
    if (normalized >= 1) {
      return;
    }

    const scale = 1 / Math.sqrt(normalized);
    position.x = cx + dx * scale;
    position.z = cz + dz * scale;
  }

  private resolvePadCollision(
    position: THREE.Vector3,
    radius: number,
    grounded: boolean,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    if (grounded) {
      return;
    }

    const topHeight = cy + sy * 0.5;
    if (position.y >= topHeight - 0.08) {
      return;
    }

    const expandedRx = 0.55 * sx + radius;
    const expandedRz = 0.55 * sz + radius;
    let dx = position.x - cx;
    let dz = position.z - cz;

    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) {
      dx = 0.0001;
    }

    const normalized = (dx * dx) / (expandedRx * expandedRx) + (dz * dz) / (expandedRz * expandedRz);
    if (normalized >= 1) {
      return;
    }

    const scale = 1 / Math.sqrt(normalized);
    position.x = cx + dx * scale;
    position.z = cz + dz * scale;
  }

  private sampleMoundSurface(
    x: number,
    z: number,
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
  ): TerrainSurfaceSample {
    const projected = this.projectPointToEllipse(x, z, cx, cz, rx, rz);
    const y = sampleEllipsoidTop(projected.x, projected.z, cx, cy, cz, rx, ry, rz) ?? cy + ry;
    const normal = new THREE.Vector3(
      (projected.x - cx) / (rx * rx),
      (y - cy) / (ry * ry),
      (projected.z - cz) / (rz * rz),
    ).normalize();

    return {
      position: new THREE.Vector3(projected.x, y, projected.z),
      normal,
      distanceSq: projected.distanceSq,
    };
  }

  private samplePadSurface(
    x: number,
    z: number,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
  ): TerrainSurfaceSample {
    const rx = 0.55 * sx;
    const rz = 0.55 * sz;
    const projected = this.projectPointToEllipse(x, z, cx, cz, rx, rz);

    return {
      position: new THREE.Vector3(projected.x, cy + sy * 0.5, projected.z),
      normal: new THREE.Vector3(0, 1, 0),
      distanceSq: projected.distanceSq,
    };
  }

  private projectPointToEllipse(
    x: number,
    z: number,
    cx: number,
    cz: number,
    rx: number,
    rz: number,
  ): { x: number; z: number; distanceSq: number } {
    const dx = x - cx;
    const dz = z - cz;
    const normalized = (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz);

    if (normalized <= SPAWN_SURFACE_MARGIN * SPAWN_SURFACE_MARGIN) {
      return { x, z, distanceSq: 0 };
    }

    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) {
      return { x: cx, z: cz, distanceSq: 0 };
    }

    const scale = SPAWN_SURFACE_MARGIN / Math.sqrt(normalized);
    const projectedX = cx + dx * scale;
    const projectedZ = cz + dz * scale;

    return {
      x: projectedX,
      z: projectedZ,
      distanceSq: (projectedX - x) * (projectedX - x) + (projectedZ - z) * (projectedZ - z),
    };
  }
}
