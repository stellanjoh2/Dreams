import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT, WORLD_FLOOR_Y } from '../config/defaults';

export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;

  private yaw = Math.PI;
  private pitch = 0.08;
  private isLocked = false;
  private bobTime = 0;
  private bobOffset = 0;
  private landingOffset = 0;
  private sensitivity = 0.0025;
  private onLockChange?: (locked: boolean) => void;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth || 1;
    const height = viewport?.height || window.innerHeight || 1;
    this.camera = new THREE.PerspectiveCamera(
      72,
      width / Math.max(1, height),
      0.1,
      400,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, PLAYER_EYE_HEIGHT, 12);

    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);

    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  setLockChangeListener(callback: (locked: boolean) => void): void {
    this.onLockChange = callback;
  }

  get locked(): boolean {
    return this.isLocked;
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
  }

  requestLock(): void {
    void this.domElement.requestPointerLock();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  updateLook(deltaYaw: number, deltaPitch: number): void {
    this.yaw -= deltaYaw;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - deltaPitch,
      -Math.PI / 2 + 0.06,
      Math.PI / 2 - 0.06,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  updateFromPlayer(
    playerPosition: THREE.Vector3,
    delta: number,
    movementAmount: number,
    headBobAmount: number,
    headBobSpeed: number,
    airborne = false,
    landingImpact = 0,
    running = false,
    speedRatio = 0,
    normalFov = 72,
    fastFov = 82,
    clampToFloor = true,
    zoomAim = false,
    zoomFov = 30,
  ): void {
    if (!airborne && movementAmount > 0.12) {
      this.bobTime += delta * headBobSpeed * (0.45 + movementAmount);
    }

    this.bobOffset = Math.sin(this.bobTime) * headBobAmount * movementAmount;
    const targetLandingOffset = -landingImpact * 0.18;
    this.landingOffset = THREE.MathUtils.damp(this.landingOffset, targetLandingOffset, 18, delta);
    const safeNormalFov = Math.max(40, normalFov);
    const safeFastFov = Math.max(safeNormalFov, fastFov);
    const speedBlend = THREE.MathUtils.clamp((speedRatio - 1) * 1.35, 0, 1);
    const runBlend = running ? (airborne ? 0.82 : 1) : 0;
    const targetFov = zoomAim
      ? THREE.MathUtils.clamp(zoomFov, 18, 45)
      : THREE.MathUtils.lerp(safeNormalFov, safeFastFov, Math.max(speedBlend, runBlend));
    const dampSpeed = zoomAim ? 16 : 8.2;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, dampSpeed, delta);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(playerPosition);
    const targetY = playerPosition.y + PLAYER_EYE_HEIGHT + this.bobOffset + this.landingOffset;
    this.camera.position.y = clampToFloor ? Math.max(WORLD_FLOOR_Y + PLAYER_EYE_HEIGHT, targetY) : targetY;
  }

  getForwardVector(target = new THREE.Vector3()): THREE.Vector3 {
    target.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize().negate();
    return target;
  }

  getRightVector(target = new THREE.Vector3()): THREE.Vector3 {
    target.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    return target;
  }

  getPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.camera.position);
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isLocked) {
      return;
    }

    this.updateLook(
      event.movementX * this.sensitivity,
      event.movementY * this.sensitivity,
    );
  }

  private handlePointerLockChange(): void {
    this.isLocked = document.pointerLockElement === this.domElement;
    this.onLockChange?.(this.isLocked);
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
  }
}
