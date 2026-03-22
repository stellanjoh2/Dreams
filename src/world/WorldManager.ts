import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FxSettings } from '../fx/FxSettings';
import { isFresnelCapableMaterial, updateFresnelMaterial } from '../materials/FresnelMaterial';
import { PropFactory } from './PropFactory';
import { AmbientDustSystem } from './AmbientDustSystem';
import { FishSchoolsSystem } from './FishSchoolsSystem';
import { FishingBoatProp } from './FishingBoatProp';
import { CactusEnemySystem } from './CactusEnemySystem';
import { TerrainGenerator } from './TerrainGenerator';
import { TerrainPhysics } from './TerrainPhysics';
import {
  BLOCK_UNIT,
  CRYSTAL_ANCHORS,
  DECOR_ANCHORS,
  JUMP_PADS,
  PLATFORM_SURFACE_TILES,
  RESPAWN_ANCHORS,
} from './TerrainLayout';
import type { CrystalInstance } from '../systems/CrystalSystem';

/** Optional hooks from `App` (e.g. Web Audio) — keeps `WorldManager` free of `AudioSystem` import. */
export type WorldAudioHooks = {
  playCactusEnemyProximity?: (x: number, y: number, z: number) => void;
};

type PlantBucket = 'tall' | 'balanced' | 'wide';

type CuratedPlantProfile = {
  url: string;
  bucket: PlantBucket;
  scale: number;
  /** Tall plants are normally off-route only; set true so this variant also scatters on spawn/path. */
  scatterOnRoute?: boolean;
};

export class WorldManager {
  readonly scene = new THREE.Scene();
  /** Outer group: world position + yaw live here; origin = AABB bottom-face center on the ground (XZ not shifted by volumetric center). */
  private static readonly PLANT_PIVOT_NAME = 'PlantPivot';
  /** Inner group: uniform fit scale + per-tile jitter scale; pivot offset lives here so root scale does not shear the pivot. */
  private static readonly PLANT_MESH_ROOT_NAME = 'PlantMeshRoot';
  private static readonly ENVIRONMENT_MAP_URL = '/hdri/MR_EXT-010_BlueEndDayPinkClouds_Moorea_4k.png';
  private static readonly CURATED_PLANT_PROFILES: readonly CuratedPlantProfile[] = [
    { url: '/plants/curated/candy-bloom-a.glb', bucket: 'balanced', scale: 1.18 },
    { url: '/plants/curated/candy-bloom-b.glb', bucket: 'balanced', scale: 1.08 },
    { url: '/plants/curated/candy-shrub-a.glb', bucket: 'balanced', scale: 1.12 },
    { url: '/plants/curated/candy-shrub-b.glb', bucket: 'balanced', scale: 1.04 },
    // Purple spike only for tall bucket (replaces spike-a / spike-b); allowed on main path so it shows on the map.
    { url: '/plants/curated/candy-spike-purple.glb', bucket: 'tall', scale: 0.96, scatterOnRoute: true },
  ];

  private readonly worldRoot = new THREE.Group();
  private readonly plantScatterRoot = new THREE.Group();
  private readonly props = new PropFactory();
  private readonly ambientDust = new AmbientDustSystem();
  private readonly fishSchools = new FishSchoolsSystem(this.worldRoot);
  private readonly fishingBoat = new FishingBoatProp(this.worldRoot);
  private readonly terrain = new TerrainGenerator();
  private readonly terrainPhysics = new TerrainPhysics();
  private readonly cactusEnemies: CactusEnemySystem;
  private readonly plantLoader = new GLTFLoader();
  private readonly driftingClouds: THREE.Object3D[] = [];
  private readonly sunAnchor = new THREE.Vector3(-32, 42, 84);
  private readonly sunTargetPosition = new THREE.Vector3(0, 4, -10);

