import { APP_TITLE } from '../config/defaults';

export class UIManager {
  readonly shell: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  readonly fxMount: HTMLDivElement;
  readonly editorMount: HTMLDivElement;
  readonly startButton: HTMLButtonElement;
  private readonly root: HTMLElement;

  private readonly hudLayer: HTMLDivElement;
  private readonly overlayLayer: HTMLDivElement;
  private readonly underwaterOverlay: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly startCard: HTMLDivElement;
  private readonly unsupportedCard: HTMLDivElement;
  private readonly hudStatus: HTMLDivElement;
  private readonly hudRenderer: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.shell = document.createElement('div');
    this.shell.className = 'app-shell';

    this.viewport = document.createElement('div');
    this.viewport.className = 'viewport';

    this.fxMount = document.createElement('div');
    this.fxMount.className = 'lens-flare-layer';

    this.underwaterOverlay = document.createElement('div');
    this.underwaterOverlay.className = 'underwater-overlay';

    this.hudLayer = document.createElement('div');
    this.hudLayer.className = 'hud-layer';

    const topLeft = document.createElement('div');
    topLeft.className = 'hud-corner hud-corner--top-left';
    topLeft.innerHTML = `
      <div class="hud-eyebrow">Visual Tech Demo</div>
      <div class="hud-title">${APP_TITLE}</div>
      <div class="hud-copy">A dreamy WebGPU first-person world built with Three.js.</div>
    `;

    const topRight = document.createElement('div');
    topRight.className = 'hud-corner hud-corner--top-right';

    this.hudRenderer = document.createElement('div');
    this.hudRenderer.className = 'hud-pill';
    this.hudRenderer.textContent = 'WebGPU';

    this.hudStatus = document.createElement('div');
    this.hudStatus.className = 'hud-status';
    this.hudStatus.textContent =
      'WASD move, mouse look, Space jump, E collect, Shift drift faster, P tune FX.';

    topRight.append(this.hudRenderer, this.hudStatus);

    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';

    this.prompt = document.createElement('div');
    this.prompt.className = 'interaction-prompt';

    this.flash = document.createElement('div');
    this.flash.className = 'flash-message';
    this.flash.textContent = 'Crystal resonance';

    this.hudLayer.append(topLeft, topRight, crosshair, this.prompt, this.flash);

    this.overlayLayer = document.createElement('div');
    this.overlayLayer.className = 'overlay-layer';

    this.startCard = document.createElement('div');
    this.startCard.className = 'start-card';
    this.startCard.innerHTML = `
      <h1>Enter Candy Lands</h1>
      <p>
        Walk through a surreal pastel desert, soak in the light, and collect crystals if you feel
        like it. This build is WebGPU-only and tuned for a calm first-person vibe.
      </p>
      <div class="start-actions">
        <button class="start-button" type="button">Click To Start</button>
        <div class="editor-hint"><kbd>P</kbd> opens the hidden FX panel.</div>
      </div>
    `;

    this.startButton = this.startCard.querySelector<HTMLButtonElement>('.start-button')!;

    this.unsupportedCard = document.createElement('div');
    this.unsupportedCard.className = 'unsupported-card';
    this.unsupportedCard.hidden = true;
    this.unsupportedCard.innerHTML = `
      <h1>WebGPU Required</h1>
      <p>
        Candy Lands currently targets modern WebGPU browsers only. Try the latest Chrome, Edge,
        or another browser with WebGPU enabled.
      </p>
    `;

    this.editorMount = document.createElement('div');
    this.editorMount.className = 'editor-layer';

    this.overlayLayer.append(this.startCard, this.unsupportedCard);
    this.shell.append(
      this.viewport,
      this.fxMount,
      this.underwaterOverlay,
      this.hudLayer,
      this.overlayLayer,
      this.editorMount,
    );
    this.root.append(this.shell);
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.viewport.append(canvas);
  }

  showUnsupported(): void {
    this.setChromeVisible(true);
    this.startCard.hidden = true;
    this.unsupportedCard.hidden = false;
  }

  setPointerLocked(locked: boolean): void {
    this.startCard.hidden = locked;
    this.hudStatus.textContent = locked
      ? 'WASD move, mouse look, Space jump, E collect, Shift drift faster, P tune FX.'
      : 'Paused. Click to re-enter the desert.';
  }

  setRendererInfo(text: string): void {
    this.hudRenderer.textContent = text;
  }

  setInteractionPrompt(message: string | null): void {
    if (!message) {
      this.prompt.classList.remove('is-visible');
      this.prompt.innerHTML = '';
      return;
    }

    this.prompt.innerHTML = message;
    this.prompt.classList.add('is-visible');
  }

  flashCrystalMessage(text = 'Crystal resonance'): void {
    this.flash.textContent = text;
    this.flash.classList.add('is-visible');

    window.setTimeout(() => {
      this.flash.classList.remove('is-visible');
    }, 1000);
  }

  setUnderwaterDepth(depth: number): void {
    const opacity = Math.min(0.88, Math.max(0, depth * 0.42));
    this.underwaterOverlay.style.opacity = opacity.toFixed(3);
  }

  setChromeVisible(visible: boolean): void {
    this.hudLayer.hidden = !visible;
    this.overlayLayer.hidden = !visible;
  }
}
