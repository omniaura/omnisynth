import * as Tone from "tone";
import { DRUM_INSTRUMENTS, INSTRUMENT_PRESETS, MEMBRANE_INSTRUMENTS, MONO_TYPES, type EffectConfig, type Patch, type SynthType } from "./presets";
import { expandToBars, parseSteps, stepFires, stepsPerBar, type Pattern, type Step, type Subdivision } from "./patterns";
import { ModMatrix, type Automation, type Modulation, type ParamHandle } from "./modulation";
import { applyOp, constrain, parseRules, type EvolveContext, type EvolveRule } from "./evolution";

/**
 * The OmniSynth audio engine: Tone.js transport, tracks (step-sequenced
 * instruments with their own FX chains), master bus FX, sections with their
 * own time signature / tempo, an addressable parameter graph, a mod matrix,
 * bar-synced automation and the evolution engine. UI and agent tools both
 * talk to this class only.
 */

export interface TrackConfig {
  id: string;
  name: string;
  instrument: string;
  /** dB, -60..6 */
  volume: number;
  pan?: number;
  pattern: Pattern;
  /** Track-level FX chain (after the patch's own effects). */
  fx?: EffectConfig[];
}

export interface Section {
  id: string;
  name: string;
  bars: number;
  /** Optional per-section meter and tempo; falls back to the song's. */
  timeSignature?: [number, number];
  bpm?: number;
  /** Per-track pattern override for this section (trackId -> steps). */
  trackPatterns: Record<string, Step[]>;
}

type SynthNode = Tone.ToneAudioNode & {
  triggerAttackRelease?: (...args: unknown[]) => unknown;
  get?: () => Record<string, unknown>;
  set?: (opts: Record<string, unknown>) => unknown;
  portamento?: number;
};

interface Track {
  config: TrackConfig;
  synth: SynthNode;
  /** Patch effects followed by track effects. */
  effects: Tone.ToneAudioNode[];
  patchFxCount: number;
  panner: Tone.Panner;
  channel: Tone.Volume;
  meter: Tone.Meter;
  playbackError: string | null;
  loop: Tone.Loop;
  current: Pattern;
  /** Pattern the track was created with (evolution seed / reset). */
  seed: Step[];
  muted: boolean;
  solo: boolean;
  stepIndex: number;
  rules: EvolveRule[];
  isDrum: boolean;
  isMembrane: boolean;
  isMetal: boolean;
  isNoise: boolean;
}

export interface TrackState {
  isDrum: boolean;
  id: string;
  name: string;
  instrument: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  pattern: Pattern;
  stepCount: number;
  fx: EffectConfig[];
  rules: EvolveRule[];
  modCount: number;
}

export interface SongState {
  bpm: number;
  timeSignature: [number, number];
  key: string;
  scale: string;
  isPlaying: boolean;
  tracks: TrackState[];
  sections: Array<{ id: string; name: string; bars: number; timeSignature?: [number, number]; bpm?: number; trackIds: string[] }>;
  arrangement: string[];
  currentSectionIndex: number;
  currentSection: string | null;
  currentBar: number;
  totalBars: number;
  customPatches: Array<{ id: string; type: SynthType; effects: EffectConfig[] }>;
  masterFx: EffectConfig[];
  modulations: Modulation[];
  automations: Automation[];
  macros: Record<string, number>;
}

export interface SongFile {
  version: 3;
  name?: string;
  timestamp: number;
  bpm: number;
  timeSignature: [number, number];
  key: string;
  scale: string;
  tracks: Array<TrackConfig & { muted?: boolean; rules?: EvolveRule[]; seed?: Step[] }>;
  sections: Section[];
  arrangement: string[];
  customPatches: Array<Patch & { id: string }>;
  masterFx?: EffectConfig[];
  modulations?: Modulation[];
  automations?: Automation[];
  macros?: Record<string, number>;
  visuals?: string;
}

export interface EvolveEvent {
  trackId: string;
  ruleId: string;
  ops: string[];
  bar: number;
}

type Listener<T> = (payload: T) => void;

const PARAM_RANGES: Record<string, [number, number]> = {
  frequency: [20, 20000],
  baseFrequency: [20, 8000],
  Q: [0.1, 24],
  wet: [0, 1],
  feedback: [0, 0.95],
  volume: [-60, 6],
  pan: [-1, 1],
  detune: [-2400, 2400],
  distortion: [0, 1],
  depth: [0, 1],
  bits: [1, 16],
  delayTime: [0, 2],
  harmonicity: [0.1, 16],
  modulationIndex: [0, 100],
  decay: [0.01, 30],
  threshold: [-60, 0],
  ratio: [1, 20],
  knee: [0, 40],
  low: [-24, 24],
  mid: [-24, 24],
  high: [-24, 24],
  attack: [0.001, 8],
  sustain: [0, 1],
  release: [0.001, 12],
  portamento: [0, 1],
  resonance: [50, 8000],
  octaves: [0, 8],
  pitchDecay: [0.001, 1],
  spread: [0, 100],
  count: [1, 8],
  dampening: [100, 10000],
  attackNoise: [0.1, 20],
  bpm: [40, 300],
  gain: [0, 2],
};

function rangeFor(name: string): [number, number] {
  return PARAM_RANGES[name] ?? [0, 1];
}

export class AudioEngine {
  readonly tracks = new Map<string, Track>();
  readonly sections = new Map<string, Section>();
  arrangement: string[] = [];
  currentSectionIndex = 0;
  currentBar = 0;
  totalBars = 0;
  isPlaying = false;
  bpm = 120;
  timeSignature: [number, number] = [4, 4];
  key = "C";
  scale = "minor";

  private started = false;
  private master!: Tone.Gain;
  private masterFx: Tone.ToneAudioNode[] = [];
  private masterFxConfig: EffectConfig[] = [];
  private limiter!: Tone.Limiter;
  analyser: Tone.Analyser | null = null;
  /** Raw Web Audio analyser for visuals (Hydra consumes an AnalyserNode). */
  analyserNode: AnalyserNode | null = null;
  readonly mods: ModMatrix;
  private stepListeners: Listener<{ trackId: string; step: number }>[] = [];
  private changeListeners: Listener<SongState>[] = [];
  private sectionListeners: Listener<{ section: Section | null; index: number }>[] = [];
  private evolveListeners: Listener<EvolveEvent>[] = [];
  private barSteps = 0;
  private changeScheduled = false;

