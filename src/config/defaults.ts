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
    enabled: true,
    intensity: 0.05,
  },
  gamepad: {
    moveSpeedX: 1,
    moveSpeedY: 1,
    lookSpeedX: 2.85,
    lookSpeedY: 2.85,
  },
  atmosphere: {
    fogDensity: 0.0022,
    /** Exp2 fog — rgb(103, 148, 158); tune in FX Studio. */
    fogColor: '#67949e',
    ambientIntensity: 0.15,
    hemiIntensity: 1.18,
    sunGlow: 1.28,
  },
  cameraFeel: {
    lookSensitivity: 0.0025,
    headBobAmount: 0.045,
    headBobSpeed: 9.4,
    normalFov: 65,
    fastFov: 90,
  },
  fresnel: {
    strength: 0.14,
    color: '#ffe6a8',
    radius: 0.45,
  },
  movement: {
    walkSpeed: 4.8,
    runMultiplier: 1.6,
    jumpForce: 7.15,
  },
  particles: {
    amount: 70,
    size: 0.04,
    color: '#b9fff4',
  },
  audio: {
    musicVolume: 0.65,
    fxVolume: 1,
  },
  water: {
    color: '#4fd6da',
    reflectionStrength: 0.3,
    reflectionContrast: 1,
    reflectivity: 0.28,
    normalStrength: 0.92,
    waveScale: 26,
    flowSpeed: 0.052,
    foamIntensity: 0.16,
    normalDistort: 0.024,
  },
};
