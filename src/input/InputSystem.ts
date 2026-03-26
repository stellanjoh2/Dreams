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
  private toggleWeaponHiddenQueued = false;
  private toggleFreeFlightQueued = false;
  private toggleEditorQueued = false;

  private readonly keyboardMove = new THREE.Vector2();
  private gamepadMove = new THREE.Vector2();
  private gamepadLook = new THREE.Vector2();
  private running = false;
  /** Right mouse held: zoom / aim (handled in App + camera). */
  private zoomAimHeld = false;

  private static readonly keyListenerOpts: AddEventListenerOptions = { capture: true };

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('keydown', this.handleKeyDown, InputSystem.keyListenerOpts);
    window.addEventListener('keyup', this.handleKeyUp, InputSystem.keyListenerOpts);
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

    if (state.toggleWeaponHidden.justPressed) {
      this.toggleWeaponHiddenQueued = true;
    }

    if (state.toggleFreeFlight.justPressed) {
      this.toggleFreeFlightQueued = true;
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

  consumeToggleWeaponHidden(): boolean {
    const value = this.toggleWeaponHiddenQueued;
    this.toggleWeaponHiddenQueued = false;
    return value;
  }

  consumeToggleFreeFlight(): boolean {
    const value = this.toggleFreeFlightQueued;
    this.toggleFreeFlightQueued = false;
    return value;
  }

  /** Space up, Ctrl down — used only in free-flight mode (does not consume jump). */
  getFreeFlightVerticalAxis(): number {
    let v = 0;
    if (this.pressedKeys.has('Space')) {
      v += 1;
    }
    if (this.pressedKeys.has('ControlLeft') || this.pressedKeys.has('ControlRight')) {
      v -= 1;
    }
    return v;
  }

  /** Avoid buffered actions firing when returning to the player from free flight. */
  clearTransientActionQueuesForFreeFlight(): void {
    this.jumpQueued = false;
    this.interactQueued = false;
    this.primaryAttackQueued = false;
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

    if (event.code === 'KeyH' && !event.repeat) {
      if (!this.shouldIgnoreGameKeyTarget(event.target)) {
        this.toggleWeaponHiddenQueued = true;
      }
    }

    if (event.code === 'KeyF' && !event.repeat) {
      if (!this.shouldIgnoreGameKeyTarget(event.target)) {
        event.preventDefault();
        this.toggleFreeFlightQueued = true;
      }
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.pressedKeys.delete(event.code);
  }

  /** Don’t steal keys from range inputs / the FX editor fields. */
  private shouldIgnoreGameKeyTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) {
      return false;
    }
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
      return true;
    }
    return Boolean(el.isContentEditable);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown, InputSystem.keyListenerOpts);
    window.removeEventListener('keyup', this.handleKeyUp, InputSystem.keyListenerOpts);
  }
}
