import * as THREE from 'three';
import { WaterMesh } from 'three/addons/objects/Water2Mesh.js';
import { FOREGROUND_MOUNDS, PATH_PADS } from './TerrainLayout';
import { WORLD_FLOOR_Y } from '../config/defaults';

const WATER_RADIUS = 132;

const createWaterNormalTexture = (phase: number): THREE.DataTexture => {
  const size = 512;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const waveA = Math.sin((u * 12 + phase) * Math.PI * 2);
      const waveB = Math.cos((v * 10 - phase * 0.7) * Math.PI * 2);
      const waveC = Math.sin((u * 7 + v * 8 + phase * 1.3) * Math.PI * 2);
      const waveD = Math.cos((u * 21 - v * 17 + phase * 2.1) * Math.PI * 2);
      const waveE = Math.sin((u * 29 + v * 23 - phase * 1.7) * Math.PI * 2);
      const nx = THREE.MathUtils.clamp((waveA + waveC * 0.48 + waveD * 0.22) * 0.3, -1, 1);
      const nz = THREE.MathUtils.clamp((waveB - waveC * 0.38 + waveE * 0.18) * 0.3, -1, 1);
      const up = THREE.MathUtils.clamp(0.84 + (waveA * waveB + waveD * 0.35 + 1) * 0.06, 0, 1);
      const index = (y * size + x) * 4;

      data[index] = Math.round((nx * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round(up * 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

export class TerrainGenerator {
  private readonly seaBedGeometry = new THREE.CircleGeometry(148, 96);
  private readonly waterGeometry = new THREE.CircleGeometry(WATER_RADIUS, 192);
  private readonly pathGeometry = new THREE.CylinderGeometry(0.4, 0.55, 1, 28);
  private readonly moundGeometry = new THREE.SphereGeometry(1, 26, 18);
  private readonly waterNormal0 = createWaterNormalTexture(0.12);
  private readonly waterNormal1 = createWaterNormalTexture(0.57);

  createGround(): THREE.Group {
    const group = new THREE.Group();

    const seaBed = new THREE.Mesh(
      this.seaBedGeometry,
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#0d7c87'),
        roughness: 0.52,
        metalness: 0.06,
        clearcoat: 0.18,
        transparent: true,
        opacity: 0.9,
      }),
    );
    seaBed.rotation.x = -Math.PI / 2;
    seaBed.position.set(0, WORLD_FLOOR_Y - 1.25, 0);
    seaBed.receiveShadow = true;
    group.add(seaBed);

    const water = new WaterMesh(this.waterGeometry, {
      color: '#4fd6da',
      flowDirection: new THREE.Vector2(0.35, 0.18),
      flowSpeed: 0.042,
      reflectivity: 0.22,
      scale: 5.6,
      normalMap0: this.waterNormal0,
      normalMap1: this.waterNormal1,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WORLD_FLOOR_Y + 0.02, 0);
    water.receiveShadow = true;
    const waterMaterials = Array.isArray(water.material) ? water.material : [water.material];
    for (const material of waterMaterials) {
      material.side = THREE.DoubleSide;
      material.transparent = true;
    }
    group.add(water);

    const pathMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#fff2ea'),
      roughness: 0.22,
      metalness: 0.08,
      transmission: 0.12,
      clearcoat: 0.65,
    });

    for (const [x, y, z, sx, sy, sz] of PATH_PADS) {
      const pad = new THREE.Mesh(this.pathGeometry, pathMaterial);
      pad.position.set(x, y, z);
      pad.scale.set(sx, sy, sz);
      pad.castShadow = true;
      pad.receiveShadow = true;
      group.add(pad);
    }

    const duneMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffbfd9'),
      roughness: 0.38,
      metalness: 0.05,
      transmission: 0.1,
      clearcoat: 0.42,
    });

    for (const [x, y, z, sx, sy, sz] of FOREGROUND_MOUNDS) {
      const mound = new THREE.Mesh(this.moundGeometry, duneMaterial);
      mound.position.set(x, y, z);
      mound.scale.set(sx, sy, sz);
      mound.castShadow = true;
      mound.receiveShadow = true;
      group.add(mound);
    }

    return group;
  }
}
