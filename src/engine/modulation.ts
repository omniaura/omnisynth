import * as Tone from "tone";

/**
 * Mod matrix. Sources produce a 0..1 (or -1..1 bipolar) value; targets are
 * parameter paths resolved by the engine (`resolveParam`). Audio-rate LFOs
 * connect straight to Tone Signals; everything else is sampled by a 32n tick.
 */

export type LfoShape = "sine" | "triangle" | "sawtooth" | "square" | "random" | "sh";

export type ModSource =
  | { type: "lfo"; rate: string | number; shape?: LfoShape; phase?: number }
  | { type: "follower"; track: string; attack?: number; release?: number; invert?: boolean }
  | { type: "random"; rate: string | number; smooth?: number }
  | { type: "steps"; values: number[]; rate: string | number }
  | { type: "band"; band: 0 | 1 | 2 | 3 }
  | { type: "macro"; name: string }
  | { type: "bar" } // 0..1 position within the current section
  | { type: "section" }; // 0..1 position within the arrangement

export interface Modulation {
  id: string;
  source: ModSource;
  /** Parameter path, e.g. "acid.fx.0.frequency", "pad.volume", "master.fx.1.wet". */
  target: string;
  /** Range of the modulated parameter: value = offset + depth * source. */
  depth: number;
  offset: number;
  /** Shapes the 0..1 source: 1 linear, 2 squared (slow start), 0.5 sqrt. */
  curve?: number;
  /** True when the source is -1..1 (LFO) rather than 0..1. */
  bipolar?: boolean;
}

export interface ParamHandle {
  path: string;
  /** Current value getter. */
  get(): number;
  /** Set a value (immediate or ramped). */
  set(value: number, rampSeconds?: number): void;
  /** Underlying Tone Signal/Param when the target is audio-rate. */
  signal?: Tone.Signal<"number"> | Tone.Param<"number"> | Tone.Signal<"frequency"> | Tone.Param<"frequency"> | Tone.Signal<"decibels"> | Tone.Param<"decibels">;
  min: number;
  max: number;
  unit?: string;
}

export interface Automation {
  id: string;
  target: string;
  from: number;
  to: number;
  bars: number;
  curve?: "linear" | "exponential";
  startedAtBar?: number;
}

type ParamResolver = (path: string) => ParamHandle | null;
type FollowerSource = (trackId: string) => Tone.ToneAudioNode | null;

interface Live {
  mod: Modulation;
  lfo?: Tone.LFO;
  follower?: Tone.Meter;
  followerGain?: Tone.Gain;
  /** Cached target handle; cleared by invalidate() when the node graph changes. */
  handle?: ParamHandle | null;
  phase: number;
  shValue: number;
  lastStep: number;
  smoothed: number;
}

export class ModMatrix {
  readonly mods = new Map<string, Live>();
  readonly automations = new Map<string, Automation>();
  readonly macros = new Map<string, number>();
  readonly values = new Map<string, number>();
  private tick: Tone.Loop | null = null;
  private bands = [0, 0, 0, 0];
  private barPos = 0;
  private sectionPos = 0;
  private onValues: ((v: Record<string, number>) => void) | null = null;

  constructor(
    private resolve: ParamResolver,
    private followerSource: FollowerSource,
  ) {}

  start(): void {
    if (this.tick) return;
    this.tick = new Tone.Loop((time) => this.step(time), "32n").start(0);
  }

  stop(): void {
    this.tick?.stop();
    this.tick?.dispose();
    this.tick = null;
  }

  setBands(bands: number[]): void {
    this.bands = bands;
  }
  setPositions(bar: number, section: number): void {
    this.barPos = bar;
    this.sectionPos = section;
  }
  setMacro(name: string, value: number): void {
    this.macros.set(name, Math.max(0, Math.min(1, value)));
  }
  subscribe(cb: (v: Record<string, number>) => void): void {
    this.onValues = cb;
  }

