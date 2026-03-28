import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AtmosphereSettings, FxSettings, WaterFxSettings } from '../fx/FxSettings';
import { WATER_SURFACE_Y } from '../config/defaults';
import { isFresnelCapableMaterial, updateFresnelMaterial } from '../materials/FresnelMaterial';
import { PropFactory } from './PropFactory';
import { AmbientDustSystem } from './AmbientDustSystem';
import { FishSchoolsSystem } from './FishSchoolsSystem';
import {
  FishingBoatProp,
  FISHING_BOAT_PLACEMENT_LEFT,
  FISHING_BOAT_PLACEMENT_RIGHT,
} from './FishingBoatProp';
import { FloatingBarrelsProp } from './FloatingBarrelsProp';
import { DistantPlanetsBackdrop, getSunAnchorHorizonDistanceWorld } from './DistantPlanetsBackdrop';
import { MountainBackdropProp } from './MountainBackdropProp';
import { ButterflyScatterSystem } from './ButterflyScatterSystem';
import { WaterEdgeGrassScatter } from './WaterEdgeGrassScatter';
import { SeaFloorRocksScatter } from './SeaFloorRocksScatter';
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
  CRYSTAL_INSTANCE_SCALE,
  DECOR_ANCHORS,
  JUMP_PADS,
  MOVING_ELEVATORS,
  PLATFORM_SURFACE_TILES,
  RESPAWN_ANCHORS,
  surfaceGridKeyFromTile,
  surfaceGridKeyFromWorldXZ,
  surfaceTileFacesOpenPerimeter,
} from './TerrainLayout';
import type { CrystalInstance } from '../systems/CrystalSystem';
import { publicUrl } from '../config/publicUrl';
import { loadCrystalPickupGeometryFromGlb } from './crystalPickupMesh';

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
  /** Skip tiles that border open water — keeps tall variants on interior land only. */
  landInteriorOnly?: boolean;
  /**
   * How many times this variant is repeated in the round-robin pool (default 1). Lower = rarer vs siblings
   * (e.g. cyan `candy-shrub-a` clusters vs other land plants).
   */
  scatterPoolCopies?: number;
};

