import * as THREE from 'three';
import type { FirstPersonCamera } from './FirstPersonCamera';

/** World units per second — slow dolly for trailer shots. */
const FORWARD_SPEED = 0.55;

/** Full 360° roll period (seconds); ~60s as requested. */
const ROLL_PERIOD_SEC = 60;

/** Key C: starting roll (degrees). */
const DOLLY_INITIAL_ROLL_C_DEG = -22.5;

/**
 * Key V: inverse dolly — opposite roll start, backward travel, reversed roll rate, and pitch offset on
 * the other euler axis from C.
 */
const DOLLY_INITIAL_ROLL_V_DEG = 25;
const DOLLY_PITCH_OFFSET_V_DEG = -25;

/** Pivot lies this far along the view ray (world units) — roughly what you’re framing center-screen. */
const ORBIT_FOCUS_DISTANCE = 24;

/** Orbit angular speed (rad/s); ~52s per full revolution at 0.12. */
const ORBIT_SPEED = 0.12;

const scratchForward = new THREE.Vector3();

export type TrailerCameraState = {
  mode: 'none' | 'dolly' | 'orbit';
  /** Dolly only: +1 = Key C; −1 = Key V (inverse roll rate, backward dolly, mirrored start + pitch offset). */
  dollyRollSign: 1 | -1;
  frozenYaw: number;
  frozenPitch: number;
  roll: number;
  readonly orbitPivot: THREE.Vector3;
  orbitAzimuth: number;
  orbitRadius: number;
  orbitEyeY: number;
  /** Orbit only: +1 first leg, −1 after second O; third O exits. */
  orbitDirection: 1 | -1;
};

export function createTrailerCameraState(): TrailerCameraState {
  return {
    mode: 'none',
    dollyRollSign: 1,
    frozenYaw: 0,
    frozenPitch: 0,
    roll: 0,
    orbitPivot: new THREE.Vector3(),
    orbitAzimuth: 0,
    orbitRadius: 0,
    orbitEyeY: 0,
    orbitDirection: 1,
  };
}

/** @deprecated Use createTrailerCameraState */
export const createCinematicCameraState = createTrailerCameraState;

export type CinematicCameraState = TrailerCameraState;

export function trailerCameraActive(state: TrailerCameraState): boolean {
  return state.mode !== 'none';
}

function enterDollyTrailer(state: TrailerCameraState, cameraSystem: FirstPersonCamera, rollSign: 1 | -1): void {
  state.mode = 'dolly';
  state.dollyRollSign = rollSign;
  state.frozenYaw = cameraSystem.getYaw();
  if (rollSign === 1) {
    state.frozenPitch = cameraSystem.getPitch();
    state.roll = THREE.MathUtils.degToRad(DOLLY_INITIAL_ROLL_C_DEG);
  } else {
    state.frozenPitch =
      cameraSystem.getPitch() + THREE.MathUtils.degToRad(DOLLY_PITCH_OFFSET_V_DEG);
    state.roll = THREE.MathUtils.degToRad(DOLLY_INITIAL_ROLL_V_DEG);
  }
}

function enterOrbitTrailer(state: TrailerCameraState, cameraSystem: FirstPersonCamera): void {
  const cam = cameraSystem.camera;
  scratchForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
  state.orbitPivot.copy(cam.position).addScaledVector(scratchForward, ORBIT_FOCUS_DISTANCE);

  const dx = cam.position.x - state.orbitPivot.x;
  const dz = cam.position.z - state.orbitPivot.z;
  state.orbitRadius = Math.max(0.65, Math.hypot(dx, dz));
  state.orbitAzimuth = Math.atan2(dz, dx);
  state.orbitEyeY = cam.position.y;
  state.orbitDirection = 1;
  state.mode = 'orbit';
}

export function exitTrailerCamera(state: TrailerCameraState, cameraSystem: FirstPersonCamera): void {
  if (state.mode === 'none') {
    return;
  }
  state.mode = 'none';
  state.orbitDirection = 1;
  cameraSystem.applyOrientationWithoutRollFromCurrentQuaternion();
}

/** @deprecated Use exitTrailerCamera */
export const exitCinematicCamera = exitTrailerCamera;

/**
 * Key C: forward dolly + slow roll. Key V: inverse (backward dolly, opposite roll rate, +25° start roll,
 * −25° pitch vs capture). Tapping the same key again exits.
 */
export function toggleTrailerDolly(
  state: TrailerCameraState,
  cameraSystem: FirstPersonCamera,
  rollSign: 1 | -1,
): void {
  if (state.mode === 'dolly' && state.dollyRollSign === rollSign) {
    exitTrailerCamera(state, cameraSystem);
    return;
  }
  if (state.mode !== 'none') {
    exitTrailerCamera(state, cameraSystem);
  }
  enterDollyTrailer(state, cameraSystem, rollSign);
}

/**
 * Key O: orbit around the view-axis focus. Second O reverses direction; third O exits to FPS.
 */
export function toggleTrailerOrbit(state: TrailerCameraState, cameraSystem: FirstPersonCamera): void {
  if (state.mode === 'orbit') {
    if (state.orbitDirection === 1) {
      state.orbitDirection = -1;
      return;
    }
    exitTrailerCamera(state, cameraSystem);
    return;
  }
  if (state.mode !== 'none') {
    exitTrailerCamera(state, cameraSystem);
  }
  enterOrbitTrailer(state, cameraSystem);
}

export function updateTrailerCamera(
  delta: number,
  state: TrailerCameraState,
  cameraSystem: FirstPersonCamera,
): void {
  if (state.mode === 'none') {
    return;
  }

  const cam = cameraSystem.camera;

  if (state.mode === 'dolly') {
    const rollSpeed = (Math.PI * 2) / ROLL_PERIOD_SEC;
    state.roll += rollSpeed * delta * state.dollyRollSign;
    cam.rotation.set(state.frozenPitch, state.frozenYaw, state.roll);
    scratchForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const forwardSign = state.dollyRollSign;
    cam.position.addScaledVector(scratchForward, FORWARD_SPEED * delta * forwardSign);
    return;
  }

  state.orbitAzimuth += ORBIT_SPEED * delta * state.orbitDirection;
  const r = state.orbitRadius;
  const p = state.orbitPivot;
  cam.position.set(
    p.x + Math.cos(state.orbitAzimuth) * r,
    state.orbitEyeY,
    p.z + Math.sin(state.orbitAzimuth) * r,
  );
  cam.up.set(0, 1, 0);
  cam.lookAt(p);
}

/** @deprecated Use updateTrailerCamera */
export const updateCinematicCamera = updateTrailerCamera;