  constructor() {
    this.mods = new ModMatrix(
      (path) => this.resolveParam(path),
      (trackId) => this.tracks.get(trackId)?.channel ?? null,
    );
  }

  async init(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0.8);
    this.master.connect(this.limiter);
    this.analyser = new Tone.Analyser("fft", 256);
    this.master.connect(this.analyser);
    const ctx = Tone.getContext().rawContext as AudioContext;
    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 512;
    this.analyserNode.smoothingTimeConstant = 0.6;
    Tone.connect(this.master, this.analyserNode);
    Tone.getTransport().bpm.value = this.bpm;
    Tone.getTransport().timeSignature = this.timeSignature;
    this.started = true;
  }

  get ready(): boolean {
    return this.started;
  }

  // --- Events ---
  onStep(cb: Listener<{ trackId: string; step: number }>): () => void {
    this.stepListeners.push(cb);
    return () => (this.stepListeners = this.stepListeners.filter((l) => l !== cb));
  }
  onChange(cb: Listener<SongState>): () => void {
    this.changeListeners.push(cb);
    return () => (this.changeListeners = this.changeListeners.filter((l) => l !== cb));
  }
  onSectionChange(cb: Listener<{ section: Section | null; index: number }>): () => void {
    this.sectionListeners.push(cb);
    return () => (this.sectionListeners = this.sectionListeners.filter((l) => l !== cb));
  }
  onEvolve(cb: Listener<EvolveEvent>): () => void {
    this.evolveListeners.push(cb);
    return () => (this.evolveListeners = this.evolveListeners.filter((l) => l !== cb));
  }
  private emitChange(): void {
    // Coalesce bursts (evolution touching several tracks, bar ticks while the
    // UI is busy) into at most ~20 state snapshots per second.
    if (this.changeScheduled) return;
    this.changeScheduled = true;
    setTimeout(() => {
      this.changeScheduled = false;
      const state = this.getState();
      for (const l of this.changeListeners) l(state);
    }, 48);
  }

  /** Live audio bands from the visualizer (0..1), used by `band` mod sources. */
  setAudioBands(bands: number[]): void {
    this.mods.setBands(bands);
  }

  // --- Transport ---
  setBPM(bpm: number, ramp = 0.1): void {
    this.bpm = Math.max(40, Math.min(300, bpm));
    if (this.started) Tone.getTransport().bpm.rampTo(this.bpm, ramp);
    this.emitChange();
  }

  setTimeSignature(beats: number, unit: number): void {
    this.timeSignature = [beats, unit];
    if (this.started) Tone.getTransport().timeSignature = this.timeSignature;
    this.emitChange();
  }

  /** Meter currently in force (section override or song default). */
  activeTimeSignature(): [number, number] {
    return this.getCurrentSection()?.timeSignature ?? this.timeSignature;
  }

  setKey(key: string, scale: string): void {
    this.key = key;
    this.scale = scale;
    this.emitChange();
  }

  async play(): Promise<void> {
    await this.init();
    this.tracks.forEach((t) => {
      t.stepIndex = 0;
      t.loop.start(0);
    });
    this.currentBar = 0;
    this.barSteps = 0;
    this.applySectionPatterns();
    this.applySectionTransport();
    this.mods.start();
    Tone.getTransport().start("+0.05");
    this.isPlaying = true;
    this.emitChange();
  }

  stop(): void {
    if (!this.started) return;
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
    this.tracks.forEach((t) => {
      t.loop.stop();
      t.stepIndex = 0;
    });
    this.mods.stop();
    this.isPlaying = false;
    this.currentBar = 0;
    this.barSteps = 0;
    this.emitChange();
  }

  // --- Patches & effects ---
  private createSynth(instrument: string): SynthNode {
    const preset = INSTRUMENT_PRESETS[instrument];
    const ToneAny = Tone as unknown as Record<string, new (opts?: unknown) => Tone.ToneAudioNode>;
    if (!preset) {
      console.warn(`Unknown instrument "${instrument}", using default synth`);
      return new Tone.PolySynth(Tone.Synth) as unknown as SynthNode;
    }
    const Cls = ToneAny[preset.type];
    if (!Cls) return new Tone.PolySynth(Tone.Synth) as unknown as SynthNode;
    if (MONO_TYPES.has(preset.type)) return new Cls(preset.options) as unknown as SynthNode;
    const poly = new Tone.PolySynth(Cls as unknown as typeof Tone.Synth, preset.options as never);
    poly.maxPolyphony = 16;
    return poly as unknown as SynthNode;
  }

  private createEffect(fx: EffectConfig): Tone.ToneAudioNode | null {
    const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
    const wet = (node: { wet?: Tone.Signal<"normalRange"> }) => {
      if (fx.wet !== undefined && node.wet) node.wet.value = Math.max(0, Math.min(1, fx.wet));
    };
    switch (String(fx.type).toLowerCase()) {
      case "reverb":
        return new Tone.Reverb({ decay: num(fx.decay, 2.5), preDelay: num(fx.preDelay, 0.01), wet: num(fx.wet, 0.3) });
      case "delay":
      case "feedbackdelay": {
        const n = new Tone.FeedbackDelay((fx.delayTime as string) ?? "8n", num(fx.feedback, 0.3));
        wet(n);
        return n;
      }
      case "pingpong": {
        const n = new Tone.PingPongDelay((fx.delayTime as string) ?? "8n", num(fx.feedback, 0.3));
        wet(n);
        return n;
      }
      case "chorus": {
        const n = new Tone.Chorus(num(fx.frequency, 1.5), num(fx.delayTime, 3.5), num(fx.depth, 0.7)).start();
        wet(n);
        return n;
      }
      case "distortion": {
        const n = new Tone.Distortion(num(fx.distortion, 0.4));
        wet(n);
        return n;
      }
      case "chebyshev":
      case "saturation": {
        const n = new Tone.Chebyshev(Math.max(1, Math.round(num(fx.order, 3))));
        wet({ wet: n.wet });
        if (fx.wet === undefined) n.wet.value = 0.3;
        return n;
      }
      case "phaser": {
        const n = new Tone.Phaser({ frequency: num(fx.frequency, 0.5), octaves: num(fx.octaves, 3), baseFrequency: num(fx.baseFrequency, 350) });
        wet(n);
        return n;
      }
      case "tremolo": {
        const n = new Tone.Tremolo(num(fx.frequency, 9), num(fx.depth, 0.75)).start();
        wet(n);
        return n;
      }
      case "vibrato": {
        const n = new Tone.Vibrato(num(fx.frequency, 5), num(fx.depth, 0.1));
        wet(n);
        return n;
      }
      case "bitcrusher": {
        const n = new Tone.BitCrusher(num(fx.bits, 4));
        wet(n);
        return n;
      }
      case "autofilter": {
        const n = new Tone.AutoFilter({ frequency: (fx.frequency as string | number) ?? "4n", baseFrequency: num(fx.baseFrequency, 200), octaves: num(fx.octaves, 4), depth: num(fx.depth, 1) }).start();
        wet(n);
        return n;
      }
      case "autopanner": {
        const n = new Tone.AutoPanner({ frequency: (fx.frequency as string | number) ?? "4n", depth: num(fx.depth, 1) }).start();
        wet(n);
        return n;
      }
      case "autowah": {
        const n = new Tone.AutoWah(num(fx.baseFrequency, 100), num(fx.octaves, 6), num(fx.sensitivity, 0));
        wet(n);
        return n;
      }
      case "freeverb": {
        const n = new Tone.Freeverb(num(fx.roomSize, 0.7), num(fx.dampening, 3000));
        wet(n);
        return n;
      }
      case "stereowidener": {
        const n = new Tone.StereoWidener(num(fx.width, 0.75));
        return n;
      }
      case "pitchshift": {
        const n = new Tone.PitchShift({ pitch: num(fx.pitch, 0), windowSize: num(fx.windowSize, 0.1), feedback: num(fx.feedback, 0) });
        wet(n);
        return n;
      }
      case "eq":
      case "eq3":
        return new Tone.EQ3({ low: num(fx.low, 0), mid: num(fx.mid, 0), high: num(fx.high, 0), lowFrequency: num(fx.lowFrequency, 250), highFrequency: num(fx.highFrequency, 2500) });
      case "compressor":
        return new Tone.Compressor({ threshold: num(fx.threshold, -24), ratio: num(fx.ratio, 4), attack: num(fx.attack, 0.003), release: num(fx.release, 0.25), knee: num(fx.knee, 30) });
      case "limiter":
        return new Tone.Limiter(num(fx.threshold, -1));
      case "gate":
        return new Tone.Gate(num(fx.threshold, -40), num(fx.smoothing, 0.1));
      case "filter":
        return new Tone.Filter({
          frequency: num(fx.frequency, 800),
          type: (fx.filterType as BiquadFilterType) ?? (fx.mode as BiquadFilterType) ?? "lowpass",
          Q: num(fx.Q, 1),
          rolloff: num(fx.rolloff, -12) as -12 | -24 | -48 | -96,
        });
      case "gain":
        return new Tone.Gain(num(fx.gain, 1));
      default:
        console.warn(`Unknown effect "${fx.type}" ignored`);
        return null;
    }
  }

  static readonly EFFECT_TYPES = [
    "reverb",
    "freeverb",
    "delay",
    "pingpong",
    "chorus",
    "vibrato",
    "distortion",
    "saturation",
    "phaser",
    "tremolo",
    "bitcrusher",
    "autofilter",
    "autopanner",
    "autowah",
    "stereowidener",
    "pitchshift",
    "eq",
    "compressor",
    "limiter",
    "gate",
    "filter",
    "gain",
  ];

  /** Registers a runtime patch so it can be used as an instrument. */
  createPatch(id: string, patch: Patch): Patch {
    INSTRUMENT_PRESETS[id] = { ...patch, custom: true, name: patch.name ?? id };
    for (const track of [...this.tracks.values()]) {
      if (track.config.instrument === id) this.rebuildTrack(track.config);
    }
    this.emitChange();
    return INSTRUMENT_PRESETS[id];
  }

  getPatch(id: string): Patch | undefined {
    return INSTRUMENT_PRESETS[id];
  }

  listInstruments(): string[] {
    return Object.keys(INSTRUMENT_PRESETS);
  }

  setMasterFx(chain: EffectConfig[]): void {
    if (!this.started) throw new Error("engine not started");
    this.masterFx.forEach((n) => n.dispose());
    this.master.disconnect();
    const nodes = chain.map((fx) => this.createEffect(fx)).filter((n): n is Tone.ToneAudioNode => n !== null);
    const path: Tone.ToneAudioNode[] = [this.master, ...nodes, this.limiter];
    for (let i = 0; i < path.length - 1; i++) path[i].connect(path[i + 1]);
    this.master.connect(this.analyser!);
    if (this.analyserNode) Tone.connect(this.master, this.analyserNode);
    this.masterFx = nodes;
    this.masterFxConfig = chain;
    this.mods.invalidate();
    this.emitChange();
  }

  setTrackFx(id: string, chain: EffectConfig[]): TrackState {
    const track = this.tracks.get(id);
    if (!track) throw new Error(`no track "${id}"`);
    this.rebuildTrack({ ...track.config, fx: chain });
    return this.trackState(this.tracks.get(id)!);
  }

  // --- Parameter graph ---
  /** Resolve "track.synth.filter.frequency", "track.fx.0.wet", "master.fx.1.threshold", "track.volume", "bpm". */
  resolveParam(path: string): ParamHandle | null {
    const parts = path.split(".");
    if (parts[0] === "bpm") {
      return { path, get: () => this.bpm, set: (v, r) => this.setBPM(v, r ?? 0.05), min: 40, max: 300, unit: "bpm" };
    }
    if (parts[0] === "master") {
      if (parts[1] === "volume") return this.signalHandle(path, this.master.gain as unknown as Tone.Signal<"number">, 0, 1.5);
      if (parts[1] === "fx") {
        const node = this.masterFx[Number(parts[2])];
        if (!node) return null;
        return this.nodeHandle(path, node, parts.slice(3));
      }
      return null;
    }
    const track = this.tracks.get(parts[0]);
    if (!track) return null;
    switch (parts[1]) {
      case "volume":
        return this.signalHandle(path, track.channel.volume as unknown as Tone.Signal<"number">, -60, 6, "dB", (v) => (track.config.volume = v));
      case "pan":
        return this.signalHandle(path, track.panner.pan as unknown as Tone.Signal<"number">, -1, 1, undefined, (v) => (track.config.pan = v));
      case "synth":
        return this.nodeHandle(path, track.synth, parts.slice(2));
      case "fx": {
        const node = track.effects[Number(parts[2])];
        if (!node) return null;
        return this.nodeHandle(path, node, parts.slice(3));
      }
      default:
        return null;
    }
  }

  private signalHandle(path: string, sig: Tone.Signal<"number">, min: number, max: number, unit?: string, mirror?: (v: number) => void): ParamHandle {
    return {
      path,
      signal: sig,
      min,
      max,
      unit,
      get: () => sig.value as number,
      set: (v, ramp) => {
        const c = Math.max(min, Math.min(max, v));
        if (ramp && ramp > 0) sig.rampTo(c, ramp);
        else sig.value = c;
        mirror?.(c);
      },
    };
  }

  /** Walks a Tone node by path; Signals/Params get audio-rate handles, option leaves go through node.set(). */
  private nodeHandle(path: string, node: Tone.ToneAudioNode, rest: string[]): ParamHandle | null {
    if (rest.length === 0) return null;
    const leaf = rest[rest.length - 1];
    const [min, max] = rangeFor(leaf);
    // 1. Direct object walk for Signals/Params (e.g. filter.frequency, wet, feedback, detune).
    let obj: unknown = node;
    for (const seg of rest) {
      if (obj && typeof obj === "object" && seg in (obj as Record<string, unknown>)) obj = (obj as Record<string, unknown>)[seg];
      else {
        obj = undefined;
        break;
      }
    }
    if (obj && typeof obj === "object" && "value" in (obj as Record<string, unknown>) && typeof (obj as { value: unknown }).value === "number") {
      return this.signalHandle(path, obj as Tone.Signal<"number">, min, max);
    }
    if (typeof obj === "number") {
      // Plain numeric property (e.g. Reverb.decay, PolySynth maxPolyphony); set via node.set when possible.
      const holder = node as unknown as { set?: (o: Record<string, unknown>) => void; get?: () => Record<string, unknown> };
      return {
        path,
        min,
        max,
        get: () => Number(readPath(holder.get ? holder.get() : (node as unknown as Record<string, unknown>), rest) ?? 0),
        set: (v) => {
          const c = Math.max(min, Math.min(max, v));
          if (holder.set) holder.set(nest(rest, c));
          else writePath(node as unknown as Record<string, unknown>, rest, c);
        },
      };
    }
    // 2. Options path (PolySynth voice options such as envelope.attack, oscillator.spread).
    const holder = node as unknown as { set?: (o: Record<string, unknown>) => void; get?: () => Record<string, unknown> };
    if (holder.get && holder.set) {
      const opts = holder.get();
      const current = readPath(opts, rest);
      if (typeof current === "number") {
        return {
          path,
          min,
          max,
          get: () => Number(readPath(holder.get!(), rest) ?? 0),
          set: (v) => holder.set!(nest(rest, Math.max(min, Math.min(max, v)))),
        };
      }
    }
    return null;
  }

  /** Enumerate addressable parameter paths with current values (for list_params). */
  listParams(trackId?: string): Array<{ path: string; value: number; min: number; max: number }> {
    const out: Array<{ path: string; value: number; min: number; max: number }> = [];
    const push = (path: string) => {
      const h = this.resolveParam(path);
      if (h) out.push({ path, value: round(h.get()), min: h.min, max: h.max });
    };
    const scanNode = (prefix: string, node: Tone.ToneAudioNode, depth = 0) => {
      const holder = node as unknown as { get?: () => Record<string, unknown> };
      const opts = holder.get ? safeGet(holder) : {};
      const walk = (o: Record<string, unknown>, p: string[], d: number) => {
        for (const [k, v] of Object.entries(o)) {
          if (k === "context" || k === "type" || k === "onsilence" || k === "curve") continue;
          if (typeof v === "number") push(`${prefix}.${[...p, k].join(".")}`);
          else if (v && typeof v === "object" && d < 2 && !Array.isArray(v)) walk(v as Record<string, unknown>, [...p, k], d + 1);
        }
      };
      walk(opts, [], depth);
      // Common signals not always in get(): wet, detune, frequency, Q, feedback, delayTime.
      for (const k of ["wet", "detune", "frequency", "Q", "feedback", "delayTime", "depth", "distortion", "threshold", "ratio", "low", "mid", "high", "harmonicity", "modulationIndex", "portamento"]) {
        if (k in (node as unknown as Record<string, unknown>) && !out.some((e) => e.path === `${prefix}.${k}`)) push(`${prefix}.${k}`);
      }
    };
    const ids = trackId ? [trackId] : [...this.tracks.keys()];
    for (const id of ids) {
      const t = this.tracks.get(id);
      if (!t) continue;
      push(`${id}.volume`);
      push(`${id}.pan`);
      scanNode(`${id}.synth`, t.synth);
      t.effects.forEach((fx, i) => scanNode(`${id}.fx.${i}`, fx));
    }
    if (!trackId) {
      push("bpm");
      push("master.volume");
      this.masterFx.forEach((fx, i) => scanNode(`master.fx.${i}`, fx));
    }
    return out;
  }

  setParam(path: string, value: number, ramp = 0.02): number {
    const h = this.resolveParam(path);
    if (!h) throw new Error(`unknown parameter "${path}"`);
    const c = Math.max(h.min, Math.min(h.max, value));
    h.set(c, ramp);
    this.emitChange();
    return c;
  }

  getParam(path: string): number {
    const h = this.resolveParam(path);
    if (!h) throw new Error(`unknown parameter "${path}"`);
    return h.get();
  }

  // --- Modulation / automation / macros ---
  addModulation(mod: Modulation): Modulation {
    if (!this.started) throw new Error("engine not started");
    const m = this.mods.add(mod);
    if (this.isPlaying) this.mods.start();
    this.emitChange();
    return m;
  }
  removeModulation(id: string): boolean {
    const ok = this.mods.remove(id);
    this.emitChange();
    return ok;
  }
  addAutomation(a: Automation): void {
    this.mods.addAutomation(a, this.totalBars);
    this.emitChange();
  }
  setMacro(name: string, value: number): void {
    this.mods.setMacro(name, value);
    this.emitChange();
  }

  // --- Tracks ---
  addTrack(config: TrackConfig): TrackState {
    if (!this.started) throw new Error("engine not started");
    const existing = this.tracks.get(config.id);
    const seed = existing?.seed ?? config.pattern.notes.map((s) => ({ ...s }));
    const rules = existing?.rules ?? [];
    if (existing) this.removeTrack(config.id, false, true);

    const synth = this.createSynth(config.instrument);
    const preset = INSTRUMENT_PRESETS[config.instrument];
    const effects: Tone.ToneAudioNode[] = [];
    for (const fx of preset?.effects ?? []) {
      const node = this.createEffect(fx);
      if (node) effects.push(node);
    }
    const patchFxCount = effects.length;
    for (const fx of config.fx ?? []) {
      const node = this.createEffect(fx);
      if (node) effects.push(node);
    }
    const panner = new Tone.Panner(config.pan ?? 0);
    const channel = new Tone.Volume(config.volume ?? -8);
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.3 });
    channel.connect(meter);
    const chain: Tone.ToneAudioNode[] = [synth, ...effects, panner, channel];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    channel.connect(this.master);

    const subdivision = config.pattern.subdivision ?? "16n";
    const isMembrane = MEMBRANE_INSTRUMENTS.has(config.instrument) || preset?.type === "MembraneSynth";
    const isMetal = preset?.type === "MetalSynth";
    const isNoise = preset?.type === "NoiseSynth";
    const isDrum = DRUM_INSTRUMENTS.has(config.instrument) || isMembrane || isMetal || isNoise;
    const basePortamento = typeof synth.portamento === "number" ? synth.portamento : 0;

    const track: Track = {
      config,
      synth,
      effects,
      patchFxCount,
      panner,
      channel,
      meter,
      playbackError: null,
      current: config.pattern,
      seed,
      muted: false,
      solo: false,
      stepIndex: 0,
      rules,
      isDrum,
      isMembrane,
      isMetal,
      isNoise,
      loop: null as unknown as Tone.Loop,
    };

    track.loop = new Tone.Loop((time) => {
      const steps = track.current.notes;
      if (!steps || steps.length === 0) {
        this.advanceBarClock(track, subdivision);
        return;
      }
      const idx = track.stepIndex % steps.length;
      const pass = Math.floor(track.stepIndex / steps.length) + 1;
      const step = steps[idx];
      track.stepIndex++;

      this.advanceBarClock(track, subdivision);
      Tone.getDraw().schedule(() => {
        for (const l of this.stepListeners) l({ trackId: config.id, step: idx });
      }, time);

      if (!step || !stepFires(step, pass)) return;
      if (track.muted) return;
      if (this.anySolo() && !track.solo) return;
      // After a main-thread stall Tone replays every missed tick at once; the
      // audio for those is already in the past, so skip it instead of piling
      // stale events onto the audio thread and stalling again.
      if (time < Tone.now() - 0.08) return;
      const velocity = step.velocity ?? (isDrum ? 0.8 : 0.7);
      const t0 = time + (step.nudge ? Math.max(-0.05, Math.min(0.05, step.nudge / 1000)) : 0);
      const ratchet = Math.max(1, Math.min(4, Math.round(step.ratchet ?? 1)));
      const slot = ratchet > 1 ? Tone.Time(subdivision).toSeconds() : 0;
      if (typeof synth.portamento === "number") synth.portamento = step.slide ?? basePortamento;
      try {
        for (let r = 0; r < ratchet; r++) {
          const t = t0 + (r * slot) / ratchet;
          const dur = ratchet > 1 ? slot / ratchet / 1.2 : (step.duration ?? (isDrum ? "16n" : "8n"));
          const vel = ratchet > 1 ? velocity * (1 - r * 0.12) : velocity;
          if (isDrum) {
            if (!step.hit && !step.note) return;
            if (isMembrane) synth.triggerAttackRelease?.(step.note ?? "C1", dur, t, vel);
            else if (isMetal || isNoise) synth.triggerAttackRelease?.(ratchet > 1 ? dur : (step.duration ?? (isMetal ? "32n" : "16n")), t, vel);
            else synth.triggerAttackRelease?.(step.note ?? "C2", dur, t, vel);
          } else if (step.note) {
            synth.triggerAttackRelease?.(step.note, dur, t, vel);
          } else if (step.hit) {
            synth.triggerAttackRelease?.("C3", dur, t, vel);
          }
        }
      } catch (err) {
        track.playbackError = (err as Error).message;
        console.warn(`Track ${config.id} playback error:`, (err as Error).message);
      }
    }, subdivision);

    if (this.isPlaying) track.loop.start(Tone.getTransport().nextSubdivision("1m"));
    this.tracks.set(config.id, track);
    this.mods.invalidate();

    this.sections.forEach((section) => {
      if (!section.trackPatterns[config.id]) {
        const [b, u] = section.timeSignature ?? this.timeSignature;
        section.trackPatterns[config.id] = expandToBars(config.pattern.notes, subdivision, section.bars, b, u);
      }
    });
    this.emitChange();
    return this.trackState(track);
  }

  /** Only the first track's clock advances the bar counter; bars drive sections, automation and evolution. */
  private advanceBarClock(track: Track, subdivision: Subdivision): void {
    const first = this.tracks.keys().next().value;
    if (first !== track.config.id) return;
    this.barSteps++;
    const [beats, unit] = this.activeTimeSignature();
    const perBar = stepsPerBar(subdivision, beats, unit);
    if (this.barSteps % perBar !== 0) return;
    this.totalBars++;
    this.currentBar++;
    const section = this.getCurrentSection();
    const nextSection = section && this.currentBar >= section.bars ? this.sections.get(this.arrangement[(this.currentSectionIndex + 1) % this.arrangement.length]) : section;
    const [nextBeats, nextUnit] = nextSection?.timeSignature ?? this.timeSignature;
    const secondsPerBar = (60 / (nextSection?.bpm ?? this.bpm)) * nextBeats * (4 / nextUnit);
    this.mods.onBar(this.totalBars, secondsPerBar);
    this.mods.setPositions(section ? this.currentBar / section.bars : (this.currentBar % 8) / 8, this.arrangement.length ? this.currentSectionIndex / this.arrangement.length : 0);
    this.runEvolution();
    if (section && this.currentBar >= section.bars) {
      this.currentBar = 0;
      this.currentSectionIndex = (this.currentSectionIndex + 1) % this.arrangement.length;
      this.applySectionPatterns();
      this.applySectionTransport();
      this.notifySection();
    }
    this.emitChange();
  }

  private anySolo(): boolean {
    for (const t of this.tracks.values()) if (t.solo) return true;
    return false;
  }

  private rebuildTrack(config: TrackConfig): void {
    const old = this.tracks.get(config.id);
    const muted = old?.muted ?? false;
    const solo = old?.solo ?? false;
    const wasPlaying = this.isPlaying;
    this.addTrack(config);
    const t = this.tracks.get(config.id)!;
    t.muted = muted;
    t.solo = solo;
    if (wasPlaying) t.loop.start(0);
  }

  removeTrack(id: string, emit = true, keepMods = false): void {
    const track = this.tracks.get(id);
    if (!track) return;
    track.loop.stop();
    track.loop.dispose();
    track.synth.dispose();
    track.effects.forEach((n) => n.dispose());
    track.panner.dispose();
    track.channel.dispose();
    track.meter.dispose();
    this.tracks.delete(id);
    this.mods.invalidate();
    if (!keepMods) {
      this.sections.forEach((s) => delete s.trackPatterns[id]);
      this.mods.removeForTrack(id);
    }
    if (emit) this.emitChange();
  }

  updateTrack(id: string, updates: Partial<Omit<TrackConfig, "id">> & { notes?: Step[] }): TrackState {
    const track = this.tracks.get(id);
    if (!track) throw new Error(`no track "${id}"`);
    const config: TrackConfig = { ...track.config, ...updates, id, pattern: { ...track.config.pattern, ...(updates.pattern ?? {}) } };
    if (updates.notes) config.pattern = { ...config.pattern, notes: updates.notes };

    const needsRebuild =
      (updates.instrument && updates.instrument !== track.config.instrument) || (updates.pattern?.subdivision && updates.pattern.subdivision !== track.config.pattern.subdivision) || updates.fx !== undefined;
    if (needsRebuild) {
      this.rebuildTrack(config);
      const rebuilt = this.tracks.get(id)!;
      if (updates.notes) rebuilt.seed = updates.notes.map((s) => ({ ...s }));
      return this.trackState(rebuilt);
    }
    track.config = config;
    track.current = config.pattern;
    if (updates.notes) {
      track.seed = updates.notes.map((s) => ({ ...s }));
      const section = this.getCurrentSection();
      if (section) section.trackPatterns[id] = updates.notes;
    }
    if (updates.volume !== undefined) track.channel.volume.rampTo(updates.volume, 0.05);
    if (updates.pan !== undefined) track.panner.pan.rampTo(updates.pan, 0.05);
    this.emitChange();
    return this.trackState(track);
  }

  setMute(id: string, muted: boolean): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.muted = muted;
    this.emitChange();
  }
  setSolo(id: string, solo: boolean): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.solo = solo;
    this.emitChange();
  }

  audioStatus(): Record<string, unknown> {
    return {
      context: this.started ? Tone.getContext().state : "uninitialized",
      playing: this.isPlaying,
      tracks: [...this.tracks.values()].map((track) => ({
        id: track.config.id, instrument: track.config.instrument,
        muted: track.muted, solo: track.solo, volume: track.channel.volume.value,
        level: track.meter.getValue(), lastPlaybackError: track.playbackError,
      })),
    };
  }

  private trackState(t: Track): TrackState {
    return {
      isDrum: t.isDrum,
      id: t.config.id,
      name: t.config.name,
      instrument: t.config.instrument,
      volume: t.config.volume,
      pan: t.config.pan ?? 0,
      muted: t.muted,
      solo: t.solo,
      pattern: t.current,
      stepCount: t.current.notes.length,
      // The addressable chain: patch effects first, then track effects (<track>.fx.<index>).
      fx: [...(INSTRUMENT_PRESETS[t.config.instrument]?.effects ?? []), ...(t.config.fx ?? [])],
      // Shallow copies so the UI store sees `fired` counters change.
      rules: t.rules.map((r) => ({ ...r })),
      modCount: this.mods.list().filter((m) => m.target.startsWith(`${t.config.id}.`) || (m.source.type === "follower" && m.source.track === t.config.id)).length,
    };
  }

  // --- Sections / arrangement ---
  createSection(id: string, name: string, bars: number, opts: { timeSignature?: [number, number]; bpm?: number } = {}): Section {
    const section: Section = { id, name, bars, timeSignature: opts.timeSignature, bpm: opts.bpm, trackPatterns: {} };
    const [b, u] = section.timeSignature ?? this.timeSignature;
    this.tracks.forEach((t, trackId) => {
      section.trackPatterns[trackId] = expandToBars(t.config.pattern.notes, t.config.pattern.subdivision, bars, b, u);
    });
    this.sections.set(id, section);
    if (this.arrangement.length === 0) this.arrangement.push(id);
    this.emitChange();
    return section;
  }

  updateSection(id: string, updates: { name?: string; bars?: number; timeSignature?: [number, number] | null; bpm?: number | null }): Section {
    const s = this.sections.get(id);
    if (!s) throw new Error(`no section "${id}"`);
    if (updates.name !== undefined) s.name = updates.name;
    if (updates.bars) s.bars = updates.bars;
    if (updates.timeSignature !== undefined) s.timeSignature = updates.timeSignature ?? undefined;
    if (updates.bpm !== undefined) s.bpm = updates.bpm ?? undefined;
    if (this.getCurrentSection()?.id === id) this.applySectionTransport();
    this.emitChange();
    return s;
  }

  removeSection(id: string): void {
    const currentId = this.getCurrentSection()?.id;
    const removedIndex = this.arrangement.indexOf(id);
    this.sections.delete(id);
    this.arrangement = this.arrangement.filter((s) => s !== id);
    if (currentId === id) {
      this.currentSectionIndex = this.arrangement.length
        ? Math.min(removedIndex, this.arrangement.length - 1)
        : 0;
      this.currentBar = 0;
      this.applySectionPatterns();
      this.applySectionTransport();
      this.notifySection();
    } else if (removedIndex >= 0 && removedIndex < this.currentSectionIndex) {
      this.currentSectionIndex--;
    }
    this.emitChange();
  }

  setSectionPattern(sectionId: string, trackId: string, notes: Step[]): void {
    const section = this.sections.get(sectionId);
    if (!section) throw new Error(`no section "${sectionId}"`);
    if (!this.tracks.has(trackId)) throw new Error(`no track "${trackId}"`);
    section.trackPatterns[trackId] = notes;
    if (this.getCurrentSection()?.id === sectionId) this.applySectionPatterns();
    this.emitChange();
  }

  setArrangement(sectionIds: string[]): void {
    const unknown = sectionIds.filter((id) => !this.sections.has(id));
    if (unknown.length) throw new Error(`unknown sections: ${unknown.join(", ")}`);
    this.arrangement = [...sectionIds];
    this.currentSectionIndex = 0;
    this.applySectionPatterns();
    this.applySectionTransport();
    this.emitChange();
  }

  getCurrentSection(): Section | null {
    if (this.arrangement.length === 0) return null;
    return this.sections.get(this.arrangement[this.currentSectionIndex % this.arrangement.length]) ?? null;
  }

  jumpToSection(idOrIndex: string | number): void {
    if (typeof idOrIndex === "number") this.currentSectionIndex = idOrIndex % Math.max(1, this.arrangement.length);
    else {
      const idx = this.arrangement.indexOf(idOrIndex);
      if (idx < 0) throw new Error(`section "${idOrIndex}" is not in the arrangement`);
      this.currentSectionIndex = idx;
    }
    this.currentBar = 0;
    this.applySectionPatterns();
    this.applySectionTransport();
    this.notifySection();
    this.emitChange();
  }

  private applySectionPatterns(): void {
    const section = this.getCurrentSection();
    this.tracks.forEach((track, id) => {
      const notes = section?.trackPatterns[id];
      track.current = notes ? { ...track.config.pattern, notes } : track.config.pattern;
    });
  }

  /** Apply the current section's meter/tempo overrides (or the song defaults). */
  private applySectionTransport(): void {
    if (!this.started) return;
    const section = this.getCurrentSection();
    const ts = section?.timeSignature ?? this.timeSignature;
    const transport = Tone.getTransport();
    const cur = transport.timeSignature;
    const curArr = Array.isArray(cur) ? cur : [cur, 4];
    if (curArr[0] !== ts[0] || curArr[1] !== ts[1]) transport.timeSignature = ts;
    const bpm = section?.bpm ?? this.bpm;
    if (Math.abs(transport.bpm.value - bpm) > 0.01) transport.bpm.rampTo(bpm, 0.05);
    this.barSteps = 0;
  }

  private notifySection(): void {
    const payload = { section: this.getCurrentSection(), index: this.currentSectionIndex };
    for (const l of this.sectionListeners) l(payload);
  }

  // --- Evolution ---
  setEvolution(trackId: string, rules: EvolveRule[]): void {
    const t = this.tracks.get(trackId);
    if (!t) throw new Error(`no track "${trackId}"`);
    t.rules = rules.map((r) => ({ ...r, fired: 0 }));
    this.emitChange();
  }

  clearEvolution(trackId?: string): void {
    if (trackId) {
      const t = this.tracks.get(trackId);
      if (t) t.rules = [];
    } else this.tracks.forEach((t) => (t.rules = []));
    this.emitChange();
  }

  private evolveContext(t: Track): EvolveContext {
    return { key: this.key, scale: this.scale, isDrum: t.isDrum, seed: t.seed, subdivision: t.config.pattern.subdivision };
  }

  /** Run one rule's ops on a track right now; returns the resulting steps. */
  applyRule(trackId: string, rule: EvolveRule): Step[] {
    const t = this.tracks.get(trackId);
    if (!t) throw new Error(`no track "${trackId}"`);
    const ctx = this.evolveContext(t);
    let steps = t.current.notes.map((s) => ({ ...s }));
    const applied: string[] = [];
    for (const op of rule.ops) {
      if (op.type === "param_walk") {
        const h = this.resolveParam(op.path);
        if (h) {
          const step = op.step ?? (h.max - h.min) * 0.05;
          const lo = op.min ?? h.min;
          const hi = op.max ?? h.max;
          const v = Math.max(lo, Math.min(hi, h.get() + (Math.random() * 2 - 1) * step));
          h.set(v, 0.1);
          applied.push(`${op.type}(${op.path}→${round(v)})`);
        }
        continue;
      }
      steps = applyOp(steps, op, ctx);
      applied.push(op.type);
    }
    steps = constrain(steps, rule, ctx);
    t.current = { ...t.current, notes: steps };
    t.config.pattern = { ...t.config.pattern, notes: steps };
    const section = this.getCurrentSection();
    if (section) section.trackPatterns[trackId] = steps;
    rule.fired = (rule.fired ?? 0) + 1;
    const ev: EvolveEvent = { trackId, ruleId: rule.id, ops: applied, bar: this.totalBars };
    for (const l of this.evolveListeners) l(ev);
    this.emitChange();
    return steps;
  }

  /** Called on every bar boundary. */
  private runEvolution(): void {
    for (const [id, t] of this.tracks) {
      for (const rule of t.rules) {
        if (rule.max_generations !== undefined && (rule.fired ?? 0) >= rule.max_generations) continue;
        if (this.totalBars % rule.every !== 0) continue;
        if ((rule.prob ?? 1) < 1 && Math.random() > (rule.prob ?? 1)) continue;
        try {
          this.applyRule(id, rule);
        } catch (err) {
          console.warn(`evolution ${id}/${rule.id}:`, (err as Error).message);
        }
      }
    }
  }

  // --- Generative one-shots (kept from the first pass) ---
  mutate(trackId: string, mutation: string, params: Record<string, unknown> = {}): Step[] {
    const map: Record<string, () => EvolveRule["ops"][number]> = {
      dropout: () => ({ type: "dropout", probability: num(params.probability, 0.15) }),
      humanize: () => ({ type: "humanize", amount: num(params.amount, 0.12), timing: num(params.timing, 0) }),
      reverse: () => ({ type: "reverse" }),
      rotate: () => ({ type: "rotate", steps: num(params.steps, 1) }),
      euclidean: () => ({ type: "euclid_morph", delta: 0, min: num(params.hits, 5), max: num(params.hits, 5), rotation: num(params.rotation, 0) }),
      density: () => ({ type: "density", density: num(params.density, 0.5) }),
      markov: () => ({ type: "markov", order: num(params.order, 1), temperature: num(params.temperature, 1), length: num(params.length, 0) || undefined }),
      cellular: () => ({ type: "cellular", rule: num(params.rule, 90) }),
      lsystem: () => ({ type: "lsystem", depth: num(params.depth, 2), octave: num(params.octave, 4) }),
      genetic: () => ({ type: "genetic", density: params.density as number | undefined, syncopation: params.syncopation as number | undefined, similarity: params.similarity as number | undefined }),
      transpose: () => ({ type: "transpose_scale", degrees: num(params.degrees, 1) }),
      stutter: () => ({ type: "stutter", probability: num(params.probability, 0.15), max_ratchet: num(params.max_ratchet, 3) }),
      probability: () => ({ type: "probability", prob: params.prob as number | undefined, delta: params.delta as number | undefined }),
      reset: () => ({ type: "reset" }),
    };
    const make = map[mutation];
    if (!make) throw new Error(`unknown mutation "${mutation}". Known: ${Object.keys(map).join(", ")}`);
    return this.applyRule(trackId, { id: `once-${mutation}`, every: 1, ops: [make()] });
  }

  // --- State / persistence ---
  getState(): SongState {
    const tracks = [...this.tracks.values()].map((t) => this.trackState(t));
    const sections = [...this.sections.values()].map((s) => ({ id: s.id, name: s.name, bars: s.bars, timeSignature: s.timeSignature, bpm: s.bpm, trackIds: Object.keys(s.trackPatterns) }));
    const customPatches = Object.entries(INSTRUMENT_PRESETS)
      .filter(([, p]) => p.custom)
      .map(([id, p]) => ({ id, type: p.type, effects: p.effects ?? [] }));
    return {
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      key: this.key,
      scale: this.scale,
      isPlaying: this.isPlaying,
      tracks,
      sections,
      arrangement: [...this.arrangement],
      currentSectionIndex: this.currentSectionIndex,
      currentSection: this.getCurrentSection()?.id ?? null,
      currentBar: this.currentBar,
      totalBars: this.totalBars,
      customPatches,
      masterFx: this.masterFxConfig,
      modulations: this.mods.list(),
      automations: [...this.mods.automations.values()],
      macros: Object.fromEntries(this.mods.macros),
    };
  }

  exportSong(name?: string, visuals?: string): SongFile {
    return {
      version: 3,
      name,
      timestamp: Date.now(),
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      key: this.key,
      scale: this.scale,
      tracks: [...this.tracks.values()].map((t) => ({ ...t.config, muted: t.muted, rules: t.rules, seed: t.seed })),
      sections: [...this.sections.values()].map((s) => ({ ...s, trackPatterns: { ...s.trackPatterns } })),
      arrangement: [...this.arrangement],
      customPatches: Object.entries(INSTRUMENT_PRESETS)
        .filter(([, p]) => p.custom)
        .map(([id, p]) => ({ id, ...p })),
      masterFx: this.masterFxConfig,
      modulations: this.mods.list(),
      macros: Object.fromEntries(this.mods.macros),
      visuals,
      automations: [...this.mods.automations.values()],
    };
  }

  async importSong(song: SongFile): Promise<void> {
    await this.init();
    this.stop();
    this.mods.clear();
    [...this.tracks.keys()].forEach((id) => this.removeTrack(id, false));
    this.sections.clear();
    this.arrangement = [];
    this.currentSectionIndex = 0;
    this.totalBars = 0;
    this.bpm = song.bpm ?? 120;
    Tone.getTransport().bpm.value = this.bpm;
    this.timeSignature = song.timeSignature ?? [4, 4];
    Tone.getTransport().timeSignature = this.timeSignature;
    this.key = song.key ?? "C";
    this.scale = song.scale ?? "minor";
    for (const patch of song.customPatches ?? []) {
      const { id, ...rest } = patch;
      INSTRUMENT_PRESETS[id] = { ...rest, custom: true };
    }
    for (const t of song.tracks ?? []) {
      const { muted, rules, seed, ...config } = t;
      this.addTrack({ ...config, pattern: { subdivision: config.pattern.subdivision ?? "16n", notes: parseSteps(config.pattern.notes) } });
      const track = this.tracks.get(config.id)!;
      if (muted) track.muted = true;
      if (rules) {
        try {
          track.rules = parseRules(rules).map((r) => ({ ...r, fired: 0 }));
        } catch (err) {
          console.warn(`skip rules for track ${config.id}:`, (err as Error).message);
        }
      }
      if (seed) track.seed = seed;
    }
    for (const s of song.sections ?? []) this.sections.set(s.id, { ...s, trackPatterns: { ...s.trackPatterns } });
    this.arrangement = (song.arrangement ?? []).filter((id) => this.sections.has(id));
    this.setMasterFx(song.masterFx ?? []);
    for (const [k, v] of Object.entries(song.macros ?? {})) this.mods.setMacro(k, v);
    for (const m of song.modulations ?? []) {
      try {
        this.mods.add(m);
      } catch (err) {
        console.warn("skip modulation", m.id, (err as Error).message);
      }
    }
      for (const automation of song.automations ?? []) {
        try {
          this.mods.addAutomation(automation, 0);
        } catch (err) {
          console.warn("skip automation", automation.id, (err as Error).message);
        }
      }
    this.applySectionPatterns();
    this.emitChange();
  }

  clear(): void {
    this.stop();
    this.mods.clear();
    [...this.tracks.keys()].forEach((id) => this.removeTrack(id, false));
    this.sections.clear();
    this.arrangement = [];
    this.currentSectionIndex = 0;
    this.totalBars = 0;
    this.emitChange();
  }

  /** Average level 0..1 from the FFT, for meters. */
  level(): number {
    if (!this.analyser) return 0;
    const values = this.analyser.getValue() as Float32Array;
    let sum = 0;
    for (const v of values) sum += Math.max(0, (v + 100) / 100);
    return Math.min(1, sum / values.length);
  }
}

function num(v: unknown, d: number): number {
  return typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d;
}
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function readPath(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
function writePath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (const p of path.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
}
function nest(path: string[], value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let cur = out;
  path.forEach((p, i) => {
    if (i === path.length - 1) cur[p] = value;
    else {
      cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
  });
  return out;
}
function safeGet(holder: { get?: () => Record<string, unknown> }): Record<string, unknown> {
  try {
    return holder.get ? holder.get() : {};
  } catch {
    return {};
  }
}

export const engine = new AudioEngine();
