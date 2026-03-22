import * as THREE from 'three';
import { WORLD_FLOOR_Y } from '../config/defaults';
import type { FxSettings } from '../fx/FxSettings';
import type { FirstPersonCamera } from '../camera/FirstPersonCamera';
import type { InputSystem } from '../input/InputSystem';

export class PlayerController {
  static readonly WATER_SURFACE_Y = WORLD_FLOOR_Y + 0.02;

  readonly position = new THREE.Vector3(0, WORLD_FLOOR_Y, 12);
  private readonly collisionRadius = 0.55;
  private readonly spawnPosition = new THREE.Vector3(0, WORLD_FLOOR_Y, 12);
  private readonly respawnTarget = new THREE.Vector3();

  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly desiredMove = new THREE.Vector3();
  private readonly desiredVelocity = new THREE.Vector3();
  private readonly velocityDelta = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookAxes = new THREE.Vector2();
  private readonly moveAxes = new THREE.Vector2();

  private verticalVelocity = 0;
  private grounded = true;
  private movementIntensity = 0;
  private landingImpact = 0;
  private landingGlide = 0;
  private drowningTimer = 0;

  update(
    delta: number,
    input: InputSystem,
    cameraSystem: FirstPersonCamera,
    settings: FxSettings,
    getGroundHeightAt: (x: number, z: number) => number | null,
    resolveTerrainCollisions: (position: THREE.Vector3, radius: number, grounded: boolean) => void,
    getRespawnPoint: (target: THREE.Vector3) => THREE.Vector3,
  ): void {
    if (this.drowningTimer > 0) {
      this.updateDrowning(delta, cameraSystem, getRespawnPoint);
      return;
    }

    const movement = input.getMovementAxes(this.moveAxes);
    const look = input.getLookAxes(this.lookAxes);

    if (look.lengthSq() > 0) {
      cameraSystem.updateLook(
        look.x * settings.cameraFeel.lookSensitivity * 30 * delta,
        look.y * settings.cameraFeel.lookSensitivity * 30 * delta,
      );
    }

    cameraSystem.getForwardVector(this.forward);
    cameraSystem.getRightVector(this.right);

    this.desiredMove.set(0, 0, 0);
    this.desiredMove.addScaledVector(this.forward, movement.y);
    this.desiredMove.addScaledVector(this.right, movement.x);

    if (this.desiredMove.lengthSq() > 1) {
      this.desiredMove.normalize();
    }

    const moveSpeed =
      settings.movement.walkSpeed *
      (input.isRunning() ? settings.movement.runMultiplier : 1);
    this.desiredVelocity.copy(this.desiredMove).multiplyScalar(moveSpeed);

    this.applyHorizontalMovement(delta);
    resolveTerrainCollisions(this.position, this.collisionRadius, this.grounded);
    const groundHeight = getGroundHeightAt(this.position.x, this.position.z);

    if (this.grounded && groundHeight !== null) {
      this.position.y = groundHeight;
    }

    if (this.grounded && input.consumeJump()) {
      this.grounded = false;
      this.verticalVelocity = settings.movement.jumpForce;
    }

    const gravity = this.verticalVelocity > 0 ? 11.9 : 15.6;
    this.verticalVelocity -= gravity * delta;
    this.position.y += this.verticalVelocity * delta;
    resolveTerrainCollisions(this.position, this.collisionRadius, this.grounded);

    const impactSpeed = this.verticalVelocity;
    if (groundHeight !== null && this.position.y <= groundHeight) {
      this.position.y = groundHeight;
      if (!this.grounded && impactSpeed < -2) {
        this.landingImpact = Math.max(this.landingImpact, THREE.MathUtils.clamp(-impactSpeed / 12, 0, 1));
        const speedRatio = THREE.MathUtils.clamp(
          this.horizontalVelocity.length() / Math.max(0.001, settings.movement.walkSpeed),
          0,
          settings.movement.runMultiplier,
        );
        const runBias = THREE.MathUtils.clamp((speedRatio - 1) / Math.max(0.01, settings.movement.runMultiplier - 1), 0, 1);
        const impactCarry = THREE.MathUtils.clamp(-impactSpeed / 10, 0, 1);
        this.landingGlide = Math.max(
          this.landingGlide,
          THREE.MathUtils.lerp(0.16, 0.48, runBias) * impactCarry,
        );
      }
      this.verticalVelocity = 0;
      this.grounded = true;
    } else if (this.grounded && (groundHeight === null || this.position.y > groundHeight + 0.08)) {
      this.grounded = false;
    }

    this.landingImpact = THREE.MathUtils.damp(this.landingImpact, 0, 9, delta);
    this.landingGlide = THREE.MathUtils.damp(this.landingGlide, 0, 3.2, delta);

    this.movementIntensity = THREE.MathUtils.lerp(
      this.movementIntensity,
      THREE.MathUtils.clamp(this.horizontalVelocity.length() / moveSpeed || 0, 0, 1),
      Math.min(1, delta * 8),
    );

    if (groundHeight === null && this.position.y < WORLD_FLOOR_Y - 0.18) {
      this.beginDrowning();
    }

    cameraSystem.updateFromPlayer(
      this.position,
      delta,
      this.movementIntensity,
      settings.cameraFeel.headBobAmount,
      settings.cameraFeel.headBobSpeed,
      !this.grounded,
      this.landingImpact,
      input.isRunning(),
    );
  }

