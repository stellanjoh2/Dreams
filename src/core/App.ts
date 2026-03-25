import * as THREE from 'three';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { DEFAULT_FX_SETTINGS, ENABLE_EMISSIVE_LENS_FLARE } from '../config/defaults';
import { FirstPersonCamera } from '../camera/FirstPersonCamera';
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

const emissiveFlareScratch: LensFlareEmissiveCandidate[] = [];

const cloneSettings = (): FxSettings => structuredClone(DEFAULT_FX_SETTINGS);
const USE_POST_PROCESSING = true;

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

  private lastFrame = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly sunPosition = new THREE.Vector3();

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
    this.ui.attachCanvas(this.rendererCore.canvas);
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
    const crystals = this.world.build(this.settings);
    await this.world.loadCloudPack();
    await this.world.loadDecorScatter();
    await this.world.loadButterflies();
    this.player.respawn(this.world.getRespawnPoint(new THREE.Vector3()));
    this.crystalSystem.setCrystals(crystals);

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
    this.lensFlare.setSunOcclusionObjects(this.world.getSunFlareOccluders());

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
    this.world?.applyFxSettings(this.settings);
    this.postProcessing?.applySettings(this.settings);
    this.reapplyAudioVolumes();
    this.editor?.sync();
    this.lensFlare?.setColor('#ffc090');
    this.lensFlare?.setIntensity(this.settings.atmosphere.sunGlow);

    localStorage.setItem(FX_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
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

    if (this.input.consumeToggleEditor()) {
      this.editor?.toggle();
      if (this.editor?.isOpen && document.pointerLockElement) {
        void document.exitPointerLock();
      }
    }

    this.world.syncDynamicPlatforms(elapsed);
    this.audio.tickElevatorSounds(elapsed, this.cameraSystem.camera);

    if (this.cameraSystem.locked) {
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
    this.interactionSystem?.update(this.cameraSystem.getPosition(this.cameraPosition), this.input);
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
    this.lensFlare?.update(
      this.cameraSystem.camera,
      this.world.getSunWorldPosition(this.sunPosition),
      width,
      height,
      delta,
      ENABLE_EMISSIVE_LENS_FLARE ? emissiveFlareScratch : undefined,
    );
    this.rendererCore.prepareFrame();
    if (this.postProcessing) {
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
      const merged: FxSettings = {
        ...fresh,
        ...parsed,
        bloom: { ...fresh.bloom, ...parsed.bloom },
        atmosphere: { ...fresh.atmosphere, ...parsed.atmosphere },
        cameraFeel: { ...fresh.cameraFeel, ...parsed.cameraFeel },
        fresnel: { ...fresh.fresnel, ...parsed.fresnel },
        movement: { ...fresh.movement, ...parsed.movement },
        particles: { ...fresh.particles, ...parsed.particles },
        audio: { ...fresh.audio, ...(parsed.audio ?? {}) },
      };
      const m = Number(merged.audio.musicVolume);
      const f = Number(merged.audio.fxVolume);
      if (!Number.isFinite(m)) {
        merged.audio.musicVolume = fresh.audio.musicVolume;
      }
      if (!Number.isFinite(f)) {
        merged.audio.fxVolume = fresh.audio.fxVolume;
      }
      return merged;
    } catch {
      return fresh;
    }
  }
}
