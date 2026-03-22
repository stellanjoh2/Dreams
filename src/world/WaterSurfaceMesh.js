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
  dot,
  screenUV,
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
    this.scale = uniform(options.scale !== undefined ? options.scale : 1);
    this.flowConfig = uniform(new Vector3());

    this.updateBeforeType = NodeUpdateType.RENDER;

    this._cycle = 0.15;
    this._halfCycle = this._cycle * 0.5;

    this._USE_FLOW = options.flowMap !== undefined;
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

      const normal = normalize(vec3(normalColor.r.mul(2).sub(1), normalColor.b, normalColor.g.mul(2).sub(1)));

      const theta = max(dot(toEye, normal), 0);
      const reflectance = pow(float(1.0).sub(theta), 5.0)
        .mul(float(1.0).sub(this.reflectivity))
        .add(this.reflectivity);

      // Slightly gentler UV warp — large offsets + viewportSharedTexture exaggerate shimmer/popping at edges.
      const offset = normal.xz.mul(0.034).toVar();

      reflectionSampler.uvNode = reflectorUvBase.add(offset);

      const refractorUV = screenUV.add(offset);
      const refractionSampler = viewportSharedTexture(viewportSafeUV(refractorUV));

      return vec4(this.color, 1.0).mul(mix(refractionSampler, reflectionSampler, reflectance));
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