export class WorldManager {
  readonly scene = new THREE.Scene();
  /** Outer group: world position + yaw live here; origin = AABB bottom-face center on the ground (XZ not shifted by volumetric center). */
  private static readonly PLANT_PIVOT_NAME = 'PlantPivot';
  /** Inner group: uniform fit scale + per-tile jitter scale; pivot offset lives here so root scale does not shear the pivot. */
  private static readonly PLANT_MESH_ROOT_NAME = 'PlantMeshRoot';
  private static readonly ENVIRONMENT_MAP_URL = publicUrl('hdri/MR_EXT-010_BlueEndDayPinkClouds_Moorea_4k.png');
  /** Base mesh scale (+25% vs legacy); multiplied by `atmosphere.sunDiscScale` and pulse each frame. */
  private static readonly SUN_MESH_BASE_SCALE = 1.24 * 1.25;
  /** World-space radius of the sun sphere (only geometry; halo comes from bloom). */
  private static readonly SUN_CORE_RADIUS = 34;
  /** Cool / neutral / warm for `sunTemperature` 0 → 0.5 → 1 (piecewise lerp). */
  private static readonly SUN_TEMP_LIGHT_COOL = /* @__PURE__ */ new THREE.Color('#8ec8ff');
  /** Default “day” key — soft beige, not pure white (pairs with HDR sun disc). */
  private static readonly SUN_TEMP_LIGHT_NEUTRAL = /* @__PURE__ */ new THREE.Color('#e8c9a8');
  private static readonly SUN_TEMP_LIGHT_WARM = /* @__PURE__ */ new THREE.Color('#ff5a18');
  private static readonly SUN_TEMP_HDR_COOL = /* @__PURE__ */ new THREE.Vector3(2.35, 2.95, 3.55);
  /** Beige-hot disc: R > G > B so bloom still reads warm vs chalk white. */
  private static readonly SUN_TEMP_HDR_NEUTRAL = /* @__PURE__ */ new THREE.Vector3(3.28, 2.96, 2.42);
  private static readonly SUN_TEMP_HDR_WARM = /* @__PURE__ */ new THREE.Vector3(3.75, 2.65, 2.05);
  private static readonly sunTempHdrScratch = new THREE.Vector3();
  /** Extra HDR push toward orange-red on the sun mesh near 6PM (after base temperature). */
  private static readonly SUN_SUNSET_HDR_ORANGE = /* @__PURE__ */ new THREE.Vector3(5.35, 1.22, 0.18);
  /** Shared vertical stops: zenith → horizon (matches `createSkyGradientTextureFromPhase`). */
  private static readonly SKY_GRADIENT_T = [0, 0.14, 0.32, 0.48, 0.6, 0.78, 1] as const;
  private static readonly SKY_NOON_HEX = [
    '#2d6fb3',
    '#4ba6cf',
    '#a1c2cf',
    '#e8d0c4',
    '#f9dfa8',
    '#f2b078',
    '#efa055',
  ] as const;
  /** Dusk palette — less neon magenta than v1; reads coral / peach / gold toward horizon. */
  private static readonly SKY_SUNSET_HEX = [
    '#2a2248',
    '#4d3d68',
    '#9a6e82',
    '#e08868',
    '#e87838',
    '#f0a028',
    '#ffe090',
  ] as const;
  /** Cool moonlit sky (zenith → horizon); used when the sun is below the horizon. */
  private static readonly SKY_NIGHT_HEX = [
    '#060a14',
    '#0a1224',
    '#0f1a34',
    '#152848',
    '#1a3254',
    '#1f3a5c',
    '#284a6e',
  ] as const;
  /** Fixed solar arc amplitude (removed from FX panel — time-of-day drives height). */
  private static readonly SUN_NOON_ELEVATION_DEG = 68;
  /**
   * Hint XZ (world) for which compass sector the sun sits in; anchor length is recomputed from backdrop
   * metrics so the disk sits **past** the mountain ring.
   */
  private static readonly SUN_AZIMUTH_HINT_XZ = new THREE.Vector2(-32, 84);
  private static readonly CURATED_PLANT_PROFILES: readonly CuratedPlantProfile[] = [
    { url: publicUrl('plants/curated/candy-bloom-a.glb'), bucket: 'balanced', scale: 1.18 },
    { url: publicUrl('plants/curated/candy-bloom-b.glb'), bucket: 'balanced', scale: 1.08 },
    /** Cyan glowing clusters — keep rare vs shrubs / blooms. */
    { url: publicUrl('plants/curated/candy-shrub-a.glb'), bucket: 'balanced', scale: 1.12, scatterPoolCopies: 1 },
    { url: publicUrl('plants/curated/candy-shrub-b.glb'), bucket: 'balanced', scale: 1.04, scatterPoolCopies: 4 },
    // Purple spike only for tall bucket (replaces spike-a / spike-b); allowed on main path so it shows on the map.
    {
      url: publicUrl('plants/curated/candy-spike-purple.glb'),
      bucket: 'tall',
      scale: 0.96,
      scatterOnRoute: true,
      landInteriorOnly: true,
    },
  ];

  private readonly worldRoot = new THREE.Group();
  private readonly plantScatterRoot = new THREE.Group();
  private readonly props = new PropFactory();
  private readonly ambientDust = new AmbientDustSystem();
  /** Skip O(n) fresnel mesh walk when only fog/water/particles/etc. changed. */
  private fresnelSettingsSignature = '';
  private readonly fishSchools = new FishSchoolsSystem(this.worldRoot);
  private readonly fishingBoatRight = new FishingBoatProp(this.worldRoot, FISHING_BOAT_PLACEMENT_RIGHT);
  private readonly fishingBoatLeft = new FishingBoatProp(this.worldRoot, FISHING_BOAT_PLACEMENT_LEFT);
  private readonly floatingBarrels = new FloatingBarrelsProp(this.worldRoot);
  private readonly distantPlanets = new DistantPlanetsBackdrop(this.worldRoot);
  private readonly mountainBackdrop = new MountainBackdropProp(this.worldRoot);
  private readonly terrain = new TerrainGenerator();
  /** Terrain `createGround` root — sea bed, water, platforms (rocks parent here for correct depth order). */
  private terrainRootGroup: THREE.Group | null = null;
  private readonly terrainPhysics = new TerrainPhysics();
  private readonly cactusEnemies: CactusEnemySystem;
  private readonly plantLoader = new GLTFLoader();

  private static readonly CRYSTAL_PICKUP_GLB = publicUrl('assets/game_ready_low_poly_crystal.glb');
  private readonly butterflyScatter: ButterflyScatterSystem;
  private readonly waterEdgeGrass: WaterEdgeGrassScatter;
  private readonly seaFloorRocks: SeaFloorRocksScatter;
  private readonly orbitingUfo: OrbitingUfoProp;
  private distantBackdrop: THREE.Group | null = null;
  private orbitalClouds: OrbitalCloud[] = [];
  private cloudRingGroup?: THREE.Group;
  private readonly sunAnchor = new THREE.Vector3();
  private readonly sunTargetPosition = new THREE.Vector3(0, 4, -10);

