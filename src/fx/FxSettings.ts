export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

export interface AtmosphereSettings {
  fogDensity: number;
  skyColor: string;
  ambientIntensity: number;
  hemiIntensity: number;
  sunGlow: number;
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

export interface FxSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  bloom: BloomSettings;
  atmosphere: AtmosphereSettings;
  cameraFeel: CameraFeelSettings;
  fresnel: FresnelSettings;
  movement: MovementSettings;
  particles: ParticleSettings;
  audio: AudioVolumeSettings;
}

export const FX_SETTINGS_STORAGE_KEY = 'candylands.fx.settings.v6';
