import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getBackdropFarFrameMetrics } from './DistantWorldBackdrop';
import { BLOCK_UNIT } from './TerrainLayout';
import { MOUNTAIN_ORBIT_MARGIN_BLOCKS, MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS } from './worldHorizon';
import { publicUrl } from '../config/publicUrl';

const PLANET_URLS: readonly string[] = [
  publicUrl('assets/planets_lowpoly_glb/planet_05.glb'),
  publicUrl('assets/planets_lowpoly_glb/planet_14.glb'),
  publicUrl('assets/planets_lowpoly_glb/planet_22.glb'),
  publicUrl('assets/planets_lowpoly_glb/planet_33.glb'),
  publicUrl('assets/planets_lowpoly_glb/planet_41.glb'),
];

/** Unity pack atlas; FBX→GLB kept 1×1 placeholders, so we bind the real map here. */
const PLANET_BASE_COLOR_URL = publicUrl('assets/planets_lowpoly_textures/base_color.png');

/**
 * Orbit radius beyond mountain pivots (blocks). Mountains sit at
 * `farOuterR + MOUNTAIN_ORBIT_MARGIN_BLOCKS` (+ spawn slot extra); planets sit farther out.
 */
const PLANET_ORBIT_EXTRA_BLOCKS = 96;

/** Base longest axis after normalize — larger than mountain mesh target so silhouettes read huge at range. */
const PLANET_BASE_TARGET_EXTENT = BLOCK_UNIT * 188;

/** Per-instance scale multipliers (varied silhouettes). */
const PLANET_SIZE_MULTIPLIERS: readonly number[] = [1.0, 1.12, 0.94, 1.06, 0.88];

/** World Y center of each planet (above mountain silhouettes on average). */
const PLANET_Y_MULT_BLOCKS = [52, 58, 48, 62, 55] as const;

/** Phase offset so planets don’t sit on the same ring angles as the four mountains. */
const ANGLE_PHASE = 0.38;

function hash01(i: number, seed: number): number {
  const t = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453123;
  return t - Math.floor(t);
}

/**
 * GLB/FBX export often splits vertices for hard edges. Drop baked normals/tangents,
 * weld coincident vertices (still respects UV splits), then recompute smooth normals.
 */
function applySmoothShadingToPlanetMeshes(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const { geometry } = child;
    if (!(geometry instanceof THREE.BufferGeometry)) {
      return;
    }
    const g = geometry.clone();
    g.deleteAttribute('normal');
    if (g.hasAttribute('tangent')) {
      g.deleteAttribute('tangent');
    }
    const merged = mergeVertices(g, 1e-4);
    merged.computeVertexNormals();
    child.geometry = merged;
  });
}

function normalizePlanetCentered(model: THREE.Object3D, targetMaxExtent: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(targetMaxExtent / maxDim);

  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  const center = box2.getCenter(new THREE.Vector3());
  model.position.sub(center);
}

function loadPlanetBaseColorTexture(loader: THREE.TextureLoader): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      PLANET_BASE_COLOR_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => {
        console.warn('[DistantPlanetsBackdrop] Missing or invalid', PLANET_BASE_COLOR_URL);
        resolve(null);
      },
    );
  });
}

function applySharedBaseColorMap(root: THREE.Object3D, map: THREE.Texture): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial ||
        mat instanceof THREE.MeshBasicMaterial ||
        mat instanceof THREE.MeshLambertMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshToonMaterial
      ) {
        mat.map = map;
        mat.color.setRGB(1, 1, 1);
        mat.needsUpdate = true;
      }
    }
  });
}

function tunePlanetMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) {
        continue;
      }
      const m = mat as THREE.Material & { fog?: boolean };
      m.fog = true;

      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.flatShading = false;
        mat.emissive.set(0, 0, 0);
        mat.emissiveIntensity = 0;
        mat.metalness *= 0.85;
        mat.roughness = THREE.MathUtils.clamp(mat.roughness * 0.92, 0.12, 1);
      } else if (
        mat instanceof THREE.MeshLambertMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshToonMaterial
      ) {
        mat.emissive.set(0, 0, 0);
      }
      mat.needsUpdate = true;
    }
  });
}

/**
 * Huge low-poly planets on a wide orbit **outside** mountain pivots, elevated for sky read.
 */
export class DistantPlanetsBackdrop {
  readonly root = new THREE.Group();

  private readonly loader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();

  constructor(parent: THREE.Object3D) {
    this.root.name = 'DistantPlanetsBackdrop';
    parent.add(this.root);
  }

  load(): void {
    const { centerX, centerZ, farOuterR } = getBackdropFarFrameMetrics();
    const mountainOrbitMax =
      farOuterR + BLOCK_UNIT * (MOUNTAIN_ORBIT_MARGIN_BLOCKS + MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS);
    const planetR = mountainOrbitMax + BLOCK_UNIT * PLANET_ORBIT_EXTRA_BLOCKS;

    const n = Math.min(PLANET_URLS.length, PLANET_SIZE_MULTIPLIERS.length);

    const loadOne = (url: string): Promise<THREE.Object3D | null> =>
      new Promise((resolve) => {
        this.loader.load(
          url,
          (gltf) => resolve(gltf.scene),
          undefined,
          () => {
            console.warn('[DistantPlanetsBackdrop] Missing or invalid', url);
            resolve(null);
          },
        );
      });

    const baseMapPromise = loadPlanetBaseColorTexture(this.textureLoader);

    void Promise.all([baseMapPromise, ...PLANET_URLS.slice(0, n).map((url) => loadOne(url))]).then(
      ([baseMap, ...scenes]) => {
        for (let i = 0; i < n; i += 1) {
          const scene = scenes[i];
          if (!scene) {
            continue;
          }

        const planet = scene.clone(true);
        planet.name = `DistantPlanet_${i}`;
        applySmoothShadingToPlanetMeshes(planet);
        const sizeMul = PLANET_SIZE_MULTIPLIERS[i] ?? 1;
        normalizePlanetCentered(planet, PLANET_BASE_TARGET_EXTENT * sizeMul);
          if (baseMap) {
            applySharedBaseColorMap(planet, baseMap);
          }
          tunePlanetMaterials(planet);

          const baseAngle = (i / n) * Math.PI * 2 + ANGLE_PHASE;
          const jitter = (hash01(i, 3.1) - 0.5) * 0.35;
          const angle = baseAngle + jitter;
          const x = centerX + Math.cos(angle) * planetR;
          const z = centerZ + Math.sin(angle) * planetR;
          const y = BLOCK_UNIT * PLANET_Y_MULT_BLOCKS[i % PLANET_Y_MULT_BLOCKS.length];

          const pivot = new THREE.Group();
          pivot.name = `DistantPlanetPivot_${i}`;
          pivot.position.set(x, y, z);
          pivot.rotation.y = hash01(i, 7.77) * Math.PI * 2;
          pivot.rotation.x = (hash01(i, 2.2) - 0.5) * 0.14;
          pivot.rotation.z = (hash01(i, 5.5) - 0.5) * 0.1;
          pivot.add(planet);
          this.root.add(pivot);
        }
      },
    );
  }
}
