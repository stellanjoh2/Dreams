import type { FxSettings } from '../fx/FxSettings';

export const APP_TITLE = 'Candy Lands';
export const PLAYER_EYE_HEIGHT = 1.72;
export const WORLD_FLOOR_Y = 0;

export const DEFAULT_FX_SETTINGS: FxSettings = {
  exposure: 0.97,
  contrast: 1.11,
  saturation: 1.56,
  vignette: 0.39,
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
  },
  fresnel: {
    strength: 0.14,
    color: '#ffe6a8',
    radius: 0.45,
  },
  movement: {
    walkSpeed: 4.6,
    runMultiplier: 1.55,
    jumpForce: 6.45,
  },
  particles: {
    amount: 140,
    color: '#b9fff4',
  },
};
