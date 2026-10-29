import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

/** GPU framebuffer cap. The canvas still fills the window; pixels above this are not shaded. */
const MAX_RENDER_WIDTH = 1920;
const MAX_RENDER_HEIGHT = 1080;

export class RendererCore {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGPURenderer;
  private readonly container: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private readonly handleViewportResize: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-canvas';
    this.canvas.setAttribute('aria-label', 'Candy Lands viewport');

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });

    this.handleViewportResize = () => {
      this.syncSize();
    };
  }

  async init(): Promise<void> {
    this.container.append(this.canvas);

    await this.renderer.init();

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;

    this.resize();

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleViewportResize);
    window.addEventListener('fullscreenchange', this.handleViewportResize);
    window.visualViewport?.addEventListener('resize', this.handleViewportResize);
  }

  resize(): void {
    this.syncSize();
  }

  syncSize(): { width: number; height: number; changed: boolean } {
    const viewport = window.visualViewport;
    const width = Math.max(
      1,
      Math.floor(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1),
    );
    const height = Math.max(
      1,
      Math.floor(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1),
    );
    // Logical size stays the window (camera aspect, lens flare). Pixel ratio
    // shrinks so the drawing buffer fits inside 1920×1080, keeping aspect.
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      MAX_RENDER_WIDTH / width,
      MAX_RENDER_HEIGHT / height,
    );
    const changed =
      width !== this.width || height !== this.height || Math.abs(pixelRatio - this.pixelRatio) > 0.001;

    if (changed) {
      this.width = width;
      this.height = height;
      this.pixelRatio = pixelRatio;

      this.renderer.setDrawingBufferSize(width, height, pixelRatio);
    }

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissor(0, 0, width, height);
    this.renderer.setScissorTest(false);
    this.renderer.setClearAlpha(1);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    return { width, height, changed };
  }

  prepareFrame(): void {
    if (this.width === 0 || this.height === 0) {
      this.syncSize();
    }

    const width = this.width;
    const height = this.height;

    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissor(0, 0, width, height);
    this.renderer.setScissorTest(false);
    this.renderer.setClearAlpha(1);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleViewportResize);
    window.removeEventListener('fullscreenchange', this.handleViewportResize);
    window.visualViewport?.removeEventListener('resize', this.handleViewportResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
