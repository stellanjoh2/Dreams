import * as THREE from 'three';
import { DROWNING_SOUND_PHASE_SECONDS } from '../config/audioAssets';
import { WATER_SURFACE_Y, WORLD_FLOOR_Y } from '../config/defaults';
import type { FxSettings } from '../fx/FxSettings';
import type { FirstPersonCamera } from '../camera/FirstPersonCamera';
import type { InputSystem } from '../input/InputSystem';
import type { GroundSupportSample } from '../world/TerrainPhysics';

export class PlayerController {
  private static readonly GROUND_GRACE_TIME = 0.12;
  /** Auto step for static platforms only (curbs); larger ledges need a jump. */
  private static readonly STEP_UP_HEIGHT = 0.34;
  /** Moving lifts only — can rise faster than `STEP_UP_HEIGHT` per frame without losing the player. */
  private static readonly STEP_UP_HEIGHT_MOVING_ELEVATOR = 0.95;
  private static readonly STEP_DOWN_SNAP = 0.18;
  private static readonly LANDING_SNAP_BASE = 0.22;
  private static readonly LANDING_SNAP_BUFFER = 0.08;

  /** After the death sting starts, keep sinking this long so the tail can play before respawn. */
  private static readonly DROWNING_POST_DEATH_TAIL_SEC = 2.75;

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
  private readonly jumpPadImpulse = new THREE.Vector3();

  private verticalVelocity = 0;
  private grounded = true;
  private movementIntensity = 0;
  private landingImpact = 0;
  private landingGlide = 0;
  private drowningTimer = 0;
  private groundGraceTimer = 0;
  private speedRatio = 0;

