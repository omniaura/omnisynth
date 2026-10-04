declare module "hydra-synth" {
  interface HydraOptions {
    canvas?: HTMLCanvasElement;
    width?: number;
    height?: number;
    autoLoop?: boolean;
    makeGlobal?: boolean;
    detectAudio?: boolean;
    enableStreamCapture?: boolean;
    numSources?: number;
    numOutputs?: number;
    precision?: "lowp" | "mediump" | "highp";
  }
  export default class Hydra {
    constructor(options?: HydraOptions);
    synth: Record<string, unknown> & { hush(): void; render(o?: unknown): void };
    setResolution(width: number, height: number): void;
    tick(dt: number): void;
  }
}
