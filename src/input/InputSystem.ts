import * as THREE from 'three';
import type { GamepadSettings } from '../fx/FxSettings';
import { GamepadController } from './GamepadController';

export class InputSystem {
  private readonly pressedKeys = new Set<string>();
  private readonly gamepad = new GamepadController();
  private gamepadMoveX = 1;
  private gamepadMoveY = 1;

  private jumpQueued = false;
  private interactQueued = false;
  private primaryAttackQueued = false;
  private toggleEditorQueued = false;

  private readonly keyboardMove = new THREE.Vector2();
  private gamepadMove = new THREE.Vector2();
  private gamepadLook = new THREE.Vector2();
  private running = false;
  /** Right mouse held: zoom / aim (handled in App + camera). */
  private zoomAimHeld = false;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  /** Analog move multipliers; look rates are applied in `PlayerController` (rad/s). */
  setGamepadSettings(settings: GamepadSettings): void {
    this.gamepadMoveX = settings.moveSpeedX;
    this.gamepadMoveY = settings.moveSpeedY;
  }

  update(): void {
    const state = this.gamepad.update();

    this.gamepadMove.set(state.moveX * this.gamepadMoveX, state.moveY * this.gamepadMoveY);
    if (this.gamepadMove.lengthSq() > 1) {
      this.gamepadMove.normalize();
    }
    this.gamepadLook.set(state.lookX, state.lookY);
    this.running = this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight') || state.run;

    if (state.jump.justPressed) {
      this.jumpQueued = true;
    }

    if (state.interact.justPressed) {
      this.interactQueued = true;
    }

    if (state.primaryAttack.justPressed) {
      this.primaryAttackQueued = true;
    }

    if (state.toggleEditor.justPressed) {
      this.toggleEditorQueued = true;
    }
  }

  getMovementAxes(target = new THREE.Vector2()): THREE.Vector2 {
    this.keyboardMove.set(
      Number(this.pressedKeys.has('KeyD')) - Number(this.pressedKeys.has('KeyA')),
      Number(this.pressedKeys.has('KeyW')) - Number(this.pressedKeys.has('KeyS')),
    );

    if (this.keyboardMove.lengthSq() > 1) {
      this.keyboardMove.normalize();
    }

    target.copy(this.keyboardMove).add(this.gamepadMove);

    if (target.lengthSq() > 1) {
      target.normalize();
    }

    return target;
  }

  getLookAxes(target = new THREE.Vector2()): THREE.Vector2 {
    return target.copy(this.gamepadLook);
  }

  isRunning(): boolean {
    return this.running;
  }

  setZoomAimHeld(value: boolean): void {
    this.zoomAimHeld = value;
  }

  isZoomAimHeld(): boolean {
    return this.zoomAimHeld;
  }

  consumeJump(): boolean {
    const value = this.jumpQueued;
    this.jumpQueued = false;
    return value;
  }

  consumeInteract(): boolean {
    const value = this.interactQueued;
    this.interactQueued = false;
    return value;
  }

  queuePrimaryAttack(): void {
    this.primaryAttackQueued = true;
  }

  consumePrimaryAttack(): boolean {
    const value = this.primaryAttackQueued;
    this.primaryAttackQueued = false;
    return value;
  }

  consumeToggleEditor(): boolean {
    const value = this.toggleEditorQueued;
    this.toggleEditorQueued = false;
    return value;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    this.pressedKeys.add(event.code);

    if (event.repeat && event.code === 'KeyP') {
      event.preventDefault();
      return;
    }

    if (event.code === 'Space') {
      if (document.pointerLockElement) {
        event.preventDefault();
      }
      if (!event.repeat) {
        this.jumpQueued = true;
      }
    }

    if (event.code === 'KeyE') {
      this.interactQueued = true;
    }

    if (event.code === 'KeyP') {
      this.toggleEditorQueued = true;
      event.preventDefault();
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.pressedKeys.delete(event.code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }
}
