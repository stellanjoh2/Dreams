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
}

export const FX_SETTINGS_STORAGE_KEY = 'candylands.fx.settings.v6';