  respawn(target = this.spawnPosition): void {
    this.position.copy(target);
    this.horizontalVelocity.set(0, 0, 0);
    this.desiredMove.set(0, 0, 0);
    this.desiredVelocity.set(0, 0, 0);
    this.velocityDelta.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = true;
    this.movementIntensity = 0;
    this.landingImpact = 0;
    this.landingGlide = 0;
    this.drowningTimer = 0;
  }

  getMovementIntensity(): number {
    return this.movementIntensity;
  }

  getWaterSubmersionDepth(): number {
    return Math.max(0, PlayerController.WATER_SURFACE_Y - this.position.y);
  }

  private applyHorizontalMovement(delta: number): void {
    if (this.grounded) {
      const baseResponse = this.desiredMove.lengthSq() > 0.0001 ? 18 : 10;
      const targetResponse = this.desiredMove.lengthSq() > 0.0001 ? 7.5 : 1.8;
      const response = THREE.MathUtils.lerp(baseResponse, targetResponse, this.landingGlide);
      this.horizontalVelocity.x = THREE.MathUtils.damp(
        this.horizontalVelocity.x,
        this.desiredVelocity.x,
        response,
        delta,
      );
      this.horizontalVelocity.z = THREE.MathUtils.damp(
        this.horizontalVelocity.z,
        this.desiredVelocity.z,
        response,
        delta,
      );
    } else if (this.desiredMove.lengthSq() > 0.0001) {
      this.velocityDelta.copy(this.desiredVelocity).sub(this.horizontalVelocity).setY(0);
      const maxAirStep = delta * 5.2;
      const deltaLength = this.velocityDelta.length();

      if (deltaLength > maxAirStep) {
        this.velocityDelta.multiplyScalar(maxAirStep / deltaLength);
      }

      this.horizontalVelocity.add(this.velocityDelta);
    } else {
      const airDrag = Math.max(0, 1 - delta * 0.05);
      this.horizontalVelocity.multiplyScalar(airDrag);
    }

    this.horizontalVelocity.y = 0;
    this.position.addScaledVector(this.horizontalVelocity, delta);
  }

  private beginDrowning(): void {
    this.drowningTimer = 3.4;
    this.grounded = false;
    this.verticalVelocity = Math.min(this.verticalVelocity, -1.75);
    this.landingImpact = 0;
    this.landingGlide = 0;
  }

  private updateDrowning(
    delta: number,
    cameraSystem: FirstPersonCamera,
    getRespawnPoint: (target: THREE.Vector3) => THREE.Vector3,
  ): void {
    this.drowningTimer = Math.max(0, this.drowningTimer - delta);
    this.horizontalVelocity.multiplyScalar(Math.max(0, 1 - delta * 3.4));
    this.position.addScaledVector(this.horizontalVelocity, delta);
    this.verticalVelocity = THREE.MathUtils.damp(this.verticalVelocity, -4.4, 4.8, delta);
    this.position.y += this.verticalVelocity * delta;
    this.movementIntensity = THREE.MathUtils.damp(this.movementIntensity, 0, 8, delta);

    if (this.drowningTimer === 0 || this.position.y < WORLD_FLOOR_Y - 3.6) {
      this.respawn(getRespawnPoint(this.respawnTarget));
    }

    cameraSystem.updateFromPlayer(
      this.position,
      delta,
      this.movementIntensity,
      0,
      1,
      true,
      0,
      false,
      false,
    );
  }
}
