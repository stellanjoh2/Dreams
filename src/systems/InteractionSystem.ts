import * as THREE from 'three';
import type { AudioSystem } from '../audio/AudioSystem';
import type { InputSystem } from '../input/InputSystem';
import type { UIManager } from '../ui/UIManager';
import { CrystalSystem } from './CrystalSystem';

export class InteractionSystem {
  private readonly queryPosition = new THREE.Vector3();
  private readonly crystals: CrystalSystem;
  private readonly ui: UIManager;
  private readonly audio: AudioSystem;

  constructor(
    crystals: CrystalSystem,
    ui: UIManager,
    audio: AudioSystem,
  ) {
    this.crystals = crystals;
    this.ui = ui;
    this.audio = audio;
  }

  update(cameraPosition: THREE.Vector3, input: InputSystem): void {
    this.queryPosition.copy(cameraPosition);
    this.queryPosition.y = 0.85;

    const nearest = this.crystals.getNearestCrystal(this.queryPosition, 2.35);

    if (!nearest) {
      input.consumeInteract();
      this.ui.setInteractionPrompt(null);
      return;
    }

    this.ui.setInteractionPrompt('<kbd>E</kbd>Collect crystal');

    if (input.consumeInteract()) {
      this.crystals.collect(nearest);
      this.audio.playCrystalPickup();
      this.ui.flashCrystalMessage('Crystal shimmer');
      this.ui.setInteractionPrompt(null);
    }
  }
}