  add(mod: Modulation): Modulation {
    this.remove(mod.id);
    const live: Live = { mod, phase: 0, shValue: Math.random(), lastStep: -1, smoothed: 0 };
    const handle = this.resolve(mod.target);
    if (!handle) throw new Error(`unknown parameter "${mod.target}"`);

    if (mod.source.type === "lfo") {
      const shape = mod.source.shape ?? "sine";
      const audioRate = handle.signal && shape !== "sh" && shape !== "random";
      if (audioRate) {
        // Audio-rate: use the same modulation endpoints as the sampled path.
        const a = mod.offset + (mod.bipolar ? -Math.abs(mod.depth) : Math.min(0, mod.depth));
        const b = mod.offset + (mod.bipolar ? Math.abs(mod.depth) : Math.max(0, mod.depth));
        const lo = Math.max(handle.min, Math.min(handle.max, a));
        const hi = Math.max(handle.min, Math.min(handle.max, b));
        const lfo = new Tone.LFO({ frequency: mod.source.rate as Tone.Unit.Frequency, min: lo, max: hi, type: shape as Tone.ToneOscillatorType });
        if (mod.source.phase) lfo.phase = mod.source.phase;
        lfo.connect(handle.signal as unknown as Tone.InputNode);
        lfo.start();
        live.lfo = lfo;
      }
    } else if (mod.source.type === "follower") {
      const src = this.followerSource(mod.source.track);
      if (!src) throw new Error(`follower: unknown track "${mod.source.track}"`);
      // A normalised meter acts as the envelope follower; smoothing approximates attack/release.
      const follower = new Tone.Meter({ normalRange: true, smoothing: Math.max(0.05, Math.min(0.98, 1 - 1 / (1 + ((mod.source.attack ?? 0.01) + (mod.source.release ?? 0.15)) * 20))) });
      const tap = new Tone.Gain(1);
      src.connect(tap);
      tap.connect(follower);
      live.follower = follower;
      live.followerGain = tap;
    }
    this.mods.set(mod.id, live);
    return mod;
  }

  remove(id: string): boolean {
    const live = this.mods.get(id);
    if (!live) return false;
    live.lfo?.stop();
    live.lfo?.dispose();
    live.follower?.dispose();
    live.followerGain?.dispose();
    this.mods.delete(id);
    this.values.delete(id);
    return true;
  }

  /** Drop modulations/automations that point at a track being removed. */
  removeForTrack(trackId: string): void {
    for (const [id, live] of [...this.mods]) {
      const src = live.mod.source;
      if (live.mod.target.startsWith(`${trackId}.`) || (src.type === "follower" && src.track === trackId)) this.remove(id);
    }
    for (const [id, a] of [...this.automations]) if (a.target.startsWith(`${trackId}.`)) this.automations.delete(id);
  }

  clear(): void {
    for (const id of [...this.mods.keys()]) this.remove(id);
    this.automations.clear();
  }

  list(): Modulation[] {
    return [...this.mods.values()].map((l) => l.mod);
  }

  addAutomation(a: Automation, currentBar: number): void {
    if (!this.resolve(a.target)) throw new Error(`unknown parameter "${a.target}"`);
    this.automations.set(a.id, { ...a, startedAtBar: currentBar });
  }

  removeAutomation(id: string): boolean {
    return this.automations.delete(id);
  }

  /** Called by the engine on every bar with the global bar counter. */
  onBar(bar: number, secondsPerBar: number): void {
    for (const [id, a] of [...this.automations]) {
      const start = a.startedAtBar ?? bar;
      const elapsed = bar - start;
      const handle = this.resolve(a.target);
      if (!handle) {
        this.automations.delete(id);
        continue;
      }
      if (elapsed >= a.bars) {
        handle.set(a.to, 0.05);
        this.automations.delete(id);
        continue;
      }
      const t0 = elapsed / a.bars;
      const t1 = (elapsed + 1) / a.bars;
      const shape = (t: number) => (a.curve === "exponential" ? t * t : t);
      const v0 = a.from + (a.to - a.from) * shape(t0);
      const v1 = a.from + (a.to - a.from) * shape(t1);
      handle.set(v0, 0);
      handle.set(v1, secondsPerBar);
    }
  }