  update(
    delta: number,
    input: InputSystem,
    cameraSystem: FirstPersonCamera,
    settings: FxSettings,
    getGroundSupportAt: (
      x: number,
      z: number,
      supportRadius?: number,
      maxHeight?: number,
    ) => GroundSupportSample | null,
    resolveTerrainCollisions: (position: THREE.Vector3, radius: number, grounded: boolean) => void,
    getJumpPadImpulse: (position: THREE.Vector3, target: THREE.Vector3) => THREE.Vector3 | null,
    getRespawnPoint: (target: THREE.Vector3) => THREE.Vector3,
    audioHooks?: {
      onPlayerJump?: () => void;
      onJumpPad?: () => void;
      onBeginDrowning?: () => void;
    },
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

    const running = input.isRunning();
    const moveSpeed =
      settings.movement.walkSpeed *
      (running ? settings.movement.runMultiplier : 1);
    this.desiredVelocity.copy(this.desiredMove).multiplyScalar(moveSpeed);

    this.applyHorizontalMovement(delta, running, settings.movement);
    resolveTerrainCollisions(this.position, this.collisionRadius, this.grounded);
    const supportRadius = this.collisionRadius * 0.92;
    const groundProbeMaxY = this.position.y + PlayerController.STEP_UP_HEIGHT;
    let groundSupport = getGroundSupportAt(
      this.position.x,
      this.position.z,
      supportRadius,
      groundProbeMaxY,
    );
    let groundHeight = groundSupport?.height ?? null;
    const maxStepUp =
      groundSupport?.fromMovingElevator === true
        ? PlayerController.STEP_UP_HEIGHT_MOVING_ELEVATOR
        : PlayerController.STEP_UP_HEIGHT;

    if (this.grounded && groundHeight !== null) {
      const groundedDelta = groundHeight - this.position.y;
      if (groundedDelta <= maxStepUp && groundedDelta >= -PlayerController.STEP_DOWN_SNAP) {
        this.position.y = groundHeight;
        this.groundGraceTimer = PlayerController.GROUND_GRACE_TIME;
      }
    }

    if (this.grounded) {
      const jumpPadBoost = getJumpPadImpulse(this.position, this.jumpPadImpulse);

      if (jumpPadBoost) {
        this.grounded = false;
        this.verticalVelocity = jumpPadBoost.y;
        this.horizontalVelocity.x =
          Math.abs(jumpPadBoost.x) > 0.001
            ? jumpPadBoost.x
            : this.horizontalVelocity.x * 0.4;
        this.horizontalVelocity.z =
          Math.abs(jumpPadBoost.z) > 0.001
            ? jumpPadBoost.z
            : this.horizontalVelocity.z * 0.4;
        this.landingImpact = 0;
        this.landingGlide = 0;
        audioHooks?.onJumpPad?.();
      } else if (input.consumeJump()) {
        this.grounded = false;
        this.verticalVelocity = settings.movement.jumpForce;
        audioHooks?.onPlayerJump?.();
      }
    }

    const gravity = this.verticalVelocity > 0 ? 11.9 : 15.6;
    const previousY = this.position.y;
    this.verticalVelocity -= gravity * delta;
    this.position.y += this.verticalVelocity * delta;
    resolveTerrainCollisions(this.position, this.collisionRadius, this.grounded);
    /** Wide ceiling so a rising elevator top still counts while falling (old: `previousY + 0.08` missed it). */
    const landingProbeMaxY =
      Math.max(previousY, this.position.y) +
      Math.max(
        PlayerController.LANDING_SNAP_BASE + PlayerController.LANDING_SNAP_BUFFER,
        2.35,
      );
    groundSupport = getGroundSupportAt(
      this.position.x,
      this.position.z,
      supportRadius,
      landingProbeMaxY,
    );
    groundHeight = groundSupport?.height ?? null;
    this.groundGraceTimer = Math.max(0, this.groundGraceTimer - delta);

    const impactSpeed = this.verticalVelocity;
    const landingSnapDistance = Math.max(
      PlayerController.LANDING_SNAP_BASE,
      Math.abs(impactSpeed) * delta + PlayerController.LANDING_SNAP_BUFFER,
    );
    const canSnapToGround =
      groundHeight !== null &&
      impactSpeed <= 0 &&
      previousY >= groundHeight - PlayerController.LANDING_SNAP_BUFFER &&
      this.position.y <= groundHeight + landingSnapDistance;

    if (groundHeight !== null && (this.position.y <= groundHeight || canSnapToGround)) {
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
      this.groundGraceTimer = PlayerController.GROUND_GRACE_TIME;
    } else if (
      this.grounded &&
      this.groundGraceTimer === 0 &&
      (groundHeight === null || this.position.y > groundHeight + 0.18)
    ) {
      this.grounded = false;
    }

    this.landingImpact = THREE.MathUtils.damp(this.landingImpact, 0, 9, delta);
    this.landingGlide = THREE.MathUtils.damp(this.landingGlide, 0, 3.2, delta);

    this.movementIntensity = THREE.MathUtils.lerp(
      this.movementIntensity,
      THREE.MathUtils.clamp(this.horizontalVelocity.length() / moveSpeed || 0, 0, 1),
      Math.min(1, delta * 8),
    );
    this.speedRatio = THREE.MathUtils.lerp(
      this.speedRatio,
      THREE.MathUtils.clamp(
        this.horizontalVelocity.length() / Math.max(0.001, settings.movement.walkSpeed),
        0,
        settings.movement.runMultiplier,
      ),
      Math.min(1, delta * 8),
    );

    if (groundHeight === null && this.position.y < WORLD_FLOOR_Y - 0.18) {
      this.beginDrowning(audioHooks);
    }

    cameraSystem.updateFromPlayer(
      this.position,
      delta,
      this.movementIntensity,
      settings.cameraFeel.headBobAmount,
      settings.cameraFeel.headBobSpeed,
      !this.grounded,
      this.landingImpact,
      running,
      this.speedRatio,
      settings.cameraFeel.normalFov,
      settings.cameraFeel.fastFov,
      true,
      input.isZoomAimHeld(),
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
    this.groundGraceTimer = PlayerController.GROUND_GRACE_TIME;
    this.speedRatio = 0;
  }

  getMovementIntensity(): number {
    return this.movementIntensity;
  }

  getWaterSubmersionDepth(): number {
    return Math.max(0, WATER_SURFACE_Y - this.position.y);
  }

  private applyHorizontalMovement(
    delta: number,
    running: boolean,
    movementSettings: FxSettings['movement'],
  ): void {
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
      const runAirControl = THREE.MathUtils.clamp(
        (movementSettings.runMultiplier - 1) / Math.max(0.01, movementSettings.runMultiplier),
        0,
        0.5,
      );
      const maxAirStep = delta * (running ? 12.6 + runAirControl * 5 : 9.8);
      const deltaLength = this.velocityDelta.length();

      if (deltaLength > maxAirStep) {
        this.velocityDelta.multiplyScalar(maxAirStep / deltaLength);
      }

      this.horizontalVelocity.add(this.velocityDelta);
    } else {
      const airDrag = Math.max(0, 1 - delta * 0.18);
      this.horizontalVelocity.multiplyScalar(airDrag);
    }

    this.horizontalVelocity.y = 0;
    this.position.addScaledVector(this.horizontalVelocity, delta);
  }

  private beginDrowning(
    audioHooks?: {
      onPlayerJump?: () => void;
      onJumpPad?: () => void;
      onBeginDrowning?: () => void;
    },
  ): void {
    this.drowningTimer = DROWNING_SOUND_PHASE_SECONDS + PlayerController.DROWNING_POST_DEATH_TAIL_SEC;
    this.grounded = false;
    this.verticalVelocity = Math.min(this.verticalVelocity, -1.75);
    this.landingImpact = 0;
    this.landingGlide = 0;
    this.groundGraceTimer = 0;
    audioHooks?.onBeginDrowning?.();
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
    this.speedRatio = THREE.MathUtils.damp(this.speedRatio, 0, 8, delta);

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
      0,
      72,
      82,
      false,
    );
  }
}
