export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

export interface AtmosphereSettings {
  fogDensity: number;
  /** Exp2 fog tint (`THREE.FogExp2.color`). */
  fogColor: string;
  ambientIntensity: number;
  hemiIntensity: number;
  sunGlow: number;
  /**
   * 0 = cool (blue-white sun + key), 0.5 ≈ previous default, 1 = warm (golden / sunset).
   * Drives directional `sunLight` color, the visible sun sphere, and lens-flare tint.
   */
  sunTemperature: number;
}

export interface CameraFeelSettings {
  lookSensitivity: number;
  headBobAmount: number;
  headBobSpeed: number;
  normalFov: number;
  fastFov: number;
}

export interface FresnelSettings {
  strength: number;
  color: string;
  radius: number;
}

export interface MovementSettings {
  walkSpeed: number;
  runMultiplier: number;
  jumpForce: number;
}

export interface ParticleSettings {
  amount: number;
  /** World-space point size (attenuated by distance); ~3+ reads clearly at normal FOV. */
  size: number;
  color: string;
}

/** 0 = mute, 1 = full level (multiplies internal mix). */
export interface AudioVolumeSettings {
  musicVolume: number;
  fxVolume: number;
}

/** Camera / object motion blur (WebGPU velocity buffer + screen-space samples). */
export interface MotionBlurSettings {
  /** When false, velocity MRT and blur samples are skipped (better FPS on low-end GPUs). */
  enabled: boolean;
  /** Scales motion vectors when `enabled`; 0 disables streaks, ~1 matches three.js example default. */
  intensity: number;
}

/** Gamepad analog tuning (mouse look is unchanged — uses `cameraFeel.lookSensitivity`). */
export interface GamepadSettings {
  /** Multiplier on left stick strafe (X). 1 = same as keyboard max speed. */
  moveSpeedX: number;
  /** Multiplier on left stick forward/back (Y). */
  moveSpeedY: number;
  /** Yaw rate at full stick (radians per second). */
  lookSpeedX: number;
  /** Pitch rate at full stick (radians per second). */
  lookSpeedY: number;
}

/**
 * Screen-space additive dust (ported from meshgl / Orby `LensDirtShader`).
 * `exposureFactor` is driven on CPU (tone exposure proxy); no scene luminance read yet.
 */
export interface LensDirtSettings {
  enabled: boolean;
  strength: number;
  minLuminance: number;
  maxLuminance: number;
  sensitivity: number;
}

/** Live-tunable WebGPU water surface (see `WaterSurfaceMesh`). */
export interface WaterFxSettings {
  /** Hex tint multiplied with refracted scene color in the water shader (`#rrggbb`). */
  color: string;
  /** Multiplies reflection vs refraction mix (0 = mostly refracted scene). */
  reflectionStrength: number;
  /** Contrast on fresnel mix — higher = punchier glints, lower = softer water. */
  reflectionContrast: number;
  /** Base fresnel term in the water shader (min reflection at normal incidence). */
  reflectivity: number;
  /** Normal map blend — ripple strength. */
  normalStrength: number;
  /** UV scale — smaller waves / tighter ripples when higher. */
  waveScale: number;
  flowSpeed: number;
  foamIntensity: number;
  /** UV offset strength for reflection/refraction distortion. */
  normalDistort: number;
}

export interface FxSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  bloom: BloomSettings;
  motionBlur: MotionBlurSettings;
  gamepad: GamepadSettings;
  atmosphere: AtmosphereSettings;
  cameraFeel: CameraFeelSettings;
  fresnel: FresnelSettings;
  movement: MovementSettings;
  particles: ParticleSettings;
  audio: AudioVolumeSettings;
  water: WaterFxSettings;
  lensDirt: LensDirtSettings;
}

export const FX_SETTINGS_STORAGE_KEY = 'candylands.fx.settings.v8';
