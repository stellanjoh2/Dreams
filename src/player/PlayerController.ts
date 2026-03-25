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
  /** Wider foot circle if the normal probe misses narrow 1×1 tops (crack / edge stands). */
  private static readonly GROUND_SUPPORT_RADIUS_BOOST = 1.18;
  /** Cap vertical travel per sub-step so floor contact resolves inside the frame (no one-frame snap). */
  private static readonly VERT_SUBSTEP_MAX_DISP = 0.055;
  private static readonly VERT_SUBSTEP_MAX_ITERS = 72;

  readonly position = new THREE.Vector3(0, WORLD_FLOOR_Y, 12);
  private readonly collisionRadius = 0.55;
  /** Slightly fatten AABB resolution so we don’t squeeze through 1×1 seams after single-axis solves. */
  private static readonly COLLISION_RESOLVE_RADIUS_MULT = 1.06;
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
  /** Jump pad fires once per touch; reset when leaving the pad volume (stops SFX spam). */
  private jumpPadContactOpen = true;

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
        look.x * settings.gamepad.lookSpeedX * delta,
        look.y * settings.gamepad.lookSpeedY * delta,
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
    resolveTerrainCollisions(
      this.position,
      this.collisionRadius * PlayerController.COLLISION_RESOLVE_RADIUS_MULT,
      this.grounded,
    );
    const supportRadius = this.collisionRadius * 0.92;
    const groundProbeMaxY = this.position.y + PlayerController.STEP_UP_HEIGHT;
    const px = this.position.x;
    const pz = this.position.z;
    let groundSupport = getGroundSupportAt(px, pz, supportRadius, groundProbeMaxY);
    if (groundSupport === null) {
      groundSupport = getGroundSupportAt(
        px,
        pz,
        this.collisionRadius * PlayerController.GROUND_SUPPORT_RADIUS_BOOST,
        groundProbeMaxY,
      );
    }
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
        if (this.jumpPadContactOpen) {
          this.jumpPadContactOpen = false;
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
        }
      } else {
        this.jumpPadContactOpen = true;
      }

      if (!jumpPadBoost && input.consumeJump()) {
        this.grounded = false;
        this.verticalVelocity = settings.movement.jumpForce;
        audioHooks?.onPlayerJump?.();
      }
    }

    const wasAirborne = !this.grounded;
    const previousY = this.position.y;
    const landedBySweep = this.integrateVerticalWithSubsteps(
      delta,
      px,
      pz,
      supportRadius,
      getGroundSupportAt,
      wasAirborne,
      settings,
    );

    resolveTerrainCollisions(
      this.position,
      this.collisionRadius * PlayerController.COLLISION_RESOLVE_RADIUS_MULT,
      this.grounded,
    );

    /** Wide probe for grace / ledge logic (not used for the main down-hit; sweep handles that). */
    const landingProbeMaxY =
      Math.max(previousY, this.position.y) +
      Math.max(
        PlayerController.LANDING_SNAP_BASE + PlayerController.LANDING_SNAP_BUFFER,
        2.35,
      );
    groundSupport = getGroundSupportAt(px, pz, supportRadius, landingProbeMaxY);
    if (groundSupport === null) {
      groundSupport = getGroundSupportAt(
        px,
        pz,
        this.collisionRadius * PlayerController.GROUND_SUPPORT_RADIUS_BOOST,
        landingProbeMaxY,
      );
    }
    groundHeight = groundSupport?.height ?? null;
    this.groundGraceTimer = Math.max(0, this.groundGraceTimer - delta);

    const impactSpeed = this.verticalVelocity;
    const landingSnapDistance = Math.max(
      PlayerController.LANDING_SNAP_BASE,
      Math.abs(impactSpeed) * delta + PlayerController.LANDING_SNAP_BUFFER,
    );
    const canSnapToGround =
      !landedBySweep &&
      groundHeight !== null &&
      impactSpeed <= 0 &&
      previousY >= groundHeight - PlayerController.LANDING_SNAP_BUFFER &&
      this.position.y <= groundHeight + landingSnapDistance;

    /**
     * Never use bare `position.y <= groundHeight`: the landing probe uses a tall `maxHeight`, so
     * `groundHeight` is the **highest** surface under the feet — standing under a taller neighbor
     * ledge would otherwise snap you up in one frame (“teleport step”).
     */
    const belowSupportSlack = PlayerController.LANDING_SNAP_BASE + PlayerController.LANDING_SNAP_BUFFER;
    const verticallyAlignedWithSupport =
      !landedBySweep &&
      groundHeight !== null &&
      impactSpeed <= 0 &&
      this.position.y <= groundHeight + landingSnapDistance &&
      this.position.y >= groundHeight - belowSupportSlack;

    if (groundHeight !== null && (verticallyAlignedWithSupport || canSnapToGround)) {
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

    if (this.drowningTimer <= 0) {
      const dryProbeMax = this.position.y + PlayerController.STEP_UP_HEIGHT + 0.12;
      let drySupportProbe = getGroundSupportAt(px, pz, supportRadius, dryProbeMax);
      if (drySupportProbe === null) {
        drySupportProbe = getGroundSupportAt(
          px,
          pz,
          this.collisionRadius * PlayerController.GROUND_SUPPORT_RADIUS_BOOST,
          dryProbeMax,
        );
      }
      const ghDry = drySupportProbe?.height ?? null;
      /** Feet are on some ground sample under the probe — don’t drown (includes low docks / seabed). */
      const onSolidFooting =
        ghDry !== null &&
        this.position.y <= ghDry + 0.28 &&
        this.position.y >= ghDry - 0.48;
      const submergedPastSurface = this.position.y < WATER_SURFACE_Y - 0.006;
      if (submergedPastSurface && !onSolidFooting) {
        this.beginDrowning(audioHooks);
      }
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
    this.jumpPadContactOpen = true;
  }

  getMovementIntensity(): number {
    return this.movementIntensity;
  }

  getWaterSubmersionDepth(): number {
    return Math.max(0, WATER_SURFACE_Y - this.position.y);
  }

  /**
   * Semi-implicit gravity in small vertical slices so the first contact with a floor happens on a
   * sub-step (smooth motion) instead of one full-frame snap past the surface.
   */
  private integrateVerticalWithSubsteps(
    delta: number,
    px: number,
    pz: number,
    supportRadius: number,
    getGroundSupportAt: (
      x: number,
      z: number,
      supportRadius?: number,
      maxHeight?: number,
    ) => GroundSupportSample | null,
    wasAirborne: boolean,
    settings: FxSettings,
  ): boolean {
    let y = this.position.y;
    let v = this.verticalVelocity;
    let timeLeft = delta;
    let landed = false;

    for (let iter = 0; iter < PlayerController.VERT_SUBSTEP_MAX_ITERS && timeLeft > 1e-10; iter += 1) {
      const g = v > 0 ? 11.9 : 15.6;
      const speed = Math.max(Math.abs(v), 1.2);
      let h = Math.min(timeLeft, PlayerController.VERT_SUBSTEP_MAX_DISP / speed);
      if (h <= 0) {
        break;
      }

      const vNew = v - g * h;
      const yNew = y + vNew * h;

      const sweepProbeMaxY = Math.max(y, yNew) + 0.45;
      let sweepSupport = getGroundSupportAt(px, pz, supportRadius, sweepProbeMaxY);
      if (sweepSupport === null) {
        sweepSupport = getGroundSupportAt(
          px,
          pz,
          this.collisionRadius * PlayerController.GROUND_SUPPORT_RADIUS_BOOST,
          sweepProbeMaxY,
        );
      }
      const gh = sweepSupport?.height ?? null;

      if (gh !== null && vNew < 0) {
        const fromAbove = y >= gh - PlayerController.LANDING_SNAP_BUFFER;
        const crossesOrTouchesTop = yNew <= gh + 1e-4;
        if (fromAbove && crossesOrTouchesTop) {
          landed = true;
          this.position.y = gh;
          this.verticalVelocity = 0;
          this.grounded = true;
          this.groundGraceTimer = PlayerController.GROUND_GRACE_TIME;
          if (wasAirborne && vNew < -2) {
            this.landingImpact = Math.max(
              this.landingImpact,
              THREE.MathUtils.clamp(-vNew / 12, 0, 1),
            );
            const speedRatio = THREE.MathUtils.clamp(
              this.horizontalVelocity.length() / Math.max(0.001, settings.movement.walkSpeed),
              0,
              settings.movement.runMultiplier,
            );
            const runBias = THREE.MathUtils.clamp(
              (speedRatio - 1) / Math.max(0.01, settings.movement.runMultiplier - 1),
              0,
              1,
            );
            const impactCarry = THREE.MathUtils.clamp(-vNew / 10, 0, 1);
            this.landingGlide = Math.max(
              this.landingGlide,
              THREE.MathUtils.lerp(0.16, 0.48, runBias) * impactCarry,
            );
          }
          break;
        }
      }

      y = yNew;
      v = vNew;
      timeLeft -= h;
    }

    /** Large `delta` spikes (tab focus, hitch): finish remaining time in one slice so state stays consistent. */
    if (!landed && timeLeft > 1e-8) {
      const g = v > 0 ? 11.9 : 15.6;
      const h = timeLeft;
      const vNew = v - g * h;
      const yNew = y + vNew * h;
      const sweepProbeMaxY = Math.max(y, yNew) + 0.45;
      let sweepSupport = getGroundSupportAt(px, pz, supportRadius, sweepProbeMaxY);
      if (sweepSupport === null) {
        sweepSupport = getGroundSupportAt(
          px,
          pz,
          this.collisionRadius * PlayerController.GROUND_SUPPORT_RADIUS_BOOST,
          sweepProbeMaxY,
        );
      }
      const gh = sweepSupport?.height ?? null;
      if (gh !== null && vNew < 0) {
        const fromAbove = y >= gh - PlayerController.LANDING_SNAP_BUFFER;
        const crossesOrTouchesTop = yNew <= gh + 1e-4;
        if (fromAbove && crossesOrTouchesTop) {
          landed = true;
          this.position.y = gh;
          this.verticalVelocity = 0;
          this.grounded = true;
          this.groundGraceTimer = PlayerController.GROUND_GRACE_TIME;
          if (wasAirborne && vNew < -2) {
            this.landingImpact = Math.max(
              this.landingImpact,
              THREE.MathUtils.clamp(-vNew / 12, 0, 1),
            );
            const speedRatio = THREE.MathUtils.clamp(
              this.horizontalVelocity.length() / Math.max(0.001, settings.movement.walkSpeed),
              0,
              settings.movement.runMultiplier,
            );
            const runBias = THREE.MathUtils.clamp(
              (speedRatio - 1) / Math.max(0.01, settings.movement.runMultiplier - 1),
              0,
              1,
            );
            const impactCarry = THREE.MathUtils.clamp(-vNew / 10, 0, 1);
            this.landingGlide = Math.max(
              this.landingGlide,
              THREE.MathUtils.lerp(0.16, 0.48, runBias) * impactCarry,
            );
          }
        }
      }
      if (!landed) {
        y = yNew;
        v = vNew;
      }
    }

    if (!landed) {
      this.position.y = y;
      this.verticalVelocity = v;
    }

    return landed;
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
