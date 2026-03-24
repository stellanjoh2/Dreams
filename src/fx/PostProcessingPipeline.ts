import * as THREE from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { float, mix, mrt, normalView, output, pass, saturation, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';
import type { FxSettings } from './FxSettings';

export class PostProcessingPipeline {
  private readonly renderPipeline: RenderPipeline;
  private readonly renderer: WebGPURenderer;
  private readonly scenePass;
  private readonly aoNode;
  private readonly bloomNode;

  private readonly contrastNode;
  private readonly saturationNode;
  private readonly vignetteNode;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: FxSettings,
  ) {
    this.renderer = renderer;
    this.contrastNode = uniform(settings.contrast);
    this.saturationNode = uniform(settings.saturation);
    this.vignetteNode = uniform(settings.vignette);

    this.scenePass = pass(scene, camera);
    this.scenePass.setMRT(
      mrt({
        output,
        normal: normalView,
      }),
    );
    const scenePassColor = this.scenePass.getTextureNode('output');
    const scenePassNormal = this.scenePass.getTextureNode('normal');
    const scenePassDepth = this.scenePass.getTextureNode('depth');
    this.aoNode = ao(scenePassDepth, scenePassNormal, camera);
    this.aoNode.radius.value = 1.0;
    this.aoNode.samples.value = 8;
    this.aoNode.thickness.value = 0.85;
    this.aoNode.distanceExponent.value = 1.15;
    this.aoNode.distanceFallOff.value = 0.78;
    this.aoNode.scale.value = 1.0;
    /** Slightly above 0.5 reduces blocky GTAO on large curved surfaces (e.g. distant planets). */
    this.aoNode.resolutionScale = 0.65;
    this.bloomNode = bloom(
      scenePassColor,
      settings.bloom.strength,
      settings.bloom.radius,
      settings.bloom.threshold,
    );

    const linearDepth = this.scenePass.getLinearDepthNode('depth');
    /** Fade GTAO to none on mid–far depth so huge backdrop meshes are not speckled (not draw-distance culling). */
    const aoFarBlend = smoothstep(float(0.18), float(0.62), linearDepth);
    const aoSample = this.aoNode.getTextureNode().r.clamp(0.68, 1);
    const aoFactor = mix(aoSample, float(1), aoFarBlend);
    const aoLitColor = scenePassColor.rgb.mul(aoFactor);
    const postBloomColor = aoLitColor.add(this.bloomNode).rgb;
    const contrastedColor = postBloomColor.sub(0.5).mul(this.contrastNode).add(0.5);
    /**
     * Do **not** pre-compress “hot” pixels here: a luminance rolloff before saturation was dimming normal
     * emissive / glow (often luma ~1–2 in HDR) and made them look broken. Contrast+bloom “burn” is
     * better handled by keeping contrast/saturation in a sane range in FX Studio.
     */
    const saturatedColor = saturation(contrastedColor, this.saturationNode);
    const vignetteUv = uv().sub(vec2(0.5, 0.5)).mul(1.8);
    const vignetteMask = smoothstep(0.14, 1.05, vignetteUv.dot(vignetteUv)).mul(
      this.vignetteNode,
    );
    const finalColor = mix(saturatedColor, saturatedColor.mul(0.68), vignetteMask);

    this.renderPipeline = new RenderPipeline(this.renderer, vec4(finalColor, 1));

    this.applySettings(settings);
  }

  applySettings(settings: FxSettings): void {
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = settings.exposure;

    this.bloomNode.strength.value = settings.bloom.strength;
    this.bloomNode.radius.value = settings.bloom.radius;
    this.bloomNode.threshold.value = settings.bloom.threshold;
    this.contrastNode.value = settings.contrast;
    this.saturationNode.value = settings.saturation;
    this.vignetteNode.value = settings.vignette;
    this.renderPipeline.needsUpdate = true;
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