  private sunGroup?: THREE.Group;
  /** Single bright sphere — no billboard layer (avoids donut / inner dark disc). */
  private sunCore?: THREE.Mesh;
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
  /** From `atmosphere.sunDiscScale`; updated in `applyFxSettings`. */
  private sunDiscScaleUser = 1;
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
  /** Avoid rebaking sky canvas when time slider hasn’t moved meaningfully. */
  private skyGradientTimeKey = '';
  private readonly twilightFogScratch = new THREE.Color();
  private readonly twilightAmbientScratch = new THREE.Color();
  private readonly twilightHemiSkyScratch = new THREE.Color();
  private readonly twilightHemiGroundScratch = new THREE.Color();
  private readonly twilightZenithScratch = new THREE.Color();
  private readonly skyStopScratchA = new THREE.Color();
  private readonly skyStopScratchB = new THREE.Color();
  private readonly skyHslScratch = { h: 0, s: 0, l: 0 };
  private readonly waterTwilightScratch = new THREE.Color();
  private readonly waterWarmTint = /* @__PURE__ */ new THREE.Color('#ff7a4a');
  private readonly nightLiftTarget = new THREE.Color();

  constructor(audioHooks?: WorldAudioHooks) {
    this.cactusEnemies = new CactusEnemySystem(
      this.worldRoot,
      this.terrainPhysics,
      audioHooks?.playCactusEnemyProximity,
      audioHooks?.isCactusEnemyProximityVoiceActive,
    );
    this.butterflyScatter = new ButterflyScatterSystem(this.worldRoot, this.plantLoader);
    this.waterEdgeGrass = new WaterEdgeGrassScatter(this.worldRoot, this.plantLoader);
    this.seaFloorRocks = new SeaFloorRocksScatter();
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
    this.scene.background = new THREE.Color('#2d6fb3');
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(settings.atmosphere.fogColor),
      settings.atmosphere.fogDensity,
    );

    this.loadEnvironmentMap();
    this.buildSkyDome(settings.atmosphere);
    this.updateSunPositionFromAtmosphere(settings.atmosphere);
    this.buildLights(settings);
    this.buildSun(settings);
    this.distantBackdrop = createDistantWorldBackdrop();
    this.worldRoot.add(this.distantBackdrop);
    WorldManager.markSubtreeNoLensflareOcclusion(this.distantBackdrop);
    this.terrainRootGroup = this.terrain.createGround(waterHighFrequencyNormal, settings.water.color);
    this.worldRoot.add(this.terrainRootGroup);
    this.fishSchools.load();
    this.fishingBoatRight.load();
    this.fishingBoatLeft.load();
    this.floatingBarrels.load();
    this.distantPlanets.load();
    this.mountainBackdrop.load();
    this.orbitingUfo.load();
    this.seedDecorOccupancyFromWorldProps();
    this.worldRoot.add(this.plantScatterRoot);
    this.buildLandmarks();
    this.worldRoot.add(this.ambientDust.mesh);
    WorldManager.markSubtreeNoLensflareOcclusion(this.ambientDust.mesh);
    this.ambientDust.applySettings(settings.particles);

