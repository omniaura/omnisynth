import { onMount, onCleanup, createEffect } from "solid-js";
import type Hydra from "hydra-synth";
import { engine } from "../engine/engine";
import { store } from "../stores/app";
import { strudel } from "../engine/strudel";

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
    if (strudel.selected() === "strudel") {
      const bands = strudel.status().bands;
      bands.forEach((band, i) => { audio.fft[i] = audio.fft[i] * 0.6 + band * 0.4; });
      audio.level = strudel.status().rms;
      raf = requestAnimationFrame(tickAudio);
      return;
    }
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
      engine.setAudioBands(audio.fft);
    }
    raf = requestAnimationFrame(tickAudio);
  }

  onMount(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    onCleanup(() => {
      disposed = true;
      ro?.disconnect();
      cancelAnimationFrame(raf);
    });

    void (async () => {
      const canvas = canvasRef;
      if (!canvas) return;
      const HydraModule = await import("hydra-synth");
      const HydraClass = HydraModule.default;
      if (disposed) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      hydra = new HydraClass({
        canvas,
        detectAudio: false,
        enableStreamCapture: false,
        autoLoop: true,
        makeGlobal: false,
        numSources: 4,
        numOutputs: 4,
        precision: "mediump",
      });
      ro = new ResizeObserver(() => {
        if (!hydra) return;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        hydra.setResolution(canvas.width, canvas.height);
      });
      ro.observe(canvas);
      raf = requestAnimationFrame(tickAudio);
      evaluate(store.visuals());
    })().catch((error) => props.onError((error as Error).message));
  });

  function evaluate(code: string): void {
    if (!hydra) return;
    if (!code.trim()) {
      props.onError(null);
      return;
    }
    const synth = hydra.synth as unknown as HydraSynth;
    // Sketches run inside `with (scope)`: Hydra sources/outputs are bound to
    // the synth, while `time`, `bpm`, `a` and `level` resolve live on every
    // frame so `() => Math.sin(time)` keeps working after evaluation.
    const live: Record<string, () => unknown> = {
      time: () => synth.time,
      bpm: () => synth.bpm,
      width: () => synth.width,
      height: () => synth.height,
      mouse: () => synth.mouse,
      a: () => audio,
      level: () => () => audio.level,
    };
    const scope = new Proxy(Object.create(null) as Record<string, unknown>, {
      has: (_t, key) => typeof key === "string" && (key in live || key in synth) && !(key in globalThis),
      get: (_t, key) => {
        if (typeof key !== "string") return undefined;
        if (key in live) return live[key]();
        const v = synth[key];
        return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(synth) : v;
      },
    });
    try {
      // Reset outputs so stale chains don't keep rendering under the new sketch.
      synth.hush();
      const fn = new Function("scope", `with (scope) {\n${code}\n}`);
      fn(scope);
      props.onError(null);
    } catch (err) {
      console.error("Hydra eval error:", err);
      props.onError((err as Error).message);
    }
  }

  createEffect(() => evaluate(store.visuals()));

  return <canvas ref={canvasRef} class="hydra-canvas" />;
}
