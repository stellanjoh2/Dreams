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
  saturation,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import type { FxSettings } from './FxSettings';

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

  private motionBlurEnabled: boolean;
  /** Avoid `renderPipeline.needsUpdate` when unrelated FX (e.g. water tint) changes — full graph refresh is costly. */
  private lastPostFxUniformKey: string | null = null;

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

    this.rebuildPipeline(settings);
    this.applySettings(settings);
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
    const finalColor = mix(saturatedBoosted, saturatedBoosted.mul(0.68), vignetteMask);

    this.renderPipeline = new RenderPipeline(this.renderer, vec4(finalColor, 1));
    this.motionBlurEnabled = settings.motionBlur.enabled;
  }

  applySettings(settings: FxSettings): void {
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

  render(): void {
    this.renderPipeline.render();
  }

  resize(width: number, height: number): void {
    this.scenePass?.setSize?.(width, height);
    this.aoNode?.setSize?.(width, height);
    this.bloomNode?.setSize?.(width, height);
  }

  dispose(): void {
    this.renderPipeline.dispose();
  }
}
