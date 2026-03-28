/**
 * Shared Gerstner stack for CPU-side water height sampling (must match mesh swell in TerrainGenerator).
 */

const GRAVITY = 9.81;

type GerstnerWaveParams = {
  dirX: number;
  dirY: number;
  wavelength: number;
  amplitude: number;
  steepness: number;
  phase: number;
  speedScale: number;
};

const WATER_GERSTNER_WAVES: readonly GerstnerWaveParams[] = [
  {
    dirX: 1,
    dirY: 0.38,
    wavelength: 52,
    amplitude: 0.1,
    steepness: 0.78,
    phase: 0.35,
    speedScale: 0.92,
  },
  {
    dirX: -0.55,
    dirY: 1,
    wavelength: 38,
    amplitude: 0.078,
    steepness: 0.74,
    phase: 2.05,
    speedScale: 1.02,
  },
  {
    dirX: 0.72,
    dirY: -0.68,
    wavelength: 29,
    amplitude: 0.055,
    steepness: 0.68,
    phase: 4.2,
    speedScale: 0.88,
  },
  {
    dirX: 0.22,
    dirY: 1,
    wavelength: 67,
    amplitude: 0.062,
    steepness: 0.62,
    phase: 1.45,
    speedScale: 0.75,
  },
];

export function gerstnerDisplacement(
  restX: number,
  restY: number,
  t: number,
  heightMul: number,
): { dx: number; dy: number; dz: number } {
  let dx = 0;
  let dy = 0;
  let dz = 0;

  for (const w of WATER_GERSTNER_WAVES) {
    const len = Math.hypot(w.dirX, w.dirY);
    const Dx = len > 1e-6 ? w.dirX / len : 1;
    const Dy = len > 1e-6 ? w.dirY / len : 0;
    const k = (Math.PI * 2) / Math.max(w.wavelength, 0.5);
    const omega = Math.sqrt(GRAVITY * k) * w.speedScale;
    const phase = k * (Dx * restX + Dy * restY) - omega * t + w.phase;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const horiz = w.steepness * w.amplitude * c;
    dx += horiz * Dx;
    dy += horiz * Dy;
    dz += w.amplitude * s;
  }

  return { dx: dx * heightMul, dy: dy * heightMul, dz: dz * heightMul };
}
