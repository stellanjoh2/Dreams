import * as THREE from 'three';
import { Color } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  add,
  color,
  dot,
  float,
  fract,
  mix,
  mul,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';

/** Noise dissolve sweep (linear t on CPU); mesh stays visible longer via {@link MESH_LIFETIME}. */
const DISSOLVE_SWEEP_DURATION = 0.38;
/** Whole pickup mesh: master opacity 1→0 linear — avoids a hard pop when noise hits full dissolve. */
const MESH_LIFETIME = 0.88;
const EMISSIVE_FADE_DURATION = 0.64;
const EMISSIVE_PEAK = 4.6;
const SPARK_DURATION = 0.65;
const SPARK_COUNT = 56;
const MAX_SCALE_BOOST = 0.19;

export type CrystalDissolveUniform = { value: number };

export type CrystalPickupDissolveMaterial = MeshBasicNodeMaterial & {
  userData: {
    crystalDissolve: CrystalDissolveUniform;
    masterOpacity: CrystalDissolveUniform;
    emissiveStrength: CrystalDissolveUniform;
  };
};

export function createCrystalPickupDissolveMaterial(hex: string): CrystalPickupDissolveMaterial {
  const dissolveAmount = uniform(-0.07);
  const masterOpacity = uniform(1);
  const emissiveStrength = uniform(0);
  const base = color(new Color(hex));
  const white = vec3(1, 1, 1);
  const edge = float(0.17);

  const material = new MeshBasicNodeMaterial({ fog: false }) as CrystalPickupDissolveMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;

  const n = fract(mul(sin(dot(positionWorld, vec3(12.9898, 78.233, 54.281))), float(43758.5453)));

  const d = dissolveAmount as unknown as {
    sub: (o: unknown) => typeof n;
    add: (o: unknown) => typeof n;
  };
  const vis = smoothstep(d.sub(edge), d.add(float(0.06)), n);

  const rimLow = smoothstep(d.sub(mul(edge, float(1.12))), d, n);
  const rimHigh = float(1).sub(smoothstep(d, d.add(mul(edge, float(0.52))), n));
  const rim = mul(rimLow, rimHigh);

  const emissiveHot = vec3(0.42, 0.94, 1.08);
  const eNode = emissiveStrength as unknown as Parameters<typeof mul>[0];

  material.colorNode = Fn(() => {
    const lit = mix(base, white, mul(rim, float(0.92)));
    const rimBright = mul(lit, float(1).add(mul(rim, float(2.35))));
    const emissiveLift = mul(rimBright, float(1).add(mul(eNode, float(0.55))));
    const emissiveAdd = mul(emissiveHot, eNode);
    return add(emissiveLift, emissiveAdd);
  })();

  const mo = masterOpacity as unknown as Parameters<typeof mul>[0];
  (material as THREE.Material & { opacityNode?: unknown }).opacityNode = Fn(() => mul(vis, mo))();

  material.userData.crystalDissolve = dissolveAmount as unknown as CrystalDissolveUniform;
  material.userData.masterOpacity = masterOpacity as unknown as CrystalDissolveUniform;
  material.userData.emissiveStrength = emissiveStrength as unknown as CrystalDissolveUniform;

  return material;
}

type ActivePickup = {
  mesh: THREE.Mesh;
  points: THREE.Points;
  dissolve: CrystalDissolveUniform;
  masterOpacity: CrystalDissolveUniform;
  emissiveStrength: CrystalDissolveUniform;
  elapsed: number;
  positions: Float32Array;
  velocities: Float32Array;
  sparkColors: Float32Array;
  crystalPos: THREE.Vector3;
  crystalQuat: THREE.Quaternion;
  crystalScale: THREE.Vector3;
};

/**
 * World-space pickup: dissolve mesh + additive sparks; driven from {@link CrystalSystem}.
 */
export class CrystalPickupVfxHost {
  private readonly root = new THREE.Group();
  private readonly pickups: ActivePickup[] = [];

  constructor(scene: THREE.Scene) {
    this.root.name = 'CrystalPickupVfx';
    scene.add(this.root);
  }

