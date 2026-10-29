import type { FxSettings } from '../fx/FxSettings';

export const APP_TITLE = 'Candy Lands';

/**
 * Extra lens-flare layer for jump pads / crystals (screen-space DOM + raycasts).
 * Off by default to save CPU; set `true` in code to re-enable experiments.
 */
export const ENABLE_EMISSIVE_LENS_FLARE = false;
export const PLAYER_EYE_HEIGHT = 1.72;
export const WORLD_FLOOR_Y = 0;

/** Single source for gameplay + mesh; slightly above floor to limit z-fighting with platforms/seabed. */
export const WATER_SURFACE_Y = WORLD_FLOOR_Y + 0.055;

/**
 * Sand disk surface — under water for hull / fish clearance (visual only).
 * Drowning still uses {@link WATER_SURFACE_Y}.
 */
export const SEA_BED_SURFACE_Y = WATER_SURFACE_Y - 5.05;

export const DEFAULT_FX_SETTINGS: FxSettings = {
  exposure: 0.97,
  contrast: 1.05,
  saturation: 1.56,
  vignette: 1.5,
  bloom: {
    strength: 0.5,
    radius: 0.2,
    threshold: 1,
  },
  motionBlur: {
    enabled: false,
    intensity: 0.05,
  },
  gamepad: {
    moveSpeedX: 1,
    moveSpeedY: 1,
    lookSpeedX: 2.85,
    lookSpeedY: 2.85,
  },
  atmosphere: {
    fogDensity: 0.003,
    /** Exp2 fog — rgb(120, 120, 150); tune in FX Studio. */
    fogColor: '#787896',
    ambientIntensity: 0.28,
    hemiIntensity: 0.97,
    sunGlow: 1.22,
    sunTemperature: 0.18,
    sunTimeOfDayHours: 17.5,
    sunAzimuthDegrees: 70,
    sunDiscScale: 1.48,
  },
  cameraFeel: {
    lookSensitivity: 0.0025,
    headBobAmount: 0.045,
    headBobSpeed: 9.4,
    normalFov: 65,
    fastFov: 90,
    viewDistance: 3200,
  },
  fresnel: {
    strength: 0.14,
    color: '#ffedc7',
    radius: 0.28,
  },
  movement: {
    walkSpeed: 5.28,
    runMultiplier: 1.6,
    /** ~10% higher apex than 7.15 (height scales with speed squared; 7.15 × √1.1 ≈ 7.5). */
    jumpForce: 7.5,
  },
  particles: {
    amount: 36,
    size: 0.04,
    color: '#b9fff4',
  },
  audio: {
    musicVolume: 0.65,
    fxVolume: 1,
  },
  water: {
    color: '#34eae7',
    reflectionStrength: 1.66,
    reflectionContrast: 1,
    reflectivity: 0.33,
    normalStrength: 0.92,
    waveScale: 26,
    waveHeight: 2.5,
    flowSpeed: 0.052,
    foamIntensity: 0.11,
    foamObjectRadius: 0.0005,
    normalDistort: 0.021,
    opacity: 1,
  },
  /** Orby / meshgl-style dust; `public/textures/lens-dirt.jpg`. Boost follows sun flare visibility. */
  lensDirt: {
    enabled: true,
    strength: 0.06,
    minLuminance: 0.49,
    maxLuminance: 0.79,
    sensitivity: 0.55,
  },
};
