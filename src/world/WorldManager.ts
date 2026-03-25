import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FxSettings } from '../fx/FxSettings';
import { isFresnelCapableMaterial, updateFresnelMaterial } from '../materials/FresnelMaterial';
import { PropFactory } from './PropFactory';
import { AmbientDustSystem } from './AmbientDustSystem';
import { FishSchoolsSystem } from './FishSchoolsSystem';
import {
  FishingBoatProp,
  FISHING_BOAT_PLACEMENT_LEFT,
  FISHING_BOAT_PLACEMENT_RIGHT,
} from './FishingBoatProp';
import { MountainBackdropProp } from './MountainBackdropProp';
import { DistantPlanetsBackdrop } from './DistantPlanetsBackdrop';
import { ButterflyScatterSystem } from './ButterflyScatterSystem';
import { WaterEdgeGrassScatter } from './WaterEdgeGrassScatter';
import { OrbitingUfoProp } from './OrbitingUfoProp';
import { CactusEnemySystem } from './CactusEnemySystem';
import {
  createDistantWorldBackdrop,
  getBackdropFarFrameMetrics,
  updateDistantWorldBackdropMotion,
} from './DistantWorldBackdrop';
import { buildStylizedCloudRing, updateStylizedCloudRing, type OrbitalCloud } from './StylizedCloudRing';
import { TerrainGenerator } from './TerrainGenerator';
import { TerrainPhysics, type GroundSupportSample } from './TerrainPhysics';
import {
  addSurfaceGridKeysForFootprint,
  BLOCK_UNIT,
  CRYSTAL_ANCHORS,
  DECOR_ANCHORS,
  JUMP_PADS,
  MOVING_ELEVATORS,
  PLATFORM_SURFACE_TILES,
  RESPAWN_ANCHORS,
  surfaceGridKeyFromTile,
  surfaceGridKeyFromWorldXZ,
} from './TerrainLayout';
import type { CrystalInstance } from '../systems/CrystalSystem';
import { publicUrl } from '../config/publicUrl';
import { MOUNTAIN_ORBIT_MARGIN_BLOCKS, MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS } from './worldHorizon';

type GroundScatterPlacement = {
  variantIndex: number;
  tileX: number;
  tileZ: number;
  groundY: number;
  yaw: number;
  jitterScale: number;
};