  private sunMesh?: THREE.Mesh;
  private skyDome?: THREE.Mesh;
  private ambientLight?: THREE.AmbientLight;
  private hemiLight?: THREE.HemisphereLight;
  private sunLight?: THREE.DirectionalLight;
  private sunLightTarget?: THREE.Object3D;
  private coolLight?: THREE.PointLight;
  private environmentTexture?: THREE.Texture;
  private plantScatterRequested = false;
  private readonly sunWorldPosition = new THREE.Vector3();
  private readonly respawnPoints: THREE.Vector3[] = [];
  private readonly terrainSnapPosition = new THREE.Vector3();
  private readonly terrainSnapNormal = new THREE.Vector3();
  private readonly terrainSnapUp = new THREE.Vector3(0, 1, 0);
  private readonly terrainSnapLocal = new THREE.Vector3();
  private readonly terrainSnapAlignQuaternion = new THREE.Quaternion();
  private readonly terrainSnapYawQuaternion = new THREE.Quaternion();
  private readonly terrainSnapIdentityQuaternion = new THREE.Quaternion();
  private nextRespawnIndex = 0;

  constructor(audioHooks?: WorldAudioHooks) {
    this.cactusEnemies = new CactusEnemySystem(
      this.worldRoot,
      this.terrainPhysics,
      audioHooks?.playCactusEnemyProximity,
    );
    this.scene.add(this.worldRoot);

    for (const anchor of RESPAWN_ANCHORS) {
      const sample = this.terrainPhysics.getNearestSpawnSurface(anchor.x, anchor.z);
      if (sample) {
        this.respawnPoints.push(sample.position.clone().add(new THREE.Vector3(0, BLOCK_UNIT * 0.03, 0)));
      }
    }
  }

  build(settings: FxSettings): CrystalInstance[] {
    this.scene.background = new THREE.Color('#8fb7ff');
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(settings.atmosphere.skyColor),
      settings.atmosphere.fogDensity,
    );

    this.loadEnvironmentMap();
    this.buildSkyDome();
    this.buildLights(settings);
    this.buildSun();
    this.worldRoot.add(this.terrain.createGround());
    this.fishSchools.load();
    this.fishingBoat.load();
    this.cactusEnemies.load();
    this.worldRoot.add(this.plantScatterRoot);
    this.buildLandmarks();
    this.buildClouds();
    this.worldRoot.add(this.ambientDust.mesh);
    this.ambientDust.applySettings(settings.particles);