  private sourceValue(live: Live, time: number): number | null {
    const s = live.mod.source;
    switch (s.type) {
      case "lfo": {
        if (live.lfo) return null; // audio-rate, nothing to do per tick
        const hz = typeof s.rate === "number" ? s.rate : 1 / Tone.Time(s.rate).toSeconds();
        const period = 1 / Math.max(0.001, hz);
        const ph = ((time % period) / period + (s.phase ?? 0) / 360) % 1;
        if (s.shape === "sh" || s.shape === "random") {
          const step = Math.floor(time / period);
          if (step !== live.lastStep) {
            live.lastStep = step;
            live.shValue = Math.random();
          }
          return live.shValue;
        }
        switch (s.shape ?? "sine") {
          case "sine":
            return 0.5 + 0.5 * Math.sin(2 * Math.PI * ph);
          case "triangle":
            return ph < 0.5 ? 2 * ph : 2 * (1 - ph);
          case "square":
            return ph < 0.5 ? 1 : 0;
          default:
            return ph;
        }
      }
      case "follower": {
        const v = live.follower ? (live.follower.getValue() as number) : 0;
        const n = Math.min(1, Math.max(0, v * 4));
        return s.invert ? 1 - n : n;
      }
      case "random": {
        const hz = typeof s.rate === "number" ? s.rate : 1 / Tone.Time(s.rate).toSeconds();
        const step = Math.floor(time * hz);
        if (step !== live.lastStep) {
          live.lastStep = step;
          live.shValue = Math.random();
        }
        const sm = Math.max(0, Math.min(0.98, s.smooth ?? 0.6));
        live.smoothed = live.smoothed * sm + live.shValue * (1 - sm);
        return live.smoothed;
      }
      case "steps": {
        if (!s.values.length) return 0;
        const sec = typeof s.rate === "number" ? 1 / s.rate : Tone.Time(s.rate).toSeconds();
        const idx = Math.floor(time / sec) % s.values.length;
        return Math.max(0, Math.min(1, s.values[idx]));
      }
      case "band":
        return this.bands[s.band] ?? 0;
      case "macro":
        return this.macros.get(s.name) ?? 0;
      case "bar":
        return this.barPos;
      case "section":
        return this.sectionPos;
    }
  }

  private step(time: number): void {
    const now = Tone.getTransport().seconds;
    // Skip catch-up ticks after a stall; the next on-time tick resumes modulation.
    if (time < Tone.now() - 0.08) return;
    const snapshot: Record<string, number> = {};
    for (const live of this.mods.values()) {
      const raw = this.sourceValue(live, now);
      if (raw === null) continue;
      const m = live.mod;
      let v = Math.max(0, Math.min(1, raw));
      if (m.curve && m.curve !== 1) v = Math.pow(v, m.curve);
      const value = m.offset + m.depth * (m.bipolar ? v * 2 - 1 : v);
      if (!live.handle) live.handle = this.resolve(m.target);
      const handle = live.handle;
      if (!handle) continue;
      const clamped = Math.max(handle.min, Math.min(handle.max, value));
      handle.set(clamped, 0.03);
      this.values.set(m.id, clamped);
      snapshot[m.id] = clamped;
    }
    if (this.onValues) Tone.getDraw().schedule(() => this.onValues?.(snapshot), time);
  }

  /** Forget cached parameter handles (tracks or master chain were rebuilt). */
  invalidate(): void {
    for (const live of this.mods.values()) {
      live.handle = undefined;
      live.lfo?.stop();
      live.lfo?.dispose();
      live.lfo = undefined;
      if (live.mod.source.type !== "lfo") continue;
      const handle = this.resolve(live.mod.target);
      const shape = live.mod.source.shape ?? "sine";
      if (!handle?.signal || shape === "sh" || shape === "random") continue;
      const mod = live.mod;
      const a = mod.offset + (mod.bipolar ? -Math.abs(mod.depth) : Math.min(0, mod.depth));
      const b = mod.offset + (mod.bipolar ? Math.abs(mod.depth) : Math.max(0, mod.depth));
      const lo = Math.max(handle.min, Math.min(handle.max, a));
      const hi = Math.max(handle.min, Math.min(handle.max, b));
      const lfo = new Tone.LFO({ frequency: mod.source.rate as Tone.Unit.Frequency, min: lo, max: hi, type: shape as Tone.ToneOscillatorType });
      if (mod.source.phase) lfo.phase = mod.source.phase;
      lfo.connect(handle.signal as unknown as Tone.InputNode);
      lfo.start();
      live.lfo = lfo;
    }
  }
}

export function parseModSource(input: unknown): ModSource {
  const raw = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || !raw.type) throw new Error("source must be an object with a type");
  return raw as unknown as ModSource;
}

export const MOD_SOURCE_DOC = `Sources:
{"type":"lfo","rate":"1m","shape":"sine"} tempo-synced ("4m","1m","2n","4n","8n") or Hz; shapes sine|triangle|sawtooth|square|random|sh; set bipolar:true for -1..1
{"type":"follower","track":"kick","attack":0.005,"release":0.12,"invert":true} envelope follower — invert:true for sidechain ducking
{"type":"random","rate":"8n","smooth":0.7} smoothed random walk   {"type":"steps","values":[0,0.5,1,0.25],"rate":"4n"} mod lane
{"type":"band","band":0} live audio band 0 bass..3 treble   {"type":"macro","name":"intensity"} 0..1 knob set with set_macro
{"type":"bar"} 0..1 position in the current section   {"type":"section"} 0..1 position through the arrangement
value = offset + depth * source (clamped to the parameter's range). curve 2 = slow start, 0.5 = fast start.`;
