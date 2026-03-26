import * as THREE from 'three';
import type { FirstPersonCamera } from './FirstPersonCamera';
import type { InputSystem } from '../input/InputSystem';
import type { FxSettings } from '../fx/FxSettings';

const BASE_SPEED = 16;
const FAST_MULT = 3.1;

const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchMove = new THREE.Vector2();
const scratchLook = new THREE.Vector2();

/**
 * Detached camera: fly along view axes (WASD + Space/Ctrl vertical), gamepad look + move.
 * Player body stays frozen until the mode is toggled off.
 */
export function updateFreeFlight(
  delta: number,
  cameraSystem: FirstPersonCamera,
  input: InputSystem,
  settings: FxSettings,
): void {
  const look = input.getLookAxes(scratchLook);
  if (look.lengthSq() > 0) {
    cameraSystem.updateLook(
      look.x * settings.gamepad.lookSpeedX * delta,
      look.y * settings.gamepad.lookSpeedY * delta,
    );
  }

  const cam = cameraSystem.camera;
  scratchForward.set(0, 0, -1).applyQuaternion(cam.quaternion);
  scratchRight.set(1, 0, 0).applyQuaternion(cam.quaternion);

  const move = input.getMovementAxes(scratchMove);
  const walk = settings.movement.walkSpeed;
  let speed = (BASE_SPEED * delta * walk) / 4.8;
  if (input.isRunning()) {
    speed *= FAST_MULT;
  }

  const vy = input.getFreeFlightVerticalAxis();
  cam.position.addScaledVector(scratchForward, move.y * speed);
  cam.position.addScaledVector(scratchRight, move.x * speed);
  cam.position.y += vy * speed;

  cameraSystem.applyFreeFlightFov(
    delta,
    input.isZoomAimHeld(),
    settings.cameraFeel.normalFov,
    30,
  );
}
