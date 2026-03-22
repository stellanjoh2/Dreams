const DEADZONE = 0.16;

const clampAxis = (value: number): number => {
  if (Math.abs(value) < DEADZONE) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
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
      toggleEditor: createButtonState(),
    };

    const pads = navigator.getGamepads?.() ?? [];
    const gamepad = this.getActiveGamepad(pads);

    if (!gamepad) {
      this.previousButtonStates.clear();
      return snapshot;
    }

    const [leftX = 0, leftY = 0, rightX = 0, rightY = 0] = gamepad.axes;
    snapshot.moveX = clampAxis(leftX);
    snapshot.moveY = clampAxis(-leftY);
    snapshot.lookX = clampAxis(rightX);
    snapshot.lookY = clampAxis(rightY);
    snapshot.run = (gamepad.buttons[6]?.value ?? 0) > 0.2;

    snapshot.jump = this.readButton(gamepad, 0);
    snapshot.interact = this.readButton(gamepad, 2);
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
