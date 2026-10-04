import { onMount, onCleanup, createEffect } from "solid-js";
import type Hydra from "hydra-synth";

interface HydraCanvasProps {
  code: () => string;
  audioAnalyser: () => AnalyserNode | null;
  isFullscreen: () => boolean;
}

let hydraInstance: Hydra | null = null;

export function getHydraInstance(): Hydra | null {
  return hydraInstance;
}

export default function HydraCanvas(props: HydraCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined;

  onMount(async () => {
    if (!canvasRef) return;

    // Dynamic import for hydra-synth
    const HydraModule = await import("hydra-synth");
    const HydraClass = HydraModule.default;

    hydraInstance = new HydraClass({
      canvas: canvasRef,
      detectAudio: false,
      enableStreamCapture: false,
      autoLoop: true,
      makeGlobal: false,
      numSources: 4,
      numOutputs: 4,
    });

    // Set initial resolution
    const updateResolution = () => {
      if (hydraInstance && canvasRef) {
        hydraInstance.setResolution(canvasRef.width, canvasRef.height);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (canvasRef) {
        canvasRef.width = canvasRef.clientWidth;
        canvasRef.height = canvasRef.clientHeight;
        updateResolution();
      }
    });

    resizeObserver.observe(canvasRef);
    updateResolution();

    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  // Execute Hydra code when it changes
  createEffect(() => {
    const code = props.code();
    if (!hydraInstance || !code.trim()) return;

    try {
      // Create a function that has access to Hydra's synth object
      const synth = hydraInstance.synth;
      const evalCode = new Function(
        "osc",
        "solid",
        "gradient",
        "noise",
        "voronoi",
        "shape",
        "src",
        "o0",
        "o1",
        "o2",
        "o3",
        "s0",
        "s1",
        "s2",
        "s3",
        "render",
        "a",
        "time",
        "mouse",
        code
      );

      evalCode(
        synth.osc.bind(synth),
        synth.solid.bind(synth),
        synth.gradient.bind(synth),
        synth.noise.bind(synth),
        synth.voronoi.bind(synth),
        synth.shape.bind(synth),
        synth.src.bind(synth),
        synth.o0,
        synth.o1,
        synth.o2,
        synth.o3,
        synth.s0,
        synth.s1,
        synth.s2,
        synth.s3,
        synth.render.bind(synth),
        synth.a,
        synth.time,
        synth.mouse
      );
    } catch (err) {
      console.error("Hydra eval error:", err);
    }
  });

  // Connect audio analyser to Hydra
  createEffect(() => {
    const analyser = props.audioAnalyser();
    if (!hydraInstance || !analyser) return;

    // Set up audio reactivity
    const synth = hydraInstance.synth;
    if (synth.a) {
      synth.a.setSmooth(0.4);
      synth.a.setBins(4);
      // Connect the analyser
      synth.a.fft = analyser;
    }
  });

  return (
    <canvas
      ref={canvasRef}
      class="hydra-canvas"
      classList={{
        fullscreen: props.isFullscreen(),
      }}
    />
  );
}

