const DEADZONE = 0.14;

/** Zero inside deadzone; remap remainder to full [-1, 1] so X/Y use the same effective range. */
const applyDeadzone = (value: number): number => {
  const a = Math.abs(value);
  if (a < DEADZONE) {
    return 0;
  }
  const sign = value < 0 ? -1 : 1;
  const remapped = (a - DEADZONE) / (1 - DEADZONE);
  return sign * Math.min(1, remapped);
};

interface ButtonState {
  pressed: boolean;
  justPressed: boolean;
}

export interface GamepadSnapshot {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  run: boolean;
  jump: ButtonState;
  interact: ButtonState;
  /** Primary attack / sword (e.g. RT on Standard gamepad mapping in many browsers). */
  primaryAttack: ButtonState;
  toggleEditor: ButtonState;
}

const createButtonState = (): ButtonState => ({
  pressed: false,
  justPressed: false,
});

export class GamepadController {
  private activeIndex: number | null = null;
  private previousButtonStates = new Map<number, boolean>();

  update(): GamepadSnapshot {
    const snapshot: GamepadSnapshot = {
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      run: false,
      jump: createButtonState(),
      interact: createButtonState(),
      primaryAttack: createButtonState(),
      toggleEditor: createButtonState(),
    };

    const pads = navigator.getGamepads?.() ?? [];
    const gamepad = this.getActiveGamepad(pads);

    if (!gamepad) {
      this.previousButtonStates.clear();
      return snapshot;
    }

    const [leftX = 0, leftY = 0, rightX = 0, rightY = 0] = gamepad.axes;
    snapshot.moveX = applyDeadzone(leftX);
    snapshot.moveY = applyDeadzone(-leftY);
    snapshot.lookX = applyDeadzone(rightX);
    snapshot.lookY = applyDeadzone(rightY);
    snapshot.run = (gamepad.buttons[6]?.value ?? 0) > 0.2;

    snapshot.jump = this.readButton(gamepad, 0);
    snapshot.interact = this.readButton(gamepad, 2);
    snapshot.primaryAttack = this.readButton(gamepad, 7);
    snapshot.toggleEditor = this.readButton(gamepad, 9);

    return snapshot;
  }

  private getActiveGamepad(gamepads: readonly (Gamepad | null)[]): Gamepad | null {
    if (this.activeIndex !== null) {
      const existing = gamepads[this.activeIndex];
      if (existing?.connected) {
        return existing;
      }
    }

    const next = gamepads.find((pad) => pad?.connected) ?? null;
    this.activeIndex = next?.index ?? null;
    return next;
  }

  private readButton(gamepad: Gamepad, index: number): ButtonState {
    const pressed = gamepad.buttons[index]?.pressed ?? false;
    const previous = this.previousButtonStates.get(index) ?? false;
    this.previousButtonStates.set(index, pressed);

    return {
      pressed,
      justPressed: pressed && !previous,
    };
  }
}
