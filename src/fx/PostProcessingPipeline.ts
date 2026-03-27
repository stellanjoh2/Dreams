import * as THREE from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import {
  add,
  float,
  mix,
  mul,
  mrt,
  normalView,
  output,
  pass,
  pow,
  saturation,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { publicUrl } from '../config/publicUrl';
import type { FxSettings, LensDirtSettings } from './FxSettings';

function makePlaceholderDirtTexture(): THREE.Texture {
  const data = new Uint8Array([0, 0, 0, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export class PostProcessingPipeline {
  private renderPipeline!: RenderPipeline;
  private scenePass!: ReturnType<typeof pass>;
  /** GTAO pass — typings vary by three.js version; methods used: `getTextureNode`, `setSize`, numeric props. */
  private aoNode!: ReturnType<typeof ao>;
  private bloomNode!: ReturnType<typeof bloom>;

  private readonly renderer: WebGPURenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  private readonly contrastNode;
  private readonly saturationNode;
  private readonly vignetteNode;
  private readonly motionBlurIntensityNode;
  private readonly crystalPickupPulseNode;

  /** Orby-style lens dirt (meshgl `LensDirtShader` — additive dust, smoothstep × pow × strength). */
  private lensDirtGpuTexture: THREE.Texture = makePlaceholderDirtTexture();
  private readonly lensDirtStrengthNode;
  private readonly lensDirtMinLumNode;
  private readonly lensDirtMaxLumNode;
  private readonly lensDirtSensitivityNode;
  private readonly lensDirtExposureNode;
  private readonly lensDirtActiveNode;
  /** 0–1 from sun lens-flare visibility — stronger dirt when staring at the sun (Orby-like). */
  private readonly lensDirtSunBoostNode;

  private motionBlurEnabled: boolean;
  /** Avoid `renderPipeline.needsUpdate` when unrelated FX (e.g. water tint) changes — full graph refresh is costly. */
  private lastPostFxUniformKey: string | null = null;
  private lensDirtTextureLoaded = false;
  private lastLensDirtSettings: LensDirtSettings;
  /** Live settings reference for async lens-dirt load → pipeline rebuild. */
  private latestFxSettings: FxSettings;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: FxSettings,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.contrastNode = uniform(settings.contrast);
    this.saturationNode = uniform(settings.saturation);
    this.vignetteNode = uniform(settings.vignette);
    this.motionBlurIntensityNode = uniform(settings.motionBlur.intensity);
    this.crystalPickupPulseNode = uniform(0);
    this.motionBlurEnabled = settings.motionBlur.enabled;
    this.latestFxSettings = settings;

    this.lastLensDirtSettings = settings.lensDirt;
    this.lensDirtStrengthNode = uniform(settings.lensDirt.strength);
    this.lensDirtMinLumNode = uniform(settings.lensDirt.minLuminance);
    this.lensDirtMaxLumNode = uniform(settings.lensDirt.maxLuminance);
    this.lensDirtSensitivityNode = uniform(settings.lensDirt.sensitivity);
    this.lensDirtExposureNode = uniform(1);
    this.lensDirtActiveNode = uniform(0);
    this.lensDirtSunBoostNode = uniform(0);

    this.rebuildPipeline(settings);
    this.applySettings(settings);
    void this.loadLensDirtTexture(publicUrl('textures/lens-dirt.jpg'));
  }

  private loadLensDirtTexture(url: string): void {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;

        this.lensDirtGpuTexture.dispose();
        this.lensDirtGpuTexture = tex;
        this.lensDirtTextureLoaded = true;

        const w = this.renderer.domElement.width;
        const h = this.renderer.domElement.height;
        this.rebuildPipeline(this.latestFxSettings);
        this.lastPostFxUniformKey = null;
        if (w > 0 && h > 0) {
          this.resize(w, h);
        }
        this.applySettings(this.latestFxSettings);
        this.renderPipeline.needsUpdate = true;
      },
      undefined,
      () => {
        console.warn('[PostProcessing] Could not load textures/lens-dirt.jpg — lens dirt disabled');
      },
    );
  }

  private syncLensDirtActiveFlag(): void {
    const s = this.lastLensDirtSettings;
    this.lensDirtActiveNode.value = s.enabled && this.lensDirtTextureLoaded ? 1 : 0;
  }

  private rebuildPipeline(settings: FxSettings): void {
    this.renderPipeline?.dispose();

    this.scenePass = pass(this.scene, this.camera);
    if (settings.motionBlur.enabled) {
      this.scenePass.setMRT(
        mrt({
          output,
          normal: normalView,
          velocity,
        }),
      );
    } else {
      this.scenePass.setMRT(
        mrt({
          output,
          normal: normalView,
        }),
      );
    }

    const scenePassColor = this.scenePass.getTextureNode('output');
    const scenePassNormal = this.scenePass.getTextureNode('normal');
    const scenePassDepth = this.scenePass.getTextureNode('depth');
    this.aoNode = ao(scenePassDepth, scenePassNormal, this.camera);
    this.aoNode.radius.value = 1.0;
    this.aoNode.samples.value = 8;
    this.aoNode.thickness.value = 0.85;
    this.aoNode.distanceExponent.value = 1.15;
    this.aoNode.distanceFallOff.value = 0.78;
    this.aoNode.scale.value = 1.0;
    this.aoNode.resolutionScale = 0.65;

    this.bloomNode = bloom(
      scenePassColor,
      settings.bloom.strength,
      settings.bloom.radius,
      settings.bloom.threshold,
    );

    const linearDepth = this.scenePass.getLinearDepthNode('depth');
    const aoFarBlend = smoothstep(float(0.18), float(0.62), linearDepth);
    const aoSample = this.aoNode.getTextureNode().r.clamp(0.68, 1);
    const aoFactor = mix(aoSample, float(1), aoFarBlend);

    const preAoRgb = settings.motionBlur.enabled
      ? (
          motionBlur(
            scenePassColor,
            this.scenePass.getTextureNode('velocity').mul(this.motionBlurIntensityNode),
          ) as typeof scenePassColor
        ).rgb
      : scenePassColor.rgb;

    const aoLitRgb = preAoRgb.mul(aoFactor);
    const postBloomColor = aoLitRgb.add((this.bloomNode as typeof scenePassColor).rgb);
    const contrastedColor = postBloomColor.sub(0.5).mul(this.contrastNode).add(0.5);
    const saturatedColor = saturation(contrastedColor, this.saturationNode);
    const pulseN = this.crystalPickupPulseNode as unknown as Parameters<typeof mul>[0];
    const pickBoost = mul(vec3(0.26, 0.92, 1.0), mul(pulseN, float(1.12)));
    const brightLift = add(float(1), mul(pulseN, float(0.16)));
    const chromaKick = add(float(1), mul(pulseN, float(0.1)));
    const saturatedBoosted = mul(saturatedColor.add(pickBoost).mul(chromaKick), brightLift);
    const vignetteUv = uv().sub(vec2(0.5, 0.5)).mul(1.8);
    const vignetteMask = smoothstep(0.14, 1.05, vignetteUv.dot(vignetteUv)).mul(this.vignetteNode);
    const afterVignette = mix(saturatedBoosted, saturatedBoosted.mul(0.68), vignetteMask);

    /** Only compile dirt sampling after the JPG loads — sampling a 1×1 placeholder broke WebGPU output (black). */
    const finalRgb = this.lensDirtTextureLoaded
      ? (() => {
          const dirtSample = texture(this.lensDirtGpuTexture).sample(screenUV.flipY());
          const ramp = smoothstep(this.lensDirtMinLumNode, this.lensDirtMaxLumNode, this.lensDirtExposureNode);
          /**
           * Goal: screen-space plate, **additive only** (no multiply — that darkened the whole frame).
           * `lensDirtSunBoost` is ~0 when not facing the sun / bright spot; pow() keeps it **mostly off** until boost is high.
           */
          const sunGate = pow(this.lensDirtSunBoostNode, float(2.85));
          const amount = pow(ramp.add(float(1e-4)), this.lensDirtSensitivityNode)
            .mul(this.lensDirtStrengthNode)
            .mul(this.lensDirtActiveNode)
            .mul(sunGate);
          /** Slight lift so mid-gray specks read a bit on bright bloom (still additive, no darken). */
          const dirtRgb = dirtSample.xyz.mul(float(2.1));
          return afterVignette.add(dirtRgb.mul(amount));
        })()
      : afterVignette;

    this.renderPipeline = new RenderPipeline(this.renderer, vec4(finalRgb, 1));
    this.motionBlurEnabled = settings.motionBlur.enabled;
  }

  applySettings(settings: FxSettings): void {
    this.latestFxSettings = settings;

    const motionBlurToggled = settings.motionBlur.enabled !== this.motionBlurEnabled;
    if (motionBlurToggled) {
      this.rebuildPipeline(settings);
      this.lastPostFxUniformKey = null;
      const w = this.renderer.domElement.width;
      const h = this.renderer.domElement.height;
      if (w > 0 && h > 0) {
        this.resize(w, h);
      }
    }

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = settings.exposure;

    this.bloomNode.strength.value = settings.bloom.strength;
    this.bloomNode.radius.value = settings.bloom.radius;
    this.bloomNode.threshold.value = settings.bloom.threshold;
    this.contrastNode.value = settings.contrast;
    this.saturationNode.value = settings.saturation;
    this.vignetteNode.value = settings.vignette;
    this.motionBlurIntensityNode.value = settings.motionBlur.intensity;

    this.lastLensDirtSettings = settings.lensDirt;
    this.lensDirtStrengthNode.value = settings.lensDirt.strength;
    this.lensDirtMinLumNode.value = settings.lensDirt.minLuminance;
    this.lensDirtMaxLumNode.value = settings.lensDirt.maxLuminance;
    this.lensDirtSensitivityNode.value = Math.max(0.001, settings.lensDirt.sensitivity);
    /** Maps tone exposure into Orby’s `exposureFactor` slot (no auto-exposure luminance yet). */
    this.lensDirtExposureNode.value = THREE.MathUtils.clamp(settings.exposure / 1.25, 0.25, 1.05);
    this.syncLensDirtActiveFlag();

    const uniformKey = [
      settings.exposure,
      settings.contrast,
      settings.saturation,
      settings.vignette,
      settings.motionBlur.intensity,
      settings.bloom.strength,
      settings.bloom.radius,
      settings.bloom.threshold,
      settings.motionBlur.enabled,
    ].join('|');

    if (motionBlurToggled || this.lastPostFxUniformKey !== uniformKey) {
      this.lastPostFxUniformKey = uniformKey;
      this.renderPipeline.needsUpdate = true;
    }
  }

  /** 0–1 pickup “boost” tint (decay on CPU each frame). */
  setCrystalPickupPulse(strength: number): void {
    this.crystalPickupPulseNode.value = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /**
   * 0 = not facing bright sky / sun; 1 = full screen-space dirt strength.
   * App feeds max(DOM sun flare visibility, camera→sun alignment³).
   */
  setLensDirtSunBoost(visibility01: number): void {
    this.lensDirtSunBoostNode.value = THREE.MathUtils.clamp(visibility01, 0, 1);
  }

  render(): void {
    this.renderPipeline.render();
  }

  resize(width: number, height: number): void {
    this.scenePass?.setSize?.(width, height);
  }

  dispose(): void {
    this.renderPipeline.dispose();
    this.lensDirtGpuTexture.dispose();
  }
}