    return this.buildCrystals();
  }

  update(delta: number, elapsed: number, camera?: THREE.Camera, playerPosition?: THREE.Vector3): void {
    this.prepareWaterReflectorForFrame();

    this.syncDynamicPlatforms(elapsed);

    for (const [index, cloud] of this.driftingClouds.entries()) {
      cloud.position.x += delta * (0.18 + index * 0.015);
      cloud.position.z += Math.sin(elapsed * 0.1 + index) * delta * 0.2;
      cloud.position.y += Math.sin(elapsed * 0.25 + index * 1.2) * delta * 0.04;

      if (cloud.position.x > 52) {
        cloud.position.x = -52;
      }
    }

    if (this.sunMesh) {
      const pulse = 1 + Math.sin(elapsed * 0.45) * 0.03;
      this.sunMesh.scale.setScalar(0.38 * pulse);
    }

    this.ambientDust.update(elapsed, camera);
    this.fishSchools.update(delta, elapsed);
    this.fishingBoat.update(delta, elapsed);
    this.cactusEnemies.update(delta, elapsed, playerPosition ?? null, camera ?? null);
  }

  /**
   * Water2 reflector skips rendering when the mirror plane faces away from the camera (e.g. underwater
   * or low grazing angles), which clears the reflection texture and makes the surface vanish. Force a
   * pass every frame before the main render / post-process scene pass.
   */
  private prepareWaterReflectorForFrame(): void {
    const water = this.worldRoot.getObjectByName('WaterSurface');
    const sampler = water?.userData?.waterReflectionSampler as { reflector?: { forceUpdate: boolean } } | undefined;
    if (sampler?.reflector) {
      sampler.reflector.forceUpdate = true;
    }
  }

  syncDynamicPlatforms(elapsed: number): void {
    this.terrain.update(elapsed);
    this.terrainPhysics.update(elapsed);
  }

  applyFxSettings(settings: FxSettings): void {
    this.scene.background = new THREE.Color('#8fb7ff');

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(settings.atmosphere.skyColor);
      this.scene.fog.density = settings.atmosphere.fogDensity;
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = settings.atmosphere.ambientIntensity;
    }

    if (this.hemiLight) {
      this.hemiLight.intensity = settings.atmosphere.hemiIntensity;
    }

    if (this.sunMesh?.material instanceof THREE.MeshBasicMaterial) {
      this.sunMesh.material.color.set('#fff3be');
    }

    if (this.sunLight) {
      this.sunLight.intensity = 2.8 * settings.atmosphere.sunGlow;
      this.sunLight.color.set('#ffe6b0');
    }

    this.ambientDust.applySettings(settings.particles);

    if (this.environmentTexture) {
      this.scene.environment = this.environmentTexture;
    }

    this.worldRoot.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];

      materials.forEach((material: THREE.Material) => {
        if (material && isFresnelCapableMaterial(material)) {
          updateFresnelMaterial(
            material,
            settings.fresnel.color,
            settings.fresnel.strength,
            settings.fresnel.radius,
          );
        }
      });
    });
  }

  getSunWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.sunMesh) {
      return target.set(0, 26, -90);
    }

    this.sunMesh.getWorldPosition(this.sunWorldPosition);
    return target.copy(this.sunWorldPosition);
  }

  getLensFlareOccluders(): THREE.Object3D[] {
    return [this.worldRoot];
  }

  getGroundHeightAt(x: number, z: number, supportRadius?: number, maxHeight?: number): number | null {
    return this.terrainPhysics.getGroundHeightAt(x, z, supportRadius, maxHeight);
  }

  resolveTerrainCollisions(position: THREE.Vector3, radius: number, grounded: boolean): void {
    this.terrainPhysics.resolvePlayerCollisions(position, radius, grounded);
  }

  getJumpPadImpulse(position: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 | null {
    return this.terrainPhysics.getJumpPadImpulse(position, target);
  }

  getRespawnPoint(target = new THREE.Vector3()): THREE.Vector3 {
    const point = this.respawnPoints[this.nextRespawnIndex % this.respawnPoints.length];
    this.nextRespawnIndex += 1;
    return target.copy(point);
  }

  private buildLights(settings: FxSettings): void {
    this.ambientLight = new THREE.AmbientLight('#fff4fb', settings.atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(
      '#8eb2ff',
      '#ffc1de',
      settings.atmosphere.hemiIntensity,
    );
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#ffe6b0', 2.8 * settings.atmosphere.sunGlow);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1536, 1536);
    this.sunLight.shadow.bias = -0.00008;
    this.sunLight.shadow.normalBias = 0.01;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 180;
    this.sunLight.shadow.camera.left = -90;
    this.sunLight.shadow.camera.right = 90;
    this.sunLight.shadow.camera.top = 90;
    this.sunLight.shadow.camera.bottom = -90;
    this.scene.add(this.sunLight);

    this.sunLightTarget = new THREE.Object3D();
    this.sunLightTarget.position.copy(this.sunTargetPosition);
    this.scene.add(this.sunLightTarget);
    this.sunLight.target = this.sunLightTarget;
    this.syncSunLighting();

    this.coolLight = new THREE.PointLight('#8ebeff', 1.8, 140, 2);
    this.coolLight.position.set(22, 12, 16);
    this.scene.add(this.coolLight);
  }

  private buildSun(): void {
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(7.8, 28, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#fff3be'),
      }),
    );
    this.sunMesh.scale.setScalar(0.38);
    this.sunMesh.position.copy(this.sunAnchor);
    this.scene.add(this.sunMesh);
  }

  private buildSkyDome(): void {
    const skyTexture = this.createSkyGradientTexture();
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });

    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 28), skyMaterial);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);
  }

  private buildLandmarks(): void {
    this.buildIslandDecor();
    this.loadPlantScatter();
  }

  private buildIslandDecor(): void {
    for (const anchor of DECOR_ANCHORS) {
      let object: THREE.Object3D;
      let heightOffset = anchor.heightOffsetUnits * BLOCK_UNIT;

      switch (anchor.kind) {
        case 'tree':
          object = this.props.createTree(anchor.primaryColor, anchor.secondaryColor ?? '#ff9bd3');
          heightOffset = 0;
          break;
        case 'cactus':
          object = this.props.createCactus(anchor.primaryColor);
          heightOffset = 0;
          break;
        case 'monolith':
          object = this.props.createMonolith(anchor.primaryColor, [
            BLOCK_UNIT * 0.95 * anchor.scale,
            BLOCK_UNIT * anchor.heightOffsetUnits * 2,
            BLOCK_UNIT * 1.02 * anchor.scale,
          ]);
          break;
        default:
          object = this.props.createCandyRock(anchor.primaryColor, [
            BLOCK_UNIT * 0.85 * anchor.scale,
            BLOCK_UNIT * anchor.heightOffsetUnits * 1.65,
            BLOCK_UNIT * 0.95 * anchor.scale,
          ]);
          break;
      }

      this.placeObjectOnTerrain(
        this.worldRoot,
        object,
        anchor.x,
        anchor.z,
        heightOffset,
        anchor.yaw,
        anchor.tiltAmount,
      );
      this.worldRoot.add(object);
    }
  }

  private buildClouds(): void {
    const cloudPositions = [
      [-26, 19, -18],
      [4, 18, -8],
      [26, 21, 3],
      [14, 16, 18],
      [-8, 22, 14],
    ] as const;

    for (const [x, y, z] of cloudPositions) {
      const cloud = this.props.createCloud('#fff1ff');
      cloud.position.set(x, y, z);
      cloud.scale.setScalar((1.3 + (x + z) * 0.005) * 2.2);
      this.driftingClouds.push(cloud);
      this.worldRoot.add(cloud);
    }
  }

  private placeObjectOnTerrain(
    parent: THREE.Group,
    object: THREE.Object3D,
    worldX: number,
    worldZ: number,
    heightOffset: number,
    yaw: number,
    tiltAmount: number,
  ): void {
    const sample = this.terrainPhysics.getNearestSpawnSurface(worldX, worldZ);

    if (!sample) {
      object.position.set(worldX - parent.position.x, heightOffset, worldZ - parent.position.z);
      object.rotation.y = yaw;
      return;
    }

    this.terrainSnapPosition.copy(sample.position);
    this.terrainSnapPosition.y += heightOffset;
    this.terrainSnapLocal.copy(this.terrainSnapPosition).sub(parent.position);
    object.position.copy(this.terrainSnapLocal);

    this.terrainSnapNormal.copy(sample.normal);
    this.terrainSnapAlignQuaternion.setFromUnitVectors(this.terrainSnapUp, this.terrainSnapNormal);
    this.terrainSnapIdentityQuaternion.identity().slerp(this.terrainSnapAlignQuaternion, tiltAmount);
    this.terrainSnapYawQuaternion.setFromAxisAngle(this.terrainSnapUp, yaw);
    object.quaternion.copy(this.terrainSnapIdentityQuaternion).multiply(this.terrainSnapYawQuaternion);
  }

  private syncSunLighting(): void {
    if (!this.sunLight || !this.sunLightTarget) {
      return;
    }

    this.sunLight.position.copy(this.sunAnchor);
    this.sunLightTarget.position.copy(this.sunTargetPosition);
    this.sunLight.target.updateMatrixWorld();
  }

  private loadEnvironmentMap(): void {
    if (this.environmentTexture) {
      this.scene.environment = this.environmentTexture;
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(WorldManager.ENVIRONMENT_MAP_URL, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      this.environmentTexture = texture;
      this.scene.environment = texture;
    });
  }

  private loadPlantScatter(): void {
    if (this.plantScatterRequested) {
      return;
    }

    this.plantScatterRequested = true;
    const loadRequests = WorldManager.CURATED_PLANT_PROFILES.map(
      (profile) =>
        new Promise<{ profile: CuratedPlantProfile; scene: THREE.Object3D } | null>((resolve) => {
          this.plantLoader.load(
            profile.url,
            (gltf) => {
              resolve({ profile, scene: gltf.scene });
            },
            undefined,
            () => {
              resolve(null);
            },
          );
        }),
    );

    void Promise.all(loadRequests)
      .then((results) => {
        const variants = results.flatMap((result) => {
          if (!result) {
            return [];
          }

          const variant = this.createNormalizedPlantVariant(result.scene);
          variant.userData.plantBucket = result.profile.bucket;
          variant.userData.plantScaleMultiplier = result.profile.scale;
          variant.userData.scatterOnRoute = result.profile.scatterOnRoute === true;
          return [variant];
        });

        this.populatePlantScatter(variants);
      })
      .catch(() => {
        /* createNormalizedPlantVariant or loader can throw; keep scatter empty but allow retry */
      })
      .finally(() => {
        this.plantScatterRequested = false;
      });
  }

  private populatePlantScatter(variants: THREE.Object3D[]): void {
    this.plantScatterRoot.clear();
    if (variants.length === 0) {
      return;
    }

    const routeVariants = variants.filter(
      (variant) =>
        variant.userData.plantBucket !== 'tall' || variant.userData.scatterOnRoute === true,
    );
    let routeVariantCursor = 0;
    let offRouteVariantCursor = 0;

    const blockedTiles = new Set(
      JUMP_PADS.map((pad) => `${Math.round(pad.x / BLOCK_UNIT - 0.5)}:${Math.round(pad.z / BLOCK_UNIT - 0.5)}`),
    );

    for (const tile of PLATFORM_SURFACE_TILES) {
      if (blockedTiles.has(`${tile.gridX}:${tile.gridZ}`)) {
        continue;
      }

      const baseDensity = tile.role === 'spawn' ? 0.34 : tile.role === 'path' ? 0.26 : 0.12;
      const scatterRoll = this.hashTile(tile.gridX, tile.gridZ, 0.17);
      if (scatterRoll > baseDensity) {
        continue;
      }

      const useRoutePool = tile.role === 'spawn' || tile.role === 'path';
      const selectionPool = useRoutePool ? routeVariants : variants;
      const selectionIndex = useRoutePool ? routeVariantCursor : offRouteVariantCursor;
      const selectedVariant = selectionPool[selectionIndex % selectionPool.length] ?? variants[0];
      if (useRoutePool) {
        routeVariantCursor += 1;
      } else {
        offRouteVariantCursor += 1;
      }
      const plant = selectedVariant.clone(true);
      const yawStep = Math.floor(this.hashTile(tile.gridX, tile.gridZ, 1.13) * 4);
      const yaw = yawStep * (Math.PI * 0.5);
      const authoredScale = typeof plant.userData.plantScaleMultiplier === 'number'
        ? plant.userData.plantScaleMultiplier
        : 1;
      const jitterScale = authoredScale * (0.92 + this.hashTile(tile.gridX, tile.gridZ, 2.91) * 0.08);

      const groundY = this.terrainPhysics.getGroundHeightAt(tile.x, tile.z) ?? tile.topY;

      const meshRoot =
        plant.getObjectByName(WorldManager.PLANT_MESH_ROOT_NAME) ?? plant.children[0] ?? plant;
      plant.position.set(0, 0, 0);
      plant.rotation.set(0, 0, 0);
      plant.scale.set(1, 1, 1);
      meshRoot.scale.multiplyScalar(jitterScale);
      plant.updateMatrixWorld(true);

      // Foot from AABB at yaw=0; Y-rotation preserves vertex Y.
      const footBounds = new THREE.Box3().setFromObject(plant);
      let footMinY = footBounds.min.y;
      if (!Number.isFinite(footMinY)) {
        footMinY = 0;
      }

      plant.rotation.y = yaw;
      const surfaceSink = BLOCK_UNIT * 0.018;
      plant.position.set(tile.x, groundY - footMinY - surfaceSink, tile.z);
      plant.updateMatrixWorld(true);
      this.applyShadowFlags(plant);
      this.plantScatterRoot.add(plant);
    }
  }

  private createNormalizedPlantVariant(source: THREE.Object3D): THREE.Object3D {
    source.updateWorldMatrix(true, true);
    const sourceWorldInverse = source.matrixWorld.clone().invert();
    const sourceWorldPosition = new THREE.Vector3();
    const sourceWorldQuaternion = new THREE.Quaternion();
    const sourceWorldScale = new THREE.Vector3();
    source.matrixWorld.decompose(sourceWorldPosition, sourceWorldQuaternion, sourceWorldScale);
    const sourceWorldNoTranslation = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      sourceWorldQuaternion,
      sourceWorldScale,
    );
    const meshRoot = new THREE.Group();
    meshRoot.name = WorldManager.PLANT_MESH_ROOT_NAME;

    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
        return;
      }

      const bakedGeometry = mesh.geometry.clone();
      const childRelativeToSource = sourceWorldInverse.clone().multiply(mesh.matrixWorld);
      const bakedMatrix = sourceWorldNoTranslation.clone().multiply(childRelativeToSource);
      bakedGeometry.applyMatrix4(bakedMatrix);
      this.ensureUvAttributeOnGeometry(bakedGeometry);

      const bakedMaterial = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
      const bakedMesh = new THREE.Mesh(bakedGeometry, bakedMaterial);
      const materials = Array.isArray(bakedMesh.material) ? bakedMesh.material : [bakedMesh.material];
      materials.forEach((material) => {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      });
      bakedMesh.castShadow = true;
      bakedMesh.receiveShadow = true;
      meshRoot.add(bakedMesh);
    });

    meshRoot.updateMatrixWorld(true);
    const boundsUnscaled = new THREE.Box3().setFromObject(meshRoot);
    if (boundsUnscaled.isEmpty()) {
      const pivot = new THREE.Group();
      pivot.name = WorldManager.PLANT_PIVOT_NAME;
      pivot.add(meshRoot);
      return pivot;
    }

    const size = boundsUnscaled.getSize(new THREE.Vector3());
    const footprint = Math.max(0.001, Math.max(size.x, size.z));
    const footprintScale = (BLOCK_UNIT * 0.76) / footprint;
    const heightScale = (BLOCK_UNIT * 1.02) / Math.max(0.001, size.y);
    const uniformScale = Math.min(footprintScale, heightScale);

    meshRoot.scale.setScalar(uniformScale);
    meshRoot.updateMatrixWorld(true);

    const boundsScaled = new THREE.Box3().setFromObject(meshRoot);
    const boxCenter = boundsScaled.getCenter(new THREE.Vector3());
    const centerBottom = new THREE.Vector3(boxCenter.x, boundsScaled.min.y, boxCenter.z);

    const pivotRoot = new THREE.Group();
    pivotRoot.name = WorldManager.PLANT_PIVOT_NAME;
    pivotRoot.add(meshRoot);
    meshRoot.position.set(-centerBottom.x, -centerBottom.y, -centerBottom.z);

    pivotRoot.updateMatrixWorld(true);
    const verify = new THREE.Box3().setFromObject(pivotRoot);
    // Only snap Y: re-centering XZ on the full AABB shifts asymmetric tufts (purple spike) because
    // volumetric center ≠ bottom-face center; tile anchor stays at (tile.x, tile.z).
    if (!verify.isEmpty() && Math.abs(verify.min.y) > 1e-4) {
      pivotRoot.position.y -= verify.min.y;
    }

    return pivotRoot;
  }

  private hashTile(x: number, z: number, seed: number): number {
    const value = Math.sin(x * 127.1 + z * 311.7 + seed * 91.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  private ensureUvAttributeOnGeometry(geometry: THREE.BufferGeometry): void {
    if (geometry.getAttribute('uv')) {
      return;
    }

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const position = geometry.getAttribute('position');
    if (!bounds || !position) {
      return;
    }

    const size = bounds.getSize(new THREE.Vector3());
    const useXZ = size.x >= size.y;
    const width = Math.max(0.001, size.x);
    const height = Math.max(0.001, useXZ ? size.z : size.y);
    const uv = new Float32Array(position.count * 2);

    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      uv[index * 2] = (x - bounds.min.x) / width;
      uv[index * 2 + 1] = useXZ ? (z - bounds.min.z) / height : (y - bounds.min.y) / height;
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.attributes.uv.needsUpdate = true;
  }

  private applyShadowFlags(object: THREE.Object3D): void {
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private createSkyGradientTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 512;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Candy Lands could not create the sky gradient context.');
    }

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#5f95ff');
    gradient.addColorStop(0.28, '#8fa7ff');
    gradient.addColorStop(0.62, '#d3b4ff');
    gradient.addColorStop(1, '#ffbfdc');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildCrystals(): CrystalInstance[] {
    return CRYSTAL_ANCHORS.map(({ x, z, color }, index) => {
      const crystal = this.props.createCrystal(color);
      const surfaceSample = this.terrainPhysics.getNearestSpawnSurface(x, z);

      if (surfaceSample) {
        crystal.position.set(
          surfaceSample.position.x,
          surfaceSample.position.y + BLOCK_UNIT * 0.14,
          surfaceSample.position.z,
        );
      } else {
        crystal.position.set(x, BLOCK_UNIT * 0.14, z);
      }

      crystal.rotation.set(0, index * 0.73, 0);
      this.worldRoot.add(crystal);

      const basePosition = crystal.position.clone();

      return {
        id: `crystal-${index}`,
        mesh: crystal,
        basePosition,
        collected: false,
        respawnAt: 0,
      };
    });
  }
}
