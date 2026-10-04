import { onMount, onCleanup, createEffect } from "solid-js";
import type Hydra from "hydra-synth";
import { engine } from "../engine/engine";
import { store } from "../stores/app";

/**
 * Full-window Hydra canvas. Visual code from the store (user- or agent-written)
 * is evaluated against Hydra's synth with an `a.fft` object we drive from the
 * engine's AnalyserNode (4 bands, 0..1), so sketches react to the music.
 */

interface HydraSynth {
  [fn: string]: unknown;
  render: (o?: unknown) => void;
  hush: () => void;
}

export default function HydraCanvas(props: { onError: (msg: string | null) => void }) {
  let canvasRef: HTMLCanvasElement | undefined;
  let hydra: Hydra | null = null;
  let raf = 0;
  const audio = { fft: [0, 0, 0, 0], level: 0 };
  const bins = new Uint8Array(256);

  function tickAudio(): void {
    const node = engine.analyserNode;
    if (node) {
      node.getByteFrequencyData(bins);
      // Split the spectrum into 4 log-ish bands: bass, low-mid, high-mid, treble.
      const ranges: Array<[number, number]> = [
        [1, 6],
        [6, 24],
        [24, 80],
        [80, 200],
      ];
      let total = 0;
      ranges.forEach(([lo, hi], i) => {
        let sum = 0;
        for (let k = lo; k < hi; k++) sum += bins[k];
        const v = sum / (hi - lo) / 255;
        audio.fft[i] = audio.fft[i] * 0.6 + v * 0.4;
        total += v;
      });
      audio.level = total / 4;
    }
    raf = requestAnimationFrame(tickAudio);
  }

  onMount(async () => {
    if (!canvasRef) return;
    const HydraModule = await import("hydra-synth");
    const HydraClass = HydraModule.default;
    canvasRef.width = canvasRef.clientWidth;
    canvasRef.height = canvasRef.clientHeight;
    hydra = new HydraClass({
      canvas: canvasRef,
      detectAudio: false,
      enableStreamCapture: false,
      autoLoop: true,
      makeGlobal: false,
      numSources: 4,
      numOutputs: 4,
      precision: "mediump",
    });
    const ro = new ResizeObserver(() => {
      if (!canvasRef || !hydra) return;
      canvasRef.width = canvasRef.clientWidth;
      canvasRef.height = canvasRef.clientHeight;
      hydra.setResolution(canvasRef.width, canvasRef.height);
    });
    ro.observe(canvasRef);
    raf = requestAnimationFrame(tickAudio);
    evaluate(store.visuals());
    onCleanup(() => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    });
  });

  function evaluate(code: string): void {
    if (!hydra || !code.trim()) return;
    const synth = hydra.synth as unknown as HydraSynth;
    const names = ["osc", "solid", "gradient", "noise", "voronoi", "shape", "src", "o0", "o1", "o2", "o3", "s0", "s1", "s2", "s3", "render", "hush", "speed", "bpm", "width", "height", "mouse", "a", "level"];
    const values = names.map((n) => {
      if (n === "a") return audio;
      if (n === "level") return () => audio.level;
      const v = synth[n];
      return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(synth) : v;
    });
    try {
      // Reset outputs so stale chains don't keep rendering under the new sketch.
      synth.hush();
      const fn = new Function(...names, `"use strict";\n${code}`);
      fn(...values);
      props.onError(null);
    } catch (err) {
      console.error("Hydra eval error:", err);
      props.onError((err as Error).message);
    }
  }

  createEffect(() => evaluate(store.visuals()));

  return <canvas ref={canvasRef} class="hydra-canvas" />;
}