/** Optional hooks from `App` (e.g. Web Audio) — keeps `WorldManager` free of `AudioSystem` import. */
export type WorldAudioHooks = {
  playCactusEnemyProximity?: (x: number, y: number, z: number) => void;
  /** True while the cactus aggro line is still playing (idle anim speeds up). */
  isCactusEnemyProximityVoiceActive?: () => boolean;
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
  private static readonly ENVIRONMENT_MAP_URL = publicUrl('hdri/MR_EXT-010_BlueEndDayPinkClouds_Moorea_4k.png');
  /** Visual scale for `buildSun` (pulse multiplies this each frame). */
  private static readonly SUN_MESH_BASE_SCALE = 1.24;
  /**
   * Hint XZ (world) for which compass sector the sun sits in; anchor length is recomputed from backdrop
   * metrics so the disk sits **past** the mountain ring.
   */
  private static readonly SUN_AZIMUTH_HINT_XZ = new THREE.Vector2(-32, 84);
  private static readonly CURATED_PLANT_PROFILES: readonly CuratedPlantProfile[] = [
    { url: publicUrl('plants/curated/candy-bloom-a.glb'), bucket: 'balanced', scale: 1.18 },
    { url: publicUrl('plants/curated/candy-bloom-b.glb'), bucket: 'balanced', scale: 1.08 },
    { url: publicUrl('plants/curated/candy-shrub-a.glb'), bucket: 'balanced', scale: 1.12 },
    { url: publicUrl('plants/curated/candy-shrub-b.glb'), bucket: 'balanced', scale: 1.04 },
    // Purple spike only for tall bucket (replaces spike-a / spike-b); allowed on main path so it shows on the map.
    {
      url: publicUrl('plants/curated/candy-spike-purple.glb'),
      bucket: 'tall',
      scale: 0.96,
      scatterOnRoute: true,
    },
  ];

  private readonly worldRoot = new THREE.Group();
  private readonly plantScatterRoot = new THREE.Group();
  private readonly props = new PropFactory();
  private readonly ambientDust = new AmbientDustSystem();
  private readonly fishSchools = new FishSchoolsSystem(this.worldRoot);
  private readonly fishingBoatRight = new FishingBoatProp(this.worldRoot, FISHING_BOAT_PLACEMENT_RIGHT);
  private readonly fishingBoatLeft = new FishingBoatProp(this.worldRoot, FISHING_BOAT_PLACEMENT_LEFT);
  private readonly mountainBackdrop = new MountainBackdropProp(this.worldRoot);
  private readonly distantPlanets = new DistantPlanetsBackdrop(this.worldRoot);
  private readonly terrain = new TerrainGenerator();
  private readonly terrainPhysics = new TerrainPhysics();
  private readonly cactusEnemies: CactusEnemySystem;
  private readonly plantLoader = new GLTFLoader();
  private readonly butterflyScatter: ButterflyScatterSystem;
  private readonly waterEdgeGrass: WaterEdgeGrassScatter;
  private readonly orbitingUfo: OrbitingUfoProp;
  private distantBackdrop: THREE.Group | null = null;
  private orbitalClouds: OrbitalCloud[] = [];
  private cloudRingGroup?: THREE.Group;
  private readonly sunAnchor = new THREE.Vector3();
  private readonly sunTargetPosition = new THREE.Vector3(0, 4, -10);

  private sunGroup?: THREE.Group;
  /** Single camera-facing disc: radial gradient (no separate core vs halo). */
  private sunSprite?: THREE.Sprite;
  private skyDome?: THREE.Mesh;
  private ambientLight?: THREE.AmbientLight;
  private hemiLight?: THREE.HemisphereLight;
  private sunLight?: THREE.DirectionalLight;
  private sunLightTarget?: THREE.Object3D;
  private coolLight?: THREE.PointLight;
  private environmentTexture?: THREE.Texture;
  private plantScatterPromise: Promise<void> | null = null;
  /** At most one scatter prop (plant/crystal/…) per `gridX:gridZ` surface cell. */
  private readonly decorOccupiedSurfaceKeys = new Set<string>();
  private readonly sunWorldPosition = new THREE.Vector3();
  private readonly respawnPoints: THREE.Vector3[] = [];
  private readonly terrainSnapPosition = new THREE.Vector3();
  private readonly terrainSnapNormal = new THREE.Vector3();
  private readonly terrainSnapUp = new THREE.Vector3(0, 1, 0);
  private readonly terrainSnapLocal = new THREE.Vector3();
  private readonly terrainSnapAlignQuaternion = new THREE.Quaternion();
  private readonly terrainSnapYawQuaternion = new THREE.Quaternion();
  private readonly terrainSnapIdentityQuaternion = new THREE.Quaternion();
  private readonly crystalLayoutDummy = new THREE.Object3D();
  private nextRespawnIndex = 0;

  constructor(audioHooks?: WorldAudioHooks) {
    this.cactusEnemies = new CactusEnemySystem(
      this.worldRoot,
      this.terrainPhysics,
      audioHooks?.playCactusEnemyProximity,
      audioHooks?.isCactusEnemyProximityVoiceActive,
    );
    this.butterflyScatter = new ButterflyScatterSystem(this.worldRoot, this.plantLoader);
    this.waterEdgeGrass = new WaterEdgeGrassScatter(this.worldRoot, this.plantLoader);
    this.orbitingUfo = new OrbitingUfoProp(this.worldRoot, this.plantLoader);
    this.scene.add(this.worldRoot);

    for (const anchor of RESPAWN_ANCHORS) {
      const sample = this.terrainPhysics.getNearestSpawnSurface(anchor.x, anchor.z);
      if (sample) {
        this.respawnPoints.push(sample.position.clone().add(new THREE.Vector3(0, BLOCK_UNIT * 0.03, 0)));
      }
    }
  }

  build(settings: FxSettings, waterHighFrequencyNormal?: THREE.Texture): CrystalInstance[] {
    this.scene.background = new THREE.Color('#8fb7ff');
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(settings.atmosphere.skyColor),
      settings.atmosphere.fogDensity,
    );

    this.loadEnvironmentMap();
    this.buildSkyDome();
    this.updateSunAnchorFromBackdrop();
    this.buildLights(settings);
    this.buildSun();
    this.distantBackdrop = createDistantWorldBackdrop();
    this.worldRoot.add(this.distantBackdrop);
    this.worldRoot.add(this.terrain.createGround(waterHighFrequencyNormal));
    this.fishSchools.load();
    this.fishingBoatRight.load();
    this.fishingBoatLeft.load();
    this.mountainBackdrop.load();
    this.distantPlanets.load();
    this.orbitingUfo.load();
    this.seedDecorOccupancyFromWorldProps();
    this.worldRoot.add(this.plantScatterRoot);
    this.buildLandmarks();
    this.worldRoot.add(this.ambientDust.mesh);
    this.ambientDust.applySettings(settings.particles);

    return this.buildCrystals();
  }

  /** Surface cells already used by jump pads, elevators, island decor, crystals, plants (read after `loadDecorScatter`). */
  getDecorOccupiedSurfaceKeys(): ReadonlySet<string> {
    return this.decorOccupiedSurfaceKeys;
  }

  /** Shared octahedron used by crystal instances — safe for transient pickup dissolve meshes. */
  getCrystalGeometry(): THREE.BufferGeometry {
    return this.props.getCrystalGeometry();
  }

  /**
   * Instanced plants (reserves tiles), then spawns cactus enemies on remaining free tiles.
   * Call after `build()` and before butterflies so props don’t overlap.
   */
  async loadDecorScatter(): Promise<void> {
    await this.loadPlantScatter();
    this.cactusEnemies.load(this.decorOccupiedSurfaceKeys);
  }

  private seedDecorOccupancyFromWorldProps(): void {
    this.decorOccupiedSurfaceKeys.clear();
    for (const pad of JUMP_PADS) {
      addSurfaceGridKeysForFootprint(pad.x, pad.z, pad.width, pad.depth, this.decorOccupiedSurfaceKeys);
    }
    for (const lift of MOVING_ELEVATORS) {
      addSurfaceGridKeysForFootprint(lift.x, lift.z, lift.width, lift.depth, this.decorOccupiedSurfaceKeys);
    }
  }

  update(delta: number, elapsed: number, camera?: THREE.Camera, playerPosition?: THREE.Vector3): void {
    this.prepareWaterReflectorForFrame();

    this.syncDynamicPlatforms(elapsed);

    if (this.distantBackdrop) {
      updateDistantWorldBackdropMotion(this.distantBackdrop, elapsed);
    }

    this.distantPlanets.update(delta);

    if (this.cloudRingGroup && this.orbitalClouds.length > 0) {
      updateStylizedCloudRing(this.orbitalClouds, this.cloudRingGroup, delta, elapsed);
    }

    if (this.sunGroup) {
      const pulse = 1 + Math.sin(elapsed * 0.45) * 0.03;
      this.sunGroup.scale.setScalar(WorldManager.SUN_MESH_BASE_SCALE * pulse);
    }

    this.ambientDust.update(elapsed, camera);
    this.fishSchools.update(delta, elapsed);
    this.orbitingUfo.update(delta, elapsed);
    this.butterflyScatter.update(delta, elapsed);
    this.fishingBoatRight.update(delta, elapsed);
    this.fishingBoatLeft.update(delta, elapsed);
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

    if (this.sunSprite?.material instanceof THREE.SpriteMaterial) {
      this.sunSprite.material.color.set('#ffe8c8');
    }

    if (this.sunLight) {
      this.sunLight.intensity = 3.45 * settings.atmosphere.sunGlow;
      this.sunLight.color.set('#ffd6a0');
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
    if (!this.sunSprite) {
      return target.set(0, 26, -90);
    }

    this.sunSprite.getWorldPosition(this.sunWorldPosition);
    return target.copy(this.sunWorldPosition);
  }

  getLensFlareOccluders(): THREE.Object3D[] {
    return [this.worldRoot];
  }

  /** Mountains only — avoids treating nearby terrain/candy as blocking the sun flare. */
  getSunFlareOccluders(): THREE.Object3D[] {
    return [this.mountainBackdrop.root];
  }

  getGroundHeightAt(x: number, z: number, supportRadius?: number, maxHeight?: number): number | null {
    return this.terrainPhysics.getGroundHeightAt(x, z, supportRadius, maxHeight);
  }

  getGroundSupportAt(
    x: number,
    z: number,
    supportRadius?: number,
    maxHeight?: number,
  ): GroundSupportSample | null {
    return this.terrainPhysics.getGroundSupportAt(x, z, supportRadius, maxHeight);
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

    this.sunLight = new THREE.DirectionalLight('#ffd6a0', 3.45 * settings.atmosphere.sunGlow);
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
    const blobTex = WorldManager.createSunBlobTexture();
    const mat = new THREE.SpriteMaterial({
      map: blobTex,
      color: new THREE.Color('#ffe8c8'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.sunSprite = new THREE.Sprite(mat);
    this.sunSprite.center.set(0.5, 0.5);
    this.sunSprite.scale.set(132, 132, 1);
    this.sunSprite.renderOrder = 50;

    this.sunGroup = new THREE.Group();
    this.sunGroup.add(this.sunSprite);
    this.sunGroup.position.copy(this.sunAnchor);
    this.sunGroup.scale.setScalar(WorldManager.SUN_MESH_BASE_SCALE);
    this.scene.add(this.sunGroup);
  }

  /** One smooth radial falloff: bright opaque core → soft edge (no “donut” or second disk). */
  private static createSunBlobTexture(): THREE.CanvasTexture {
    const s = 256;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255, 252, 245, 1)');
    g.addColorStop(0.05, 'rgba(255, 248, 228, 1)');
    g.addColorStop(0.14, 'rgba(255, 238, 205, 0.96)');
    g.addColorStop(0.28, 'rgba(255, 224, 175, 0.8)');
    g.addColorStop(0.46, 'rgba(255, 205, 145, 0.52)');
    g.addColorStop(0.66, 'rgba(255, 185, 115, 0.26)');
    g.addColorStop(0.86, 'rgba(255, 165, 95, 0.08)');
    g.addColorStop(1, 'rgba(255, 150, 80, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Park the sun **outside** the mountain orbit (same basis as `MountainBackdropProp`) so depth tests
   * draw silhouettes in front of the disk while light direction stays similar.
   */
  private updateSunAnchorFromBackdrop(): void {
    const { centerX, centerZ, farOuterR } = getBackdropFarFrameMetrics();
    const orbitBase = farOuterR + BLOCK_UNIT * MOUNTAIN_ORBIT_MARGIN_BLOCKS;
    const orbitMax = orbitBase + BLOCK_UNIT * MOUNTAIN_SPAWN_EXTRA_MARGIN_BLOCKS;
    /**
     * Just past the farthest mountain pivot (not a full mesh radius beyond it): far enough to read
     * “behind” the ring, close enough that the disk isn’t always depth-occluded / sub-pixel.
     */
    const radial = orbitMax + BLOCK_UNIT * 52;

    const inPlane = new THREE.Vector3(
      WorldManager.SUN_AZIMUTH_HINT_XZ.x - centerX,
      0,
      WorldManager.SUN_AZIMUTH_HINT_XZ.y - centerZ,
    );
    if (inPlane.lengthSq() < 4) {
      inPlane.set(-1, 0, 1);
    }
    inPlane.normalize();

    this.sunAnchor.set(centerX + inPlane.x * radial, 112, centerZ + inPlane.z * radial);
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
      this.decorOccupiedSurfaceKeys.add(surfaceGridKeyFromWorldXZ(anchor.x, anchor.z));
    }
  }

  /**
   * Loads `public/assets/stylized_clouds_pack_vol_01.glb` and spawns a ring of clouds orbiting the playfield.
   * Safe to call once after `build()`; no-op if the file is missing (warning in console).
   */
  async loadCloudPack(): Promise<void> {
    if (this.cloudRingGroup) {
      return;
    }
    try {
      const { group, clouds } = await buildStylizedCloudRing(this.plantLoader);
      this.cloudRingGroup = group;
      this.orbitalClouds = clouds;
      this.worldRoot.add(group);
    } catch (err) {
      console.warn('[WorldManager] Could not load stylized cloud pack:', err);
    }
  }

  /** Stylized grass in the water ring around platform cubes (`stylized_grass_8/stylized_grass.glb`). */
  async loadWaterEdgeGrass(): Promise<void> {
    await this.waterEdgeGrass.load();
  }

  /** `public/assets/butterflies.glb` — scattered over platform tops (see `ButterflyScatterSystem`). */
  async loadButterflies(): Promise<void> {
    await this.butterflyScatter.load(this.decorOccupiedSurfaceKeys);
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

  private loadPlantScatter(): Promise<void> {
    if (this.plantScatterPromise) {
      return this.plantScatterPromise;
    }

    this.plantScatterPromise = (async () => {
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

      const results = await Promise.all(loadRequests);
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
    })().catch(() => {
      /* loader / normalize errors — leave plants empty */
    });

    return this.plantScatterPromise;
  }

  private static collectPlantMeshesDeep(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    root.updateMatrixWorld(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry) {
        meshes.push(node);
      }
    });
    return meshes;
  }

  private populatePlantScatter(variants: THREE.Object3D[]): void {
    const routeVariantIndices: number[] = [];
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      if (variant.userData.plantBucket !== 'tall' || variant.userData.scatterOnRoute === true) {
        routeVariantIndices.push(i);
      }
    }

    this.populateInstancedGroundScatter(
      variants,
      this.plantScatterRoot,
      {
        spawn: 0.34,
        path: 0.26,
        challenge: 0.12,
        decor: 0.12,
      },
      0.17,
      routeVariantIndices,
    );
  }

  private populateInstancedGroundScatter(
    variants: THREE.Object3D[],
    mountRoot: THREE.Group,
    density: { spawn: number; path: number; challenge: number; decor: number },
    hashSeed: number,
    routeVariantIndices: number[],
  ): void {
    mountRoot.clear();
    if (variants.length === 0) {
      return;
    }

    const allVariantIndices = variants.map((_, index) => index);
    let routeVariantCursor = 0;
    let offRouteVariantCursor = 0;

    const blockedTiles = new Set(
      JUMP_PADS.map((pad) => `${Math.round(pad.x / BLOCK_UNIT - 0.5)}:${Math.round(pad.z / BLOCK_UNIT - 0.5)}`),
    );

    const placements: GroundScatterPlacement[] = [];

    for (const tile of PLATFORM_SURFACE_TILES) {
      const tileKey = surfaceGridKeyFromTile(tile);
      if (blockedTiles.has(tileKey)) {
        continue;
      }
      if (this.decorOccupiedSurfaceKeys.has(tileKey)) {
        continue;
      }

      const baseDensity =
        tile.role === 'spawn'
          ? density.spawn
          : tile.role === 'path'
            ? density.path
            : tile.role === 'challenge'
              ? density.challenge
              : density.decor;
      const scatterRoll = this.hashTile(tile.gridX, tile.gridZ, hashSeed);
      if (scatterRoll > baseDensity) {
        continue;
      }

      const useRoutePool = tile.role === 'spawn' || tile.role === 'path';
      const pool = useRoutePool ? routeVariantIndices : allVariantIndices;
      if (pool.length === 0) {
        continue;
      }
      const selectionIndex = useRoutePool ? routeVariantCursor : offRouteVariantCursor;
      const variantIndex = pool[selectionIndex % pool.length] ?? 0;
      if (useRoutePool) {
        routeVariantCursor += 1;
      } else {
        offRouteVariantCursor += 1;
      }

      const variant = variants[variantIndex];
      const authoredScale =
        typeof variant.userData.plantScaleMultiplier === 'number' ? variant.userData.plantScaleMultiplier : 1;
      const jitterScale = authoredScale * (0.92 + this.hashTile(tile.gridX, tile.gridZ, 2.91) * 0.28);
      const yawStep = Math.floor(this.hashTile(tile.gridX, tile.gridZ, 1.13) * 4);
      const yaw = yawStep * (Math.PI * 0.5);
      const groundY = this.terrainPhysics.getGroundHeightAt(tile.x, tile.z) ?? tile.topY;

      placements.push({
        variantIndex,
        tileX: tile.x,
        tileZ: tile.z,
        groundY,
        yaw,
        jitterScale,
      });
      this.decorOccupiedSurfaceKeys.add(tileKey);
    }

    this.finalizeInstancedGroundScatter(variants, mountRoot, placements);
  }

  private finalizeInstancedGroundScatter(
    variants: THREE.Object3D[],
    mountRoot: THREE.Group,
    placements: GroundScatterPlacement[],
  ): void {
    const counts = new Array(variants.length).fill(0);
    for (const p of placements) {
      counts[p.variantIndex] += 1;
    }

    const instancedLayers: THREE.InstancedMesh[][] = variants.map(() => []);

    for (let vi = 0; vi < variants.length; vi += 1) {
      const n = counts[vi];
      if (n === 0) {
        continue;
      }

      const templateMeshes = WorldManager.collectPlantMeshesDeep(variants[vi]);
      for (const templateMesh of templateMeshes) {
        const instanced = new THREE.InstancedMesh(templateMesh.geometry, templateMesh.material, n);
        instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        instanced.frustumCulled = true;
        mountRoot.add(instanced);
        instancedLayers[vi].push(instanced);
      }
    }

    const cursors = new Array(variants.length).fill(0);
    const surfaceSink = BLOCK_UNIT * 0.018;

    for (const p of placements) {
      const vi = p.variantIndex;
      const idx = cursors[vi];
      cursors[vi] += 1;

      const variant = variants[vi];
      const clone = variant.clone(true);

      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      // Scale pivot, not PlantMeshRoot (offset inner group): inner-only uniform scale drifts XZ by (s-1)*footXZ.
      clone.scale.setScalar(p.jitterScale);
      clone.updateMatrixWorld(true);

      const footBounds = new THREE.Box3().setFromObject(clone);
      let footMinY = footBounds.min.y;
      if (!Number.isFinite(footMinY)) {
        footMinY = 0;
      }

      clone.rotation.y = p.yaw;
      clone.position.set(p.tileX, p.groundY - footMinY - surfaceSink, p.tileZ);
      clone.updateMatrixWorld(true);

      const cloneMeshes = WorldManager.collectPlantMeshesDeep(clone);
      const layers = instancedLayers[vi];
      const layerCount = Math.min(cloneMeshes.length, layers.length);
      for (let li = 0; li < layerCount; li += 1) {
        layers[li].setMatrixAt(idx, cloneMeshes[li].matrixWorld);
      }
    }

    for (const layers of instancedLayers) {
      for (const im of layers) {
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private createNormalizedPlantVariant(
    source: THREE.Object3D,
    fit: { footprintTarget: number; heightTarget: number } = {
      footprintTarget: BLOCK_UNIT * 0.76 * 0.75,
      heightTarget: BLOCK_UNIT * 1.02,
    },
  ): THREE.Object3D {
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
    const footprintScale = fit.footprintTarget / footprint;
    const heightScale = fit.heightTarget / Math.max(0.001, size.y);
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
    const colorCounts = new Map<string, number>();
    for (const anchor of CRYSTAL_ANCHORS) {
      colorCounts.set(anchor.color, (colorCounts.get(anchor.color) ?? 0) + 1);
    }

    const colorToMesh = new Map<string, THREE.InstancedMesh>();
    for (const [color, count] of colorCounts) {
      const mesh = this.props.createCrystalInstancedMesh(color, count);
      mesh.frustumCulled = true;
      this.worldRoot.add(mesh);
      colorToMesh.set(color, mesh);
    }

    const colorCursor = new Map<string, number>();
    for (const color of colorCounts.keys()) {
      colorCursor.set(color, 0);
    }

    const instances: CrystalInstance[] = [];

    CRYSTAL_ANCHORS.forEach(({ x, z, color }, index) => {
      const instancedMesh = colorToMesh.get(color)!;
      const instanceIndex = colorCursor.get(color)!;
      colorCursor.set(color, instanceIndex + 1);

      const surfaceSample = this.terrainPhysics.getNearestSpawnSurface(x, z);
      const basePosition = new THREE.Vector3(
        surfaceSample ? surfaceSample.position.x : x,
        (surfaceSample ? surfaceSample.position.y : BLOCK_UNIT * 0.14) + BLOCK_UNIT * 0.14,
        surfaceSample ? surfaceSample.position.z : z,
      );

      this.crystalLayoutDummy.position.copy(basePosition);
      this.crystalLayoutDummy.rotation.set(0, index * 0.73, 0);
      this.crystalLayoutDummy.scale.set(0.58, 0.92, 0.58);
      this.crystalLayoutDummy.updateMatrix();
      instancedMesh.setMatrixAt(instanceIndex, this.crystalLayoutDummy.matrix);

      instances.push({
        id: `crystal-${index}`,
        instancedMesh,
        instanceIndex,
        basePosition: basePosition.clone(),
        color,
        collected: false,
        respawnAt: 0,
        rotationY: index * 0.73,
      });

      this.decorOccupiedSurfaceKeys.add(surfaceGridKeyFromWorldXZ(basePosition.x, basePosition.z));
    });

    for (const mesh of colorToMesh.values()) {
      mesh.instanceMatrix.needsUpdate = true;
    }

    return instances;
  }
}