  spawn(worldMatrix: THREE.Matrix4, colorHex: string, geometry: THREE.BufferGeometry): void {
    const mat = createCrystalPickupDissolveMaterial(colorHex);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(worldMatrix);
    mesh.matrixWorld.copy(worldMatrix);
    mesh.frustumCulled = false;
    this.root.add(mesh);

    const crystalPos = new THREE.Vector3();
    const crystalQuat = new THREE.Quaternion();
    const crystalScale = new THREE.Vector3();
    worldMatrix.decompose(crystalPos, crystalQuat, crystalScale);

    const positions = new Float32Array(SPARK_COUNT * 3);
    const velocities = new Float32Array(SPARK_COUNT * 3);
    const sparkColors = new Float32Array(SPARK_COUNT * 3);
    const c = new Color(colorHex);
    const r = c.r;
    const g = c.g;
    const b = c.b;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const rx = (Math.random() - 0.5) * 2;
      const ry = Math.random() * 0.85 + 0.15;
      const rz = (Math.random() - 0.5) * 2;
      const len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      const speed = 2.1 + Math.random() * 3.2;
      velocities[i * 3] = (rx / len) * speed;
      velocities[i * 3 + 1] = (ry / len) * speed * 0.95;
      velocities[i * 3 + 2] = (rz / len) * speed;
      sparkColors[i * 3] = r + (Math.random() - 0.5) * 0.25;
      sparkColors[i * 3 + 1] = g + (Math.random() - 0.5) * 0.25;
      sparkColors[i * 3 + 2] = b + (Math.random() - 0.5) * 0.15 + 0.2;
    }

    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

    const pMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.11,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(pGeom, pMat);
    points.position.copy(crystalPos);
    points.quaternion.copy(crystalQuat);
    points.frustumCulled = false;
    this.root.add(points);

    this.pickups.push({
      mesh,
      points,
      dissolve: mat.userData.crystalDissolve,
      masterOpacity: mat.userData.masterOpacity,
      emissiveStrength: mat.userData.emissiveStrength,
      elapsed: 0,
      positions,
      velocities,
      sparkColors,
      crystalPos: crystalPos.clone(),
      crystalQuat: crystalQuat.clone(),
      crystalScale: crystalScale.clone(),
    });
  }

  update(delta: number): void {
    const dt = Math.max(delta, 1 / 2000);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      p.elapsed += dt;

      const dissolveT = Math.min(1, p.elapsed / DISSOLVE_SWEEP_DURATION);
      p.dissolve.value = -0.07 + dissolveT * 1.08;

      p.masterOpacity.value = Math.max(0, 1 - p.elapsed / MESH_LIFETIME);

      p.emissiveStrength.value = Math.max(0, EMISSIVE_PEAK * (1 - p.elapsed / EMISSIVE_FADE_DURATION));

      const scaleT = Math.min(1, p.elapsed / (MESH_LIFETIME * 0.92));
      const easeOut = 1 - (1 - scaleT) * (1 - scaleT);
      const grow = 1 + easeOut * MAX_SCALE_BOOST;
      p.mesh.matrix.compose(
        p.crystalPos,
        p.crystalQuat,
        p.crystalScale.clone().multiplyScalar(grow),
      );
      p.mesh.matrixWorld.copy(p.mesh.matrix);

      const pMat = p.points.material as THREE.PointsMaterial;
      if (p.elapsed < SPARK_DURATION) {
        for (let j = 0; j < SPARK_COUNT; j++) {
          p.velocities[j * 3 + 1] += dt * -1.85;
          p.positions[j * 3] += p.velocities[j * 3]! * dt;
          p.positions[j * 3 + 1] += p.velocities[j * 3 + 1]! * dt;
          p.positions[j * 3 + 2] += p.velocities[j * 3 + 2]! * dt;
        }
        (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        pMat.opacity = Math.max(0, 1 - p.elapsed / SPARK_DURATION);
      } else {
        pMat.opacity = 0;
      }

      if (p.elapsed > Math.max(MESH_LIFETIME, SPARK_DURATION) + 0.12) {
        p.mesh.removeFromParent();
        p.points.geometry.dispose();
        pMat.dispose();
        const meshMat = p.mesh.material as THREE.Material;
        meshMat.dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const p of this.pickups) {
      p.points.geometry.dispose();
      ;(p.points.material as THREE.Material).dispose();
      ;(p.mesh.material as THREE.Material).dispose();
    }
    this.pickups.length = 0;
    this.root.removeFromParent();
  }
}
