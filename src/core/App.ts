import * as THREE from 'three';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { DEFAULT_FX_SETTINGS } from '../config/defaults';
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
import { LensFlareOverlay } from '../fx/LensFlareOverlay';

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
        void this.audio.unlock();
      }
    });

    this.world = new WorldManager();
    const crystals = this.world.build(this.settings);
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

    this.applySettings();
    this.ui.setChromeVisible(false);

    this.ui.startButton.addEventListener('click', this.handleStart);
    this.ui.viewport.addEventListener('pointerdown', this.handleStart);
    window.addEventListener('resize', this.handleResize);

    requestAnimationFrame(this.loop);
  }

  private handleStart(): void {
    if (this.editor?.isOpen) {
      return;
    }

    this.cameraSystem?.requestLock();
    void this.audio.unlock();
  }

  private applySettings(): void {
    this.cameraSystem?.setSensitivity(this.settings.cameraFeel.lookSensitivity);
    this.world?.applyFxSettings(this.settings);
    this.postProcessing?.applySettings(this.settings);
    this.editor?.sync();
    this.lensFlare?.setColor('#ffd39f');
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

    this.input.update();

    if (this.input.consumeToggleEditor()) {
      this.editor?.toggle();
      if (this.editor?.isOpen && document.pointerLockElement) {
        void document.exitPointerLock();
      }
    }

    if (this.cameraSystem.locked) {
      this.player.update(
        delta,
        this.input,
        this.cameraSystem,
        this.settings,
        (x, z) => this.world?.getGroundHeightAt(x, z) ?? null,
        (position, radius, grounded) => this.world?.resolveTerrainCollisions(position, radius, grounded),
        (target) => this.world?.getRespawnPoint(target) ?? target.set(0, 0, 12),
      );
    } else {
      this.cameraSystem.updateFromPlayer(this.player.position, delta, 0, 0, 1, false, 0, false);
    }

    this.world.update(delta, time / 1000);
    this.crystalSystem.update(delta);
    this.interactionSystem?.update(this.cameraSystem.getPosition(this.cameraPosition), this.input);
    this.ui.setUnderwaterDepth(this.player.getWaterSubmersionDepth());
    const { width, height, changed } = this.rendererCore.syncSize();
    if (changed) {
      this.cameraSystem.setAspect(width / height);
      this.postProcessing?.resize(width, height);
    }

    this.lensFlare?.update(
      this.cameraSystem.camera,
      this.world.getSunWorldPosition(this.sunPosition),
      width,
      height,
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
      return {
        ...fresh,
        ...parsed,
        bloom: { ...fresh.bloom, ...parsed.bloom },
        atmosphere: { ...fresh.atmosphere, ...parsed.atmosphere },
        cameraFeel: { ...fresh.cameraFeel, ...parsed.cameraFeel },
        fresnel: { ...fresh.fresnel, ...parsed.fresnel },
        movement: { ...fresh.movement, ...parsed.movement },
        particles: { ...fresh.particles, ...parsed.particles },
      };
    } catch {
      return fresh;
    }
  }
}
