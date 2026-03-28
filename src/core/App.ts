import * as THREE from 'three';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { DEFAULT_FX_SETTINGS, ENABLE_EMISSIVE_LENS_FLARE } from '../config/defaults';
import { loadDataTexture } from '../config/loadTexture';
import { publicUrl } from '../config/publicUrl';
import { FirstPersonCamera } from '../camera/FirstPersonCamera';
import { updateFreeFlight } from '../camera/FreeFlightController';
import {
  createTrailerCameraState,
  exitTrailerCamera,
  toggleTrailerDolly,
  toggleTrailerOrbit,
  trailerCameraActive,
  updateTrailerCamera,
} from '../camera/CinematicCameraController';
import { RendererCore } from './RendererCore';
import { WorldManager } from '../world/WorldManager';
import { InputSystem } from '../input/InputSystem';
import { PlayerController } from '../player/PlayerController';
import { CrystalSystem } from '../systems/CrystalSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { UIManager } from '../ui/UIManager';
import { AudioSystem } from '../audio/AudioSystem';
import { PostProcessingPipeline } from '../fx/PostProcessingPipeline';
import { FX_SETTINGS_STORAGE_KEY, type FxSettings } from '../fx/FxSettings';
import { FxEditor } from '../editor/FxEditor';
import { appendJumpPadFlareCandidates } from '../fx/emissiveFlareSources';
import { LensFlareOverlay, type LensFlareEmissiveCandidate } from '../fx/LensFlareOverlay';
import { SwordCombatView } from '../combat/SwordCombatView';
import { applyDevRenderMode, type DevRenderMode } from '../debug/DevRenderMode';

const emissiveFlareScratch: LensFlareEmissiveCandidate[] = [];

const cloneSettings = (): FxSettings => structuredClone(DEFAULT_FX_SETTINGS);
const USE_POST_PROCESSING = true;

/** Key B: one in-game day (`sunTimeOfDayHours` 0→24) over this many real seconds (25% slower than 120s). */
const CINEMATIC_SUN_DAY_DURATION_SEC = 150;
/** Ease-in so the cycle ramps up smoothly after toggling B on. */
const CINEMATIC_SUN_RAMP_SEC = 3;

export class App {
  private readonly ui: UIManager;
  private readonly settings: FxSettings;
  private readonly audio = new AudioSystem();
  private readonly input = new InputSystem();
  private readonly player = new PlayerController();
  private readonly crystalSystem = new CrystalSystem();

  private rendererCore?: RendererCore;
  private cameraSystem?: FirstPersonCamera;
  private world?: WorldManager;
  private interactionSystem?: InteractionSystem;
  private postProcessing?: PostProcessingPipeline;
  private editor?: FxEditor;
  private lensFlare?: LensFlareOverlay;
  private swordCombat?: SwordCombatView;
  /** Detached fly cam; player frozen until toggled off (F / gamepad RS click). */
  private freeFlightActive = false;
  /** Trailer shots: C/V dolly+roll, O orbit (see CinematicCameraController). */
  private readonly trailerCamera = createTrailerCameraState();
  /** Key B: advance `sunTimeOfDayHours` for capture (~24h / 2.5 min); tap B again to stop and restore pre-B time. */
  private cinematicSunCycleActive = false;
  private cinematicSunRampElapsed = 0;
  /** `sunTimeOfDayHours` when the current cycle was started — restored on stop. */
  private cinematicSunTimeOfDayHoursSnapshot = 0;
  /** 1: normal; 2: unlit; 3: wireframe. Bypasses post when not normal (WebGPU needs NodeMaterials for overrides). */
  private devRenderMode: DevRenderMode = 'normal';

  private lastFrame = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly sunPosition = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly sunDirectionFromCam = new THREE.Vector3();
  private readonly sunFlareTintScratch = new THREE.Color();

  constructor(root: HTMLElement) {
    this.ui = new UIManager(root);
    this.settings = this.loadSettings();

    this.loop = this.loop.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleStart = this.handleStart.bind(this);
  }

