import type { FxSettings } from '../fx/FxSettings';

export const APP_TITLE = 'Candy Lands';
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
    strength: 1.17,
    radius: 0.5,
    threshold: 0.72,
  },
  atmosphere: {
    fogDensity: 0.013,
    skyColor: '#d5c4ff',
    ambientIntensity: 0.13,
    hemiIntensity: 1.22,
    sunGlow: 1.25,
  },
  cameraFeel: {
    lookSensitivity: 0.0025,
    headBobAmount: 0.045,
    headBobSpeed: 9.4,
    normalFov: 73,
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
    amount: 140,
    size: 0.04,
    color: '#b9fff4',
  },
  audio: {
    musicVolume: 0.65,
    fxVolume: 1,
  },
};
