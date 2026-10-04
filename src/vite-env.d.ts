/// <reference types="vite/client" />

declare module "hydra-synth" {
  interface HydraOptions {
    canvas?: HTMLCanvasElement;
    detectAudio?: boolean;
    enableStreamCapture?: boolean;
    autoLoop?: boolean;
    makeGlobal?: boolean;
    numSources?: number;
    numOutputs?: number;
    width?: number;
    height?: number;
  }

  interface HydraSynth {
    osc: (freq?: number, sync?: number, offset?: number) => HydraSource;
    solid: (r?: number, g?: number, b?: number, a?: number) => HydraSource;
    gradient: (speed?: number) => HydraSource;
    noise: (scale?: number, offset?: number) => HydraSource;
    voronoi: (scale?: number, speed?: number, blending?: number) => HydraSource;
    shape: (sides?: number, radius?: number, smoothing?: number) => HydraSource;
    src: (texture: HydraOutput) => HydraSource;
    render: (output?: HydraOutput) => void;
    o0: HydraOutput;
    o1: HydraOutput;
    o2: HydraOutput;
    o3: HydraOutput;
    s0: HydraSource;
    s1: HydraSource;
    s2: HydraSource;
    s3: HydraSource;
    a: {
      fft: number[];
      setSmooth: (val: number) => void;
      setBins: (count: number) => void;
    };
    time: number;
    mouse: { x: number; y: number };
  }

  interface HydraSource {
    out: (output?: HydraOutput) => void;
    color: (r?: number, g?: number, b?: number, a?: number) => HydraSource;
    rotate: (angle?: number, speed?: number) => HydraSource;
    scale: (amount?: number, xMult?: number, yMult?: number) => HydraSource;
    scrollX: (amount?: number, speed?: number) => HydraSource;
    scrollY: (amount?: number, speed?: number) => HydraSource;
    kaleid: (nSides?: number) => HydraSource;
    pixelate: (x?: number, y?: number) => HydraSource;
    repeat: (x?: number, y?: number, offsetX?: number, offsetY?: number) => HydraSource;
    modulate: (texture: HydraSource, amount?: number) => HydraSource;
    modulateScale: (texture: HydraSource, multiple?: number, offset?: number) => HydraSource;
    modulateRotate: (texture: HydraSource, multiple?: number, offset?: number) => HydraSource;
    add: (texture: HydraSource, amount?: number) => HydraSource;
    mult: (texture: HydraSource, amount?: number) => HydraSource;
    blend: (texture: HydraSource, amount?: number) => HydraSource;
    diff: (texture: HydraSource) => HydraSource;
    layer: (texture: HydraSource) => HydraSource;
    mask: (texture: HydraSource) => HydraSource;
    saturate: (amount?: number) => HydraSource;
    hue: (amount?: number) => HydraSource;
    brightness: (amount?: number) => HydraSource;
    contrast: (amount?: number) => HydraSource;
    invert: (amount?: number) => HydraSource;
    luma: (threshold?: number, tolerance?: number) => HydraSource;
    thresh: (threshold?: number, tolerance?: number) => HydraSource;
    posterize: (bins?: number, gamma?: number) => HydraSource;
    colorama: (amount?: number) => HydraSource;
  }

  interface HydraOutput {}

  export default class Hydra {
    synth: HydraSynth;
    constructor(options?: HydraOptions);
    setResolution(width: number, height: number): void;
  }
}