  async init(): Promise<void> {
    if (!WebGPU.isAvailable()) {
      this.ui.showUnsupported();
      return;
    }

    this.rendererCore = new RendererCore(this.ui.viewport);
    await this.rendererCore.init();
    const canvas = this.rendererCore.canvas;
    canvas.tabIndex = 0;
    this.ui.attachCanvas(canvas);
    this.ui.setRendererInfo('WebGPU / Three.js r183');

    this.cameraSystem = new FirstPersonCamera(this.rendererCore.canvas);
    this.cameraSystem.setLockChangeListener((locked) => {
      this.ui.setPointerLocked(locked);
      if (locked) {
        void this.audio.unlock().then(() => this.reapplyAudioVolumes());
      }
    });

    this.world = new WorldManager({
      playCactusEnemyProximity: (x, y, z) => this.audio.playCactusEnemyProximity(x, y, z),
      isCactusEnemyProximityVoiceActive: () => this.audio.isCactusAggroVoicePlaying(),
    });

    let waterHfNormal: THREE.Texture | undefined;
    try {
      waterHfNormal = await loadDataTexture(publicUrl('textures/water_hf_normal.png'));
    } catch {
      console.warn('[App] Could not load textures/water_hf_normal.png — procedural water normals');
    }

    await this.world.loadCrystalPickupMesh();
    const crystals = this.world.build(this.settings, waterHfNormal);
    await this.world.loadCloudPack();
    await this.world.loadDecorScatter();
    await this.world.loadWaterEdgeGrass();
    await this.world.loadSeaFloorRocks();
    await this.world.loadButterflies();
    this.player.respawn(this.world.getRespawnPoint(new THREE.Vector3()));
    this.crystalSystem.setCrystals(crystals);
    this.crystalSystem.attachVfxResources(this.world.scene, this.world.getCrystalGeometry());

    this.world.scene.add(this.cameraSystem.camera);
    this.swordCombat = new SwordCombatView(this.cameraSystem.camera);
    try {
      await this.swordCombat.load();
    } catch (err) {
      console.warn('[App] Sword GLB failed to load — combat view disabled', err);
      this.swordCombat.dispose();
      this.swordCombat = undefined;
    }

    this.interactionSystem = new InteractionSystem(this.crystalSystem, this.ui, this.audio);
    if (USE_POST_PROCESSING) {
      this.postProcessing = new PostProcessingPipeline(
        this.rendererCore.renderer,
        this.world.scene,
        this.cameraSystem.camera,
        this.settings,
      );
    }

    this.editor = new FxEditor(
      this.ui.editorMount,
      this.settings,
      () => this.applySettings(),
      () => this.resetSettings(),
    );
    this.lensFlare = new LensFlareOverlay(this.ui.fxMount);
    this.lensFlare.setOcclusionObjects(this.world.getLensFlareOccluders());

    this.applySettings();
    this.ui.setChromeVisible(false);

    this.ui.startButton.addEventListener('click', this.handleStart);
    this.ui.viewport.addEventListener('pointerdown', this.handleStart);
    this.bindZoomAimPointerHandlers(this.rendererCore.canvas);
    window.addEventListener('resize', this.handleResize);

    requestAnimationFrame(this.loop);
  }

  private handleStart(): void {
    if (this.editor?.isOpen) {
      return;
    }

    /** Start `<button>` often keeps focus while hidden — `InputSystem` would ignore all game keys on BUTTON. */
    this.ui.startButton.blur();
    this.rendererCore?.canvas.focus({ preventScroll: true });

    this.cameraSystem?.requestLock();
    void this.audio.unlock().then(() => this.reapplyAudioVolumes());
  }

  private reapplyAudioVolumes(): void {
    this.audio.applyVolumeSettings(this.settings.audio ?? DEFAULT_FX_SETTINGS.audio);
  }

