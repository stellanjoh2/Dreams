/**
 * WebGPU water (from three.js Water2Mesh) with reflection sampler on `userData.waterReflectionSampler`
 * so we can set `reflector.forceUpdate` each frame (fixes vanishing water when the mirror plane faces
 * away from the camera — underwater / grazing angles). See WorldManager.prepareWaterReflectorForFrame.
 */
import {
  Color,
  Mesh,
  Vector2,
  Vector3,
  NodeMaterial,
  NodeUpdateType,
  TempNode,
} from 'three/webgpu';

import {
  Fn,
  vec2,
  viewportSafeUV,
  viewportSharedTexture,
  viewportDepthTexture,
  reflector,
  pow,
  float,
  abs,
  texture,
  uniform,
  vec4,
  cameraPosition,
  positionWorld,
  uv,
  mix,
  vec3,
  normalize,
  max,
  min,
  dot,
  screenUV,
  linearDepth,
  smoothstep,
  sin,
  step,
} from 'three/tsl';

class WaterSurfaceNode extends TempNode {
  constructor(options, waterBody) {
    super('vec4');

    this.waterBody = waterBody;
    /** One reflector per water mesh — creating a new one inside every material graph build stacks targets & fights the RT. */
    this._reflectionSampler = null;
    /** Original reflector UV node so each `setup()` can do `uvBase.add(offset)` without chaining offsets. */
    this._reflectorUvBase = null;

    this.normalMap0 = texture(options.normalMap0);
    this.normalMap1 = texture(options.normalMap1);
    this.flowMap = texture(options.flowMap !== undefined ? options.flowMap : null);

    this.color = uniform(options.color !== undefined ? new Color(options.color) : new Color(0xffffff));
    this.flowDirection = uniform(options.flowDirection !== undefined ? options.flowDirection : new Vector2(1, 0));
    this.flowSpeed = uniform(options.flowSpeed !== undefined ? options.flowSpeed : 0.03);
    this.reflectivity = uniform(options.reflectivity !== undefined ? options.reflectivity : 0.02);
    /** Scales reflection vs refraction mix (1 = authored balance). */
    this.reflectionStrength = uniform(
      options.reflectionStrength !== undefined ? options.reflectionStrength : 1,
    );
    /** Pow on fresnel mix; above 1 = sharper highlights, below 1 = broader reflection. */
    this.reflectionContrast = uniform(
      options.reflectionContrast !== undefined ? options.reflectionContrast : 1,
    );
    this.scale = uniform(options.scale !== undefined ? options.scale : 1);
    this.normalStrength = uniform(
      options.normalStrength !== undefined ? options.normalStrength : 1,
    );
    /** Linear-depth band where foam ramps — keep small for a tight rim (large values = huge halos). */
    this.foamDepthWidth = uniform(
      options.foamDepthWidth !== undefined ? options.foamDepthWidth : 0.0075,
    );
    /** Max blend toward foam tint (0–1). */
    this.foamIntensity = uniform(options.foamIntensity !== undefined ? options.foamIntensity : 0.16);
    this.foamTime = uniform(0);
    this.flowConfig = uniform(new Vector3());

    this.updateBeforeType = NodeUpdateType.RENDER;

    this._foamPhase = 0;
    this._cycle = 0.15;
    this._halfCycle = this._cycle * 0.5;

    this._USE_FLOW = options.flowMap !== undefined;
    /** Procedural normals used a custom RGB packing; tiling PNGs are standard tangent-space. */
    this._STANDARD_NORMAL_UNPACK = options.standardNormalUnpack === true;
    this.normalDistort = uniform(options.normalDistort !== undefined ? options.normalDistort : 0.034);
  }

  updateFlow(delta) {
    this.flowConfig.value.x += this.flowSpeed.value * delta;
    this.flowConfig.value.y = this.flowConfig.value.x + this._halfCycle;

    if (this.flowConfig.value.x >= this._cycle) {
      this.flowConfig.value.x = 0;
      this.flowConfig.value.y = this._halfCycle;
    } else if (this.flowConfig.value.y >= this._cycle) {
      this.flowConfig.value.y = this.flowConfig.value.y - this._cycle;
    }

    this.flowConfig.value.z = this._halfCycle;
  }

  updateBefore(frame) {
    this.updateFlow(frame.deltaTime);
    this._foamPhase += frame.deltaTime;
    this.foamTime.value = this._foamPhase;
  }

