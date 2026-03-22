import * as THREE from 'three';

type FresnelCapableMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

const FRESNEL_PROGRAM_KEY = 'candylands-fresnel-v1';

type FresnelUniforms = {
  fresnelColor: { value: THREE.Color };
  fresnelStrength: { value: number };
  fresnelRadius: { value: number };
};

type FresnelFallbackState = {
  baseEmissive: THREE.Color;
  baseEmissiveIntensity: number;
  baseEnvMapIntensity?: number;
  baseClearcoat?: number;
  baseClearcoatRoughness?: number;
};

export const isFresnelCapableMaterial = (
  material: THREE.Material,
): material is FresnelCapableMaterial =>
  material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial;

const ensureFresnelMaterial = (material: FresnelCapableMaterial): void => {
  if (material.userData.hasCandyFresnel === true) {
    return;
  }

  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousCacheKey = material.customProgramCacheKey?.bind(material);

  material.userData.hasCandyFresnel = true;
  material.userData.fresnelColor = new THREE.Color('#ffe6a8');
  material.userData.fresnelStrength = 0.14;
  material.userData.fresnelRadius = 0.45;
  material.userData.fresnelFallbackState = {
    baseEmissive: material.emissive.clone(),
    baseEmissiveIntensity: material.emissiveIntensity,
    baseEnvMapIntensity: 'envMapIntensity' in material ? material.envMapIntensity : undefined,
    baseClearcoat: 'clearcoat' in material ? material.clearcoat : undefined,
    baseClearcoatRoughness: 'clearcoatRoughness' in material ? material.clearcoatRoughness : undefined,
  } satisfies FresnelFallbackState;

  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey() : material.type}|${FRESNEL_PROGRAM_KEY}`;

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);

    const uniforms = shader.uniforms as Record<string, unknown> & FresnelUniforms;
    uniforms.fresnelColor = {
      value: (material.userData.fresnelColor as THREE.Color).clone(),
    };
    uniforms.fresnelStrength = {
      value: Number(material.userData.fresnelStrength ?? 0),
    };
    uniforms.fresnelRadius = {
      value: Number(material.userData.fresnelRadius ?? 0.45),
    };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 fresnelColor;
uniform float fresnelStrength;
uniform float fresnelRadius;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `float candyFresnelExponent = mix( 5.0, 1.25, clamp( fresnelRadius, 0.0, 1.0 ) );
float candyFresnel = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), candyFresnelExponent );
outgoingLight += fresnelColor * candyFresnel * fresnelStrength;
#include <dithering_fragment>`,
    );

    material.userData.fresnelUniforms = uniforms;
  };

  material.needsUpdate = true;
};

const applyFresnelFallback = (
  material: FresnelCapableMaterial,
  color: string,
  strength: number,
  radius: number,
): void => {
  const fallback = material.userData.fresnelFallbackState as FresnelFallbackState | undefined;
  if (!fallback) {
    return;
  }

  const tint = new THREE.Color(color);
  const emissiveBoost = tint.multiplyScalar(strength * 0.3);

  material.emissive.copy(fallback.baseEmissive).add(emissiveBoost);
  material.emissiveIntensity = fallback.baseEmissiveIntensity + strength * THREE.MathUtils.lerp(0.45, 1.15, radius);

  if (typeof fallback.baseEnvMapIntensity === 'number') {
    material.envMapIntensity =
      fallback.baseEnvMapIntensity + strength * THREE.MathUtils.lerp(0.18, 0.7, radius);
  }

  if (
    material instanceof THREE.MeshPhysicalMaterial &&
    typeof fallback.baseClearcoat === 'number' &&
    typeof fallback.baseClearcoatRoughness === 'number'
  ) {
    material.clearcoat = THREE.MathUtils.clamp(
      fallback.baseClearcoat + strength * THREE.MathUtils.lerp(0.08, 0.32, radius),
      0,
      1,
    );
    material.clearcoatRoughness = THREE.MathUtils.clamp(
      fallback.baseClearcoatRoughness * THREE.MathUtils.lerp(1.08, 0.72, radius),
      0,
      1,
    );
  }
};

export const updateFresnelMaterial = (
  material: THREE.Material,
  color: string,
  strength: number,
  radius: number,
): void => {
  if (!isFresnelCapableMaterial(material)) {
    return;
  }

  ensureFresnelMaterial(material);

  const fresnelColor = material.userData.fresnelColor as THREE.Color;
  fresnelColor.set(color);
  material.userData.fresnelStrength = strength;
  material.userData.fresnelRadius = radius;

  const uniforms = material.userData.fresnelUniforms as FresnelUniforms | undefined;
  if (uniforms) {
    uniforms.fresnelColor.value.copy(fresnelColor);
    uniforms.fresnelStrength.value = strength;
    uniforms.fresnelRadius.value = radius;
  }

  // WebGPU does not support onBeforeCompile shader patching for built-in materials,
  // so apply a visible fallback tint/boost that still responds to the editor.
  applyFresnelFallback(material, color, strength, radius);
};