  /** Hold right mouse: narrow FOV “zoom” while playing (see `FirstPersonCamera.updateFromPlayer`). */
  private bindZoomAimPointerHandlers(canvas: HTMLCanvasElement): void {
    const clearZoom = (): void => {
      this.input.setZoomAimHeld(false);
    };

    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && document.pointerLockElement === canvas && !this.editor?.isOpen) {
        this.input.queuePrimaryAttack();
      }
      if (event.button === 2) {
        event.preventDefault();
        this.input.setZoomAimHeld(true);
      }
    });

    canvas.addEventListener('pointerup', (event) => {
      if (event.button === 2) {
        this.input.setZoomAimHeld(false);
      }
    });

    canvas.addEventListener('pointerleave', clearZoom);
    window.addEventListener('pointerup', (event) => {
      if (event.button === 2) {
        clearZoom();
      }
    });
    window.addEventListener('blur', clearZoom);
  }

  private applySettings(): void {
    this.cameraSystem?.setSensitivity(this.settings.cameraFeel.lookSensitivity);
    this.input.setGamepadSettings(this.settings.gamepad);
    this.world?.applyFxSettings(this.settings);
    this.postProcessing?.applySettings(this.settings);
    this.reapplyAudioVolumes();
    this.editor?.sync();
    this.syncLensFlareFromAtmosphere();

    localStorage.setItem(FX_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
  }

  private syncLensFlareFromAtmosphere(): void {
    WorldManager.sunTemperatureToLightColor(
      WorldManager.computeSunVisualTemperatureForFlare(this.settings.atmosphere),
      this.sunFlareTintScratch,
    );
    this.lensFlare?.setColor(`#${this.sunFlareTintScratch.getHexString()}`);
    this.lensFlare?.setIntensity(this.settings.atmosphere.sunGlow);
  }

  /** During cinematic sun cycle: update sky/sun/light only (no localStorage each frame). */
  private applySunTimeAtmosphereToWorld(): void {
    this.world?.applyFxSettings(this.settings);
    this.syncLensFlareFromAtmosphere();
  }

  private resetSettings(): void {
    const fresh = cloneSettings();
    Object.assign(this.settings, fresh);
    Object.assign(this.settings.bloom, fresh.bloom);
    Object.assign(this.settings.atmosphere, fresh.atmosphere);
    Object.assign(this.settings.cameraFeel, fresh.cameraFeel);
    Object.assign(this.settings.fresnel, fresh.fresnel);
    Object.assign(this.settings.movement, fresh.movement);
    Object.assign(this.settings.particles, fresh.particles);
    Object.assign(this.settings.audio, fresh.audio);
    Object.assign(this.settings.motionBlur, fresh.motionBlur);
    Object.assign(this.settings.gamepad, fresh.gamepad);
    Object.assign(this.settings.water, fresh.water);
    Object.assign(this.settings.lensDirt, fresh.lensDirt);
    this.applySettings();
  }

  private handleResize(): void {
    if (!this.rendererCore || !this.cameraSystem) {
      return;
    }

    const { width, height } = this.rendererCore.syncSize();
    this.cameraSystem.setAspect(width / height);
    this.postProcessing?.resize(width, height);
  }

  private loop(time: number): void {
    requestAnimationFrame(this.loop);

    if (!this.rendererCore || !this.cameraSystem || !this.world) {
      return;
    }

    const delta = Math.min(0.1, this.lastFrame === 0 ? 1 / 60 : (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const elapsed = time / 1000;

    this.input.update();

    const devMode = this.input.consumeDevRenderMode();
    if (devMode) {
      this.devRenderMode = devMode;
      applyDevRenderMode(this.world.scene, devMode);
    }

    const combatUiOk = !this.editor?.isOpen;
    const camSys = this.cameraSystem;
    if (combatUiOk && camSys) {
      const applyTrailerEnterCleanup = (activeBefore: boolean): void => {
        if (!activeBefore && trailerCameraActive(this.trailerCamera)) {
          this.freeFlightActive = false;
          this.input.clearTransientActionQueuesForFreeFlight();
        }
      };

      if (this.input.consumeToggleCinematicCamera()) {
        const activeBefore = trailerCameraActive(this.trailerCamera);
        toggleTrailerDolly(this.trailerCamera, camSys, 1);
        applyTrailerEnterCleanup(activeBefore);
      }
      if (this.input.consumeToggleCinematicCameraReverse()) {
        const activeBefore = trailerCameraActive(this.trailerCamera);
        toggleTrailerDolly(this.trailerCamera, camSys, -1);
        applyTrailerEnterCleanup(activeBefore);
      }
      if (this.input.consumeToggleOrbitCamera()) {
        const activeBefore = trailerCameraActive(this.trailerCamera);
        toggleTrailerOrbit(this.trailerCamera, camSys);
        applyTrailerEnterCleanup(activeBefore);
      }
    }

    /** Always consume so the queue cannot stick across editor open/close. */
    if (this.input.consumeToggleCinematicSunCycle()) {
      if (combatUiOk && camSys) {
        this.cinematicSunCycleActive = !this.cinematicSunCycleActive;
        if (this.cinematicSunCycleActive) {
          this.cinematicSunRampElapsed = 0;
          this.cinematicSunTimeOfDayHoursSnapshot = this.settings.atmosphere.sunTimeOfDayHours;
        } else {
          this.settings.atmosphere.sunTimeOfDayHours = this.cinematicSunTimeOfDayHoursSnapshot;
          this.applySettings();
        }
      }
    }

    if (this.cinematicSunCycleActive && combatUiOk) {
      this.cinematicSunRampElapsed += delta;
      /** `smoothstep(x, min, max)` — value first (we had min/max/x reversed; ramp was stuck at 0). */
      const ramp = THREE.MathUtils.smoothstep(
        this.cinematicSunRampElapsed,
        0,
        CINEMATIC_SUN_RAMP_SEC,
      );
      const hoursPerSec = 24 / CINEMATIC_SUN_DAY_DURATION_SEC;
      this.settings.atmosphere.sunTimeOfDayHours = THREE.MathUtils.euclideanModulo(
        this.settings.atmosphere.sunTimeOfDayHours + hoursPerSec * delta * ramp,
        24,
      );
      this.applySunTimeAtmosphereToWorld();
    }

    if (this.input.consumeToggleFreeFlight()) {
      if (combatUiOk) {
        this.freeFlightActive = !this.freeFlightActive;
        if (this.freeFlightActive) {
          if (trailerCameraActive(this.trailerCamera) && this.cameraSystem) {
            exitTrailerCamera(this.trailerCamera, this.cameraSystem);
          }
          this.input.clearTransientActionQueuesForFreeFlight();
        }
      }
    }

    /** In-world first person (sword can be drawn); pointer lock only gates attacks. */
    const firstPersonWorld = combatUiOk && !this.freeFlightActive && !trailerCameraActive(this.trailerCamera);
    const combatActive = this.cameraSystem.locked && firstPersonWorld;
    if (this.input.consumeToggleWeaponHidden()) {
      if (firstPersonWorld) {
        this.swordCombat?.toggleWeaponHidden();
      }
    }
    this.swordCombat?.setGameplayVisible(firstPersonWorld);
    this.swordCombat?.update(delta);
    if (combatActive && this.input.consumePrimaryAttack()) {
      this.swordCombat?.triggerAttack();
    }

    if (this.input.consumeToggleEditor()) {
      this.editor?.toggle();
      if (this.editor?.isOpen) {
        this.freeFlightActive = false;
        if (trailerCameraActive(this.trailerCamera) && this.cameraSystem) {
          exitTrailerCamera(this.trailerCamera, this.cameraSystem);
        }
        if (document.pointerLockElement) {
          void document.exitPointerLock();
        }
      }
    }

    this.world.syncDynamicPlatforms(elapsed);
    this.audio.tickElevatorSounds(elapsed, this.cameraSystem.camera);

    if (trailerCameraActive(this.trailerCamera)) {
      this.input.consumeJump();
      this.input.consumeInteract();
      updateTrailerCamera(delta, this.trailerCamera, this.cameraSystem);
    } else if (this.freeFlightActive) {
      this.input.consumeJump();
      this.input.consumeInteract();
      updateFreeFlight(delta, this.cameraSystem, this.input, this.settings);
    } else if (this.cameraSystem.locked) {
      this.player.update(
        delta,
        this.input,
        this.cameraSystem,
        this.settings,
        (x, z, supportRadius, maxHeight) =>
          this.world?.getGroundSupportAt(x, z, supportRadius, maxHeight) ?? null,
        (position, radius, grounded) => this.world?.resolveTerrainCollisions(position, radius, grounded),
        (position, target) => this.world?.getJumpPadImpulse(position, target) ?? null,
        (target) => this.world?.getRespawnPoint(target) ?? target.set(0, 0, 12),
        {
          onPlayerJump: () => this.audio.playJump(),
          onJumpPad: () => this.audio.playJumpPad(),
          onBeginDrowning: () => this.audio.playDrowningDeathSequence(),
        },
      );
    } else {
      this.cameraSystem.updateFromPlayer(this.player.position, delta, 0, 0, 1, false, 0, false);
    }

    this.world.update(delta, elapsed, this.cameraSystem.camera, this.player.position);
    this.crystalSystem.update(delta);
    if (!this.freeFlightActive && !trailerCameraActive(this.trailerCamera)) {
      this.interactionSystem?.update(this.cameraSystem.getPosition(this.cameraPosition), this.input);
    }
    this.postProcessing?.setCrystalPickupPulse(this.crystalSystem.getScreenPickupPulse());
    this.ui.setUnderwaterDepth(this.player.getWaterSubmersionDepth());
    const { width, height, changed } = this.rendererCore.syncSize();
    if (changed) {
      this.cameraSystem.setAspect(width / height);
      this.postProcessing?.resize(width, height);
    }

    if (ENABLE_EMISSIVE_LENS_FLARE) {
      emissiveFlareScratch.length = 0;
      appendJumpPadFlareCandidates(emissiveFlareScratch);
      this.crystalSystem.appendFlareCandidates(emissiveFlareScratch);
    }
    this.world.getSunWorldPosition(this.sunPosition);
    this.lensFlare?.update(
      this.cameraSystem.camera,
      this.sunPosition,
      width,
      height,
      delta,
      ENABLE_EMISSIVE_LENS_FLARE ? emissiveFlareScratch : undefined,
    );
    let lensDirtSunBoost = this.lensFlare?.getSunFlareVisibility() ?? 0;
    if (this.cameraSystem && this.world) {
      this.cameraSystem.camera.getWorldDirection(this.cameraForward);
      this.sunDirectionFromCam.subVectors(this.sunPosition, this.cameraSystem.camera.position);
      if (this.sunDirectionFromCam.lengthSq() > 1e-4) {
        this.sunDirectionFromCam.normalize();
        const facing = THREE.MathUtils.clamp(this.sunDirectionFromCam.dot(this.cameraForward), 0, 1);
        lensDirtSunBoost = Math.max(lensDirtSunBoost, facing * facing * facing);
      }
    }
    this.postProcessing?.setLensDirtSunBoost(lensDirtSunBoost);
    const sunElev = WorldManager.computeSunElevationAboveHorizonRad(this.settings.atmosphere.sunTimeOfDayHours);
    const sunGeomOcc = this.lensFlare?.getSunGeometryOcclusion01() ?? 0;
    this.postProcessing?.syncDynamicExposure(this.settings.exposure, sunElev, sunGeomOcc, delta);
    this.rendererCore.prepareFrame();
    const useDirectSceneRender = this.devRenderMode !== 'normal';
    if (useDirectSceneRender) {
      this.rendererCore.renderer.render(this.world.scene, this.cameraSystem.camera);
    } else if (this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.rendererCore.renderer.render(this.world.scene, this.cameraSystem.camera);
    }
  }

  private loadSettings(): FxSettings {
    const fresh = cloneSettings();

    try {
      const stored = localStorage.getItem(FX_SETTINGS_STORAGE_KEY);
      if (!stored) {
        return fresh;
      }

      const parsed = JSON.parse(stored) as Partial<FxSettings>;
      const mergedAtmosphere = { ...fresh.atmosphere, ...parsed.atmosphere };
      const legacyAtmosphere = parsed.atmosphere as
        | { fogColor?: unknown; skyColor?: string }
        | undefined;
      if (
        legacyAtmosphere &&
        typeof legacyAtmosphere.fogColor !== 'string' &&
        typeof legacyAtmosphere.skyColor === 'string'
      ) {
        mergedAtmosphere.fogColor = legacyAtmosphere.skyColor;
      }

      const merged: FxSettings = {
        ...fresh,
        ...parsed,
        bloom: { ...fresh.bloom, ...parsed.bloom },
        atmosphere: mergedAtmosphere,
        cameraFeel: { ...fresh.cameraFeel, ...parsed.cameraFeel },
        fresnel: { ...fresh.fresnel, ...parsed.fresnel },
        movement: { ...fresh.movement, ...parsed.movement },
        particles: { ...fresh.particles, ...parsed.particles },
        audio: { ...fresh.audio, ...(parsed.audio ?? {}) },
        motionBlur: { ...fresh.motionBlur, ...(parsed.motionBlur ?? {}) },
        gamepad: { ...fresh.gamepad, ...(parsed.gamepad ?? {}) },
        water: { ...fresh.water, ...(parsed.water ?? {}) },
        lensDirt: { ...fresh.lensDirt, ...(parsed.lensDirt ?? {}) },
      };
      const m = Number(merged.audio.musicVolume);
      const f = Number(merged.audio.fxVolume);
      if (!Number.isFinite(m)) {
        merged.audio.musicVolume = fresh.audio.musicVolume;
      }
      if (!Number.isFinite(f)) {
        merged.audio.fxVolume = fresh.audio.fxVolume;
      }
      const sunTemp = Number(merged.atmosphere.sunTemperature);
      if (!Number.isFinite(sunTemp)) {
        merged.atmosphere.sunTemperature = fresh.atmosphere.sunTemperature;
      } else {
        merged.atmosphere.sunTemperature = THREE.MathUtils.clamp(sunTemp, 0, 1);
      }
      const sunAz = Number(merged.atmosphere.sunAzimuthDegrees);
      if (!Number.isFinite(sunAz)) {
        merged.atmosphere.sunAzimuthDegrees = fresh.atmosphere.sunAzimuthDegrees;
      } else {
        merged.atmosphere.sunAzimuthDegrees = THREE.MathUtils.euclideanModulo(sunAz, 360);
      }
      const sunDisc = Number(merged.atmosphere.sunDiscScale);
      if (!Number.isFinite(sunDisc)) {
        merged.atmosphere.sunDiscScale = fresh.atmosphere.sunDiscScale;
      } else {
        merged.atmosphere.sunDiscScale = THREE.MathUtils.clamp(sunDisc, 0.2, 3.5);
      }
      const sunH = Number(merged.atmosphere.sunTimeOfDayHours);
      if (!Number.isFinite(sunH)) {
        merged.atmosphere.sunTimeOfDayHours = fresh.atmosphere.sunTimeOfDayHours;
      } else {
        merged.atmosphere.sunTimeOfDayHours = THREE.MathUtils.euclideanModulo(sunH, 24);
      }
      const foamR = Number(merged.water.foamObjectRadius);
      if (!Number.isFinite(foamR)) {
        merged.water.foamObjectRadius = fresh.water.foamObjectRadius;
      } else {
        merged.water.foamObjectRadius = THREE.MathUtils.clamp(foamR, 0.0001, 0.12);
      }
      return merged;
    } catch {
      return fresh;
    }
  }
}