    return this.buildCrystals();
  }

  /** Surface cells already used by jump pads, elevators, island decor, crystals, plants (read after `loadDecorScatter`). */
  getDecorOccupiedSurfaceKeys(): ReadonlySet<string> {
    return this.decorOccupiedSurfaceKeys;
  }

  /** Shared mesh used by crystal instances — safe for transient pickup dissolve meshes. */
  getCrystalGeometry(): THREE.BufferGeometry {
    return this.props.getCrystalGeometry();
  }

  /**
   * Load authored crystal GLB before `build()` so instanced pickups use that mesh at the same scales.
   */
  async loadCrystalPickupMesh(): Promise<void> {
    const ref = this.props.getCrystalGeometry();
    try {
      const geo = await loadCrystalPickupGeometryFromGlb(
        this.plantLoader,
        WorldManager.CRYSTAL_PICKUP_GLB,
        ref,
      );
      this.props.setCrystalPickupGeometry(geo);
    } catch (err) {
      console.warn('[WorldManager] Crystal GLB missing or invalid — procedural crystal', err);
    }
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
      this.sunGroup.scale.setScalar(
        WorldManager.SUN_MESH_BASE_SCALE * this.sunDiscScaleUser * pulse,
      );
    }
    this.ambientDust.update(elapsed, camera);
    this.fishSchools.update(delta, elapsed);
    this.orbitingUfo.update(delta, elapsed);
    this.butterflyScatter.update(delta, elapsed);
    this.fishingBoatRight.update(delta, elapsed);
    this.fishingBoatLeft.update(delta, elapsed);
    this.floatingBarrels.update(delta, elapsed);
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

  /**
   * Zenith clear color, fog, ambient, hemisphere, and cool fill — invoked from `applyFxSettings`
   * (FX panel `input` events already run every frame while dragging time-of-day).
   */
  private applyTimeOfDayAmbience(settings: FxSettings, sunsetPhase: number): void {
    const elev = WorldManager.computeSunElevationAboveHorizonRad(settings.atmosphere.sunTimeOfDayHours);
    const night01 = WorldManager.nightPhase01FromElevation(elev);
    /** Fade sunset tints after dark so warm dusk doesn’t fight moonlit blue. */
    const sunsetWeight = 1 - night01;

    const skyZenithBlend = Math.pow(sunsetPhase, 0.92) * sunsetWeight;
    this.twilightHemiSkyScratch.set(WorldManager.SKY_SUNSET_HEX[0]);
    this.twilightZenithScratch.set(WorldManager.SKY_NOON_HEX[0]).lerp(this.twilightHemiSkyScratch, skyZenithBlend);
    if (night01 > 1e-4) {
      this.nightLiftTarget.set('#0c1222');
      this.twilightZenithScratch.lerp(this.nightLiftTarget, night01 * 0.92);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.twilightZenithScratch);
    } else {
      this.scene.background = this.twilightZenithScratch.clone();
    }

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.twilightFogScratch.set(settings.atmosphere.fogColor);
      this.twilightHemiSkyScratch.set('#9b6ba8');
      this.twilightFogScratch.lerp(this.twilightHemiSkyScratch, sunsetPhase * 0.52 * sunsetWeight);
      this.twilightHemiGroundScratch.set('#c87858');
      this.twilightFogScratch.lerp(this.twilightHemiGroundScratch, sunsetPhase * 0.28 * sunsetWeight);
      if (night01 > 1e-4) {
        this.nightLiftTarget.set('#141c2e');
        this.twilightFogScratch.lerp(this.nightLiftTarget, night01 * 0.72);
      }
      this.scene.fog.color.copy(this.twilightFogScratch);
      this.scene.fog.density = settings.atmosphere.fogDensity;
    }

    if (this.ambientLight) {
      this.twilightAmbientScratch.set('#d8e6f0');
      this.twilightHemiSkyScratch.set('#f2d2c4');
      this.twilightAmbientScratch.lerp(this.twilightHemiSkyScratch, sunsetPhase * 0.42 * sunsetWeight);
      if (night01 > 1e-4) {
        this.nightLiftTarget.set('#b8cff5');
        this.twilightAmbientScratch.lerp(this.nightLiftTarget, night01 * 0.97);
      }
      this.ambientLight.color.copy(this.twilightAmbientScratch);
      this.ambientLight.intensity =
        settings.atmosphere.ambientIntensity *
        (1 + sunsetPhase * 0.06 * sunsetWeight) *
        THREE.MathUtils.lerp(1, 1.45, night01);
    }

    if (this.hemiLight) {
      this.twilightHemiSkyScratch.set('#8ebfe0');
      this.twilightZenithScratch.set('#b88fd8');
      this.twilightHemiSkyScratch.lerp(this.twilightZenithScratch, sunsetPhase * 0.58 * sunsetWeight);
      if (night01 > 1e-4) {
        this.nightLiftTarget.set('#6a9bd4');
        this.twilightHemiSkyScratch.lerp(this.nightLiftTarget, night01 * 0.96);
      }
      this.hemiLight.color.copy(this.twilightHemiSkyScratch);
      this.twilightHemiGroundScratch.set('#f2e0c8');
      this.twilightZenithScratch.set('#f0b898');
      this.twilightHemiGroundScratch.lerp(this.twilightZenithScratch, sunsetPhase * 0.45 * sunsetWeight);
      if (night01 > 1e-4) {
        this.nightLiftTarget.set('#1e2c44');
        this.twilightHemiGroundScratch.lerp(this.nightLiftTarget, night01 * 0.88);
      }
      this.hemiLight.groundColor.copy(this.twilightHemiGroundScratch);
      this.hemiLight.intensity = settings.atmosphere.hemiIntensity * THREE.MathUtils.lerp(1, 0.32, night01);
    }

    if (this.coolLight) {
      this.coolLight.intensity =
        1.8 * (1 - sunsetPhase * 0.45 * sunsetWeight) * THREE.MathUtils.lerp(1, 1.65, night01);
      this.coolLight.color.set('#8ebeff');
      if (night01 > 0.08) {
        this.nightLiftTarget.set('#d2e8ff');
        this.coolLight.color.lerp(this.nightLiftTarget, Math.min(1, night01 * 1.1));
      }
    }
  }

  applyFxSettings(settings: FxSettings): void {
    const sunsetPhase = WorldManager.computeSunsetPhase01(settings.atmosphere.sunTimeOfDayHours);
    const elevSky = WorldManager.computeSunElevationAboveHorizonRad(settings.atmosphere.sunTimeOfDayHours);
    this.refreshSkyGradientTexture(
      settings.atmosphere.sunTimeOfDayHours,
      sunsetPhase,
      WorldManager.nightPhase01FromElevation(elevSky),
    );
    this.applyTimeOfDayAmbience(settings, sunsetPhase);

    const effectiveSunTemp = WorldManager.computeEffectiveSunTemperature(settings.atmosphere);
    const sunTintTemp = THREE.MathUtils.clamp(effectiveSunTemp + sunsetPhase * 0.4, 0, 1);

    if (this.sunCore?.material instanceof THREE.MeshBasicMaterial) {
      WorldManager.applySunCoreHdrColorWithSunset(this.sunCore.material, effectiveSunTemp, sunsetPhase);
    }

    if (this.sunLight) {
      this.sunLight.intensity = 3.45 * settings.atmosphere.sunGlow * (1 + sunsetPhase * 0.1);
      WorldManager.sunTemperatureToLightColor(sunTintTemp, this.sunLight.color);
    }

    const disc = Number(settings.atmosphere.sunDiscScale);
    this.sunDiscScaleUser = Number.isFinite(disc)
      ? THREE.MathUtils.clamp(disc, 0.2, 3.5)
      : 1;

    this.updateSunPositionFromAtmosphere(settings.atmosphere);
    if (this.sunGroup) {
      this.sunGroup.position.copy(this.sunAnchor);
    }
    this.syncSunLighting();

    this.ambientDust.applySettings(settings.particles);

    this.waterTwilightScratch.set(settings.water.color);
    this.waterTwilightScratch.lerp(this.waterWarmTint, sunsetPhase * 0.36);
    const waterFx: WaterFxSettings = {
      ...settings.water,
      color: `#${this.waterTwilightScratch.getHexString()}`,
    };
    this.terrain.applyWaterFxSettings(waterFx);

    if (this.environmentTexture) {
      this.scene.environment = this.environmentTexture;
    }

    const fresnelSig = `${settings.fresnel.color}\0${settings.fresnel.strength}\0${settings.fresnel.radius}`;
    if (fresnelSig !== this.fresnelSettingsSignature) {
      this.fresnelSettingsSignature = fresnelSig;
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
  }

  getSunWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.sunGroup) {
      return target.set(0, 26, -90);
    }

    this.sunGroup.getWorldPosition(this.sunWorldPosition);
    return target.copy(this.sunWorldPosition);
  }

  /**
   * Terrain + mountain ring only. Raycasting the full `worldRoot` tests every instanced backdrop
   * cube / plant / crystal before `no-occlusion` filtering and destroys frame time.
   */
  getLensFlareOccluders(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [this.mountainBackdrop.root];
    if (this.terrainRootGroup) {
      list.push(this.terrainRootGroup);
    }
    return list;
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
    this.ambientLight = new THREE.AmbientLight('#d8e6f0', settings.atmosphere.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(
      '#8ebfe0',
      '#f2e0c8',
      settings.atmosphere.hemiIntensity,
    );
    this.scene.add(this.hemiLight);

    const sunsetPh = WorldManager.computeSunsetPhase01(settings.atmosphere.sunTimeOfDayHours);
    const sunTint = THREE.MathUtils.clamp(
      WorldManager.computeEffectiveSunTemperature(settings.atmosphere) + sunsetPh * 0.4,
      0,
      1,
    );
    const sunCol = WorldManager.sunTemperatureToLightColor(sunTint, new THREE.Color());
    this.sunLight = new THREE.DirectionalLight(sunCol, 3.45 * settings.atmosphere.sunGlow * (1 + sunsetPh * 0.1));
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

    this.coolLight = new THREE.PointLight('#8ebeff', 1.8, 140, 2);
    this.coolLight.position.set(22, 12, 16);
    this.scene.add(this.coolLight);

    this.syncSunLighting();
  }

  /**
   * Elevation above horizon (radians). Hour 12 = +noonMax; 6 & 18 = 0; 0 (midnight) = −noonMax.
   */
  static computeSunElevationAboveHorizonRad(timeHours: number): number {
    const h = THREE.MathUtils.euclideanModulo(timeHours, 24);
    const noon = THREE.MathUtils.degToRad(WorldManager.SUN_NOON_ELEVATION_DEG);
    return noon * Math.cos(((h - 12) / 24) * Math.PI * 2);
  }

  /** 0 in daylight; eases to 1 when the sun is below the horizon (cool night read). */
  static nightPhase01FromElevation(elevationAboveHorizonRad: number): number {
    if (elevationAboveHorizonRad >= 0) {
      return 0;
    }
    return THREE.MathUtils.smoothstep(0, 0.32, -elevationAboveHorizonRad);
  }

  /**
   * 0 = cool (night below horizon), 1 = warm at horizon; zenith cools via 1−sin(elev).
   */
  static computeTimeDrivenSunWarmth01(elevationAboveHorizonRad: number): number {
    if (elevationAboveHorizonRad < -0.035) {
      return 0;
    }
    const e = Math.max(0, elevationAboveHorizonRad);
    return 1 - Math.sin(THREE.MathUtils.clamp(e, 0, Math.PI / 2));
  }

  /** Combines time-of-day warmth with {@link AtmosphereSettings.sunTemperature} bias (0.5 = neutral). */
  static computeEffectiveSunTemperature(atmosphere: AtmosphereSettings): number {
    const el = WorldManager.computeSunElevationAboveHorizonRad(atmosphere.sunTimeOfDayHours);
    const auto = WorldManager.computeTimeDrivenSunWarmth01(el);
    const bias = Number(atmosphere.sunTemperature);
    const b = Number.isFinite(bias) ? THREE.MathUtils.clamp(bias, 0, 1) : 0.5;
    return THREE.MathUtils.clamp(auto + (b - 0.5) * 1.2, 0, 1);
  }

  /** Raycast targets with this skip sky / sun / decorative backdrop so lens flare occludes on real geometry only. */
  private static markSubtreeNoLensflareOcclusion(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.Points ||
        obj instanceof THREE.Line ||
        obj instanceof THREE.LineSegments
      ) {
        obj.userData.lensflare = 'no-occlusion';
      }
    });
  }

  /**
   * 0 = noon blue; warm sunset ramps from ~14:00, full by ~19:45. Night sky tint uses sun elevation, not this alone.
   */
  static computeSunsetPhase01(timeHours: number): number {
    const h = THREE.MathUtils.euclideanModulo(timeHours, 24);
    if (h < 12) {
      return 0;
    }
    if (h < 14) {
      return 0;
    }
    if (h >= 19.75) {
      return 1;
    }
    return THREE.MathUtils.smoothstep(h, 14, 19.75);
  }

  /**
   * Lens flare / UI tint: matches directional sun push toward orange near sunset.
   */
  static computeSunVisualTemperatureForFlare(atmosphere: AtmosphereSettings): number {
    const ph = WorldManager.computeSunsetPhase01(atmosphere.sunTimeOfDayHours);
    const base = WorldManager.computeEffectiveSunTemperature(atmosphere);
    return THREE.MathUtils.clamp(base + ph * 0.4, 0, 1);
  }

  /**
   * Directional sun / lens-flare tint: 0 = cool blue-white, 0.5 = legacy default, 1 = warm orange.
   */
  static sunTemperatureToLightColor(temperature01: number, target: THREE.Color): THREE.Color {
    const u = THREE.MathUtils.clamp(temperature01, 0, 1);
    const cold = WorldManager.SUN_TEMP_LIGHT_COOL;
    const neutral = WorldManager.SUN_TEMP_LIGHT_NEUTRAL;
    const warm = WorldManager.SUN_TEMP_LIGHT_WARM;
    if (u <= 0.5) {
      return target.copy(cold).lerp(neutral, u * 2);
    }
    return target.copy(neutral).lerp(warm, (u - 0.5) * 2);
  }

  private static applySunCoreHdrColor(material: THREE.MeshBasicMaterial, temperature01: number): void {
    const u = THREE.MathUtils.clamp(temperature01, 0, 1);
    const cold = WorldManager.SUN_TEMP_HDR_COOL;
    const neutral = WorldManager.SUN_TEMP_HDR_NEUTRAL;
    const warm = WorldManager.SUN_TEMP_HDR_WARM;
    const v = WorldManager.sunTempHdrScratch;
    if (u <= 0.5) {
      v.copy(cold).lerp(neutral, u * 2);
    } else {
      v.copy(neutral).lerp(warm, (u - 0.5) * 2);
    }
    material.color.setRGB(v.x, v.y, v.z);
  }

  private static applySunCoreHdrColorWithSunset(
    material: THREE.MeshBasicMaterial,
    temperature01: number,
    sunsetPhase01: number,
  ): void {
    WorldManager.applySunCoreHdrColor(material, temperature01);
    const ph = THREE.MathUtils.clamp(sunsetPhase01, 0, 1);
    if (ph <= 1e-4) {
      return;
    }
    const w = ph * ph * (0.55 + ph * 0.35);
    const v = WorldManager.sunTempHdrScratch;
    v.set(material.color.r, material.color.g, material.color.b);
    v.lerp(WorldManager.SUN_SUNSET_HDR_ORANGE, w);
    material.color.setRGB(v.x, v.y, v.z);
  }

  private buildSun(settings: FxSettings): void {
    const coreGeo = new THREE.SphereGeometry(WorldManager.SUN_CORE_RADIUS, 48, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      fog: false,
      toneMapped: false,
      depthTest: true,
      depthWrite: true,
    });
    WorldManager.applySunCoreHdrColorWithSunset(
      coreMat,
      WorldManager.computeEffectiveSunTemperature(settings.atmosphere),
      WorldManager.computeSunsetPhase01(settings.atmosphere.sunTimeOfDayHours),
    );
    this.sunCore = new THREE.Mesh(coreGeo, coreMat);

    this.sunGroup = new THREE.Group();
    this.sunGroup.add(this.sunCore);
    this.sunGroup.position.copy(this.sunAnchor);
    const disc = Number(settings.atmosphere.sunDiscScale);
    this.sunDiscScaleUser = Number.isFinite(disc)
      ? THREE.MathUtils.clamp(disc, 0.2, 3.5)
      : 1;
    this.sunGroup.scale.setScalar(WorldManager.SUN_MESH_BASE_SCALE * this.sunDiscScaleUser);
    this.scene.add(this.sunGroup);
    WorldManager.markSubtreeNoLensflareOcclusion(this.sunGroup);
  }

  /**
   * Sun on a sphere around the playfield centroid: azimuth from settings, elevation from time of day,
   * radius past distant planets (`getSunAnchorHorizonDistanceWorld`).
   */
  private updateSunPositionFromAtmosphere(atmosphere: AtmosphereSettings): void {
    const { centerX, centerZ } = getBackdropFarFrameMetrics();
    const radial = getSunAnchorHorizonDistanceWorld();

    const inPlane = new THREE.Vector3(
      WorldManager.SUN_AZIMUTH_HINT_XZ.x - centerX,
      0,
      WorldManager.SUN_AZIMUTH_HINT_XZ.y - centerZ,
    );
    if (inPlane.lengthSq() < 4) {
      inPlane.set(-1, 0, 1);
    }
    inPlane.normalize();

    const yaw = THREE.MathUtils.degToRad(THREE.MathUtils.euclideanModulo(atmosphere.sunAzimuthDegrees, 360));
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rx = inPlane.x * cy - inPlane.z * sy;
    const rz = inPlane.x * sy + inPlane.z * cy;
    inPlane.set(rx, 0, rz);

    const el = WorldManager.computeSunElevationAboveHorizonRad(atmosphere.sunTimeOfDayHours);
    const cEl = Math.cos(el);
    const sEl = Math.sin(el);
    const dirX = inPlane.x * cEl;
    const dirY = sEl;
    const dirZ = inPlane.z * cEl;

    const focusY = WATER_SURFACE_Y + BLOCK_UNIT * 22;
    this.sunAnchor.set(centerX + dirX * radial, focusY + dirY * radial, centerZ + dirZ * radial);
  }

  private buildSkyDome(atmosphere: AtmosphereSettings): void {
    const phase = WorldManager.computeSunsetPhase01(atmosphere.sunTimeOfDayHours);
    const elev = WorldManager.computeSunElevationAboveHorizonRad(atmosphere.sunTimeOfDayHours);
    const nightPh = WorldManager.nightPhase01FromElevation(elev);
    this.skyGradientTimeKey = `${atmosphere.sunTimeOfDayHours.toFixed(3)}|${nightPh.toFixed(2)}`;
    const skyTexture = this.createSkyGradientTextureFromPhase(phase, nightPh);
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      /** Exp2 fog at ~400m+ flattens the canvas gradient toward fog tint; sky reads as a solid wash. */
      fog: false,
      depthWrite: false,
    });

    const skyRadius = Math.max(420, getSunAnchorHorizonDistanceWorld() * 1.28 + 180);
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(skyRadius, 48, 28), skyMaterial);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);
    WorldManager.markSubtreeNoLensflareOcclusion(this.skyDome);
  }

  private refreshSkyGradientTexture(timeHours: number, sunsetPhase01: number, nightPhase01: number): void {
    if (!this.skyDome) {
      return;
    }
    const key = `${timeHours.toFixed(3)}|${nightPhase01.toFixed(2)}`;
    if (key === this.skyGradientTimeKey) {
      return;
    }
    this.skyGradientTimeKey = key;
    const tex = this.createSkyGradientTextureFromPhase(sunsetPhase01, nightPhase01);
    const mat = this.skyDome.material;
    if (mat instanceof THREE.MeshBasicMaterial) {
      mat.map?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
    }
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
      WorldManager.markSubtreeNoLensflareOcclusion(group);
    } catch (err) {
      console.warn('[WorldManager] Could not load stylized cloud pack:', err);
    }
  }

  /** Stylized grass in the water ring around platform cubes (`stylized_grass_8/stylized_grass.glb`). */
  async loadWaterEdgeGrass(): Promise<void> {
    await this.waterEdgeGrass.load();
  }

  async loadSeaFloorRocks(): Promise<void> {
    const parent = this.terrainRootGroup;
    if (!parent) {
      return;
    }
    await this.seaFloorRocks.load(this.plantLoader, parent);
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
        variant.userData.landInteriorOnly = result.profile.landInteriorOnly === true;
        if (typeof result.profile.scatterPoolCopies === 'number') {
          variant.userData.scatterPoolCopies = result.profile.scatterPoolCopies;
        }
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

  /** Repeat variant indices for weighted round-robin scatter (see `scatterPoolCopies` on profiles). */
  private static expandScatterPool(variants: THREE.Object3D[], indices: number[]): number[] {
    const out: number[] = [];
    for (const i of indices) {
      const raw = variants[i]?.userData.scatterPoolCopies;
      const n =
        typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 1;
      for (let k = 0; k < n; k += 1) {
        out.push(i);
      }
    }
    return out;
  }

  private populatePlantScatter(variants: THREE.Object3D[]): void {
    const routeBase: number[] = [];
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      if (variant.userData.plantBucket !== 'tall' || variant.userData.scatterOnRoute === true) {
        routeBase.push(i);
      }
    }
    const routeVariantIndices = WorldManager.expandScatterPool(variants, routeBase);

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

    const allVariantIndices = WorldManager.expandScatterPool(
      variants,
      variants.map((_, index) => index),
    );
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
      let pool = useRoutePool ? routeVariantIndices : allVariantIndices;
      if (surfaceTileFacesOpenPerimeter(tile)) {
        const filtered = pool.filter((vi) => !variants[vi].userData.landInteriorOnly);
        if (filtered.length > 0) {
          pool = filtered;
        }
      }
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

  /** Canvas gradient: noon ↔ sunset while up; lerps to {@link SKY_NIGHT_HEX} when `nightPhase01` rises. */
  private createSkyGradientTextureFromPhase(sunsetPhase01: number, nightPhase01: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 512;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Candy Lands could not create the sky gradient context.');
    }

    const ph = THREE.MathUtils.clamp(sunsetPhase01, 0, 1);
    const night = THREE.MathUtils.clamp(nightPhase01, 0, 1);
    const duskOnly = ph * (1 - night);
    /** Slightly ahead of fog/lights so warm horizon reads earlier in the afternoon. */
    const skyBlend = Math.pow(duskOnly, 0.88);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    const stops = WorldManager.SKY_GRADIENT_T;
    for (let i = 0; i < stops.length; i += 1) {
      this.skyStopScratchA.set(WorldManager.SKY_NOON_HEX[i]);
      this.skyStopScratchB.set(WorldManager.SKY_SUNSET_HEX[i]);
      this.skyStopScratchA.lerp(this.skyStopScratchB, skyBlend);
      const satBoost = 0.28 * skyBlend;
      if (satBoost > 1e-4) {
        this.skyStopScratchA.getHSL(this.skyHslScratch);
        this.skyHslScratch.s = THREE.MathUtils.clamp(
          this.skyHslScratch.s + (1 - this.skyHslScratch.s) * satBoost,
          0,
          1,
        );
        this.skyStopScratchA.setHSL(this.skyHslScratch.h, this.skyHslScratch.s, this.skyHslScratch.l);
      }
      if (night > 1e-4) {
        this.skyStopScratchB.set(WorldManager.SKY_NIGHT_HEX[i]);
        this.skyStopScratchA.lerp(this.skyStopScratchB, night * 0.96);
      }
      gradient.addColorStop(stops[i], `#${this.skyStopScratchA.getHexString()}`);
    }
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
      this.crystalLayoutDummy.scale.set(...CRYSTAL_INSTANCE_SCALE);
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