  setup() {
    if (this._reflectionSampler === null) {
      this._reflectionSampler = reflector();
      this.waterBody.add(this._reflectionSampler.target);
      this.waterBody.userData.waterReflectionSampler = this._reflectionSampler;
      this._reflectorUvBase = this._reflectionSampler.uvNode;
    }

    const reflectionSampler = this._reflectionSampler;
    const reflectorUvBase = this._reflectorUvBase;

    const outputNode = Fn(() => {
      const flowMapOffset0 = this.flowConfig.x;
      const flowMapOffset1 = this.flowConfig.y;
      const halfCycle = this.flowConfig.z;

      const toEye = normalize(cameraPosition.sub(positionWorld));

      let flow;

      if (this._USE_FLOW === true) {
        flow = this.flowMap.rg.mul(2).sub(1);
      } else {
        flow = vec2(this.flowDirection.x, this.flowDirection.y);
      }

      flow.x.mulAssign(-1);

      const uvs = uv();

      const normalUv0 = uvs.mul(this.scale).add(flow.mul(flowMapOffset0));
      const normalUv1 = uvs.mul(this.scale).add(flow.mul(flowMapOffset1));

      const normalColor0 = this.normalMap0.sample(normalUv0);
      const normalColor1 = this.normalMap1.sample(normalUv1);

      const flowLerp = abs(halfCycle.sub(flowMapOffset0)).div(halfCycle);
      const normalColor = mix(normalColor0, normalColor1, flowLerp);

      const flatUp = vec3(0, 0, 1);
      let normal;

      if (this._STANDARD_NORMAL_UNPACK === true) {
        const nSample = normalize(
          vec3(
            normalColor.r.mul(2).sub(1),
            normalColor.g.mul(2).sub(1),
            normalColor.b.mul(2).sub(1),
          ),
        );
        normal = normalize(mix(flatUp, nSample, this.normalStrength));
      } else {
        normal = normalize(
          vec3(normalColor.r.mul(2).sub(1), normalColor.b, normalColor.g.mul(2).sub(1)),
        );
      }

      const theta = max(dot(toEye, normal), 0);
      const reflectance = pow(float(1.0).sub(theta), 5.0)
        .mul(float(1.0).sub(this.reflectivity))
        .add(this.reflectivity);

      const contrasted = pow(reflectance, max(this.reflectionContrast, float(0.02)));
      const mixFactor = min(contrasted.mul(this.reflectionStrength), float(1.0));

      const distort = this.normalDistort;
      const offset = (
        this._STANDARD_NORMAL_UNPACK === true ? normal.xy.mul(distort) : normal.xz.mul(distort)
      ).toVar();

      reflectionSampler.uvNode = reflectorUvBase.add(offset);

      const refractorUV = screenUV.add(offset);
      const refractionSampler = viewportSharedTexture(viewportSafeUV(refractorUV));

      const lit = vec4(this.color, 1.0).mul(mix(refractionSampler, reflectionSampler, mixFactor));

      const waterLin = linearDepth();
      const sceneUV = viewportSafeUV(refractorUV);
      const sceneLin = linearDepth(viewportDepthTexture(sceneUV));
      const depthDiff = abs(waterLin.sub(sceneLin));
      const inner = float(0);
      const foamByDepth = float(1).sub(smoothstep(inner, this.foamDepthWidth, depthDiff));
      const foamTight = pow(foamByDepth, float(2.1));
      const behindScene = step(waterLin.add(float(0.00012)), sceneLin);
      const foamMask = foamTight.mul(behindScene);

      const wxz = positionWorld.xz;
      const chop = sin(wxz.x.mul(1.85).add(wxz.y.mul(1.42)).add(this.foamTime.mul(0.95)))
        .mul(0.5)
        .add(0.5);
      const chop2 = sin(wxz.x.mul(-2.3).add(wxz.y.mul(2.08)).sub(this.foamTime.mul(1.12)))
        .mul(0.5)
        .add(0.5);
      const foamBreak = float(0.88).add(chop.mul(0.07)).add(chop2.mul(0.05));

      const foamAmt = foamMask.mul(foamBreak).mul(this.foamIntensity);
      const foamTint = vec3(1.0, 0.985, 0.96);
      const outRgb = mix(lit.rgb, foamTint, foamAmt);

      return vec4(outRgb, lit.a);
    })();

    return outputNode;
  }
}

export class WaterSurfaceMesh extends Mesh {
  constructor(geometry, options = {}) {
    const material = new NodeMaterial();
    material.transparent = true;

    super(geometry, material);

    this.isWater = true;

    material.colorNode = new WaterSurfaceNode(options, this);
  }
}
