declare module 'three/webgpu' {
  import type { WebGLRenderer } from 'three';

  export class WebGPURenderer extends WebGLRenderer {
    constructor(parameters?: Record<string, unknown>);
    init(): Promise<void>;
  }

  export class RenderPipeline {
    constructor(renderer: WebGPURenderer, outputNode?: unknown);
    outputNode: unknown;
    outputColorTransform: boolean;
    needsUpdate: boolean;
    render(): void;
    dispose(): void;
  }
}

declare module 'three/tsl' {
  export const mix: (...args: any[]) => any;
  export const mrt: (...args: any[]) => any;
  export const normalView: any;
  export const output: any;
  export const pass: (...args: any[]) => any;
  export const saturation: (...args: any[]) => any;
  export const smoothstep: (...args: any[]) => any;
  export const uniform: <T = any>(value: T) => { value: T };
  export const uv: (...args: any[]) => any;
  export const vec2: (...args: any[]) => any;
  export const vec4: (...args: any[]) => any;
}

declare module 'three/addons/tsl/display/BloomNode.js' {
  export const bloom: (...args: any[]) => any;
}

declare module 'three/addons/tsl/display/GTAONode.js' {
  export const ao: (...args: any[]) => any;
}

declare module 'three/addons/capabilities/WebGPU.js' {
  const WebGPU: {
    isAvailable(): boolean;
    getErrorMessage(): HTMLDivElement;
  };

  export default WebGPU;
}

declare module 'three/addons/objects/Water2Mesh.js' {
  import type { BufferGeometry, Mesh, Texture, Vector2 } from 'three';

  export class WaterMesh extends Mesh {
    constructor(
      geometry: BufferGeometry,
      options?: {
        color?: string | number;
        flowDirection?: Vector2;
        flowSpeed?: number;
        reflectivity?: number;
        scale?: number;
        flowMap?: Texture | null;
        normalMap0: Texture;
        normalMap1: Texture;
      },
    );
  }
}
